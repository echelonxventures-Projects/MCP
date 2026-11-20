package controller

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/go-logr/logr"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/tools/record"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/predicate"

	mcpv1alpha1 "github.com/mcp/operator/api/v1alpha1"
)

const (
	// FinalizerName is the name of the finalizer used to clean up resources
	FinalizerName = "mcp.platform/mcp-server-finalizer"

	// MetricsPort is the port for metrics
	MetricsPort = 8080

	// HealthPort is the port for health probes
	HealthPort = 8081

	// DefaultReplicas is the default number of replicas
	DefaultReplicas = 3

	// LabelApp is the label key for app name
	LabelApp = "app"

	// LabelMCPServer is the label key for MCPServer name
	LabelMCPServer = "mcp.platform/mcp-server"

	// LabelManagedBy is the label key for managed by
	LabelManagedBy = "app.kubernetes.io/managed-by"

	// ManagedByOperator is the value for managed by operator
	ManagedByOperator = "mcp-operator"
)

// MCPServerReconciler reconciles a MCPServer object
type MCPServerReconciler struct {
	client.Client
	Scheme   *runtime.Scheme
	Recorder record.EventRecorder
	Log      logr.Logger
}

//+kubebuilder:rbac:groups=mcp.platform,resources=mcpservers,verbs=get;list;watch;create;update;patch;delete
//+kubebuilder:rbac:groups=mcp.platform,resources=mcpservers/status,verbs=get;update;patch
//+kubebuilder:rbac:groups=mcp.platform,resources=mcpservers/finalizers,verbs=update
//+kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
//+kubebuilder:rbac:groups=apps,resources=deployments/status,verbs=get
//+kubebuilder:rbac:groups=core,resources=services,verbs=get;list;watch;create;update;patch;delete
//+kubebuilder:rbac:groups=core,resources=services/status,verbs=get
//+kubebuilder:rbac:groups=networking.k8s.io,resources=ingresses,verbs=get;list;watch;create;update;patch;delete
//+kubebuilder:rbac:groups=networking.k8s.io,resources=ingresses/status,verbs=get
//+kubebuilder:rbac:groups=autoscaling,resources=horizontalpodautoscalers,verbs=get;list;watch;create;update;patch;delete
//+kubebuilder:rbac:groups=autoscaling,resources=horizontalpodautoscalers/status,verbs=get

// Reconcile is part of the main kubernetes reconciliation loop which aims to
// move the current state of the cluster closer to the desired state.
func (r *MCPServerReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx).WithValues("mcp-server", req.NamespacedName)
	ctx = log.IntoContext(ctx, logger)

	logger.Info("Reconciling MCPServer")

	// Fetch the MCPServer instance
	mcpServer := &mcpv1alpha1.MCPServer{}
	err := r.Get(ctx, req.NamespacedName, mcpServer)
	if err != nil {
		if errors.IsNotFound(err) {
			logger.Info("MCPServer resource not found. Ignoring since object must be deleted")
			return ctrl.Result{}, nil
		}
		logger.Error(err, "Failed to get MCPServer")
		return ctrl.Result{}, err
	}

	// Handle finalizer
	if !mcpServer.DeletionTimestamp.IsZero() {
		return r.handleDeletion(ctx, mcpServer)
	}

	// Add finalizer if not present
	if !controllerutil.ContainsFinalizer(mcpServer, FinalizerName) {
		controllerutil.AddFinalizer(mcpServer, FinalizerName)
		if err := r.Update(ctx, mcpServer); err != nil {
			logger.Error(err, "Failed to add finalizer")
			return ctrl.Result{}, err
		}
		return ctrl.Result{Requeue: true}, nil
	}

	// Set defaults
	r.setDefaults(mcpServer)

	// Reconcile resources
	if err := r.reconcileResources(ctx, mcpServer); err != nil {
		logger.Error(err, "Failed to reconcile resources")
		r.updateStatus(ctx, mcpServer, mcpv1alpha1.MCPServerPhaseFailed, err.Error())
		return ctrl.Result{}, err
	}

	// Update status
	if err := r.updateStatus(ctx, mcpServer, mcpv1alpha1.MCPServerPhaseRunning, ""); err != nil {
		logger.Error(err, "Failed to update status")
		return ctrl.Result{}, err
	}

	logger.Info("Successfully reconciled MCPServer")
	return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
}

