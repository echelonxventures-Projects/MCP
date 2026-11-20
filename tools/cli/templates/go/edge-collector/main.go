// Package main implements an Edge Collector MCP Server
// Lightweight data collection at the edge with intermittent connectivity support
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mcp/go-sdk/server"
	"github.com/mcp/go-sdk/types"
	"github.com/mcp/go-sdk/transport"
)

const (
	maxBufferSize = 10000
)

// ============================================
// TYPES
// ============================================

type EdgeDeviceType string

const (
	DeviceTypeSensor   EdgeDeviceType = "sensor"
	DeviceTypeGateway  EdgeDeviceType = "gateway"
	DeviceTypeMobile   EdgeDeviceType = "mobile"
	DeviceTypeIoT      EdgeDeviceType = "iot"
	DeviceTypeVehicle  EdgeDeviceType = "vehicle"
	DeviceTypeDrone    EdgeDeviceType = "drone"
)

type ConnectionState string

const (
	StateOnline      ConnectionState = "online"
	StateOffline     ConnectionState = "offline"
	StateSyncing     ConnectionState = "syncing"
	StateReconnecting ConnectionState = "reconnecting"
)

type EdgeDevice struct {
	ID              string                 `json:"id"`
	Name            string                 `json:"name"`
	Type            EdgeDeviceType         `json:"type"`
	Location        *Location              `json:"location,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
	FirmwareVersion string                 `json:"firmware_version"`
	LastSeen        string                 `json:"last_seen"`
	ConnectionState ConnectionState        `json:"connection_state"`
	Capabilities    []string               `json:"capabilities"`
}

type Location struct {
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Altitude *float64 `json:"altitude,omitempty"`
}

type TelemetryData struct {
	DeviceID  string                 `json:"device_id"`
	Timestamp string                 `json:"timestamp"`
	Metrics   map[string]float64     `json:"metrics"`
	Tags      map[string]string      `json:"tags,omitempty"`
	Location  *Location              `json:"location,omitempty"`
}

type SyncJob struct {
	ID           string        `json:"id"`
	DeviceID     string        `json:"device_id"`
	Status       string        `json:"status"`
	DataPoints   int           `json:"data_points"`
	StartedAt    string        `json:"started_at"`
	CompletedAt  *string       `json:"completed_at,omitempty"`
	Error        *string       `json:"error,omitempty"`
}

// ============================================
// STATE MANAGEMENT
// ============================================

type EdgeCollector struct {
	mu            sync.RWMutex
	devices       map[string]*EdgeDevice
	telemetryBuf  []TelemetryData
	syncJobs      map[string]*SyncJob
	server        *server.Server
	startTime     time.Time
}

func NewEdgeCollector() *EdgeCollector {
	ec := &EdgeCollector{
		devices:      make(map[string]*EdgeDevice),
		telemetryBuf: make([]TelemetryData, 0, maxBufferSize),
		syncJobs:     make(map[string]*SyncJob),
		startTime:    time.Now(),
	}
	ec.initializeSampleData()
	return ec
}

func (ec *EdgeCollector) initializeSampleData() {
	device := &EdgeDevice{
		ID:              "edge-001",
		Name:            "Warehouse Sensor Gateway",
		Type:            DeviceTypeGateway,
		Location:        &Location{Lat: 37.7749, Lng: -122.4194},
		FirmwareVersion: "2.1.0",
		LastSeen:        time.Now().Format(time.RFC3339),
		ConnectionState: StateOnline,
		Capabilities:    []string{"temperature", "humidity", "pressure", "motion", "battery"},
		Metadata:        map[string]interface{}{"building": "A", "floor": 2},
	}
	ec.devices[device.ID] = device
}

func (ec *EdgeCollector) ingestTelemetry(data TelemetryData) {
	ec.mu.Lock()
	defer ec.mu.Unlock()

	ec.telemetryBuf = append(ec.telemetryBuf, data)
	if len(ec.telemetryBuf) > maxBufferSize {
		ec.telemetryBuf = ec.telemetryBuf[1:] // FIFO eviction
	}

	if device, ok := ec.devices[data.DeviceID]; ok {
		device.LastSeen = data.Timestamp
		device.ConnectionState = StateOnline
	}
}

// ============================================
// TOOL HANDLERS
// ============================================

func (ec *EdgeCollector) registerDevice(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	name, _ := args["name"].(string)
	deviceType, _ := args["type"].(string)
	firmwareVersion, _ := args["firmware_version"].(string)
	capabilitiesRaw, _ := args["capabilities"].([]interface{})

	capabilities := make([]string, len(capabilitiesRaw))
	for i, c := range capabilitiesRaw {
		capabilities[i] = c.(string)
	}

	id := fmt.Sprintf("edge-%d", time.Now().UnixMilli())
	device := &EdgeDevice{
		ID:              id,
		Name:            name,
		Type:            EdgeDeviceType(deviceType),
		FirmwareVersion: firmwareVersion,
		LastSeen:        time.Now().Format(time.RFC3339),
		ConnectionState: StateOnline,
		Capabilities:    capabilities,
	}

	if loc, ok := args["location"].(map[string]interface{}); ok {
		device.Location = &Location{
			Lat: loc["lat"].(float64),
			Lng: loc["lng"].(float64),
		}
		if alt, ok := loc["altitude"].(float64); ok {
			device.Location.Altitude = &alt
		}
	}

	if meta, ok := args["metadata"].(map[string]interface{}); ok {
		device.Metadata = meta
	}

	ec.mu.Lock()
	ec.devices[id] = device
	ec.mu.Unlock()

	return device, nil
}

func (ec *EdgeCollector) listDevices(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	ec.mu.RLock()
	defer ec.mu.RUnlock()

	var result []*EdgeDevice
	for _, d := range ec.devices {
		if deviceType, ok := args["type"].(string); ok && d.Type != EdgeDeviceType(deviceType) {
			continue
		}
		if state, ok := args["state"].(string); ok && d.ConnectionState != ConnectionState(state) {
			continue
		}
		result = append(result, d)
	}

	return map[string]interface{}{"devices": result}, nil
}

func (ec *EdgeCollector) getDevice(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	deviceID, _ := args["device_id"].(string)

	ec.mu.RLock()
	device, ok := ec.devices[deviceID]
	ec.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("device not found: %s", deviceID)
	}
	return device, nil
}

func (ec *EdgeCollector) ingestTelemetryTool(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	deviceID, _ := args["device_id"].(string)
	metricsRaw, _ := args["metrics"].(map[string]interface{})

	metrics := make(map[string]float64)
	for k, v := range metricsRaw {
		metrics[k] = v.(float64)
	}

	tags := make(map[string]string)
	if tagsRaw, ok := args["tags"].(map[string]interface{}); ok {
		for k, v := range tagsRaw {
			tags[k] = v.(string)
		}
	}

	var location *Location
	if locRaw, ok := args["location"].(map[string]interface{}); ok {
		location = &Location{
			Lat: locRaw["lat"].(float64),
			Lng: locRaw["lng"].(float64),
		}
	}

	timestamp := time.Now().Format(time.RFC3339)
	if ts, ok := args["timestamp"].(string); ok {
		timestamp = ts
	}

	data := TelemetryData{
		DeviceID:  deviceID,
		Timestamp: timestamp,
		Metrics:   metrics,
		Tags:      tags,
		Location:  location,
	}

	ec.ingestTelemetry(data)

	return map[string]interface{}{
		"success":      true,
		"buffer_size":  len(ec.telemetryBuf),
	}, nil
}

func (ec *EdgeCollector) batchIngest(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	dataPointsRaw, _ := args["data_points"].([]interface{})

	success := 0
	failed := 0

	for _, dpRaw := range dataPointsRaw {
		dp := dpRaw.(map[string]interface{})
		deviceID, _ := dp["device_id"].(string)

		ec.mu.RLock()
		_, ok := ec.devices[deviceID]
		ec.mu.RUnlock()

		if !ok {
			failed++
			continue
		}

		metricsRaw := dp["metrics"].(map[string]interface{})
		metrics := make(map[string]float64)
		for k, v := range metricsRaw {
			metrics[k] = v.(float64)
		}

		tags := make(map[string]string)
		if tagsRaw, ok := dp["tags"].(map[string]interface{}); ok {
			for k, v := range tagsRaw {
				tags[k] = v.(string)
			}
		}

		var location *Location
		if locRaw, ok := dp["location"].(map[string]interface{}); ok {
			location = &Location{
				Lat: locRaw["lat"].(float64),
				Lng: locRaw["lng"].(float64),
			}
		}

		timestamp := time.Now().Format(time.RFC3339)
		if ts, ok := dp["timestamp"].(string); ok {
			timestamp = ts
		}

		ec.ingestTelemetry(TelemetryData{
			DeviceID:  deviceID,
			Timestamp: timestamp,
			Metrics:   metrics,
			Tags:      tags,
			Location:  location,
		})
		success++
	}

	return map[string]interface{}{
		"success":      success,
		"failed":       failed,
		"buffer_size":  len(ec.telemetryBuf),
	}, nil
}

func (ec *EdgeCollector) queryTelemetry(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	deviceID, _ := args["device_id"].(string)
	startTime, _ := args["start_time"].(string)
	endTime, _ := args["end_time"].(string)
	metricsRaw, _ := args["metrics"].([]interface{})
	limit := 100
	if l, ok := args["limit"].(float64); ok {
		limit = int(l)
	}

	ec.mu.RLock()
	buf := make([]TelemetryData, len(ec.telemetryBuf))
	copy(buf, ec.telemetryBuf)
	ec.mu.RUnlock()

	var results []TelemetryData
	for i := len(buf) - 1; i >= 0 && len(results) < limit; i-- {
		d := buf[i]
		if deviceID != "" && d.DeviceID != deviceID {
			continue
		}
		if startTime != "" && d.Timestamp < startTime {
			continue
		}
		if endTime != "" && d.Timestamp > endTime {
			continue
		}
		if len(metricsRaw) > 0 {
			match := false
			for _, m := range metricsRaw {
				if _, ok := d.Metrics[m.(string)]; ok {
					match = true
					break
				}
			}
			if !match {
				continue
			}
		}
		results = append(results, d)
	}

	return map[string]interface{}{
		"count": len(results),
		"data":  results,
	}, nil
}

func (ec *EdgeCollector) startSync(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	deviceID, _ := args["device_id"].(string)
	destination, _ := args["destination"].(string)

	ec.mu.RLock()
	device, ok := ec.devices[deviceID]
	ec.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("device not found: %s", deviceID)
	}

	var deviceData []TelemetryData
	ec.mu.RLock()
	for _, d := range ec.telemetryBuf {
		if d.DeviceID == deviceID {
			deviceData = append(deviceData, d)
		}
	}
	ec.mu.RUnlock()

	id := fmt.Sprintf("sync-%d", time.Now().UnixMilli())
	job := &SyncJob{
		ID:         id,
		DeviceID:   deviceID,
		Status:     "running",
		DataPoints: len(deviceData),
		StartedAt:  time.Now().Format(time.RFC3339),
	}

	ec.mu.Lock()
	ec.syncJobs[id] = job
	device.ConnectionState = StateSyncing
	ec.mu.Unlock()

	// Simulate async sync
	go func() {
		time.Sleep(2 * time.Second)
		completedAt := time.Now().Format(time.RFC3339)

		ec.mu.Lock()
		job.Status = "completed"
		job.CompletedAt = &completedAt
		device.ConnectionState = StateOnline
		ec.mu.Unlock()
	}()

	return job, nil
}

func (ec *EdgeCollector) getSyncStatus(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	jobID, _ := args["job_id"].(string)

	ec.mu.RLock()
	job, ok := ec.syncJobs[jobID]
	ec.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("sync job not found: %s", jobID)
	}
	return job, nil
}

func (ec *EdgeCollector) updateFirmware(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	deviceID, _ := args["device_id"].(string)
	version, _ := args["version"].(string)
	url, _ := args["url"].(string)

	ec.mu.Lock()
	device, ok := ec.devices[deviceID]
	ec.mu.Unlock()

	if !ok {
		return nil, fmt.Errorf("device not found: %s", deviceID)
	}

	device.FirmwareVersion = version
	device.ConnectionState = StateReconnecting

	go func() {
		time.Sleep(5 * time.Second)
		ec.mu.Lock()
		device.ConnectionState = StateOnline
		ec.mu.Unlock()
	}()

	return map[string]interface{}{
		"success":      true,
		"device_id":    deviceID,
		"new_version":  version,
		"update_url":   url,
	}, nil
}

// ============================================
// RESOURCE HANDLERS
// ============================================

func (ec *EdgeCollector) registerResources(srv *server.Server) {
	srv.RegisterResource("device://{device_id}", "Device Details", "application/json",
		func(ctx context.Context, uri string, params map[string]string) (interface{}, error) {
			deviceID := params["device_id"]
			ec.mu.RLock()
			device, ok := ec.devices[deviceID]
			ec.mu.RUnlock()
			if !ok {
				return nil, fmt.Errorf("device not found: %s", deviceID)
			}
			return device, nil
		})

	srv.RegisterResource("telemetry://{device_id}/latest", "Latest Telemetry", "application/json",
		func(ctx context.Context, uri string, params map[string]string) (interface{}, error) {
			deviceID := params["device_id"]
			ec.mu.RLock()
			defer ec.mu.RUnlock()

			var results []TelemetryData
			for i := len(ec.telemetryBuf) - 1; i >= 0 && len(results) < 10; i-- {
				if ec.telemetryBuf[i].DeviceID == deviceID {
					results = append(results, ec.telemetryBuf[i])
				}
			}
			return map[string]interface{}{"data": results}, nil
		})

	srv.RegisterResource("sync://{job_id}", "Sync Job Status", "application/json",
		func(ctx context.Context, uri string, params map[string]string) (interface{}, error) {
			jobID := params["job_id"]
			ec.mu.RLock()
			job, ok := ec.syncJobs[jobID]
			ec.mu.RUnlock()
			if !ok {
				return nil, fmt.Errorf("job not found: %s", jobID)
			}
			return job, nil
		})

	srv.RegisterResource("buffer://status", "Buffer Status", "application/json",
		func(ctx context.Context, uri string, params map[string]string) (interface{}, error) {
			ec.mu.RLock()
			defer ec.mu.RUnlock()

			online := 0
			for _, d := range ec.devices {
				if d.ConnectionState == StateOnline {
					online++
				}
			}

			return map[string]interface{}{
				"total_points":         len(ec.telemetryBuf),
				"max_size":             maxBufferSize,
				"utilization_percent":  float64(len(ec.telemetryBuf)) / float64(maxBufferSize) * 100,
				"devices_online":       online,
			}, nil
		})
}

// ============================================
// PROMPT HANDLERS
// ============================================

func (ec *EdgeCollector) registerPrompts(srv *server.Server) {
	srv.RegisterPrompt("analyze-device-health", "Analyze Device Health",
		[]types.PromptArgument{
			{Name: "device_id", Description: "Device ID to analyze", Required: true},
		},
		func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			deviceID, _ := args["device_id"].(string)
			return map[string]interface{}{
				"messages": []map[string]string{
					{"role": "system", "content": "IoT engineer. Analyze device telemetry for anomalies."},
					{"role": "user", "content": fmt.Sprintf("Analyze device %s. Check: battery trends, sensor drift, connectivity gaps, firmware status. Provide recommendations.", deviceID)},
				},
			}, nil
		})

	srv.RegisterPrompt("optimize-collection", "Optimize Data Collection",
		[]types.PromptArgument{
			{Name: "device_type", Description: "Type of edge device", Required: true},
			{Name: "constraints", Description: "Power, bandwidth, storage constraints", Required: true},
		},
		func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			deviceType, _ := args["device_type"].(string)
			constraints, _ := args["constraints"].(string)
			return map[string]interface{}{
				"messages": []map[string]string{
					{"role": "system", "content": "Edge computing architect. Optimize collection strategy."},
					{"role": "user", "content": fmt.Sprintf("Device type: %s\nConstraints: %s\nRecommend: sampling rates, batch sizes, compression, sync intervals.", deviceType, constraints)},
				},
			}, nil
		})
}

// ============================================
// MAIN
// ============================================

func main() {
	// Get configuration from environment
	transportType := getEnv("MCP_TRANSPORT", "websocket")
	port := getEnv("MCP_PORT", "3000")
	host := getEnv("MCP_HOST", "0.0.0.0")

	// Create edge collector
	ec := NewEdgeCollector()

	// Create MCP server
	srv := server.NewServer("edge-collector", "1.0.0",
		server.WithCapabilities(types.ServerCapabilities{
			Tools:     &types.ToolsCapability{ListChanged: true},
			Resources: &types.ResourcesCapability{Subscribe: true, ListChanged: true},
			Prompts:   &types.PromptsCapability{ListChanged: true},
			Logging:   &types.LoggingCapability{},
		}),
	)

	ec.server = srv

	// Register tools
	srv.RegisterTool("register-device", "Register edge device",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"name":            {Type: "string"},
				"type":            {Type: "string", Enum: []string{"sensor", "gateway", "mobile", "iot", "vehicle", "drone"}},
				"location":        {Type: "object", Properties: map[string]types.PropertySchema{"lat": {Type: "number"}, "lng": {Type: "number"}, "altitude": {Type: "number"}}},
				"metadata":        {Type: "object"},
				"firmware_version": {Type: "string"},
				"capabilities":    {Type: "array", Items: &types.PropertySchema{Type: "string"}},
			},
			Required: []string{"name", "type", "firmware_version", "capabilities"},
		},
		ec.registerDevice)

	srv.RegisterTool("list-devices", "List edge devices",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"type":  {Type: "string", Enum: []string{"sensor", "gateway", "mobile", "iot", "vehicle", "drone"}},
				"state": {Type: "string", Enum: []string{"online", "offline", "syncing", "reconnecting"}},
			},
		},
		ec.listDevices)

	srv.RegisterTool("get-device", "Get device details",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"device_id": {Type: "string"},
			},
			Required: []string{"device_id"},
		},
		ec.getDevice)

	srv.RegisterTool("ingest-telemetry", "Ingest telemetry data",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"device_id": {Type: "string"},
				"metrics":   {Type: "object", AdditionalProperties: &types.PropertySchema{Type: "number"}},
				"tags":      {Type: "object", AdditionalProperties: &types.PropertySchema{Type: "string"}},
				"location":  {Type: "object", Properties: map[string]types.PropertySchema{"lat": {Type: "number"}, "lng": {Type: "number"}}},
				"timestamp": {Type: "string"},
			},
			Required: []string{"device_id", "metrics"},
		},
		ec.ingestTelemetryTool)

	srv.RegisterTool("batch-ingest", "Batch ingest telemetry",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"data_points": {
					Type: "array",
					Items: &types.PropertySchema{
						Type: "object",
						Properties: map[string]types.PropertySchema{
							"device_id": {Type: "string"},
							"metrics":   {Type: "object", AdditionalProperties: &types.PropertySchema{Type: "number"}},
							"tags":      {Type: "object", AdditionalProperties: &types.PropertySchema{Type: "string"}},
							"location":  {Type: "object", Properties: map[string]types.PropertySchema{"lat": {Type: "number"}, "lng": {Type: "number"}}},
							"timestamp": {Type: "string"},
						},
						Required: []string{"device_id", "metrics"},
					},
				},
			},
			Required: []string{"data_points"},
		},
		ec.batchIngest)

	srv.RegisterTool("query-telemetry", "Query buffered telemetry",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"device_id": {Type: "string"},
				"start_time": {Type: "string"},
				"end_time": {Type: "string"},
				"metrics": {Type: "array", Items: &types.PropertySchema{Type: "string"}},
				"limit": {Type: "integer", Default: 100},
			},
		},
		ec.queryTelemetry)

	srv.RegisterTool("start-sync", "Start data sync to cloud",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"device_id":   {Type: "string"},
				"destination": {Type: "string"},
			},
			Required: []string{"device_id", "destination"},
		},
		ec.startSync)

	srv.RegisterTool("get-sync-status", "Get sync job status",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"job_id": {Type: "string"},
			},
			Required: []string{"job_id"},
		},
		ec.getSyncStatus)

	srv.RegisterTool("update-firmware", "Trigger firmware update",
		types.ToolInputSchema{
			Type: "object",
			Properties: map[string]types.PropertySchema{
				"device_id": {Type: "string"},
				"version":   {Type: "string"},
				"url":       {Type: "string", Format: "uri"},
			},
			Required: []string{"device_id", "version", "url"},
		},
		ec.updateFirmware)

	// Register resources
	ec.registerResources(srv)

	// Register prompts
	ec.registerPrompts(srv)

	// Health check tool
	srv.RegisterTool("health", "Health check",
		types.ToolInputSchema{Type: "object", Properties: map[string]types.PropertySchema{}},
		func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			ec.mu.RLock()
			defer ec.mu.RUnlock()

			online := 0
			for _, d := range ec.devices {
				if d.ConnectionState == StateOnline {
					online++
				}
			}

			return map[string]interface{}{
				"status":              "healthy",
				"timestamp":           time.Now().Format(time.RFC3339),
				"devices":             len(ec.devices),
				"online":              online,
				"buffer_size":         len(ec.telemetryBuf),
				"buffer_utilization":  fmt.Sprintf("%.1f%%", float64(len(ec.telemetryBuf))/float64(maxBufferSize)*100),
				"pending_syncs":       countPendingSyncs(ec.syncJobs),
			}, nil
		})

	// Start server based on transport
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

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Shutting down...")
	cancel()
	time.Sleep(500 * time.Millisecond)
}

func countPendingSyncs(jobs map[string]*SyncJob) int {
	count := 0
	for _, j := range jobs {
		if j.Status == "running" {
			count++
		}
	}
	return count
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// ============================================
// TRANSPORT IMPLEMENTATIONS
// ============================================

func startWebSocketServer(ctx context.Context, srv *server.Server, host, port string) error {
	addr := fmt.Sprintf("%s:%s", host, port)
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	http.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WebSocket upgrade error: %v", err)
			return
		}
		defer conn.Close()

		// Handle WebSocket connection
		transport := transport.NewWebSocketTransport(conn)
		if err := srv.Serve(ctx, transport); err != nil {
			log.Printf("WebSocket serve error: %v", err)
		}
	})

	log.Printf("Starting WebSocket server on %s", addr)
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
	// gRPC implementation would go here
	log.Printf("Starting gRPC server on %s:%s", host, port)
	return fmt.Errorf("gRPC transport not yet implemented")
}

func startStdioServer(ctx context.Context, srv *server.Server) error {
	log.Println("Starting stdio server")
	transport := transport.NewStdioTransport(os.Stdin, os.Stdout)
	return srv.Serve(ctx, transport)
}