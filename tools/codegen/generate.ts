#!/usr/bin/env node
/**
 * MCP Multi-Language Code Generation Pipeline
 *
 * Reads the TypeScript-first protocol specification and generates
 * idiomatic bindings for TypeScript, Python, Go, and Rust.
 *
 * Usage:
 *   npx tsx generate.ts --target=all --out=packages
 *   npx tsx generate.ts --target=typescript,python --out=./output
 */

import { Project, SourceFile, SyntaxKind, InterfaceDeclaration, TypeAliasDeclaration, EnumDeclaration } from 'ts-morph';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

interface CodegenConfig {
  specPath: string;
  outputDir: string;
  targets: ('typescript' | 'python' | 'go' | 'rust')[];
  verbose: boolean;
}

const DEFAULT_CONFIG: CodegenConfig = {
  specPath: join(__dirname, '../../spec/protocol/mcp-core.ts'),
  outputDir: join(__dirname, '../../packages'),
  targets: ['typescript', 'python', 'go', 'rust'],
  verbose: false,
};

// ============================================================================
// Type Extraction
// ============================================================================

interface ExtractedType {
  name: string;
  kind: 'interface' | 'type' | 'enum';
  source: string;
  zodSchema?: string;
  documentation?: string;
  properties?: ExtractedProperty[];
  extends?: string[];
}

interface ExtractedProperty {
  name: string;
  type: string;
  optional: boolean;
  documentation?: string;
}