// setDefaults sets default values for the MCPServer spec
func (r *MCPServerReconciler) setDefaults(mcpServer *mcpv1alpha1.MCPServer) {
	if mcpServer.Spec.Replicas == 0 {
		mcpServer.Spec.Replicas = DefaultReplicas
	}
	if mcpServer.Spec.Transport.Port == 0 {
		switch mcpServer.Spec.Transport.Type {
		case mcpv1alpha1.TransportHTTPSSE:
			mcpServer.Spec.Transport.Port = 8080
		case mcpv1alpha1.TransportWebsocket:
			mcpServer.Spec.Transport.Port = 8080
		case mcpv1alpha1.TransportGRPC:
			mcpServer.Spec.Transport.Port = 50051
		default:
			mcpServer.Spec.Transport.Port = 8080
		}
	}
	if mcpServer.Spec.Transport.Host == "" {
		mcpServer.Spec.Transport.Host = "0.0.0.0"
	}
}

// reconcileResources reconciles all managed resources
func (r *MCPServerReconciler) reconcileResources(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	// Reconcile Deployment
	if err := r.reconcileDeployment(ctx, mcpServer); err != nil {
		return fmt.Errorf("failed to reconcile deployment: %w", err)
	}

	// Reconcile Service
	if err := r.reconcileService(ctx, mcpServer); err != nil {
		return fmt.Errorf("failed to reconcile service: %w", err)
	}

	// Reconcile Ingress if enabled
	if mcpServer.Spec.Ingress.Enabled {
		if err := r.reconcileIngress(ctx, mcpServer); err != nil {
			return fmt.Errorf("failed to reconcile ingress: %w", err)
		}
	} else {
		// Delete ingress if it exists but is disabled
		if err := r.deleteIngress(ctx, mcpServer); err != nil {
			return fmt.Errorf("failed to delete ingress: %w", err)
		}
	}

	// Reconcile HPA if enabled
	if mcpServer.Spec.Autoscaling != nil {
		if err := r.reconcileHPA(ctx, mcpServer); err != nil {
			return fmt.Errorf("failed to reconcile HPA: %w", err)
		}
	} else {
		// Delete HPA if it exists but is disabled
		if err := r.deleteHPA(ctx, mcpServer); err != nil {
			return fmt.Errorf("failed to delete HPA: %w", err)
		}
	}

	// Handle multi-tenancy
	if mcpServer.Spec.MultiTenancy != nil && mcpServer.Spec.MultiTenancy.Enabled {
		if err := r.reconcileMultiTenancy(ctx, mcpServer); err != nil {
			return fmt.Errorf("failed to reconcile multi-tenancy: %w", err)
		}
	}

	return nil
}

// reconcileDeployment creates or updates the Deployment
func (r *MCPServerReconciler) reconcileDeployment(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	logger := log.FromContext(ctx)

	deployment := r.buildDeployment(mcpServer)

	// Set controller reference
	if err := controllerutil.SetControllerReference(mcpServer, deployment, r.Scheme); err != nil {
		return err
	}

	// Create or update
	existing := &appsv1.Deployment{}
	err := r.Get(ctx, types.NamespacedName{Name: deployment.Name, Namespace: deployment.Namespace}, existing)
	if err != nil {
		if errors.IsNotFound(err) {
			logger.Info("Creating Deployment", "name", deployment.Name)
			return r.Create(ctx, deployment)
		}
		return err
	}

	// Update if needed
	existing.Spec = deployment.Spec
	existing.Labels = deployment.Labels
	existing.Annotations = deployment.Annotations
	logger.Info("Updating Deployment", "name", deployment.Name)
	return r.Update(ctx, existing)
}

