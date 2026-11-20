/**
 * mcp dev - Start development server with hot reload
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DevOptions {
  transport?: string;
  port?: number;
  host?: string;
  config?: string;
  watch?: string[];
  env?: string[];
  inspect?: boolean;
  inspectPort?: number;
}

export const devCommand = new Command('dev')
  .description('Start development server with hot reload')
  .option('-t, --transport <transport>', 'Transport type: stdio, http-sse, websocket, grpc', 'websocket')
  .option('-p, --port <port>', 'Port number', '3000')
  .option('-H, --host <host>', 'Host address', '0.0.0.0')
  .option('-c, --config <path>', 'Path to mcp.config.yaml')
  .option('-w, --watch <paths...>', 'Additional paths to watch')
  .option('-e, --env <env...>', 'Environment variables (KEY=VALUE)')
  .option('--inspect', 'Enable Node.js inspector')
  .option('--inspect-port <port>', 'Inspector port', '9229')
  .action(async (options: DevOptions) => {
    const config = loadConfig(options.config);
    const transport = options.transport || config.transport?.type || 'websocket';
    const port = options.port || config.transport?.port || 3000;
    const host = options.host || config.transport?.host || '0.0.0.0';

    console.log(`🔧 Starting MCP dev server...`);
    console.log(`   Transport: ${transport}`);
    console.log(`   Address: ${host}:${port}`);
    console.log(`   Config: ${options.config || 'mcp.config.yaml'}`);

    // Set environment variables
    if (options.env) {
      for (const env of options.env) {
        const [key, value] = env.split('=');
        if (key && value) {
          process.env[key] = value;
        }
      }
    }

    // Detect project type
    const projectType = detectProjectType();
    console.log(`   Project: ${projectType}`);

    // Start dev server based on project type
    let child: ChildProcess;

    switch (projectType) {
      case 'typescript':
        child = startTypeScriptDev(transport, port, host, options);
        break;
      case 'python':
        child = startPythonDev(transport, port, host, options);
        break;
      case 'go':
        child = startGoDev(transport, port, host, options);
        break;
      case 'rust':
        child = startRustDev(transport, port, host, options);
        break;
      default:
        console.error('❌ Could not detect project type. Run from project root or specify --config');
        process.exit(1);
    }

    // Handle shutdown
    setupShutdown(child);
  });

function loadConfig(configPath?: string): any {
  const path = configPath || 'mcp.config.yaml';
  if (fs.existsSync(path)) {
    try {
      const yaml = require('js-yaml');
      return yaml.load(fs.readFileSync(path, 'utf-8'));
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

function startTypeScriptDev(transport: string, port: number, host: string, options: DevOptions): ChildProcess {
  const args = ['watch', 'src/index.ts'];

  if (options.inspect) {
    args.unshift(`--inspect=${options.inspectPort || 9229}`);
  }

  // Add transport config via env
  process.env.MCP_TRANSPORT = transport;
  process.env.MCP_PORT = port.toString();
  process.env.MCP_HOST = host;

  console.log(`🚀 Starting TypeScript dev server with tsx...`);

  return spawn('npx', ['tsx', ...args], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });
}

function startPythonDev(transport: string, port: number, host: string, options: DevOptions): ChildProcess {
  const args = ['src/server.py'];

  if (options.inspect) {
    args.unshift('-m', 'debugpy', '--listen', `0.0.0.0:${options.inspectPort || 5678}`);
  }

  process.env.MCP_TRANSPORT = transport;
  process.env.MCP_PORT = port.toString();
  process.env.MCP_HOST = host;

  console.log(`🚀 Starting Python dev server...`);

  // Check for watch mode (watchfiles or similar)
  if (hasWatchDependency()) {
    return spawn('python', ['-m', 'watchfiles', 'src/**/*.py', '--', ...args], {
      stdio: 'inherit',
      env: process.env,
    });
  }

  return spawn('python', args, {
    stdio: 'inherit',
    env: process.env,
  });
}

function hasWatchDependency(): boolean {
  // Check if watchfiles or similar is installed
  try {
    require.resolve('watchfiles');
    return true;
  } catch {
    return false;
  }
}

function startGoDev(transport: string, port: number, host: string, options: DevOptions): ChildProcess {
  process.env.MCP_TRANSPORT = transport;
  process.env.MCP_PORT = port.toString();
  process.env.MCP_HOST = host;

  console.log(`🚀 Starting Go dev server with air (hot reload)...`);

  // Check for air (Go hot reload)
  if (hasAir()) {
    return spawn('air', [], {
      stdio: 'inherit',
      env: process.env,
    });
  }

  // Fallback to go run
  return spawn('go', ['run', 'main.go'], {
    stdio: 'inherit',
    env: process.env,
  });
}

function hasAir(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('which air', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function startRustDev(transport: string, port: number, host: string, options: DevOptions): ChildProcess {
  process.env.MCP_TRANSPORT = transport;
  process.env.MCP_PORT = port.toString();
  process.env.MCP_HOST = host;

  console.log(`🚀 Starting Rust dev server with cargo watch...`);

  // Check for cargo-watch
  if (hasCargoWatch()) {
    return spawn('cargo', ['watch', '-x', 'run'], {
      stdio: 'inherit',
      env: process.env,
    });
  }

  // Fallback to cargo run
  return spawn('cargo', ['run'], {
    stdio: 'inherit',
    env: process.env,
  });
}

function hasCargoWatch(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('cargo install --list | grep cargo-watch', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function setupShutdown(child: ChildProcess): void {
  const shutdown = (signal: string) => {
    console.log(`\n🛑 Received ${signal}, shutting down...`);
    child.kill(signal as NodeJS.Signals);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (code !== null) {
      console.log(`\n👋 Dev server exited with code ${code}`);
    } else if (signal) {
      console.log(`\n👋 Dev server terminated by ${signal}`);
    }
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error(`❌ Dev server error: ${err.message}`);
    process.exit(1);
  });
}