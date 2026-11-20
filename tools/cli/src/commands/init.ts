/**
 * mcp init - Scaffold a new MCP server project
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface InitOptions {
  template?: string;
  transport?: string;
  language?: string;
  directory?: string;
  git?: boolean;
  install?: boolean;
}

const TEMPLATES = {
  typescript: {
    'basic-server': {
      description: 'Minimal MCP server with one tool',
      files: ['package.json', 'tsconfig.json', 'src/index.ts', 'README.md'],
    },
    'ecommerce-catalog': {
      description: 'Product search, recommendations, cart tools',
      files: ['package.json', 'tsconfig.json', 'src/index.ts', 'src/tools/catalog.ts', 'README.md'],
    },
    'ride-sharing-dispatch': {
      description: 'Driver matching, routing, real-time tracking',
      files: ['package.json', 'tsconfig.json', 'src/index.ts', 'src/tools/dispatch.ts', 'README.md'],
    },
    'analytics-engine': {
      description: 'SQL query, visualization, report generation',
      files: ['package.json', 'tsconfig.json', 'src/index.ts', 'src/tools/analytics.ts', 'README.md'],
    },
    'consultancy-workflow': {
      description: 'Document analysis, template prompts, workflow tools',
      files: ['package.json', 'tsconfig.json', 'src/index.ts', 'src/tools/workflow.ts', 'README.md'],
    },
  },
  python: {
    'basic-server': {
      description: 'Minimal MCP server with one tool',
      files: ['pyproject.toml', 'src/server.py', 'README.md'],
    },
    'data-pipeline': {
      description: 'ETL tools, dataset resources, transformation prompts',
      files: ['pyproject.toml', 'src/server.py', 'src/tools/etl.py', 'README.md'],
    },
    'ml-model-server': {
      description: 'Inference tools, model registry, prediction resources',
      files: ['pyproject.toml', 'src/server.py', 'src/tools/inference.py', 'README.md'],
    },
    'rag-pipeline': {
      description: 'Retrieval, rerank, generation tools',
      files: ['pyproject.toml', 'src/server.py', 'src/tools/rag.py', 'README.md'],
    },
  },
  go: {
    'basic-server': {
      description: 'Minimal MCP server with one tool',
      files: ['go.mod', 'main.go', 'README.md'],
    },
    'high-throughput': {
      description: 'Optimized for 10k+ RPS with connection pooling',
      files: ['go.mod', 'main.go', 'internal/server.go', 'README.md'],
    },
    'edge-collector': {
      description: 'Lightweight edge ingestion with minimal footprint',
      files: ['go.mod', 'main.go', 'internal/collector.go', 'README.md'],
    },
  },
  rust: {
    'basic-server': {
      description: 'Minimal MCP server with one tool',
      files: ['Cargo.toml', 'src/main.rs', 'README.md'],
    },
    'embedded-device': {
      description: 'no_std, minimal footprint for embedded',
      files: ['Cargo.toml', 'src/main.rs', 'src/embedded.rs', 'README.md'],
    },
    'wasm-module': {
      description: 'Browser/WASI deployment',
      files: ['Cargo.toml', 'src/main.rs', 'src/wasm.rs', 'README.md'],
    },
  },
};

const TRANSPORTS = ['stdio', 'http-sse', 'websocket', 'grpc', 'custom'];

export const initCommand = new Command('init')
  .description('Scaffold a new MCP server project')
  .argument('<name>', 'Project name')
  .option('-t, --template <template>', 'Template to use (see --list-templates)')
  .option('-T, --transport <transport>', `Transport type: ${TRANSPORTS.join(', ')}`, 'websocket')
  .option('-l, --language <language>', 'Language: typescript, python, go, rust', 'typescript')
  .option('-d, --directory <dir>', 'Target directory (default: project name)')
  .option('--git', 'Initialize git repository', true)
  .option('--no-git', 'Skip git initialization')
  .option('--install', 'Install dependencies after scaffolding', false)
  .option('--list-templates', 'List available templates')
  .action(async (name: string, options: InitOptions) => {
    if (options.listTemplates) {
      listTemplates(options.language || 'typescript');
      return;
    }

    const language = options.language || 'typescript';
    const template = options.template || 'basic-server';
    const transport = options.transport || 'websocket';
    const targetDir = options.directory || name;

    // Validate
    if (!TEMPLATES[language as keyof typeof TEMPLATES]) {
      console.error(`❌ Unknown language: ${language}`);
      console.error(`Available: ${Object.keys(TEMPLATES).join(', ')}`);
      process.exit(1);
    }

    const langTemplates = TEMPLATES[language as keyof typeof TEMPLATES];
    if (!langTemplates[template as keyof typeof langTemplates]) {
      console.error(`❌ Unknown template: ${template} for ${language}`);
      console.error(`Available: ${Object.keys(langTemplates).join(', ')}`);
      process.exit(1);
    }

    if (!TRANSPORTS.includes(transport)) {
      console.error(`❌ Unknown transport: ${transport}`);
      console.error(`Available: ${TRANSPORTS.join(', ')}`);
      process.exit(1);
    }

    // Create project
    console.log(`🚀 Creating ${language} MCP server: ${name}`);
    console.log(`   Template: ${template}`);
    console.log(`   Transport: ${transport}`);
    console.log(`   Directory: ${targetDir}`);

    await createProject(name, targetDir, language, template, transport, options);

    if (options.git) {
      await initGit(targetDir);
    }

    if (options.install) {
      await installDeps(targetDir, language);
    }

    console.log(`\n✅ Project created at ${targetDir}`);
    console.log(`\nNext steps:`);
    console.log(`  cd ${targetDir}`);
    if (!options.install) {
      console.log(`  ${getInstallCommand(language)}`);
    }
    console.log(`  mcp dev`);
  });

function listTemplates(language: string) {
  const langTemplates = TEMPLATES[language as keyof typeof TEMPLATES];
  if (!langTemplates) {
    console.error(`❌ Unknown language: ${language}`);
    return;
  }

  console.log(`\nAvailable templates for ${language}:`);
  for (const [key, value] of Object.entries(langTemplates)) {
    console.log(`  ${key.padEnd(25)} - ${value.description}`);
  }
  console.log('');
}

async function createProject(
  name: string,
  targetDir: string,
  language: string,
  template: string,
  transport: string,
  options: InitOptions
) {
  const templatePath = path.join(__dirname, '..', 'templates', language, template);

  // Create directory
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Read template files and process them
  const langTemplates = TEMPLATES[language as keyof typeof TEMPLATES];
  const templateInfo = langTemplates[template as keyof typeof langTemplates];

  for (const file of templateInfo.files) {
    const srcPath = path.join(templatePath, file);
    const destPath = path.join(targetDir, file);

    let content: string;
    if (fs.existsSync(srcPath)) {
      content = fs.readFileSync(srcPath, 'utf-8');
    } else {
      // Generate from built-in templates
      content = generateTemplateFile(language, template, file, { name, transport });
    }

    // Replace placeholders
    content = content
      .replace(/{{NAME}}/g, name)
      .replace(/{{TRANSPORT}}/g, transport)
      .replace(/{{LANGUAGE}}/g, language);

    // Ensure directory exists
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.writeFileSync(destPath, content);
  }

  // Create mcp.config.yaml
  const config = generateConfig(name, language, transport);
  fs.writeFileSync(path.join(targetDir, 'mcp.config.yaml'), config);

  // Create .gitignore
  const gitignore = generateGitignore(language);
  fs.writeFileSync(path.join(targetDir, '.gitignore'), gitignore);
}

function generateTemplateFile(language: string, template: string, file: string, vars: { name: string; transport: string }): string {
  const { name, transport } = vars;

  // Built-in minimal templates
  if (language === 'typescript') {
    if (file === 'package.json') {
      return JSON.stringify({
        name,
        version: '1.0.0',
        description: 'MCP Server',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        scripts: {
          build: 'tsc',
          dev: 'tsx watch src/index.ts',
          start: 'node dist/index.js',
          test: 'vitest run',
        },
        dependencies: {
          '@mcp/server': '^0.1.0',
          '@mcp/types': '^0.1.0',
          '@mcp/transports': '^0.1.0',
          zod: '^3.22.0',
        },
        devDependencies: {
          typescript: '^5.3.0',
          tsx: '^4.7.0',
          vitest: '^1.0.0',
          '@types/node': '^20.10.0',
        },
      }, null, 2);
    }
    if (file === 'tsconfig.json') {
      return JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: './dist',
          rootDir: './src',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          declaration: true,
          declarationMap: true,
          sourceMap: true,
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist'],
      }, null, 2);
    }
    if (file === 'src/index.ts') {
      return `import { McpServer, tool } from "@mcp/server";
import { z } from "zod";
import { createTransport } from "@mcp/transports";

const server = new McpServer({
  name: "${name}",
  version: "1.0.0",
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true },
    prompts: { listChanged: true },
  },
});

server.tool(
  "hello",
  "Say hello",
  { name: z.string() },
  async ({ name }) => ({
    content: [{ type: "text", text: \`Hello, \${name}!\` }],
  })
);

async function main() {
  const transport = createTransport({ type: "${transport}", port: 3000 });
  await server.start({ transport });
  console.log("Server started on ${transport}:3000");
}

main().catch(console.error);
`;
    }
    if (file === 'README.md') {
      return `# ${name}

MCP Server built with TypeScript.

## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

## Transport

Uses \`${transport}\` transport.
`;
    }
  }

  if (language === 'python') {
    if (file === 'pyproject.toml') {
      return `[project]
name = "${name}"
version = "1.0.0"
description = "MCP Server"
requires-python = ">=3.10"
dependencies = [
    "mcp-server>=0.1.0",
    "mcp-types>=0.1.0",
    "mcp-transports>=0.1.0",
    "pydantic>=2.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
asyncio_mode = "auto"
`;
    }
    if (file === 'src/server.py') {
      return `from mcp_server import McpServer, tool
from mcp_transports import create_transport
from pydantic import BaseModel

class HelloArgs(BaseModel):
    name: str

server = McpServer(
    name="${name}",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True},
        "prompts": {"listChanged": True},
    }
)

@tool("hello", "Say hello")
async def hello(args: HelloArgs) -> str:
    return f"Hello, {args.name}!"

async def main():
    transport = create_transport("${transport}", port=3000)
    await server.start(transport)
    print(f"Server started on ${transport}:3000")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
`;
    }
    if (file === 'README.md') {
      return `# ${name}

MCP Server built with Python.

## Quick Start

\`\`\`bash
pip install -e .
mcp dev
\`\`\`

## Transport

Uses \`${transport}\` transport.
`;
    }
  }

  if (language === 'go') {
    if (file === 'go.mod') {
      return `module ${name}

go 1.23

require (
    github.com/mcp/go-sdk/server v0.1.0
    github.com/mcp/go-sdk/types v0.1.0
    github.com/mcp/go-sdk/transports v0.1.0
)
`;
    }
    if (file === 'main.go') {
      return `package main

import (
    "context"
    "log"

    "github.com/mcp/go-sdk/server"
    "github.com/mcp/go-sdk/transports"
)

func main() {
    s := server.NewMcpServer(&server.Config{
        Name:    "${name}",
        Version: "1.0.0",
        Capabilities: server.Capabilities{
            Tools:     &server.ToolsCapability{ListChanged: true},
            Resources: &server.ResourcesCapability{Subscribe: true},
            Prompts:   &server.PromptsCapability{ListChanged: true},
        },
    })

    s.RegisterTool("hello", "Say hello", func(ctx context.Context, args map[string]any) (any, error) {
        name := args["name"].(string)
        return map[string]any{"content": []any{map[string]string{"type": "text", "text": "Hello, " + name + "!"}}}, nil
    })

    transport, err := transports.CreateTransport("${transport}", map[string]any{"port": 3000})
    if err != nil {
        log.Fatal(err)
    }

    if err := s.Start(transport); err != nil {
        log.Fatal(err)
    }
}
`;
    }
    if (file === 'README.md') {
      return `# ${name}

MCP Server built with Go.

## Quick Start

\`\`\`bash
go mod tidy
go run main.go
\`\`\`

## Transport

Uses \`${transport}\` transport.
`;
    }
  }

  if (language === 'rust') {
    if (file === 'Cargo.toml') {
      return `[package]
name = "${name}"
version = "1.0.0"
edition = "2021"

[dependencies]
mcp-server = "0.1"
mcp-types = "0.1"
mcp-transports = "0.1"
tokio = { version = "1.0", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
`;
    }
    if (file === 'src/main.rs') {
      return `use mcp_server::{McpServer, ToolHandler};
use mcp_transports::create_transport;
use mcp_types::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
struct HelloArgs {
    name: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut server = McpServer::new(
        "${name}".to_string(),
        "1.0.0".to_string(),
        ServerCapabilities {
            tools: Some(ToolsCapability { list_changed: Some(true) }),
            resources: Some(ResourcesCapability { subscribe: Some(true), list_changed: Some(true) }),
            prompts: Some(PromptsCapability { list_changed: Some(true) }),
            ..Default::default()
        },
    );

    server.register_tool("hello", "Say hello", Arc::new(|args: HelloArgs| async move {
        Ok(CallToolResult {
            content: vec![Content { content_type: "text".to_string(), text: Some(format!("Hello, {}!", args.name)), ..Default::default() }],
            is_error: Some(false),
        })
    }))?;

    let transport = create_transport("${transport}", 3000).await?;
    server.start(transport).await?;

    println!("Server started on ${transport}:3000");
    Ok(())
}
`;
    }
    if (file === 'README.md') {
      return `# ${name}

MCP Server built with Rust.

## Quick Start

\`\`\`bash
cargo run
\`\`\`

## Transport

Uses \`${transport}\` transport.
`;
    }
  }

  return `// ${file} - generated template`;
}

function generateConfig(name: string, language: string, transport: string): string {
  return `# MCP Server Configuration
# Generated by mcp init

server:
  name: "${name}"
  version: "1.0.0"
  language: "${language}"

transport:
  type: "${transport}"
  port: 3000
  host: "0.0.0.0"

capabilities:
  tools:
    listChanged: true
  resources:
    subscribe: true
    listChanged: true
  prompts:
    listChanged: true
  logging: {}

development:
  hotReload: true
  logLevel: "debug"

production:
  replicas: 3
  resources:
    limits:
      cpu: "2000m"
      memory: "4Gi"
    requests:
      cpu: "500m"
      memory: "1Gi"
  autoscaling:
    minReplicas: 2
    maxReplicas: 20
    targetCPUUtilization: 70
`;
}

function generateGitignore(language: string): string {
  const common = `# Dependencies
node_modules/
target/
.venv/
__pycache__/
*.pyc

# Build outputs
dist/
build/
*.egg-info/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Test coverage
coverage/
.nyc_output/

# Environment
.env
.env.local
.env.*.local

# MCP
.mcp/
`;

  if (language === 'typescript') {
    return common + `# TypeScript
*.tsbuildinfo
`;
  }
  if (language === 'python') {
    return common + `# Python
.pytest_cache/
.mypy_cache/
*.egg/
`;
  }
  if (language === 'go') {
    return common + `# Go
vendor/
*.exe
`;
  }
  if (language === 'rust') {
    return common + `# Rust
Cargo.lock
`;
  }
  return common;
}

function initGit(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const git = spawn('git', ['init'], { cwd: dir });
    git.on('close', (code: number) => {
      if (code === 0) {
        console.log('✅ Git repository initialized');
        resolve();
      } else {
        reject(new Error('Git init failed'));
      }
    });
  });
}

function installDeps(dir: string, language: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    let cmd: string;
    let args: string[];

    switch (language) {
      case 'typescript':
        cmd = 'npm';
        args = ['install'];
        break;
      case 'python':
        cmd = 'pip';
        args = ['install', '-e', '.'];
        break;
      case 'go':
        cmd = 'go';
        args = ['mod', 'tidy'];
        break;
      case 'rust':
        cmd = 'cargo';
        args = ['build'];
        break;
      default:
        resolve();
        return;
    }

    console.log(`📦 Installing dependencies...`);
    const proc = spawn(cmd, args, { cwd: dir, stdio: 'inherit' });
    proc.on('close', (code: number) => {
      if (code === 0) {
        console.log('✅ Dependencies installed');
        resolve();
      } else {
        reject(new Error(`${cmd} install failed`));
      }
    });
  });
}

function getInstallCommand(language: string): string {
  switch (language) {
    case 'typescript': return 'npm install';
    case 'python': return 'pip install -e .';
    case 'go': return 'go mod tidy';
    case 'rust': return 'cargo build';
    default: return '';
  }
}