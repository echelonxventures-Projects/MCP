/**
 * mcp run - Run MCP server in production-like mode locally
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RunOptions {
  transport?: string;
  port?: number;
  host?: string;
  config?: string;
  env?: string[];
  build?: boolean;
}

export const runCommand = new Command('run')
  .description('Run MCP server in production-like mode locally')
  .option('-t, --transport <transport>', 'Transport type: stdio, http-sse, websocket, grpc')
  .option('-p, --port <port>', 'Port number')
  .option('-H, --host <host>', 'Host address')
  .option('-c, --config <path>', 'Path to mcp.config.yaml')
  .option('-e, --env <env...>', 'Environment variables (KEY=VALUE)')
  .option('--build', 'Build before running', true)
  .option('--no-build', 'Skip build step')
  .action(async (options: RunOptions) => {
    const config = loadConfig(options.config);
    const transport = options.transport || config.transport?.type || 'websocket';
    const port = options.port || config.transport?.port || 3000;
    const host = options.host || config.transport?.host || '0.0.0.0';

    console.log(`🏃 Running MCP server...`);
    console.log(`   Transport: ${transport}`);
    console.log(`   Address: ${host}:${port}`);

    // Set environment variables
    if (options.env) {
      for (const env of options.env) {
        const [key, value] = env.split('=');
        if (key && value) {
          process.env[key] = value;
        }
      }
    }

    process.env.MCP_TRANSPORT = transport;
    process.env.MCP_PORT = port.toString();
    process.env.MCP_HOST = host;
    process.env.NODE_ENV = 'production';

    const projectType = detectProjectType();
    console.log(`   Project: ${projectType}`);

    // Build if requested
    if (options.build !== false) {
      await buildProject(projectType);
    }

    // Run production server
    await runProject(projectType, transport, port, host);
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

async function buildProject(projectType: string): Promise<void> {
  console.log(`🔨 Building project...`);

  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];

    switch (projectType) {
      case 'typescript':
        cmd = 'npm';
        args = ['run', 'build'];
        break;
      case 'python':
        // Python doesn't typically need a build step
        console.log(`   Python: skipping build`);
        resolve();
        return;
      case 'go':
        cmd = 'go';
        args = ['build', '-o', 'bin/server', 'main.go'];
        break;
      case 'rust':
        cmd = 'cargo';
        args = ['build', '--release'];
        break;
      default:
        resolve();
        return;
    }

    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code: number) => {
      if (code === 0) {
        console.log(`✅ Build complete`);
        resolve();
      } else {
        reject(new Error(`Build failed with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function runProject(projectType: string, transport: string, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];

    switch (projectType) {
      case 'typescript':
        cmd = 'node';
        args = ['dist/index.js'];
        break;
      case 'python':
        cmd = 'python';
        args = ['src/server.py'];
        break;
      case 'go':
        cmd = './bin/server';
        args = [];
        break;
      case 'rust':
        cmd = './target/release/' + getProjectName();
        args = [];
        break;
      default:
        reject(new Error('Unknown project type'));
        return;
    }

    console.log(`🚀 Starting production server...`);

    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });

    child.on('close', (code: number) => {
      resolve();
    });

    child.on('error', (err) => {
      reject(err);
    });

    // Handle shutdown
    const shutdown = (signal: string) => {
      console.log(`\n🛑 Received ${signal}, shutting down...`);
      child.kill(signal as NodeJS.Signals);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });
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
  return 'server';
}