// buildDeployment builds the Deployment object
func (r *MCPServerReconciler) buildDeployment(mcpServer *mcpv1alpha1.MCPServer) *appsv1.Deployment {
	labels := r.buildLabels(mcpServer)
	replicas := mcpServer.Spec.Replicas

	// Build container
	container := corev1.Container{
		Name:  "mcp-server",
		Image: mcpServer.Spec.Image,
		Ports: []corev1.ContainerPort{
			{
				Name:          "mcp",
				ContainerPort: mcpServer.Spec.Transport.Port,
				Protocol:      corev1.ProtocolTCP,
			},
		},
		Env:             r.buildEnvVars(mcpServer),
		VolumeMounts:    r.buildVolumeMounts(mcpServer),
		Resources:       r.buildResourceRequirements(mcpServer),
		LivenessProbe:   r.buildLivenessProbe(mcpServer),
		ReadinessProbe:  r.buildReadinessProbe(mcpServer),
		ImagePullPolicy: corev1.PullIfNotPresent,
	}

	// Build volumes
	volumes := r.buildVolumes(mcpServer)

	// Build pod spec
	podSpec := corev1.PodSpec{
		Containers:         []corev1.Container{container},
		Volumes:            volumes,
		ServiceAccountName: mcpServer.Spec.ServiceAccount,
		SecurityContext: &corev1.PodSecurityContext{
			RunAsNonRoot: func() *bool { b := true; return &b }(),
			RunAsUser:    func() *int64 { u := int64(1000); return &u }(),
			FSGroup:      func() *int64 { g := int64(1000); return &g }(),
		},
	}

	// Add network isolation if enabled
	if mcpServer.Spec.MultiTenancy != nil && mcpServer.Spec.MultiTenancy.Enabled {
		if mcpServer.Spec.MultiTenancy.Isolation == mcpv1alpha1.IsolationNetwork || mcpServer.Spec.MultiTenancy.Isolation == mcpv1alpha1.IsolationFull {
			podSpec.HostNetwork = false
		}
	}

	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      mcpServer.Name,
			Namespace: mcpServer.Namespace,
			Labels:    labels,
			Annotations: map[string]string{
				"mcp.platform/version": "v1alpha1",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: labels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels:      labels,
					Annotations: map[string]string{"mcp.platform/checksum": "config"},
				},
				Spec: podSpec,
			},
			Strategy: appsv1.DeploymentStrategy{
				Type: appsv1.RollingUpdateDeploymentStrategyType,
				RollingUpdate: &appsv1.RollingUpdateDeployment{
					MaxSurge:       &intstr.IntOrString{Type: intstr.String, StrVal: "25%"},
					MaxUnavailable: &intstr.IntOrString{Type: intstr.String, StrVal: "25%"},
				},
			},
		},
	}
}

// reconcileService creates or updates the Service
func (r *MCPServerReconciler) reconcileService(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	logger := log.FromContext(ctx)

	service := r.buildService(mcpServer)

	// Set controller reference
	if err := controllerutil.SetControllerReference(mcpServer, service, r.Scheme); err != nil {
		return err
	}

	// Create or update
	existing := &corev1.Service{}
	err := r.Get(ctx, types.NamespacedName{Name: service.Name, Namespace: service.Namespace}, existing)
	if err != nil {
		if errors.IsNotFound(err) {
			logger.Info("Creating Service", "name", service.Name)
			return r.Create(ctx, service)
		}
		return err
	}

	// Update if needed
	existing.Spec = service.Spec
	existing.Labels = service.Labels
	existing.Annotations = service.Annotations
	logger.Info("Updating Service", "name", service.Name)
	return r.Update(ctx, existing)
}

