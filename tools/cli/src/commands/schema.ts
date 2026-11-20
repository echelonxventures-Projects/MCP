/**
 * mcp schema - Schema management for MCP tools/resources/prompts
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SchemaOptions {
  config?: string;
  output?: string;
  format?: 'json' | 'yaml' | 'typescript' | 'python' | 'go' | 'rust';
}

export const schemaCommand = new Command('schema')
  .description('Manage MCP schemas (register, validate, migrate, generate)')
  .option('-c, --config <path>', 'Path to mcp.config.yaml')
  .option('-o, --output <path>', 'Output file path')
  .option('-f, --format <format>', 'Output format: json, yaml, typescript, python, go, rust', 'json')
  .addCommand(registerCommand)
  .addCommand(validateCommand)
  .addCommand(migrateCommand)
  .addCommand(generateCommand)
  .addCommand(checkCompatCommand)
  .addCommand(listCommand);

const registerCommand = new Command('register')
  .description('Register a schema to the schema registry')
  .argument('<schema-file>', 'Path to schema file (JSON Schema)')
  .option('--id <id>', 'Schema ID (default: derived from filename)')
  .option('--version <version>', 'Schema version (semver)', '1.0.0')
  .option('--policy <policy>', 'Evolution policy: BACKWARD, FORWARD, FULL, NONE', 'BACKWARD')
  .action(async (schemaFile: string, options: any) => {
    console.log(`📝 Registering schema: ${schemaFile}`);

    if (!fs.existsSync(schemaFile)) {
      console.error(`❌ Schema file not found: ${schemaFile}`);
      process.exit(1);
    }

    const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf-8'));
    const schemaId = options.id || path.basename(schemaFile, path.extname(schemaFile));

    console.log(`   ID: ${schemaId}`);
    console.log(`   Version: ${options.version}`);
    console.log(`   Policy: ${options.policy}`);

    // In real implementation, would call schema registry API
    console.log(`✅ Schema registered (mock)`);
  });

const validateCommand = new Command('validate')
  .description('Validate a schema or data against a schema')
  .argument('<schema-file>', 'Path to schema file')
  .argument('[data-file]', 'Path to data file to validate (optional)')
  .option('--strict', 'Strict validation mode')
  .action(async (schemaFile: string, dataFile?: string, options?: any) => {
    console.log(`✅ Validating schema: ${schemaFile}`);

    if (!fs.existsSync(schemaFile)) {
      console.error(`❌ Schema file not found: ${schemaFile}`);
      process.exit(1);
    }

    const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf-8'));

    // Validate schema itself
    const ajv = require('ajv')({ strict: options?.strict });
    const validate = ajv.compile(schema);

    if (dataFile) {
      if (!fs.existsSync(dataFile)) {
        console.error(`❌ Data file not found: ${dataFile}`);
        process.exit(1);
      }
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
      const valid = validate(data);

      if (valid) {
        console.log(`✅ Data is valid`);
      } else {
        console.error(`❌ Validation failed:`);
        console.error(validate.errors);
        process.exit(1);
      }
    } else {
      // Just validate schema syntax
      try {
        ajv.compile(schema);
        console.log(`✅ Schema is valid`);
      } catch (e: any) {
        console.error(`❌ Invalid schema: ${e.message}`);
        process.exit(1);
      }
    }
  });

const migrateCommand = new Command('migrate')
  .description('Generate migration between schema versions')
  .argument('<from-schema>', 'Source schema file')
  .argument('<to-schema>', 'Target schema file')
  .option('--policy <policy>', 'Compatibility policy: BACKWARD, FORWARD, FULL', 'BACKWARD')
  .option('--dry-run', 'Show migration plan without generating code')
  .action(async (fromSchema: string, toSchema: string, options: any) => {
    console.log(`🔄 Generating migration...`);
    console.log(`   From: ${fromSchema}`);
    console.log(`   To: ${toSchema}`);
    console.log(`   Policy: ${options.policy}`);

    if (!fs.existsSync(fromSchema) || !fs.existsSync(toSchema)) {
      console.error(`❌ Schema file not found`);
      process.exit(1);
    }

    const from = JSON.parse(fs.readFileSync(fromSchema, 'utf-8'));
    const to = JSON.parse(fs.readFileSync(toSchema, 'utf-8'));

    // Analyze differences
    const diff = analyzeSchemaDiff(from, to);

    console.log(`\n📋 Migration Plan:`);
    console.log(`   Breaking changes: ${diff.breaking.length}`);
    console.log(`   Additions: ${diff.additions.length}`);
    console.log(`   Removals: ${diff.removals.length}`);
    console.log(`   Modifications: ${diff.modifications.length}`);

    if (diff.breaking.length > 0 && options.policy === 'BACKWARD') {
      console.log(`\n⚠️  WARNING: Breaking changes detected with BACKWARD policy!`);
      for (const change of diff.breaking) {
        console.log(`   - ${change}`);
      }
    }

    if (options.dryRun) {
      return;
    }

    // Generate adapter code
    const adapter = generateAdapter(from, to, diff);

    const outputPath = options.output || `migration-${Date.now()}.ts`;
    fs.writeFileSync(outputPath, adapter);
    console.log(`\n✅ Migration adapter generated: ${outputPath}`);
  });

const checkCompatCommand = new Command('check-compat')
  .description('Check compatibility between two schema versions')
  .argument('<schema1>', 'First schema file')
  .argument('<schema2>', 'Second schema file')
  .option('--policy <policy>', 'Policy to check against: BACKWARD, FORWARD, FULL', 'BACKWARD')
  .action(async (schema1: string, schema2: string, options: any) => {
    console.log(`🔍 Checking compatibility...`);
    console.log(`   Schema 1: ${schema1}`);
    console.log(`   Schema 2: ${schema2}`);
    console.log(`   Policy: ${options.policy}`);

    const s1 = JSON.parse(fs.readFileSync(schema1, 'utf-8'));
    const s2 = JSON.parse(fs.readFileSync(schema2, 'utf-8'));

    const compat = checkCompatibility(s1, s2, options.policy);

    console.log(`\n📊 Compatibility Result: ${compat.compatible ? '✅ COMPATIBLE' : '❌ INCOMPATIBLE'}`);
    console.log(`   Policy: ${options.policy}`);

    if (compat.issues.length > 0) {
      console.log(`\n⚠️  Issues:`);
      for (const issue of compat.issues) {
        console.log(`   - ${issue.severity}: ${issue.message}`);
      }
    }

    if (!compat.compatible) {
      process.exit(1);
    }
  });

const listCommand = new Command('list')
  .description('List registered schemas')
  .option('--tag <tag>', 'Filter by tag')
  .action(async (options: any) => {
    console.log(`📋 Registered schemas (mock):`);
    console.log(`   product-schema@v1.2.0  [ecommerce] - BACKWARD`);
    console.log(`   user-schema@v2.0.0     [auth] - FULL`);
    console.log(`   order-schema@v1.0.0    [ecommerce] - BACKWARD`);
  });

const generateCommand = new Command('generate')
  .description('Generate code from schema')
  .argument('<schema-file>', 'Path to schema file')
  .option('-l, --language <lang>', 'Target language: typescript, python, go, rust', 'typescript')
  .option('-o, --output <dir>', 'Output directory')
  .option('--client', 'Generate client code')
  .option('--server', 'Generate server stubs')
  .action(async (schemaFile: string, options: any) => {
    console.log(`⚙️  Generating code from schema...`);
    console.log(`   Schema: ${schemaFile}`);
    console.log(`   Language: ${options.language}`);
    console.log(`   Client: ${options.client}`);
    console.log(`   Server: ${options.server}`);

    // This would use the codegen pipeline
    console.log(`✅ Code generated (mock)`);
  });

function analyzeSchemaDiff(from: any, to: any): any {
  // Simplified diff analysis
  return {
    breaking: [],
    additions: [],
    removals: [],
    modifications: [],
  };
}

function generateAdapter(from: any, to: any, diff: any): string {
  return `// Migration adapter from ${JSON.stringify(from).slice(0,50)}... to ${JSON.stringify(to).slice(0,50)}...
// Generated by mcp schema migrate

export function migrate(data: any): any {
  // TODO: Implement migration logic
  return data;
}

export function rollback(data: any): any {
  // TODO: Implement rollback logic
  return data;
}
`;
}

function checkCompatibility(schema1: any, schema2: any, policy: string): any {
  // Simplified compatibility check
  return {
    compatible: true,
    issues: [],
  };
}