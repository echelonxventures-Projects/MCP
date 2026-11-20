# MCP Operator

Kubernetes Operator for managing MCP (Model Context Protocol) Servers.

## Overview

The MCP Operator watches `MCPServer` custom resources and automatically manages the underlying Kubernetes resources:
- **Deployment** - Runs the MCP server pods
- **Service** - Exposes the MCP server transport port
- **Ingress** - Optional external access (when enabled)
- **HorizontalPodAutoscaler** - Optional autoscaling based on CPU utilization

## Features

- **Multi-transport support**: stdio, HTTP/SSE, WebSocket, gRPC
- **Full MCP capabilities**: Tools, Resources, Prompts, Logging
- **Autoscaling**: Horizontal pod autoscaling with configurable metrics
- **Multi-tenancy**: Namespace isolation, network policies, resource quotas
- **Health checks**: Liveness and readiness probes per transport type
- **Leader election**: High availability for the operator itself
- **Observability**: Prometheus metrics, health endpoints, alerting rules

## Quick Start

### Prerequisites

- Kubernetes cluster v1.28+
- kubectl configured
- Go 1.23+ (for building)
- Docker (for building images)

### Install CRDs

```bash
make install
```

### Deploy Operator

```bash
make deploy
```

### Create an MCPServer

```yaml
apiVersion: mcp.platform/v1alpha1
kind: MCPServer
metadata:
  name: my-mcp-server
  namespace: mcp-servers
spec:
  replicas: 3
  image: ghcr.io/myorg/my-mcp-server:v1.0.0
  transport:
    type: websocket
    port: 3000
  capabilities:
    tools:
      listChanged: true
    resources:
      subscribe: true
  autoscaling:
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilization: 70
```

```bash
kubectl apply -f my-mcp-server.yaml
```

## Development

### Build

```bash
make build
```

### Run Locally

```bash
make run
```

### Run Tests

```bash
make test
```

### Generate Code

```bash
make generate
```

### Generate Manifests

```bash
make manifests
```

### Build and Push Docker Image

```bash
make docker-build-push IMAGE_REGISTRY=ghcr.io/myorg IMAGE_TAG=v1.0.0
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Operator                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           MCPServerReconciler                        │   │
│  │  - Watches MCPServer resources                       │   │
│  │  - Reconciles: Deployment, Service, Ingress, HPA    │   │
│  │  - Handles multi-tenancy                             │   │
│  │  - Updates status                                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │Deployment│        │ Service  │        │  Ingress │
    │ (Pods)   │        │ (Port)   │        │ (Ext)    │
    └──────────┘        └──────────┘        └──────────┘
                              │
                              ▼
                        ┌──────────┐
                        │   HPA    │
                        │(Optional)│
                        └──────────┘
```

## Configuration

### MCPServer Spec

| Field | Type | Description |
|-------|------|-------------|
| `replicas` | int32 | Number of replicas (default: 3) |
| `image` | string | Container image (required) |
| `transport` | TransportSpec | Transport configuration (required) |
| `capabilities` | CapabilitiesSpec | MCP capabilities |
| `resources` | ResourceRequirements | CPU/Memory limits and requests |
| `autoscaling` | AutoscalingSpec | HPA configuration |
| `multiTenancy` | MultiTenancySpec | Multi-tenancy settings |
| `env` | []EnvVar | Environment variables |
| `secrets` | []SecretMount | Secrets to mount |
| `serviceAccount` | string | Service account name |
| `ingress` | IngressSpec | Ingress configuration |

### Transport Types

| Type | Port | Use Case |
|------|------|----------|
| `stdio` | N/A | Local development, CLI |
| `http-sse` | 8080 | Serverless, webhooks |
| `websocket` | 8080 | Real-time, persistent |
| `grpc` | 50051 | High-performance, service mesh |

### Multi-Tenancy Isolation Levels

| Level | Description |
|-------|-------------|
| `namespace` | Kubernetes namespace isolation |
| `network` | Network policies for pod isolation |
| `full` | Namespace + network + resource quotas |

## Monitoring

The operator exposes:
- **Metrics**: `:8080/metrics` (Prometheus format)
- **Health**: `:8081/healthz`
- **Readiness**: `:8081/readyz`

### Key Metrics

- `controller_runtime_reconcile_total` - Reconciliation count
- `controller_runtime_reconcile_errors_total` - Reconciliation errors
- `controller_runtime_reconcile_duration_seconds` - Reconciliation latency
- `mcp_server_replicas` - Current replicas per MCPServer
- `mcp_server_ready_replicas` - Ready replicas per MCPServer

### Alerting Rules

Pre-configured PrometheusRule alerts for:
- Operator down
- High reconciliation error rate
- High reconciliation latency
- Deployment not ready

## Troubleshooting

### Check Operator Logs

```bash
kubectl logs -n mcp-system deployment/mcp-operator-controller-manager -c manager
```

### Check MCPServer Status

```bash
kubectl get mcpserver -n mcp-servers -o wide
kubectl describe mcpserver my-mcp-server -n mcp-servers
```

### Check Managed Resources

```bash
kubectl get deployment,service,ingress,hpa -n mcp-servers -l mcp.platform/mcp-server=my-mcp-server
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes
4. Run tests: `make test`
5. Run linter: `make lint`
6. Submit a PR

## License

Apache License 2.0