// buildService builds the Service object
func (r *MCPServerReconciler) buildService(mcpServer *mcpv1alpha1.MCPServer) *corev1.Service {
	labels := r.buildLabels(mcpServer)

	serviceType := corev1.ServiceTypeClusterIP
	if mcpServer.Spec.Transport.Type == mcpv1alpha1.TransportStdio {
		// For stdio, we use a headless service
		serviceType = corev1.ServiceTypeClusterIP
	}

	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      mcpServer.Name,
			Namespace: mcpServer.Namespace,
			Labels:    labels,
			Annotations: map[string]string{
				"mcp.platform/transport": string(mcpServer.Spec.Transport.Type),
			},
		},
		Spec: corev1.ServiceSpec{
			Type:     serviceType,
			Selector: labels,
			Ports: []corev1.ServicePort{
				{
					Name:       "mcp",
					Port:       mcpServer.Spec.Transport.Port,
					TargetPort: intstr.FromInt32(mcpServer.Spec.Transport.Port),
					Protocol:   corev1.ProtocolTCP,
				},
			},
		},
	}
}

// reconcileIngress creates or updates the Ingress
func (r *MCPServerReconciler) reconcileIngress(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	logger := log.FromContext(ctx)

	ingress := r.buildIngress(mcpServer)

	// Set controller reference
	if err := controllerutil.SetControllerReference(mcpServer, ingress, r.Scheme); err != nil {
		return err
	}

	// Create or update
	existing := &networkingv1.Ingress{}
	err := r.Get(ctx, types.NamespacedName{Name: ingress.Name, Namespace: ingress.Namespace}, existing)
	if err != nil {
		if errors.IsNotFound(err) {
			logger.Info("Creating Ingress", "name", ingress.Name)
			return r.Create(ctx, ingress)
		}
		return err
	}

	// Update if needed
	existing.Spec = ingress.Spec
	existing.Labels = ingress.Labels
	existing.Annotations = ingress.Annotations
	logger.Info("Updating Ingress", "name", ingress.Name)
	return r.Update(ctx, existing)
}

// buildIngress builds the Ingress object
func (r *MCPServerReconciler) buildIngress(mcpServer *mcpv1alpha1.MCPServer) *networkingv1.Ingress {
	labels := r.buildLabels(mcpServer)

	pathType := networkingv1.PathTypePrefix
	className := mcpServer.Spec.Ingress.ClassName

	var rules []networkingv1.IngressRule
	for _, host := range mcpServer.Spec.Ingress.Hosts {
		var paths []networkingv1.HTTPIngressPath
		for _, p := range host.Paths {
			pt := pathType
			if p.PathType != "" {
				pt = networkingv1.PathType(p.PathType)
			}
			paths = append(paths, networkingv1.HTTPIngressPath{
				Path:     p.Path,
				PathType: &pt,
				Backend: networkingv1.IngressBackend{
					Service: &networkingv1.IngressServiceBackend{
						Name: mcpServer.Name,
						Port: networkingv1.ServiceBackendPort{
							Number: mcpServer.Spec.Transport.Port,
						},
					},
				},
			})
		}
		if len(paths) == 0 {
			paths = append(paths, networkingv1.HTTPIngressPath{
				Path:     "/",
				PathType: &pathType,
				Backend: networkingv1.IngressBackend{
					Service: &networkingv1.IngressServiceBackend{
						Name: mcpServer.Name,
						Port: networkingv1.ServiceBackendPort{
							Number: mcpServer.Spec.Transport.Port,
						},
					},
				},
			})
		}
		rules = append(rules, networkingv1.IngressRule{
			Host: host.Host,
			IngressRuleValue: networkingv1.IngressRuleValue{
				HTTP: &networkingv1.HTTPIngressRuleValue{
					Paths: paths,
				},
			},
		})
	}

	return &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Name:        mcpServer.Name,
			Namespace:   mcpServer.Namespace,
			Labels:      labels,
			Annotations: mcpServer.Spec.Ingress.Annotations,
		},
		Spec: networkingv1.IngressSpec{
			IngressClassName: &className,
			Rules:            rules,
		},
	}
}

