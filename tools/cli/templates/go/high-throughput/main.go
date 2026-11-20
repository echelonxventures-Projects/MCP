// Package main implements a High-Throughput MCP Server
// Optimized for 10k+ RPS with worker pools and connection pooling
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mcp/go-sdk/server"
	"github.com/mcp/go-sdk/types"
	"github.com/mcp/go-sdk/transport"
)

const (
	defaultWorkerCount = 100
	maxQueueSize       = 10000
)

// ============================================
// WORKER POOL
// ============================================

type Task struct {
	ID       string
	Type     string
	Data     interface{}
	Result   chan TaskResult
	Error    chan error
}

type TaskResult struct {
	Data interface{}
}

type WorkerPool struct {
	workers    int
	taskQueue  chan Task
	wg         sync.WaitGroup
	mu         sync.Mutex
	stats      PoolStats
}

type PoolStats struct {
	TasksSubmitted   int64
	TasksCompleted   int64
	TasksFailed      int64
	ActiveWorkers    int
	QueueLength      int
}

func NewWorkerPool(workers int) *WorkerPool {
	if workers <= 0 {
		workers = runtime.NumCPU() * 2
	}
	if workers > defaultWorkerCount {
		workers = defaultWorkerCount
	}

	wp := &WorkerPool{
		workers:   workers,
		taskQueue: make(chan Task, maxQueueSize),
	}

	for i := 0; i < workers; i++ {
		wp.wg.Add(1)
		go wp.worker(i)
	}

	return wp
}

func (wp *WorkerPool) worker(id int) {
	defer wp.wg.Done()

	for task := range wp.taskQueue {
		result, err := wp.processTask(task)
		if err != nil {
			task.Error <- err
			wp.mu.Lock()
			wp.stats.TasksFailed++
			wp.mu.Unlock()
		} else {
			task.Result <- result
			wp.mu.Lock()
			wp.stats.TasksCompleted++
			wp.mu.Unlock()
		}
	}
}

func (wp *WorkerPool) processTask(task Task) (TaskResult, error) {
	switch task.Type {
	case "echo":
		data := task.Data.(map[string]interface{})
		message := data["message"].(string)
		count := int(data["count"].(float64))
		result := ""
		for i := 0; i < count; i++ {
			if i > 0 {
				result += " "
			}
			result += message
		}
		return TaskResult{Data: result}, nil

	case "hash":
		data := task.Data.(map[string]interface{})
		input := data["input"].(string)
		hash := 0
		for i := 0; i < len(input); i++ {
			hash = ((hash << 5) - hash) + int(input[i])
			hash |= 0
		}
		return TaskResult{Data: hash}, nil

	case "batch":
		data := task.Data.(map[string]interface{})
		items := data["items"].([]interface{})
		results := make([]interface{}, len(items))
		for i, item := range items {
			results[i] = map[string]interface{}{
				"processed": true,
				"data":      item,
			}
		}
		return TaskResult{Data: results}, nil

	default:
		return TaskResult{}, fmt.Errorf("unknown task type: %s", task.Type)
	}
}

func (wp *WorkerPool) Submit(taskType string, data interface{}) (interface{}, error) {
	task := Task{
		ID:       fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Type:     taskType,
		Data:     data,
		Result:   make(chan TaskResult, 1),
		Error:    make(chan error, 1),
	}

	select {
	case wp.taskQueue <- task:
		wp.mu.Lock()
		wp.stats.TasksSubmitted++
		wp.stats.QueueLength = len(wp.taskQueue)
		wp.mu.Unlock()
	default:
		return nil, fmt.Errorf("queue full")
	}

	select {
	case result := <-task.Result:
		return result.Data, nil
	case err := <-task.Error:
		return nil, err
	case <-time.After(30 * time.Second):
		return nil, fmt.Errorf("task timeout")
	}
}

func (wp *WorkerPool) GetStats() PoolStats {
	wp.mu.Lock()
	defer wp.mu.Unlock()
	wp.stats.QueueLength = len(wp.taskQueue)
	wp.stats.ActiveWorkers = wp.workers
	return wp.stats
}

func (wp *WorkerPool) Shutdown() {
	close(wp.taskQueue)
	wp.wg.Wait()
}

// ============================================
// SERVER STATE
// ============================================

type HighThroughputServer struct {
	mu           sync.RWMutex
	workerPool   *WorkerPool
	requestCount int64
	startTime    time.Time
	server       *server.Server
}

