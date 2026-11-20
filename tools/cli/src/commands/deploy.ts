/**
 * mcp deploy - Deploy MCP server to various targets
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DeployOptions {
  target?: string;
  environment?: string;
  canary?: boolean;
  rollback?: boolean;
  dryRun?: boolean;
  config?: string;
  namespace?: string;
  registry?: string;
  tag?: string;
}

export const deployCommand = new Command('deploy')
  .description('Deploy MCP server to various targets')
  .argument('[environment]', 'Target environment (staging, production, etc.)', 'staging')
  .option('-t, --target <target>', 'Deployment target: k8s, serverless, edge, docker', 'k8s')
  .option('--canary', 'Deploy as canary (progressive rollout)')
  .option('--rollback', 'Rollback to previous version')
  .option('--dry-run', 'Show what would be deployed without applying')
  .option('-c, --config <path>', 'Path to mcp.config.yaml')
  .option('-n, --namespace <namespace>', 'Kubernetes namespace')
  .option('-r, --registry <registry>', 'Container registry')
  .option('--tag <tag>', 'Image tag (default: git sha)')
  .action(async (environment: string, options: DeployOptions) => {
    const config = loadConfig(options.config);
    const projectType = detectProjectType();

    console.log(`🚀 Deploying MCP server...`);
    console.log(`   Environment: ${environment}`);
    console.log(`   Target: ${options.target}`);
    console.log(`   Project: ${projectType}`);

    if (options.rollback) {
      await rollback(environment, options);
      return;
    }

    // Build and push image
    const imageTag = options.tag || getGitSha();
    const imageName = `${options.registry || 'ghcr.io/mcp'}/${config.server?.name || getProjectName()}:${imageTag}`;

    if (!options.dryRun) {
      await buildAndPushImage(projectType, imageName);
    }

    // Deploy based on target
    switch (options.target) {
      case 'k8s':
        await deployK8s(environment, imageName, options);
        break;
      case 'serverless':
        await deployServerless(environment, imageName, options);
        break;
      case 'edge':
        await deployEdge(environment, imageName, options);
        break;
      case 'docker':
        await deployDocker(environment, imageName, options);
        break;
      default:
        console.error(`❌ Unknown target: ${options.target}`);
        process.exit(1);
    }
  });

function loadConfig(configPath?: string): any {
  const configFile = configPath || 'mcp.config.yaml';
  if (fs.existsSync(configFile)) {
    try {
      const yaml = require('js-yaml');
      return yaml.load(fs.readFileSync(configFile, 'utf-8'));
    } catch (e) {
      console.warn(`⚠️  Could not load config: ${e}`);
    }
  }
  return {};
}

function detectProjectType(): string {
  if (fs.existsSync('package.json')) return 'typescript';
  if (fs.existsSync('pyproject.toml') || fs.existsSync('setup.py') || fs.existsSync('requirements.txt')) return 'python';
  if (fs.existsSync('go.mod')) return 'go';
  if (fs.existsSync('Cargo.toml')) return 'rust';
  return 'unknown';
}

function getProjectName(): string {
  if (fs.existsSync('package.json')) {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    return pkg.name;
  }
  if (fs.existsSync('Cargo.toml')) {
    const content = fs.readFileSync('Cargo.toml', 'utf-8');
    const match = content.match(/name\s*=\s*"([^"]+)"/);
    return match ? match[1] : 'server';
  }
  if (fs.existsSync('pyproject.toml')) {
    const content = fs.readFileSync('pyproject.toml', 'utf-8');
    const match = content.match(/name\s*=\s*"([^"]+)"/);
    return match ? match[1] : 'server';
  }
  return 'mcp-server';
}

function getGitSha(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'latest';
  }
}

async function buildAndPushImage(projectType: string, imageName: string): Promise<void> {
  console.log(`🔨 Building Docker image: ${imageName}`);

  return new Promise((resolve, reject) => {
    // Generate Dockerfile if not exists
    if (!fs.existsSync('Dockerfile')) {
      generateDockerfile(projectType);
    }

    const child = spawn('docker', ['build', '-t', imageName, '.'], { stdio: 'inherit' });
    child.on('close', async (code: number) => {
      if (code !== 0) {
        reject(new Error('Docker build failed'));
        return;
      }

      console.log(`📤 Pushing image...`);
      const pushChild = spawn('docker', ['push', imageName], { stdio: 'inherit' });
      pushChild.on('close', (pushCode: number) => {
        if (pushCode === 0) {
          console.log(`✅ Image pushed: ${imageName}`);
          resolve();
        } else {
          reject(new Error('Docker push failed'));
        }
      });
    });
    child.on('error', reject);
  });
}

function generateDockerfile(projectType: string): void {
  let dockerfile: string;

  switch (projectType) {
    case 'typescript':
      dockerfile = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
`;
      break;
    case 'python':
      dockerfile = `FROM python:3.11-slim AS builder
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e .

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY src ./src
USER 1000
EXPOSE 8080
CMD ["python", "src/server.py"]
`;
      break;
    case 'go':
      dockerfile = `FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server main.go

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /app/server /server
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/server"]
`;
      break;
    case 'rust':
      dockerfile = `FROM rust:1.75 AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN cargo build --release

FROM gcr.io/distroless/cc:nonroot
COPY --from=builder /app/target/release/server /server
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/server"]
`;
      break;
    default:
      dockerfile = '# Generated Dockerfile';
  }

  fs.writeFileSync('Dockerfile', dockerfile);
  console.log(`📝 Generated Dockerfile for ${projectType}`);
}

async function deployK8s(environment: string, imageName: string, options: DeployOptions): Promise<void> {
  console.log(`☸️  Deploying to Kubernetes (${environment})...`);

  const namespace = options.namespace || `mcp-${environment}`;
  const chartPath = path.join(__dirname, '..', '..', '..', 'deploy', 'helm', 'mcp-server');

  if (!fs.existsSync(chartPath)) {
    console.error(`❌ Helm chart not found at ${chartPath}`);
    process.exit(1);
  }

  const args = [
    'upgrade', '--install',
    `${getProjectName()}-${environment}`,
    chartPath,
    '--namespace', namespace,
    '--create-namespace',
    '--set', `image.repository=${imageName.split(':')[0]}`,
    '--set', `image.tag=${imageName.split(':')[1]}`,
    '--set', `environment=${environment}`,
  ];

  if (options.canary) {
    args.push('--set', 'canary.enabled=true');
  }

  if (options.dryRun) {
    args.push('--dry-run=client');
  }

  await runCommand('helm', args);
}

async function deployServerless(environment: string, imageName: string, options: DeployOptions): Promise<void> {
  console.log(`☁️  Deploying to Serverless (${environment})...`);

  // Check for serverless framework
  try {
    const { execSync } = require('child_process');
    execSync('which serverless', { stdio: 'ignore' });
  } catch {
    console.error(`❌ Serverless Framework not installed. Run 'npm install -g serverless'`);
    return;
  }

  const serverlessConfig = generateServerlessConfig(environment, imageName);
  fs.writeFileSync('serverless.yml', serverlessConfig);

  await runCommand('serverless', ['deploy', '--stage', environment]);
}

function generateServerlessConfig(environment: string, imageName: string): string {
  return `service: ${getProjectName()}-${environment}

provider:
  name: aws
  runtime: nodejs20.x
  stage: ${environment}
  region: us-east-1
  httpApi:
    cors: true

functions:
  mcp:
    image: ${imageName}
    handler: dist/index.handler
    events:
      - httpApi:
          path: /{proxy+}
          method: ANY
    environment:
      MCP_TRANSPORT: http-sse
      MCP_PORT: 8080

plugins:
  - serverless-container
`;
}

async function deployEdge(environment: string, imageName: string, options: DeployOptions): Promise<void> {
  console.log(`🌍 Deploying to Edge (${environment})...`);

  // Cloudflare Workers
  const wranglerConfig = `name = "${getProjectName()}-${environment}"
main = "dist/index.js"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[build]
command = "npm run build"

[env]
MCP_TRANSPORT = "custom"
MCP_ENDPOINT = "https://${getProjectName()}-${environment}.workers.dev"
`;

  fs.writeFileSync('wrangler.toml', wranglerConfig);

  await runCommand('npx', ['wrangler', 'deploy', '--env', environment]);
}

async function deployDocker(environment: string, imageName: string, options: DeployOptions): Promise<void> {
  console.log(`🐳 Deploying with Docker Compose (${environment})...`);

  const composeConfig = generateDockerCompose(environment, imageName);
  fs.writeFileSync('docker-compose.yml', composeConfig);

  await runCommand('docker-compose', ['-f', 'docker-compose.yml', 'up', '-d']);
}

function generateDockerCompose(environment: string, imageName: string): string {
  return `version: '3.8'

services:
  mcp-server:
    image: ${imageName}
    ports:
      - "3000:3000"
    environment:
      - MCP_TRANSPORT=websocket
      - MCP_PORT=3000
      - NODE_ENV=${environment}
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '0.5'
          memory: 1G
      restart_policy:
        condition: on-failure
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
`;
}

async function rollback(environment: string, options: DeployOptions): Promise<void> {
  console.log(`⏪ Rolling back ${environment}...`);

  const namespace = options.namespace || `mcp-${environment}`;

  await runCommand('helm', [
    'rollback',
    `${getProjectName()}-${environment}`,
    '-n', namespace,
  ]);

  console.log(`✅ Rollback complete`);
}

async function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`   $ ${cmd} ${args.join(' ')}`);

    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code: number) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} failed with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}