// deleteIngress deletes the Ingress if it exists
func (r *MCPServerReconciler) deleteIngress(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	ingress := &networkingv1.Ingress{}
	err := r.Get(ctx, types.NamespacedName{Name: mcpServer.Name, Namespace: mcpServer.Namespace}, ingress)
	if err != nil {
		if errors.IsNotFound(err) {
			return nil
		}
		return err
	}
	return r.Delete(ctx, ingress)
}

// reconcileHPA creates or updates the HorizontalPodAutoscaler
func (r *MCPServerReconciler) reconcileHPA(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	logger := log.FromContext(ctx)

	hpa := r.buildHPA(mcpServer)

	// Set controller reference
	if err := controllerutil.SetControllerReference(mcpServer, hpa, r.Scheme); err != nil {
		return err
	}

	// Create or update
	existing := &autoscalingv2.HorizontalPodAutoscaler{}
	err := r.Get(ctx, types.NamespacedName{Name: hpa.Name, Namespace: hpa.Namespace}, existing)
	if err != nil {
		if errors.IsNotFound(err) {
			logger.Info("Creating HPA", "name", hpa.Name)
			return r.Create(ctx, hpa)
		}
		return err
	}

	// Update if needed
	existing.Spec = hpa.Spec
	existing.Labels = hpa.Labels
	existing.Annotations = hpa.Annotations
	logger.Info("Updating HPA", "name", hpa.Name)
	return r.Update(ctx, existing)
}

// buildHPA builds the HorizontalPodAutoscaler object
func (r *MCPServerReconciler) buildHPA(mcpServer *mcpv1alpha1.MCPServer) *autoscalingv2.HorizontalPodAutoscaler {
	labels := r.buildLabels(mcpServer)

	minReplicas := mcpServer.Spec.Autoscaling.MinReplicas
	if minReplicas == 0 {
		minReplicas = 1
	}
	maxReplicas := mcpServer.Spec.Autoscaling.MaxReplicas
	if maxReplicas == 0 {
		maxReplicas = mcpServer.Spec.Replicas * 2
	}
	targetCPU := mcpServer.Spec.Autoscaling.TargetCPUUtilization
	if targetCPU == 0 {
		targetCPU = 70
	}

	return &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      mcpServer.Name,
			Namespace: mcpServer.Namespace,
			Labels:    labels,
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       mcpServer.Name,
			},
			MinReplicas: &minReplicas,
			MaxReplicas: maxReplicas,
			Metrics: []autoscalingv2.MetricSpec{
				{
					Type: autoscalingv2.ResourceMetricSourceType,
					Resource: &autoscalingv2.ResourceMetricSource{
						Name: corev1.ResourceCPU,
						Target: autoscalingv2.MetricTarget{
							Type:               autoscalingv2.UtilizationMetricType,
							AverageUtilization: &targetCPU,
						},
					},
				},
			},
			Behavior: &autoscalingv2.HorizontalPodAutoscalerBehavior{
				ScaleDown: &autoscalingv2.HPAScalingRules{
					StabilizationWindowSeconds: func() *int32 { s := int32(300); return &s }(),
					Policies: []autoscalingv2.HPAScalingPolicy{
						{Type: autoscalingv2.PercentScalingPolicy, Value: 10, PeriodSeconds: 60},
					},
				},
				ScaleUp: &autoscalingv2.HPAScalingRules{
					StabilizationWindowSeconds: func() *int32 { s := int32(0); return &s }(),
					Policies: []autoscalingv2.HPAScalingPolicy{
						{Type: autoscalingv2.PercentScalingPolicy, Value: 100, PeriodSeconds: 15},
						{Type: autoscalingv2.PodsScalingPolicy, Value: 4, PeriodSeconds: 15},
					},
					SelectPolicy: func() *autoscalingv2.ScalingPolicySelect { s := autoscalingv2.MaxChangePolicySelect; return &s }(),
				},
			},
		},
	}
}

