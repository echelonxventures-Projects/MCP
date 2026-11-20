# Makefile for MCP Operator

# Variables
BINARY_NAME := mcp-operator
IMAGE_REGISTRY := ghcr.io/mcp
IMAGE_TAG := v0.1.0
IMAGE := $(IMAGE_REGISTRY)/$(BINARY_NAME):$(IMAGE_TAG)

# Directories
PROJECT_DIR := $(shell pwd)
CONFIG_DIR := $(PROJECT_DIR)/config
SAMPLE_DIR := $(CONFIG_DIR)/samples

# Go commands
GO := go
GOBUILD := $(GO) build
GOCLEAN := $(GO) clean
GOTEST := $(GO) test
GOGET := $(GO) get
GOMOD := $(GO) mod
GOFMT := $(GO) fmt
GOVET := $(GO) vet
GOLINT := golangci-lint run

# Controller-gen
CONTROLLER_GEN := controller-gen
CONTROLLER_GEN_VERSION := v0.16.2

# Kustomize
KUSTOMIZE := kustomize

# Default target
.PHONY: all
all: build

# Build the binary
.PHONY: build
build: generate fmt vet
	$(GOBUILD) -o bin/manager cmd/main.go

# Run against the configured Kubernetes cluster in ~/.kube/config
.PHONY: run
run: generate fmt vet manifests
	$(GO) run ./cmd/main.go

# Install CRDs into a cluster
.PHONY: install
install: manifests
	kubectl apply -f $(CONFIG_DIR)/crd/bases/

# Uninstall CRDs from a cluster
.PHONY: uninstall
uninstall: manifests
	kubectl delete -f $(CONFIG_DIR)/crd/bases/

# Deploy controller in the configured Kubernetes cluster in ~/.kube/config
.PHONY: deploy
deploy: manifests
	kustomize build $(CONFIG_DIR)/default | kubectl apply -f -

# Undeploy controller
.PHONY: undeploy
undeploy:
	kustomize build $(CONFIG_DIR)/default | kubectl delete -f -

# Generate manifests e.g. CRD, RBAC etc.
.PHONY: manifests
manifests: controller-gen
	$(CONTROLLER_GEN) rbac:roleName=manager-role crd webhook paths="./..." output:crd:artifacts:config=$(CONFIG_DIR)/crd/bases

# Run go fmt against code
.PHONY: fmt
fmt:
	$(GOFMT) ./...

# Run go vet against code
.PHONY: vet
vet:
	$(GOVET) ./...

# Run tests
.PHONY: test
test: generate fmt vet manifests
	$(GOTEST) ./... -coverprofile cover.out

# Build the docker image
.PHONY: docker-build
docker-build:
	docker build -t $(IMAGE) .

# Push the docker image
.PHONY: docker-push
docker-push:
	docker push $(IMAGE)

# Build and push the docker image
.PHONY: docker-build-push
docker-build-push: docker-build docker-push

# Generate code
.PHONY: generate
generate: controller-gen
	$(CONTROLLER_GEN) object:headerFile="hack/boilerplate.go.txt" paths="./..."

# Download controller-gen locally if necessary
.PHONY: controller-gen
controller-gen:
	@if command -v $(CONTROLLER_GEN) > /dev/null; then \
		echo "$(CONTROLLER_GEN) already installed"; \
	else \
		echo "Installing $(CONTROLLER_GEN)"; \
		$(GO) install sigs.k8s.io/controller-tools/cmd/controller-gen@$(CONTROLLER_GEN_VERSION); \
	fi

# Download kustomize locally if necessary
.PHONY: kustomize
kustomize:
	@if command -v $(KUSTOMIZE) > /dev/null; then \
		echo "$(KUSTOMIZE) already installed"; \
	else \
		echo "Installing $(KUSTOMIZE)"; \
		curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" | bash -; \
	fi

# Lint code
.PHONY: lint
lint:
	$(GOLINT) ./...

# Generate deepcopy functions
.PHONY: deepcopy
deepcopy: controller-gen
	$(CONTROLLER_GEN) object:headerFile="hack/boilerplate.go.txt" paths="./api/..."

# Create sample resources
.PHONY: samples
samples:
	kubectl apply -f $(SAMPLE_DIR)/

# Delete sample resources
.PHONY: samples-clean
samples-clean:
	kubectl delete -f $(SAMPLE_DIR)/

# Tidy go modules
.PHONY: mod-tidy
mod-tidy:
	$(GOMOD) tidy

# Verify go modules
.PHONY: mod-verify
mod-verify:
	$(GOMOD) verify

# Clean build artifacts
.PHONY: clean
clean:
	$(GOCLEAN)
	rm -rf bin/

# Help
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  all               - Build the operator (default)"
	@echo "  build             - Build the operator binary"
	@echo "  run               - Run the operator locally"
	@echo "  test              - Run tests"
	@echo "  install           - Install CRDs into cluster"
	@echo "  uninstall         - Uninstall CRDs from cluster"
	@echo "  deploy            - Deploy operator to cluster"
	@echo "  undeploy          - Undeploy operator from cluster"
	@echo "  manifests         - Generate manifests (CRD, RBAC, etc.)"
	@echo "  generate          - Generate code (deepcopy, etc.)"
	@echo "  docker-build      - Build docker image"
	@echo "  docker-push       - Push docker image"
	@echo "  docker-build-push - Build and push docker image"
	@echo "  lint              - Run linter"
	@echo "  fmt               - Run go fmt"
	@echo "  vet               - Run go vet"
	@echo "  samples           - Create sample resources"
	@echo "  samples-clean     - Delete sample resources"
	@echo "  mod-tidy          - Tidy go modules"
	@echo "  mod-verify        - Verify go modules"
	@echo "  clean             - Clean build artifacts"
	@echo "  help              - Show this help"

# Default target
.DEFAULT_GOAL := help