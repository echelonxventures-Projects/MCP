package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TransportType defines the transport protocol for the MCP server
type TransportType string

const (
	TransportStdio     TransportType = "stdio"
	TransportHTTPSSE   TransportType = "http-sse"
	TransportWebsocket TransportType = "websocket"
	TransportGRPC      TransportType = "grpc"
)

// IsolationLevel defines the multi-tenancy isolation level
type IsolationLevel string

const (
	IsolationNamespace IsolationLevel = "namespace"
	IsolationNetwork   IsolationLevel = "network"
	IsolationFull      IsolationLevel = "full"
)

// MCPServerPhase defines the phase of the MCPServer
type MCPServerPhase string

const (
	MCPServerPhasePending MCPServerPhase = "Pending"
	MCPServerPhaseRunning MCPServerPhase = "Running"
	MCPServerPhaseFailed  MCPServerPhase = "Failed"
	MCPServerPhaseUnknown MCPServerPhase = "Unknown"
)

// MCPServerConditionType defines the condition type
type MCPServerConditionType string

const (
	MCPServerConditionReady       MCPServerConditionType = "Ready"
	MCPServerConditionProgressing MCPServerConditionType = "Progressing"
	MCPServerConditionDegraded    MCPServerConditionType = "Degraded"
)

// TransportSpec defines the transport configuration
type TransportSpec struct {
	// Type is the transport protocol type
	Type TransportType `json:"type"`
	// Port is the port number for the transport
	Port int32 `json:"port,omitempty"`
	// Host is the host address for the transport
	Host string `json:"host,omitempty"`
}

// CapabilitiesSpec defines the MCP server capabilities
type CapabilitiesSpec struct {
	Tools     ToolsCapability     `json:"tools,omitempty"`
	Resources ResourcesCapability `json:"resources,omitempty"`
	Prompts   PromptsCapability   `json:"prompts,omitempty"`
	Logging   LoggingCapability   `json:"logging,omitempty"`
}

type ToolsCapability struct {
	ListChanged bool `json:"listChanged,omitempty"`
}

type ResourcesCapability struct {
	Subscribe   bool `json:"subscribe,omitempty"`
	ListChanged bool `json:"listChanged,omitempty"`
}

type PromptsCapability struct {
	ListChanged bool `json:"listChanged,omitempty"`
}

type LoggingCapability struct {
}

// ResourceRequirements defines resource limits and requests
type ResourceRequirements struct {
	Limits   ResourceList `json:"limits,omitempty"`
	Requests ResourceList `json:"requests,omitempty"`
}

type ResourceList struct {
	CPU    string `json:"cpu,omitempty"`
	Memory string `json:"memory,omitempty"`
}

// AutoscalingSpec defines the autoscaling configuration
type AutoscalingSpec struct {
	MinReplicas          int32 `json:"minReplicas,omitempty"`
	MaxReplicas          int32 `json:"maxReplicas,omitempty"`
	TargetCPUUtilization int32 `json:"targetCPUUtilization,omitempty"`
}

// MultiTenancySpec defines the multi-tenancy configuration
type MultiTenancySpec struct {
	Enabled   bool           `json:"enabled,omitempty"`
	Isolation IsolationLevel `json:"isolation,omitempty"`
	Quotas    QuotasSpec     `json:"quotas,omitempty"`
}

type QuotasSpec struct {
	RequestsPerMinute     int32 `json:"requestsPerMinute,omitempty"`
	ConcurrentConnections int32 `json:"concurrentConnections,omitempty"`
}

// EnvVar defines an environment variable
type EnvVar struct {
	Name      string        `json:"name"`
	Value     string        `json:"value,omitempty"`
	ValueFrom *EnvVarSource `json:"valueFrom,omitempty"`
}

type EnvVarSource struct {
	// Add fields as needed for secret/configmap references
}

// SecretMount defines a secret to mount
type SecretMount struct {
	Name      string `json:"name"`
	MountPath string `json:"mountPath"`
}

// IngressSpec defines the ingress configuration
type IngressSpec struct {
	Enabled     bool              `json:"enabled,omitempty"`
	ClassName   string            `json:"className,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
	Hosts       []IngressHost     `json:"hosts,omitempty"`
}

type IngressHost struct {
	Host  string        `json:"host"`
	Paths []IngressPath `json:"paths,omitempty"`
}

type IngressPath struct {
	Path     string `json:"path"`
	PathType string `json:"pathType,omitempty"`
}

// MCPServerSpec defines the desired state of MCPServer
type MCPServerSpec struct {
	// Replicas is the number of replicas
	Replicas int32 `json:"replicas,omitempty"`

	// Image is the container image to use
	Image string `json:"image"`

	// Transport defines the transport configuration
	Transport TransportSpec `json:"transport"`

	// Capabilities defines the MCP server capabilities
	Capabilities CapabilitiesSpec `json:"capabilities,omitempty"`

	// Resources defines the resource requirements
	Resources ResourceRequirements `json:"resources,omitempty"`

	// Autoscaling defines the autoscaling configuration
	Autoscaling *AutoscalingSpec `json:"autoscaling,omitempty"`

	// MultiTenancy defines the multi-tenancy configuration
	MultiTenancy *MultiTenancySpec `json:"multiTenancy,omitempty"`

	// Env defines environment variables
	Env []EnvVar `json:"env,omitempty"`

	// Secrets defines secrets to mount
	Secrets []SecretMount `json:"secrets,omitempty"`

	// ServiceAccount is the service account to use
	ServiceAccount string `json:"serviceAccount,omitempty"`

	// Ingress defines the ingress configuration
	Ingress IngressSpec `json:"ingress,omitempty"`
}

// MCPServerCondition defines a condition of the MCPServer
type MCPServerCondition struct {
	Type               MCPServerConditionType `json:"type"`
	Status             string                 `json:"status"`
	Reason             string                 `json:"reason,omitempty"`
	Message            string                 `json:"message,omitempty"`
	LastTransitionTime metav1.Time            `json:"lastTransitionTime,omitempty"`
}

// MCPServerStatus defines the observed state of MCPServer
type MCPServerStatus struct {
	// Phase is the current phase of the MCPServer
	Phase MCPServerPhase `json:"phase,omitempty"`

	// Replicas is the current number of replicas
	Replicas int32 `json:"replicas,omitempty"`

	// ReadyReplicas is the number of ready replicas
	ReadyReplicas int32 `json:"readyReplicas,omitempty"`

	// Conditions represents the latest available observations of the MCPServer's state
	Conditions []MCPServerCondition `json:"conditions,omitempty"`

	// ObservedGeneration is the generation observed by the controller
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
}

//+kubebuilder:object:root=true
//+kubebuilder:subresource:status
//+kubebuilder:subresource:scale:specpath=.spec.replicas,statuspath=.status.replicas,selectorpath=.status.selector
//+kubebuilder:printcolumn:name="Phase",type="string",JSONPath=".status.phase"
//+kubebuilder:printcolumn:name="Replicas",type="integer",JSONPath=".status.replicas"
//+kubebuilder:printcolumn:name="Ready",type="integer",JSONPath=".status.readyReplicas"
//+kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp"

// MCPServer is the Schema for the mcpservers API
type MCPServer struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   MCPServerSpec   `json:"spec,omitempty"`
	Status MCPServerStatus `json:"status,omitempty"`
}

//+kubebuilder:object:root=true

// MCPServerList contains a list of MCPServer
type MCPServerList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []MCPServer `json:"items"`
}

func init() {
	SchemeBuilder.Register(&MCPServer{}, &MCPServerList{})
}