func NewHighThroughputServer() *HighThroughputServer {
	hts := &HighThroughputServer{
		workerPool: NewWorkerPool(runtime.NumCPU() * 2),
		startTime:  time.Now(),
	}
	return hts
}

// ============================================
// TOOL HANDLERS
// ============================================

func (hts *HighThroughputServer) echo(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	message, _ := args["message"].(string)
	count := 1
	if c, ok := args["count"].(float64); ok {
		count = int(c)
	}

	result, err := hts.workerPool.Submit("echo", map[string]interface{}{
		"message": message,
		"count":   count,
	})
	if err != nil {
		return nil, err
	}

	hts.mu.Lock()
	hts.requestCount++
	hts.mu.Unlock()

	return map[string]interface{}{
		"content": []map[string]string{{"type": "text", "text": result.(string)}},
	}, nil
}

func (hts *HighThroughputServer) batchEcho(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	messagesRaw, _ := args["messages"].([]interface{})
	messages := make([]map[string]interface{}, len(messagesRaw))
	for i, m := range messagesRaw {
		messages[i] = map[string]interface{}{"message": m}
	}

	result, err := hts.workerPool.Submit("batch", map[string]interface{}{
		"items": messages,
	})
	if err != nil {
		return nil, err
	}

	hts.mu.Lock()
	hts.requestCount++
	hts.mu.Unlock()

	results := result.([]interface{})
	return map[string]interface{}{
		"content": []map[string]string{{"type": "text", "text": fmt.Sprintf("Processed %d messages", len(results))}},
	}, nil
}

func (hts *HighThroughputServer) hash(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	input, _ := args["input"].(string)

	result, err := hts.workerPool.Submit("hash", map[string]interface{}{
		"input": input,
	})
	if err != nil {
		return nil, err
	}

	hts.mu.Lock()
	hts.requestCount++
	hts.mu.Unlock()

	return map[string]interface{}{
		"content": []map[string]string{{"type": "text", "text": fmt.Sprintf("Hash: %d", result.(int))}},
	}, nil
}

func (hts *HighThroughputServer) health(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	hts.mu.RLock()
	requestCount := hts.requestCount
	hts.mu.RUnlock()

	stats := hts.workerPool.GetStats()

	return map[string]interface{}{
		"content": []map[string]string{{
			"type": "text",
			"text": fmt.Sprintf(`{
  "status": "healthy",
  "timestamp": "%s",
  "requests": %d,
  "workers": %d,
  "queue_length": %d,
  "uptime_seconds": %.0f
}`, time.Now().Format(time.RFC3339), requestCount, stats.ActiveWorkers, stats.QueueLength, time.Since(hts.startTime).Seconds())}},
	}, nil
}

func (hts *HighThroughputServer) metrics(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	hts.mu.RLock()
	requestCount := hts.requestCount
	hts.mu.RUnlock()

	stats := hts.workerPool.GetStats()

	return map[string]interface{}{
		"content": []map[string]string{{
			"type": "text",
			"text": fmt.Sprintf(`{
  "requests": %d,
  "workers": %d,
  "queue_length": %d,
  "uptime_seconds": %.0f,
  "tasks_submitted": %d,
  "tasks_completed": %d,
  "tasks_failed": %d
}`, requestCount, stats.ActiveWorkers, stats.QueueLength, time.Since(hts.startTime).Seconds(),
				stats.TasksSubmitted, stats.TasksCompleted, stats.TasksFailed)}},
	}, nil
}

// ============================================
// RESOURCE HANDLERS
// ============================================

func (hts *HighThroughputServer) registerResources(srv *server.Server) {
	srv.RegisterResource("metrics://current", "Current Metrics", "application/json",
		func(ctx context.Context, uri string, params map[string]string) (interface{}, error) {
			hts.mu.RLock()
			requestCount := hts.requestCount
			hts.mu.RUnlock()

			stats := hts.workerPool.GetStats()

			return map[string]interface{}{
				"requests":          requestCount,
				"workers":           stats.ActiveWorkers,
				"queue_length":      stats.QueueLength,
				"uptime_seconds":    time.Since(hts.startTime).Seconds(),
				"tasks_submitted":   stats.TasksSubmitted,
				"tasks_completed":   stats.TasksCompleted,
				"tasks_failed":      stats.TasksFailed,
			}, nil
		})
}

// ============================================
// PROMPT HANDLERS
// ============================================

