package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mcp/go-sdk/server"
	"github.com/mcp/go-sdk/types"
)

func main() {
	// Create MCP server instance
	s := server.NewMcpServer(&server.Config{
		Name:    "{{projectName}}",
		Version: "1.0.0",
		Capabilities: server.Capabilities{
			Tools:     &server.ToolsCapability{ListChanged: true},
			Resources: &server.ResourcesCapability{Subscribe: true, ListChanged: true},
			Prompts:   &server.PromptsCapability{ListChanged: true},
			Logging:   &server.LoggingCapability{},
		},
	})

	// Register tools
	registerTools(s)

	// Register resources
	registerResources(s)

	// Register prompts
	registerPrompts(s)

	// Health check endpoint
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "healthy",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	// Determine transport
	transport := getEnv("MCP_TRANSPORT", "stdio")
	port := getEnv("MCP_PORT", "3000")
	host := getEnv("MCP_HOST", "0.0.0.0")

	log.Printf("Starting {{projectName}} on %s...", transport)

	// Start server based on transport
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var err error
	switch transport {
	case "websocket":
		err = s.StartWebSocket(ctx, host+":"+port)
	case "http-sse":
		err = s.StartHTTPSSE(ctx, host+":"+port)
	case "grpc":
		err = s.StartGRPC(ctx, host+":"+port)
	default:
		err = s.StartStdio(ctx)
	}

	if err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	cancel()
	s.Stop()
	log.Println("Server stopped")
}

func registerTools(s *server.McpServer) {
	// Echo tool
	s.Tool("echo", "Echo back the input message").
		Param("message", types.StringType, "Message to echo", true).
		Param("count", types.IntegerType, "Number of times to repeat", false).
		Handler(func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			message := args["message"].(string)
			count := 1
			if c, ok := args["count"].(float64); ok {
				count = int(c)
			}
			result := ""
			for i := 0; i < count; i++ {
				if i > 0 {
					result += " "
				}
				result += message
			}
			return map[string]interface{}{
				"content": []map[string]string{{"type": "text", "text": result}},
			}, nil
		}).
		Register()

	// Get current time tool
	s.Tool("get-current-time", "Get the current server time").
		Handler(func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			return map[string]interface{}{
				"content": []map[string]string{{"type": "text", "text": time.Now().Format(time.RFC3339)}},
			}, nil
		}).
		Register()

	// Health check tool
	s.Tool("health", "Health check endpoint").
		Handler(func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			return map[string]interface{}{
				"content": []map[string]string{{
					"type": "text",
					"text": fmt.Sprintf(`{"status":"healthy","timestamp":"%s"}`, time.Now().Format(time.RFC3339)),
				}},
			}, nil
		}).
		Register()
}

func registerResources(s *server.McpServer) {
	// Server info resource
	s.Resource("server://info", "Server information").
		Handler(func(ctx context.Context, uri string) (interface{}, error) {
			info := map[string]interface{}{
				"name":        "{{projectName}}",
				"version":     "1.0.0",
				"description": "{{description}}",
				"uptime":      0,
				"timestamp":   time.Now().Format(time.RFC3339),
			}
			data, _ := json.MarshalIndent(info, "", "  ")
			return map[string]interface{}{
				"contents": []map[string]interface{}{
					{
						"uri":      uri,
						"mimeType": "application/json",
						"text":     string(data),
					},
				},
			}, nil
		}).
		Register()
}

func registerPrompts(s *server.McpServer) {
	// Greeting prompt
	s.Prompt("greeting", "Generate a friendly greeting").
		Param("name", types.StringType, "Name to greet", true).
		Param("style", types.StringType, "Greeting style (formal, casual, friendly)", false).
		Handler(func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			name := args["name"].(string)
			style := "friendly"
			if s, ok := args["style"].(string); ok {
				style = s
			}

			greetings := map[string]string{
				"formal":   fmt.Sprintf("Good day, %s. How may I assist you?", name),
				"casual":   fmt.Sprintf("Hey %s! What's up?", name),
				"friendly": fmt.Sprintf("Hello %s! 👋 It's great to see you. How can I help today?", name),
			}

			return map[string]interface{}{
				"messages": []map[string]string{
					{"role": "system", "content": "You are a helpful assistant."},
					{"role": "user", "content": greetings[style]},
				},
			}, nil
		}).
		Register()
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}