// deleteHPA deletes the HPA if it exists
func (r *MCPServerReconciler) deleteHPA(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	hpa := &autoscalingv2.HorizontalPodAutoscaler{}
	err := r.Get(ctx, types.NamespacedName{Name: mcpServer.Name, Namespace: mcpServer.Namespace}, hpa)
	if err != nil {
		if errors.IsNotFound(err) {
			return nil
		}
		return err
	}
	return r.Delete(ctx, hpa)
}

// reconcileMultiTenancy handles multi-tenancy configurations
func (r *MCPServerReconciler) reconcileMultiTenancy(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	logger := log.FromContext(ctx)

	if mcpServer.Spec.MultiTenancy.Isolation == mcpv1alpha1.IsolationNamespace {
		// Create namespace-level network policies
		logger.Info("Configuring namespace isolation", "mcp-server", mcpServer.Name)
		return r.reconcileNetworkPolicies(ctx, mcpServer)
	}

	if mcpServer.Spec.MultiTenancy.Isolation == mcpv1alpha1.IsolationFull {
		// Full isolation includes network policies and resource quotas
		logger.Info("Configuring full isolation", "mcp-server", mcpServer.Name)
		if err := r.reconcileNetworkPolicies(ctx, mcpServer); err != nil {
			return err
		}
		return r.reconcileResourceQuotas(ctx, mcpServer)
	}

	return nil
}

// reconcileNetworkPolicies creates network policies for isolation
func (r *MCPServerReconciler) reconcileNetworkPolicies(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	// NetworkPolicy implementation would go here
	// For now, log the intent
	log.FromContext(ctx).Info("Network policy reconciliation not fully implemented")
	return nil
}

// reconcileResourceQuotas creates resource quotas for the namespace
func (r *MCPServerReconciler) reconcileResourceQuotas(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) error {
	// ResourceQuota implementation would go here
	// For now, log the intent
	log.FromContext(ctx).Info("Resource quota reconciliation not fully implemented")
	return nil
}

// handleDeletion handles the deletion of the MCPServer
func (r *MCPServerReconciler) handleDeletion(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer) (ctrl.Result, error) {
	logger := log.FromContext(ctx)
	logger.Info("Handling MCPServer deletion")

	// Remove finalizer
	controllerutil.RemoveFinalizer(mcpServer, FinalizerName)
	if err := r.Update(ctx, mcpServer); err != nil {
		logger.Error(err, "Failed to remove finalizer")
		return ctrl.Result{}, err
	}

	return ctrl.Result{}, nil
}

// updateStatus updates the MCPServer status
func (r *MCPServerReconciler) updateStatus(ctx context.Context, mcpServer *mcpv1alpha1.MCPServer, phase mcpv1alpha1.MCPServerPhase, message string) error {
	logger := log.FromContext(ctx)

	// Fetch the latest status to avoid conflicts
	latest := &mcpv1alpha1.MCPServer{}
	if err := r.Get(ctx, client.ObjectKeyFromObject(mcpServer), latest); err != nil {
		return err
	}

	now := metav1.Now()
	latest.Status.Phase = phase
	latest.Status.ObservedGeneration = mcpServer.Generation

	// Update conditions
	condition := mcpv1alpha1.MCPServerCondition{
		Type:               mcpv1alpha1.MCPServerConditionReady,
		Status:             string(corev1.ConditionTrue),
		Reason:             "Reconciled",
		Message:            message,
		LastTransitionTime: now,
	}
	if phase == mcpv1alpha1.MCPServerPhaseFailed {
		condition.Status = string(corev1.ConditionFalse)
		condition.Reason = "ReconciliationFailed"
	} else if phase == mcpv1alpha1.MCPServerPhasePending {
		condition.Status = string(corev1.ConditionUnknown)
		condition.Reason = "Pending"
	}

	// Update or add condition
	found := false
	for i, c := range latest.Status.Conditions {
		if c.Type == condition.Type {
			latest.Status.Conditions[i] = condition
			found = true
			break
		}
	}
	if !found {
		latest.Status.Conditions = append(latest.Status.Conditions, condition)
	}

	// TODO: Get actual replicas from deployment
	latest.Status.Replicas = mcpServer.Spec.Replicas
	latest.Status.ReadyReplicas = mcpServer.Spec.Replicas // Placeholder

	if err := r.Status().Update(ctx, latest); err != nil {
		logger.Error(err, "Failed to update status")
		return err
	}

	// Copy status back to mcpServer for potential further use
	mcpServer.Status = latest.Status
	return nil
}