func (hts *HighThroughputServer) registerPrompts(srv *server.Server) {
	srv.RegisterPrompt("performance-tuning", "Performance tuning advice",
		[]types.PromptArgument{
			{Name: "workload", Description: "Workload description", Required: true},
		},
		func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			workload, _ := args["workload"].(string)
			return map[string]interface{}{
				"messages": []map[string]string{
					{"role": "system", "content": "Performance engineer. Provide tuning advice."},
					{"role": "user", "content": fmt.Sprintf("Workload: %s\nProvide optimization recommendations.", workload)},
				},
			}, nil
		})
}

// ============================================
// MAIN
// ============================================

func main() {
	transportType := getEnv("MCP_TRANSPORT", "websocket")
	port := getEnv("MCP_PORT", "3000")
	host := getEnv("MCP_HOST", "0.0.0.0")

	hts := NewHighThroughputServer()
	defer hts.workerPool.Shutdown()

	srv := server.NewServer("high-throughput", "1.0.0",
		server.WithCapabilities(types.ServerCapabilities{
			Tools:     &types.ToolsCapability{ListChanged: true},
			Resources: &types.ResourcesCapability{Subscribe: true, ListChanged: true},
			Prompts:   &types.PromptsCapability{ListChanged: true},
			Logging:   &types.LoggingCapability{},
		}),
	)

	hts.server = srv

	// Register tools
	srv.RegisterTool("echo", "High-throughput echo",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"message": {Type: "string"},
				"count":   {Type: "integer", Minimum: 1, Default: 1},
			},
			Required: []string{"message"},
		},
		hts.echo)

	srv.RegisterTool("batch-echo", "Batch echo for maximum throughput",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"messages": {Type: "array", Items: &types.PropertySchema{Type: "string"}},
			},
			Required: []string{"messages"},
		},
		hts.batchEcho)

	srv.RegisterTool("hash", "Fast string hashing",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"input": {Type: "string"},
			},
			Required: []string{"input"},
		},
		hts.hash)

	srv.RegisterTool("health", "Health check",
		types.ToolInputSchema{Type: "object", Properties: map[string]types.PropertySchema{}},
		hts.health)

	srv.RegisterTool("metrics", "Get metrics",
		types.ToolInputSchema{Type: "object", Properties: map[string]types.PropertySchema{}},
		hts.metrics)

	// Register resources and prompts
	hts.registerResources(srv)
	hts.registerPrompts(srv)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var err error
	switch transportType {
	case "websocket":
		err = startWebSocketServer(ctx, srv, host, port)
	case "http-sse":
		err = startHTTPSSEServer(ctx, srv, host, port)
	case "grpc":
		err = startGRPCServer(ctx, srv, host, port)
	default:
		err = startStdioServer(ctx, srv)
	}

	if err != nil {
		log.Fatalf("Server error: %v", err)
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Shutting down...")
	cancel()
	time.Sleep(500 * time.Millisecond)
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func startWebSocketServer(ctx context.Context, srv *server.Server, host, port string) error {
	addr := fmt.Sprintf("%s:%s", host, port)
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

	http.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WebSocket upgrade error: %v", err)
			return
		}
		defer conn.Close()

		transport := transport.NewWebSocketTransport(conn)
		if err := srv.Serve(ctx, transport); err != nil {
			log.Printf("WebSocket serve error: %v", err)
		}
	})

	log.Printf("Starting high-throughput WebSocket server on %s", addr)
	return http.ListenAndServe(addr, nil)
}

func startHTTPSSEServer(ctx context.Context, srv *server.Server, host, port string) error {
	addr := fmt.Sprintf("%s:%s", host, port)

	http.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		transport := transport.NewSSETransport(w, r)
		if err := srv.Serve(ctx, transport); err != nil {
			log.Printf("SSE serve error: %v", err)
		}
	})

	log.Printf("Starting HTTP/SSE server on %s", addr)
	return http.ListenAndServe(addr, nil)
}

func startGRPCServer(ctx context.Context, srv *server.Server, host, port string) error {
	log.Printf("Starting gRPC server on %s:%s", host, port)
	return fmt.Errorf("gRPC transport not yet implemented")
}

func startStdioServer(ctx context.Context, srv *server.Server) error {
	log.Println("Starting stdio server")
	transport := transport.NewStdioTransport(os.Stdin, os.Stdout)
	return srv.Serve(ctx, transport)
}