function extractTypesFromSpec(specPath: string): ExtractedType[] {
  const project = new Project({
    tsConfigFilePath: join(__dirname, '../../tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFile = project.addSourceFileAtPath(specPath);
  const types: ExtractedType[] = [];

  // Extract interfaces
  sourceFile.getInterfaces().forEach((iface: InterfaceDeclaration) => {
    const name = iface.getName();
    if (!name || name.startsWith('_') || name === 'Transport') return; // Skip internal/transport types

    const properties: ExtractedProperty[] = [];
    iface.getProperties().forEach(prop => {
      properties.push({
        name: prop.getName(),
        type: prop.getType().getText(),
        optional: prop.hasQuestionToken(),
        documentation: prop.getJsDocs().map(d => d.getDescription()).join('\n'),
      });
    });

    types.push({
      name,
      kind: 'interface',
      source: iface.getText(),
      documentation: iface.getJsDocs().map(d => d.getDescription()).join('\n'),
      properties,
      extends: iface.getExtends().map(e => e.getText()),
    });
  });

  // Extract type aliases
  sourceFile.getTypeAliases().forEach((alias: TypeAliasDeclaration) => {
    const name = alias.getName();
    if (!name || name.startsWith('_')) return;

    types.push({
      name,
      kind: 'type',
      source: alias.getText(),
      documentation: alias.getJsDocs().map(d => d.getDescription()).join('\n'),
    });
  });

  // Extract enums
  sourceFile.getEnums().forEach((enu: EnumDeclaration) => {
    const name = enu.getName();
    if (!name || name.startsWith('_')) return;

    types.push({
      name,
      kind: 'enum',
      source: enu.getText(),
      documentation: enu.getJsDocs().map(d => d.getDescription()).join('\n'),
    });
  });

  return types;
}

// ============================================================================
// TypeScript Generator
// ============================================================================

function generateTypeScript(types: ExtractedType[], outputDir: string): void {
  const tsDir = join(outputDir, 'typescript/types/src');
  mkdirSync(tsDir, { recursive: true });

  let output = `/**
 * @mcp/types - TypeScript MCP Types
 * Auto-generated from spec/protocol/mcp-core.ts
 * DO NOT EDIT MANUALLY
 */

import { z } from 'zod';
import type { JSONSchema } from '../../spec/protocol/mcp-core';

// ============================================================================
// Re-export all protocol types
// ============================================================================
`;

  // Group types by category
  const interfaces = types.filter(t => t.kind === 'interface');
  const typeAliases = types.filter(t => t.kind === 'type');
  const enums = types.filter(t => t.kind === 'enum');

  // Export all types
  const allNames = types.map(t => t.name);
  output += `export type {\n  ${allNames.join(',\n  ')}\n} from '../../spec/protocol/mcp-core';\n\n`;

  // Export Zod schemas
  output += `// ============================================================================\n// Zod Validators\n// ============================================================================\n\n`;

  interfaces.forEach(t => {
    const zodName = t.name + 'Zod';
    output += `export { ${zodName} } from '../../spec/protocol/mcp-core';\n`;
  });

  output += `\n// ============================================================================\n// Branded Types\n// ============================================================================\n\n`;

  // Branded ID types
  const brandedTypes = [
    'ServerId',
    'ToolName',
    'ResourceUri',
    'PromptName',
    'ConnectionId',
    'RequestId',
  ];

  brandedTypes.forEach(name => {
    output += `export type ${name} = string & { readonly __brand: unique symbol };\n`;
    output += `export function create${name}(value: string): ${name} { return value as ${name}; }\n\n`;
  });

  output += `// ============================================================================\n// Utility Types\n// ============================================================================\n\n`;
  output += `export type JSONSchema = import('../../spec/protocol/mcp-core').JSONSchema;\n`;
  output += `export type MCPResult<T> = { result: T } | { error: import('../../spec/protocol/mcp-core').MCPError };\n`;
  output += `export type ToolResult = import('../../spec/protocol/mcp-core').CallToolResult;\n`;
  output += `export type ResourceContents = import('../../spec/protocol/mcp-core').ResourceContents;\n\n`;

  output += `// ============================================================================\n// Type Guards\n// ============================================================================\n\n`;
  output += `export { isRequest, isNotification, isResponse, isErrorResponse, isMCPError, isTool, isResource, isPrompt, isResourceContents } from '../../spec/protocol/mcp-core';\n`;

  // Write index.ts
  writeFileSync(join(tsDir, 'index.ts'), output);

  // Write package.json
  const pkgJson = {
    name: '@mcp/types',
    version: '0.1.0',
    description: 'TypeScript MCP Protocol Types',
    main: './index.js',
    module: './index.mjs',
    types: './index.d.ts',
    exports: {
      '.': {
        types: './index.d.ts',
        import: './index.mjs',
        require: './index.js',
      },
    },
    scripts: {
      build: 'tsc',
      test: 'vitest run',
    },
    peerDependencies: {
      zod: '>=3.22.0',
    },
    devDependencies: {
      typescript: '>=5.0.0',
      vitest: '>=1.0.0',
      zod: '>=3.22.0',
    },
    keywords: ['mcp', 'model-context-protocol', 'types'],
    license: 'MIT',
  };
  writeFileSync(join(outputDir, 'typescript/types/package.json'), JSON.stringify(pkgJson, null, 2));

  // Write tsconfig.json
  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022'],
      declaration: true,
      declarationMap: true,
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };
  writeFileSync(join(outputDir, 'typescript/types/tsconfig.json'), JSON.stringify(tsConfig, null, 2));

  console.log(`Generated TypeScript types at ${tsDir}`);
}

// ============================================================================
// Python Generator
// ============================================================================

function generatePython(types: ExtractedType[], outputDir: string): void {
  const pyDir = join(outputDir, 'python/mcp_types/mcp_types');
  mkdirSync(pyDir, { recursive: true });

  let output = `"""
mcp-types - Python MCP Protocol Types
Auto-generated from spec/protocol/mcp-core.ts
DO NOT EDIT MANUALLY
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union, Literal, Annotated
from pydantic import BaseModel, Field, ConfigDict, TypeAdapter
from typing_extensions import NewType
import json


# ============================================================================
# Branded Types
# ============================================================================

ServerId = NewType('ServerId', str)
ToolName = NewType('ToolName', str)
ResourceUri = NewType('ResourceUri', str)
PromptName = NewType('PromptName', str)
ConnectionId = NewType('ConnectionId', str)
RequestId = NewType('RequestId', str)


def create_server_id(value: str) -> ServerId:
    return ServerId(value)


def create_tool_name(value: str) -> ToolName:
    return ToolName(value)


def create_resource_uri(value: str) -> ResourceUri:
    return ResourceUri(value)


def create_prompt_name(value: str) -> PromptName:
    return PromptName(value)


def create_connection_id(value: str) -> ConnectionId:
    return ConnectionId(value)


def create_request_id(value: str) -> RequestId:
    return RequestId(value)


# ============================================================================
# JSON Schema
# ============================================================================

JSONSchema = Dict[str, Any]


# ============================================================================
# Protocol Types
# ============================================================================
`

  // Generate Pydantic models for interfaces
  const interfaces = types.filter(t => t.kind === 'interface');
  interfaces.forEach(t => {
    const name = t.name;
    if (name.endsWith('Zod') || name.endsWith('Config') || name.includes('Builder')) return;

    output += `class ${name}(BaseModel):\n`;
    output += `    \"\"\"${t.documentation || ''}\"\"\"\n`;
    output += `    model_config = ConfigDict(extra='allow')\n\n`;

    if (t.properties) {
      t.properties.forEach(prop => {
        const pyType = convertTypeToPython(prop.type);
        const fieldDef = prop.optional
          ? `    ${prop.name}: Optional[${pyType}] = Field(default=None)`
          : `    ${prop.name}: ${pyType}`;
        if (prop.documentation) {
          const typeStr = prop.optional ? `Optional[${pyType}]` : pyType;
          output += `    ${prop.name}: ${typeStr} = Field(description="${prop.documentation.replace(/"/g, '\\"')}")\n`;
        } else {
          output += `${fieldDef}\n`;
        }
      });
    }
    output += `\n\n`;
  });

  // Utility functions
  output += `# ============================================================================\n# Utility Functions\n# ============================================================================\n\n`;
  output += `def validate_tool_result(data: Dict[str, Any]) -> bool:\n    \"\"\"Validate tool result structure.\"\"\"\n    return 'content' in data\n\n`;
  output += `def validate_resource_contents(data: Dict[str, Any]) -> bool:\n    \"\"\"Validate resource contents structure.\"\"\"\n    return 'uri' in data and 'mimeType' in data\n\n`;

  // Type adapters
  output += `# ============================================================================\n# Type Adapters for JSON Schema Generation\n# ============================================================================\n\n`;
  interfaces.forEach(t => {
    if (!t.name.endsWith('Zod') && !t.name.endsWith('Config')) {
      output += `${t.name}Adapter = TypeAdapter(${t.name})\n`;
    }
  });

  writeFileSync(join(pyDir, '__init__.py'), output);

  // pyproject.toml
  const pyproject = `[project]
name = "mcp-types"
version = "0.1.0"
description = "Python MCP Protocol Types"
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
    "pydantic>=2.6.0",
    "typing-extensions>=4.9.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "hypothesis>=6.90.0",
    "pytest-asyncio>=0.23.0",
]

[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
`;
  writeFileSync(join(outputDir, 'python/mcp_types/pyproject.toml'), pyproject);

  console.log(`Generated Python types at ${pyDir}`);
}

function convertTypeToPython(tsType: string): string {
  const typeMap: Record<string, string> = {
    'string': 'str',
    'number': 'float',
    'boolean': 'bool',
    'string | number': 'Union[str, float]',
    'Record<string, unknown>': 'Dict[str, Any]',
    'Record<string, string>': 'Dict[str, str]',
    'unknown': 'Any',
    'never': 'Never',
    'void': 'None',
  };

  // Handle arrays
  if (tsType.endsWith('[]')) {
    const inner = tsType.slice(0, -2);
    return `List[${convertTypeToPython(inner)}]`;
  }

  // Handle unions
  if (tsType.includes(' | ')) {
    const parts = tsType.split(' | ').map(p => convertTypeToPython(p.trim()));
    return `Union[${parts.join(', ')}]`;
  }

  return typeMap[tsType] || tsType;
}

// ============================================================================
// Go Generator
// ============================================================================

function generateGo(types: ExtractedType[], outputDir: string): void {
  const goDir = join(outputDir, 'go/types');
  mkdirSync(goDir, { recursive: true });

  let output = `// Package types provides Go MCP protocol types
// Auto-generated from spec/protocol/mcp-core.ts
// DO NOT EDIT MANUALLY

package types

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/go-playground/validator/v10"
	"github.com/xeipuuv/gojsonschema"
)

var validate = validator.New()

// ============================================================================
// Branded Types
// ============================================================================

type ServerID string
type ToolName string
type ResourceURI string
type PromptName string
type ConnectionID string
type RequestID string

func NewServerID(v string) ServerID      { return ServerID(v) }
func NewToolName(v string) ToolName      { return ToolName(v) }
func NewResourceURI(v string) ResourceURI { return ResourceURI(v) }
func NewPromptName(v string) PromptName   { return PromptName(v) }
func NewConnectionID(v string) ConnectionID { return ConnectionID(v) }
func NewRequestID(v string) RequestID     { return RequestID(v) }

// ============================================================================
// JSON Schema
// ============================================================================

type JSONSchema map[string]interface{}

// ValidateJSONSchema validates a JSON schema using gojsonschema
func ValidateJSONSchema(schema JSONSchema) error {
	sl := gojsonschema.NewGoLoader(schema)
	_, err := gojsonschema.NewSchema(sl)
	return err
}

// ============================================================================
// Protocol Types
// ============================================================================
`

  const interfaces = types.filter(t => t.kind === 'interface');
  interfaces.forEach(t => {
    const name = t.name;
    if (name.endsWith('Zod') || name.endsWith('Config') || name.includes('Builder')) return;

    output += `// ${t.documentation || ''}\n`;
    output += `type ${name} struct {\n`;

    if (t.properties) {
      t.properties.forEach(prop => {
        const goType = convertTypeToGo(prop.type);
        const tag = prop.optional ? 'omitempty' : 'required';
        const jsonName = prop.name.charAt(0).toLowerCase() + prop.name.slice(1);
        output += `\t${prop.name} ${goType} \`json:"${jsonName},${tag}" validate:"${tag}"\`\n`;
      });
    }
    output += `}\n\n`;

    // Validation method
    output += `func (${name[0].toLowerCase()} *${name}) Validate() error {\n`;
    output += `\treturn validate.Struct(${name[0].toLowerCase()})\n`;
    output += `}\n\n`;
  });

  // Utility functions
  output += `// ============================================================================\n// Utility Functions\n// ============================================================================\n\n`;
  output += `var (\n`;
  output += `\tErrInvalidToolResult = errors.New("invalid tool result: missing content")\n`;
  output += `\tErrInvalidResourceContents = errors.New("invalid resource contents: missing uri or mimeType")\n`;
  output += `)\n\n`;

  output += `func ValidateToolResult(data map[string]interface{}) error {\n`;
  output += `\tif _, ok := data["content"]; !ok {\n`;
  output += `\t\treturn ErrInvalidToolResult\n`;
  output += `\t}\n`;
  output += `\treturn nil\n`;
  output += `}\n\n`;

  output += `func ValidateResourceContents(data map[string]interface{}) error {\n`;
  output += `\tif _, ok := data["uri"]; !ok {\n`;
  output += `\t\treturn ErrInvalidResourceContents\n`;
  output += `\t}\n`;
  output += `\tif _, ok := data["mimeType"]; !ok {\n`;
  output += `\t\treturn ErrInvalidResourceContents\n`;
  output += `\t}\n`;
  output += `\treturn nil\n`;
  output += `}\n\n`;

  // JSON Schema generation
  output += `// GenerateJSONSchema generates a JSON schema for the given type\n`;
  output += `func GenerateJSONSchema(v interface{}) (JSONSchema, error) {\n`;
  output += `\treflector := gojsonschema.NewReflector()\n`;
  output += `\tschema, err := reflector.Reflect(v)\n`;
  output += `\tif err != nil {\n`;
  output += `\t\treturn nil, err\n`;
  output += `\t}\n`;
  output += `\tdoc, err := json.Marshal(schema)\n`;
  output += `\tif err != nil {\n`;
  output += `\t\treturn nil, err\n`;
  output += `\t}\n`;
  output += `\tvar result JSONSchema\n`;
  output += `\tif err := json.Unmarshal(doc, &result); err != nil {\n`;
  output += `\t\treturn nil, err\n`;
  output += `\t}\n`;
  output += `\treturn result, nil\n`;
  output += `}\n`;

  writeFileSync(join(goDir, 'types.go'), output);

  // go.mod
  const goMod = `module github.com/mcp/go-sdk/types

go 1.22

require (
	github.com/go-playground/validator/v10 v10.16.0
	github.com/xeipuuv/gojsonschema v1.2.0
)
`;
  writeFileSync(join(goDir, 'go.mod'), goMod);

  console.log(`Generated Go types at ${goDir}`);
}

function convertTypeToGo(tsType: string): string {
  const typeMap: Record<string, string> = {
    'string': 'string',
    'number': 'float64',
    'boolean': 'bool',
    'string | number': 'interface{}',
    'Record<string, unknown>': 'map[string]interface{}',
    'Record<string, string>': 'map[string]string',
    'unknown': 'interface{}',
    'never': 'struct{}',
    'void': 'struct{}',
  };

  if (tsType.endsWith('[]')) {
    const inner = tsType.slice(0, -2);
    return `[]${convertTypeToGo(inner)}`;
  }

  if (tsType.includes(' | ')) {
    return 'interface{}';
  }

  return typeMap[tsType] || tsType;
}

// ============================================================================
// Rust Generator
// ============================================================================

function generateRust(types: ExtractedType[], outputDir: string): void {
  const rsDir = join(outputDir, 'rust/mcp-types/src');
  mkdirSync(rsDir, { recursive: true });

  let output = `//! mcp-types - Rust MCP Protocol Types
//! Auto-generated from spec/protocol/mcp-core.ts
//! DO NOT EDIT MANUALLY

use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use validator::Validate;
use thiserror::Error;
use std::collections::HashMap;

// ============================================================================
// Branded Types
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct ServerId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct ToolName(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct ResourceUri(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct PromptName(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct ConnectionId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct RequestId(pub String);

impl ServerId {
    pub fn new(value: String) -> Self { Self(value) }
}

impl ToolName {
    pub fn new(value: String) -> Self { Self(value) }
}

impl ResourceUri {
    pub fn new(value: String) -> Self { Self(value) }
}

impl PromptName {
    pub fn new(value: String) -> Self { Self(value) }
}

impl ConnectionId {
    pub fn new(value: String) -> Self { Self(value) }
}

impl RequestId {
    pub fn new(value: String) -> Self { Self(value) }
}

// ============================================================================
// JSON Schema
// ============================================================================

pub type JSONSchema = serde_json::Value;

// ============================================================================
// Errors
// ============================================================================

#[derive(Debug, Error)]
pub enum MCPError {
    #[error("validation error: {0}")]
    Validation(String),
    #[error("invalid tool result: missing content")]
    InvalidToolResult,
    #[error("invalid resource contents: missing uri or mimeType")]
    InvalidResourceContents,
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

// ============================================================================
// Protocol Types
// ============================================================================
`

  const interfaces = types.filter(t => t.kind === 'interface');
  interfaces.forEach(t => {
    const name = t.name;
    if (name.endsWith('Zod') || name.endsWith('Config') || name.includes('Builder')) return;

    output += `/// ${t.documentation || ''}\n`;
    output += `#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]\n`;
    output += `pub struct ${name} {\n`;

    if (t.properties) {
      t.properties.forEach(prop => {
        const rsType = convertTypeToRust(prop.type);
        output += `    #[serde(rename = "${prop.name.charAt(0).toLowerCase() + prop.name.slice(1)}"${prop.optional ? ', skip_serializing_if = "Option::is_none"' : ''})]\n`;
        output += `    ${prop.optional ? `Option<${rsType}>` : rsType},\n`;
      });
    }
    output += `}\n\n`;

    // Validation impl
    output += `impl ${name} {\n`;
    output += `    pub fn validate(&self) -> Result<(), MCPError> {\n`;
    output += `        self.validate().map_err(|e| MCPError::Validation(e.to_string()))\n`;
    output += `    }\n`;
    output += `}\n\n`;
  });

  // Utility functions
  output += `// ============================================================================\n// Utility Functions\n// ============================================================================\n\n`;
  output += `pub fn validate_tool_result(data: &serde_json::Value) -> Result<(), MCPError> {\n`;
  output += `    if data.get("content").is_none() {\n`;
  output += `        return Err(MCPError::InvalidToolResult);\n`;
  output += `    }\n`;
  output += `    Ok(())\n`;
  output += `}\n\n`;

  output += `pub fn validate_resource_contents(data: &serde_json::Value) -> Result<(), MCPError> {\n`;
  output += `    if data.get("uri").is_none() || data.get("mimeType").is_none() {\n`;
  output += `        return Err(MCPError::InvalidResourceContents);\n`;
  output += `    }\n`;
  output += `    Ok(())\n`;
  output += `}\n\n`;

  // JSON Schema generation
  output += `pub fn generate_json_schema<T: JsonSchema>() -> Result<JSONSchema, MCPError> {\n`;
  output += `    let schema = schemars::schema_for!(T);\n`;
  output += `    Ok(serde_json::to_value(schema)?)\n`;
  output += `}\n`;

  writeFileSync(join(rsDir, 'lib.rs'), output);

  // Cargo.toml
  const cargoToml = `[package]
name = "mcp-types"
version = "0.1.0"
edition = "2021"
description = "Rust MCP Protocol Types"
license = "MIT"
repository = "https://github.com/mcp/mcp"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
schemars = { version = "0.8", features = ["derive"] }
validator = { version = "0.19", features = ["derive"] }
thiserror = "1.0"
serde_json = "1.0"

[dev-dependencies]
proptest = "1.0"
tokio = { version = "1.0", features = ["full"] }
`;
  writeFileSync(join(outputDir, 'rust/mcp-types/Cargo.toml'), cargoToml);

  console.log(`Generated Rust types at ${rsDir}`);
}

function convertTypeToRust(tsType: string): string {
  const typeMap: Record<string, string> = {
    'string': 'String',
    'number': 'f64',
    'boolean': 'bool',
    'string | number': 'serde_json::Value',
    'Record<string, unknown>': 'HashMap<String, serde_json::Value>',
    'Record<string, string>': 'HashMap<String, String>',
    'unknown': 'serde_json::Value',
    'never': '()',
    'void': '()',
  };

  if (tsType.endsWith('[]')) {
    const inner = tsType.slice(0, -2);
    return `Vec<${convertTypeToRust(inner)}>`;
  }

  if (tsType.includes(' | ')) {
    return 'serde_json::Value';
  }

  return typeMap[tsType] || tsType;
}

// ============================================================================
// Main
// ============================================================================

function parseArgs(): CodegenConfig {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--spec':
        config.specPath = args[++i];
        break;
      case '--out':
      case '--output':
        config.outputDir = args[++i];
        break;
      case '--target':
        config.targets = args[++i].split(',') as CodegenConfig['targets'];
        break;
      case '--verbose':
        config.verbose = true;
        break;
      case '--help':
        console.log(`
MCP Code Generation Pipeline

Usage:
  npx tsx generate.ts [options]

Options:
  --spec <path>       Path to protocol spec (default: spec/protocol/mcp-core.ts)
  --out <dir>         Output directory (default: packages)
  --target <list>     Comma-separated targets: typescript,python,go,rust (default: all)
  --verbose           Verbose output
  --help              Show this help
        `);
        process.exit(0);
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();

  console.log('Reading protocol spec...');
  const types = extractTypesFromSpec(config.specPath);
  console.log(`Extracted ${types.length} types`);

  if (config.targets.includes('typescript')) {
    console.log('Generating TypeScript...');
    generateTypeScript(types, config.outputDir);
  }

  if (config.targets.includes('python')) {
    console.log('Generating Python...');
    generatePython(types, config.outputDir);
  }

  if (config.targets.includes('go')) {
    console.log('Generating Go...');
    generateGo(types, config.outputDir);
  }

  if (config.targets.includes('rust')) {
    console.log('Generating Rust...');
    generateRust(types, config.outputDir);
  }

  console.log('Code generation complete!');
}

main().catch(err => {
  console.error('Generation failed:', err);
  process.exit(1);
});