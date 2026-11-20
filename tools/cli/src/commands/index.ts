#!/usr/bin/env node
/**
 * MCP CLI - Universal command-line interface for MCP development
 * Supports: init, dev, run, test, deploy, schema, server management
 */

import { Command } from 'commander';
import { version } from '../../package.json';
import { initCommand } from './init';
import { devCommand } from './dev';
import { runCommand } from './run';
import { testCommand } from './test';
import { deployCommand } from './deploy';
import { schemaCommand } from './schema';
import { serverCommand } from './server';
import { generateCommand } from './generate';

const program = new Command();

program
  .name('mcp')
  .description('MCP - Universal Model Context Protocol CLI')
  .version(version)
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-c, --config <path>', 'Path to mcp.config.yaml')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      process.env.MCP_VERBOSE = 'true';
    }
  });

// Register commands
program.addCommand(initCommand);
program.addCommand(devCommand);
program.addCommand(runCommand);
program.addCommand(testCommand);
program.addCommand(deployCommand);
program.addCommand(schemaCommand);
program.addCommand(serverCommand);
program.addCommand(generateCommand);

// Global help
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ mcp init my-server --template typescript --transport websocket');
  console.log('  $ mcp dev --transport websocket --port 3000');
  console.log('  $ mcp test --contract');
  console.log('  $ mcp deploy staging --canary');
  console.log('  $ mcp schema register ./schemas/product.json');
  console.log('  $ mcp server list');
  console.log('');
  console.log('Documentation: https://mcp.dev/docs/cli');
});

program.parse(process.argv);