// buildLabels builds common labels for all resources
func (r *MCPServerReconciler) buildLabels(mcpServer *mcpv1alpha1.MCPServer) map[string]string {
	return map[string]string{
		LabelApp:                 mcpServer.Name,
		LabelMCPServer:           mcpServer.Name,
		LabelManagedBy:           ManagedByOperator,
		"mcp.platform/transport": string(mcpServer.Spec.Transport.Type),
	}
}

// buildEnvVars builds environment variables
func (r *MCPServerReconciler) buildEnvVars(mcpServer *mcpv1alpha1.MCPServer) []corev1.EnvVar {
	var envVars []corev1.EnvVar

	// Add transport type
	envVars = append(envVars, corev1.EnvVar{
		Name:  "MCP_TRANSPORT",
		Value: string(mcpServer.Spec.Transport.Type),
	})

	// Add transport port
	envVars = append(envVars, corev1.EnvVar{
		Name:  "MCP_PORT",
		Value: strconv.Itoa(int(mcpServer.Spec.Transport.Port)),
	})

	// Add transport host
	envVars = append(envVars, corev1.EnvVar{
		Name:  "MCP_HOST",
		Value: mcpServer.Spec.Transport.Host,
	})

	// Add custom env vars
	for _, env := range mcpServer.Spec.Env {
		envVar := corev1.EnvVar{
			Name:  env.Name,
			Value: env.Value,
		}
		// Note: ValueFrom conversion would require mapping our custom type to corev1.EnvVarSource
		envVars = append(envVars, envVar)
	}

	return envVars
}

// buildVolumeMounts builds volume mounts for secrets
func (r *MCPServerReconciler) buildVolumeMounts(mcpServer *mcpv1alpha1.MCPServer) []corev1.VolumeMount {
	var mounts []corev1.VolumeMount

	for _, secret := range mcpServer.Spec.Secrets {
		mounts = append(mounts, corev1.VolumeMount{
			Name:      secret.Name,
			MountPath: secret.MountPath,
			ReadOnly:  true,
		})
	}

	return mounts
}

// buildVolumes builds volumes for secrets
func (r *MCPServerReconciler) buildVolumes(mcpServer *mcpv1alpha1.MCPServer) []corev1.Volume {
	var volumes []corev1.Volume

	for _, secret := range mcpServer.Spec.Secrets {
		volumes = append(volumes, corev1.Volume{
			Name: secret.Name,
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: secret.Name,
				},
			},
		})
	}

	return volumes
}

