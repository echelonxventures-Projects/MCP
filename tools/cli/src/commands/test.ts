/**
 * mcp test - Run tests for MCP server
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestOptions {
  contract?: boolean;
  integration?: boolean;
  load?: boolean;
  unit?: boolean;
  coverage?: boolean;
  watch?: boolean;
  filter?: string;
  config?: string;
}

export const testCommand = new Command('test')
  .description('Run tests for MCP server')
  .option('--contract', 'Run protocol contract tests only')
  .option('--integration', 'Run integration tests')
  .option('--load', 'Run load tests (k6)')
  .option('--unit', 'Run unit tests only')
  .option('--coverage', 'Generate coverage report')
  .option('--watch', 'Watch mode for unit tests')
  .option('-f, --filter <pattern>', 'Filter tests by pattern')
  .option('-c, --config <path>', 'Path to mcp.config.yaml')
  .action(async (options: TestOptions) => {
    const config = loadConfig(options.config);
    const projectType = detectProjectType();

    console.log(`🧪 Running MCP tests...`);
    console.log(`   Project: ${projectType}`);

    if (options.contract) {
      await runContractTests(projectType, options);
    } else if (options.integration) {
      await runIntegrationTests(projectType, options);
    } else if (options.load) {
      await runLoadTests(projectType, options);
    } else {
      await runUnitTests(projectType, options);
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

async function runUnitTests(projectType: string, options: TestOptions): Promise<void> {
  console.log(`📋 Running unit tests...`);

  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[] = [];

    switch (projectType) {
      case 'typescript':
        cmd = 'npx';
        args = ['vitest', 'run'];
        if (options.watch) args = ['vitest'];
        if (options.coverage) args.push('--coverage');
        if (options.filter) args.push('-t', options.filter);
        break;
      case 'python':
        cmd = 'python';
        args = ['-m', 'pytest'];
        if (options.coverage) args.push('--cov=src', '--cov-report=html');
        if (options.filter) args.push('-k', options.filter);
        if (options.watch) args.push('--looponfail');
        break;
      case 'go':
        cmd = 'go';
        args = ['test', './...'];
        if (options.coverage) args.push('-coverprofile=coverage.out');
        if (options.filter) args.push('-run', options.filter);
        break;
      case 'rust':
        cmd = 'cargo';
        args = ['test'];
        if (options.filter) args.push('--', options.filter);
        break;
      default:
        reject(new Error('Unknown project type'));
        return;
    }

    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code: number) => {
      if (code === 0) {
        console.log(`✅ Unit tests passed`);
        resolve();
      } else {
        reject(new Error(`Tests failed with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function runContractTests(projectType: string, options: TestOptions): Promise<void> {
  console.log(`📜 Running protocol contract tests...`);

  // Contract tests verify MCP protocol compliance across all languages
  const contractTestPath = path.join(__dirname, '..', '..', '..', 'tests', 'protocol-compliance');

  if (!fs.existsSync(contractTestPath)) {
    console.log(`⚠️  Contract tests not found at ${contractTestPath}`);
    console.log(`   Run 'mcp generate contract-tests' to create them`);
    return;
  }

  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];

    switch (projectType) {
      case 'typescript':
        cmd = 'npx';
        args = ['vitest', 'run', path.join(contractTestPath, 'test-suite.ts')];
        break;
      case 'python':
        cmd = 'python';
        args = ['-m', 'pytest', path.join(contractTestPath, 'test_contract.py')];
        break;
      case 'go':
        cmd = 'go';
        args = ['test', '-v', path.join(contractTestPath, 'go')];
        break;
      case 'rust':
        cmd = 'cargo';
        args = ['test', '--test', 'contract'];
        break;
      default:
        reject(new Error('Unknown project type'));
        return;
    }

    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code: number) => {
      if (code === 0) {
        console.log(`✅ Contract tests passed`);
        resolve();
      } else {
        reject(new Error(`Contract tests failed with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function runIntegrationTests(projectType: string, options: TestOptions): Promise<void> {
  console.log(`🔗 Running integration tests...`);

  const integrationTestPath = path.join(__dirname, '..', '..', '..', 'tests', 'integration');

  if (!fs.existsSync(integrationTestPath)) {
    console.log(`⚠️  Integration tests not found at ${integrationTestPath}`);
    return;
  }

  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];

    switch (projectType) {
      case 'typescript':
        cmd = 'npx';
        args = ['vitest', 'run', path.join(integrationTestPath, '**/*.test.ts')];
        break;
      case 'python':
        cmd = 'python';
        args = ['-m', 'pytest', path.join(integrationTestPath)];
        break;
      case 'go':
        cmd = 'go';
        args = ['test', '-v', path.join(integrationTestPath, '...')];
        break;
      case 'rust':
        cmd = 'cargo';
        args = ['test', '--test', 'integration'];
        break;
      default:
        reject(new Error('Unknown project type'));
        return;
    }

    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code: number) => {
      if (code === 0) {
        console.log(`✅ Integration tests passed`);
        resolve();
      } else {
        reject(new Error(`Integration tests failed with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function runLoadTests(projectType: string, options: TestOptions): Promise<void> {
  console.log(`⚡ Running load tests...`);

  // Check for k6
  try {
    const { execSync } = require('child_process');
    execSync('which k6', { stdio: 'ignore' });
  } catch {
    console.error(`❌ k6 not installed. Install from https://k6.io/docs/getting-started/installation/`);
    return;
  }

  const loadTestPath = path.join(__dirname, '..', '..', '..', 'tests', 'load');

  if (!fs.existsSync(loadTestPath)) {
    console.log(`⚠️  Load tests not found at ${loadTestPath}`);
    console.log(`   Run 'mcp generate load-tests' to create them`);
    return;
  }

  return new Promise((resolve, reject) => {
    const script = path.join(loadTestPath, 'mcp-load-test.js');
    const args = ['run', '--vus', '50', '--duration', '30s', script];

    const child = spawn('k6', args, { stdio: 'inherit' });
    child.on('close', (code: number) => {
      if (code === 0) {
        console.log(`✅ Load tests completed`);
        resolve();
      } else {
        reject(new Error(`Load tests failed with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}