// buildResourceRequirements builds resource requirements
func (r *MCPServerReconciler) buildResourceRequirements(mcpServer *mcpv1alpha1.MCPServer) corev1.ResourceRequirements {
	requirements := corev1.ResourceRequirements{}

	if mcpServer.Spec.Resources.Limits.CPU != "" || mcpServer.Spec.Resources.Limits.Memory != "" {
		requirements.Limits = corev1.ResourceList{}
		if mcpServer.Spec.Resources.Limits.CPU != "" {
			requirements.Limits[corev1.ResourceCPU] = resource.MustParse(mcpServer.Spec.Resources.Limits.CPU)
		}
		if mcpServer.Spec.Resources.Limits.Memory != "" {
			requirements.Limits[corev1.ResourceMemory] = resource.MustParse(mcpServer.Spec.Resources.Limits.Memory)
		}
	}

	if mcpServer.Spec.Resources.Requests.CPU != "" || mcpServer.Spec.Resources.Requests.Memory != "" {
		requirements.Requests = corev1.ResourceList{}
		if mcpServer.Spec.Resources.Requests.CPU != "" {
			requirements.Requests[corev1.ResourceCPU] = resource.MustParse(mcpServer.Spec.Resources.Requests.CPU)
		}
		if mcpServer.Spec.Resources.Requests.Memory != "" {
			requirements.Requests[corev1.ResourceMemory] = resource.MustParse(mcpServer.Spec.Resources.Requests.Memory)
		}
	}

	return requirements
}

// buildLivenessProbe builds the liveness probe
func (r *MCPServerReconciler) buildLivenessProbe(mcpServer *mcpv1alpha1.MCPServer) *corev1.Probe {
	switch mcpServer.Spec.Transport.Type {
	case mcpv1alpha1.TransportHTTPSSE, mcpv1alpha1.TransportWebsocket, mcpv1alpha1.TransportGRPC:
		return &corev1.Probe{
			ProbeHandler: corev1.ProbeHandler{
				HTTPGet: &corev1.HTTPGetAction{
					Path: "/healthz",
					Port: intstr.FromInt32(mcpServer.Spec.Transport.Port),
				},
			},
			InitialDelaySeconds: 10,
			PeriodSeconds:       10,
			TimeoutSeconds:      5,
			FailureThreshold:    3,
		}
	default:
		// For stdio, use exec probe or none
		return &corev1.Probe{
			ProbeHandler: corev1.ProbeHandler{
				Exec: &corev1.ExecAction{
					Command: []string{"sh", "-c", "ps aux | grep mcp-server | grep -v grep"},
				},
			},
			InitialDelaySeconds: 10,
			PeriodSeconds:       10,
			TimeoutSeconds:      5,
			FailureThreshold:    3,
		}
	}
}

// buildReadinessProbe builds the readiness probe
func (r *MCPServerReconciler) buildReadinessProbe(mcpServer *mcpv1alpha1.MCPServer) *corev1.Probe {
	switch mcpServer.Spec.Transport.Type {
	case mcpv1alpha1.TransportHTTPSSE, mcpv1alpha1.TransportWebsocket, mcpv1alpha1.TransportGRPC:
		return &corev1.Probe{
			ProbeHandler: corev1.ProbeHandler{
				HTTPGet: &corev1.HTTPGetAction{
					Path: "/ready",
					Port: intstr.FromInt32(mcpServer.Spec.Transport.Port),
				},
			},
			InitialDelaySeconds: 5,
			PeriodSeconds:       5,
			TimeoutSeconds:      3,
			FailureThreshold:    3,
		}
	default:
		return &corev1.Probe{
			ProbeHandler: corev1.ProbeHandler{
				Exec: &corev1.ExecAction{
					Command: []string{"sh", "-c", "ps aux | grep mcp-server | grep -v grep"},
				},
			},
			InitialDelaySeconds: 5,
			PeriodSeconds:       5,
			TimeoutSeconds:      3,
			FailureThreshold:    3,
		}
	}
}

// SetupWithManager sets up the controller with the Manager.
func (r *MCPServerReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&mcpv1alpha1.MCPServer{}).
		Owns(&appsv1.Deployment{}).
		Owns(&corev1.Service{}).
		Owns(&networkingv1.Ingress{}).
		Owns(&autoscalingv2.HorizontalPodAutoscaler{}).
		WithEventFilter(predicate.GenerationChangedPredicate{}).
		Complete(r)
}
