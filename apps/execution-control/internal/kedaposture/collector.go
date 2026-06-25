package kedaposture

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/autoscaler"
)

type Target struct {
	MaxReplicas   int
	MinReplicas   int
	Name          string
	QueueKind     string
	ScaledObject  string
	TaskQueue     string
	TargetService string
}

type Config struct {
	Namespace string
	Targets   []Target
}

type Collector struct {
	Client    *http.Client
	Now       func() time.Time
	ServerURL string
	Token     string
}

type deploymentResource struct {
	Status struct {
		ReadyReplicas float64 `json:"readyReplicas"`
		Replicas      float64 `json:"replicas"`
	} `json:"status"`
}

type hpaResource struct {
	Spec struct {
		MaxReplicas float64  `json:"maxReplicas"`
		MinReplicas *float64 `json:"minReplicas"`
	} `json:"spec"`
	Status struct {
		Conditions      []condition `json:"conditions"`
		CurrentReplicas float64     `json:"currentReplicas"`
		DesiredReplicas float64     `json:"desiredReplicas"`
	} `json:"status"`
}

type scaledObjectResource struct {
	Metadata struct {
		Annotations map[string]string `json:"annotations"`
	} `json:"metadata"`
	Status struct {
		Conditions     []condition `json:"conditions"`
		LastActiveTime string      `json:"lastActiveTime"`
	} `json:"status"`
}

type eventListResource struct {
	Items []eventResource `json:"items"`
}

type eventResource struct {
	EventTime      string `json:"eventTime"`
	FirstTimestamp string `json:"firstTimestamp"`
	LastTimestamp  string `json:"lastTimestamp"`
	Message        string `json:"message"`
	Metadata       struct {
		CreationTimestamp string `json:"creationTimestamp"`
	} `json:"metadata"`
	Reason string `json:"reason"`
	Type   string `json:"type"`
}

type condition struct {
	LastTransitionTime string `json:"lastTransitionTime"`
	Message            string `json:"message"`
	Reason             string `json:"reason"`
	Status             string `json:"status"`
	Type               string `json:"type"`
}

type kedaEventSignal struct {
	At      string
	Message string
	Reason  string
	Type    string
}

func (c Collector) Collect(ctx context.Context, config Config) ([]autoscaler.WorkerAutoscalerPosture, error) {
	namespace := strings.TrimSpace(config.Namespace)
	if namespace == "" {
		return nil, fmt.Errorf("kubernetes namespace is required")
	}
	if len(config.Targets) == 0 {
		return nil, fmt.Errorf("posture targets are required")
	}
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	postures := make([]autoscaler.WorkerAutoscalerPosture, 0, len(config.Targets))
	for _, target := range config.Targets {
		normalized, err := normalizeTarget(target)
		if err != nil {
			return nil, err
		}
		deployment := deploymentResource{}
		if err := c.get(ctx, namespace, "apis/apps/v1", "deployments", normalized.Name, &deployment); err != nil {
			return nil, err
		}
		hpa := hpaResource{}
		hpaName := "keda-hpa-" + normalized.Name
		if err := c.get(ctx, namespace, "apis/autoscaling/v2", "horizontalpodautoscalers", hpaName, &hpa); err != nil {
			return nil, err
		}
		scaledObject := scaledObjectResource{}
		if err := c.get(ctx, namespace, "apis/keda.sh/v1alpha1", "scaledobjects", normalized.ScaledObject, &scaledObject); err != nil {
			return nil, err
		}
		events, err := c.listEvents(ctx, namespace, normalized.Name)
		if err != nil {
			return nil, err
		}
		postures = append(postures, postureFromResources(now, normalized, deployment, hpaName, hpa, scaledObject, events))
	}
	return postures, nil
}

func normalizeTarget(target Target) (Target, error) {
	target.Name = strings.TrimSpace(target.Name)
	target.TargetService = strings.TrimSpace(target.TargetService)
	target.ScaledObject = strings.TrimSpace(target.ScaledObject)
	target.TaskQueue = strings.TrimSpace(target.TaskQueue)
	target.QueueKind = strings.TrimSpace(target.QueueKind)
	if target.Name == "" {
		return Target{}, fmt.Errorf("target name is required")
	}
	if target.TargetService == "" {
		target.TargetService = target.Name
	}
	if target.ScaledObject == "" {
		target.ScaledObject = target.Name
	}
	if target.TaskQueue == "" {
		return Target{}, fmt.Errorf("task queue is required for %s", target.Name)
	}
	if target.QueueKind == "" {
		return Target{}, fmt.Errorf("queue kind is required for %s", target.Name)
	}
	if target.MinReplicas < 0 || target.MaxReplicas < 0 {
		return Target{}, fmt.Errorf("replica bounds must be non-negative for %s", target.Name)
	}
	if target.MaxReplicas < target.MinReplicas {
		return Target{}, fmt.Errorf("max replicas must be greater than or equal to min replicas for %s", target.Name)
	}
	return target, nil
}

func (c Collector) listEvents(ctx context.Context, namespace string, targetName string) (eventListResource, error) {
	result := eventListResource{}
	baseURL := strings.TrimRight(strings.TrimSpace(c.ServerURL), "/")
	if baseURL == "" {
		return result, fmt.Errorf("kubernetes server URL is required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return result, err
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") +
		"/api/v1/namespaces/" + url.PathEscape(namespace) + "/events"
	query := parsed.Query()
	query.Set("fieldSelector", "involvedObject.name="+targetName)
	parsed.RawQuery = query.Encode()
	if err := c.requestJSON(ctx, parsed.String(), "events", "list", &result); err != nil {
		return result, err
	}
	return result, nil
}

func (c Collector) get(
	ctx context.Context,
	namespace string,
	apiPrefix string,
	resource string,
	name string,
	out any,
) error {
	baseURL := strings.TrimRight(strings.TrimSpace(c.ServerURL), "/")
	if baseURL == "" {
		return fmt.Errorf("kubernetes server URL is required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return err
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/" + strings.Trim(apiPrefix, "/") +
		"/namespaces/" + url.PathEscape(namespace) + "/" + url.PathEscape(resource) +
		"/" + url.PathEscape(name)
	return c.requestJSON(ctx, parsed.String(), resource, name, out)
}

func (c Collector) requestJSON(ctx context.Context, endpoint string, resource string, name string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	token := strings.TrimSpace(c.Token)
	if token == "" {
		return fmt.Errorf("kubernetes bearer token is required")
	}
	request.Header.Set("authorization", "Bearer "+token)
	client := c.Client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("kubernetes %s/%s returned %d: %s", resource, name, response.StatusCode, strings.TrimSpace(string(body)))
	}
	if readErr != nil {
		return readErr
	}
	if err := json.Unmarshal(body, out); err != nil {
		return err
	}
	return nil
}

func postureFromResources(
	now time.Time,
	target Target,
	deployment deploymentResource,
	hpaName string,
	hpa hpaResource,
	scaledObject scaledObjectResource,
	events eventListResource,
) autoscaler.WorkerAutoscalerPosture {
	minReplicas := target.MinReplicas
	if hpa.Spec.MinReplicas != nil {
		minReplicas = int(*hpa.Spec.MinReplicas)
	}
	maxReplicas := target.MaxReplicas
	if hpa.Spec.MaxReplicas > 0 {
		maxReplicas = int(hpa.Spec.MaxReplicas)
	}
	current := int(hpa.Status.CurrentReplicas)
	if current == 0 && deployment.Status.Replicas > 0 {
		current = int(deployment.Status.Replicas)
	}
	desired := int(hpa.Status.DesiredReplicas)
	if desired == 0 {
		desired = current
	}
	lastScaleCondition := newestCondition(hpa.Status.Conditions)
	lastScaleEventAt := nullableTimeString(lastScaleCondition.LastTransitionTime)
	metricFreshness := autoscaler.SourceMetric{State: autoscaler.SourceMetricUnsupported}
	if lastActive, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(scaledObject.Status.LastActiveTime)); err == nil {
		ms := int(now.Sub(lastActive.UTC()).Milliseconds())
		if ms < 0 {
			ms = 0
		}
		metricFreshness = autoscaler.SourceMetric{MS: &ms, State: autoscaler.SourceMetricObserved}
	}
	scaledReady := conditionIsTrue(scaledObject.Status.Conditions, "Ready")
	hpaAble := conditionIsTrue(hpa.Status.Conditions, "AbleToScale")
	hpaActive := conditionIsTrue(hpa.Status.Conditions, "ScalingActive")
	paused := isPaused(scaledObject.Metadata.Annotations)
	eventSignal, hasEventSignal := newestKEDAEventSignal(events)
	status := autoscaler.ScalerStatusHealthy
	reason := "within_target"
	if desired > current {
		reason = "hpa_desired_replicas_above_current"
	} else if desired < current {
		reason = "hpa_desired_replicas_below_current"
	}
	if paused {
		status = autoscaler.ScalerStatusPaused
		reason = "keda_scaledobject_paused"
	} else if hasEventSignal && eventSignal.Reason == "ScaledObjectFallbackActivated" {
		status = autoscaler.ScalerStatusDegraded
		reason = "keda_fallback_active"
	} else if hasEventSignal {
		status = autoscaler.ScalerStatusDegraded
		reason = "keda_metric_source_failed"
	} else if !scaledReady || !hpaAble || !hpaActive {
		status = autoscaler.ScalerStatusDegraded
		reason = "keda_hpa_condition_degraded"
	}
	if hasEventSignal && eventSignal.At != "" {
		lastScaleEventAt = &eventSignal.At
	}
	return autoscaler.WorkerAutoscalerPosture{
		CurrentReplicas:  current,
		DesiredReplicas:  desired,
		Evidence:         evidence(target, deployment, hpaName, hpa, scaledObject, scaledReady, hpaAble, hpaActive, paused, eventSignal, hasEventSignal),
		LastScaleEventAt: lastScaleEventAt,
		LastScaleEventID: lastScaleEventAt,
		MaxReplicas:      maxReplicas,
		MetricFreshness:  metricFreshness,
		MinReplicas:      minReplicas,
		ObservedAt:       now.Format(time.RFC3339Nano),
		Reason:           reason,
		ScalerKind:       autoscaler.ScalerKindKEDATemporal,
		ScalerStatus:     status,
		TargetService:    target.TargetService,
		TaskQueue:        target.TaskQueue,
		TaskQueueKind:    target.QueueKind,
	}
}

func evidence(
	target Target,
	deployment deploymentResource,
	hpaName string,
	hpa hpaResource,
	scaledObject scaledObjectResource,
	scaledReady bool,
	hpaAble bool,
	hpaActive bool,
	paused bool,
	eventSignal kedaEventSignal,
	hasEventSignal bool,
) map[string]any {
	result := map[string]any{
		"deploymentName":          target.Name,
		"deploymentReadyReplicas": deployment.Status.ReadyReplicas,
		"deploymentReplicas":      deployment.Status.Replicas,
		"hpaAbleToScale":          hpaAble,
		"hpaActive":               hpaActive,
		"hpaConditions":           hpa.Status.Conditions,
		"hpaName":                 hpaName,
		"kedaPaused":              paused,
		"scaledObjectConditions":  scaledObject.Status.Conditions,
		"scaledObjectName":        target.ScaledObject,
		"scaledObjectReady":       scaledReady,
	}
	if hasEventSignal {
		result["kedaEventReason"] = eventSignal.Reason
		result["kedaEventType"] = eventSignal.Type
		result["kedaEventMessage"] = eventSignal.Message
		if eventSignal.At != "" {
			result["kedaEventAt"] = eventSignal.At
		}
	}
	return result
}

func conditionIsTrue(conditions []condition, conditionType string) bool {
	for _, condition := range conditions {
		if condition.Type == conditionType && strings.EqualFold(condition.Status, "true") {
			return true
		}
	}
	return len(conditions) == 0
}

func newestCondition(conditions []condition) condition {
	var selected condition
	var selectedTime time.Time
	for _, condition := range conditions {
		timestamp, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(condition.LastTransitionTime))
		if err != nil {
			continue
		}
		if selected.LastTransitionTime == "" || timestamp.After(selectedTime) {
			selected = condition
			selectedTime = timestamp
		}
	}
	return selected
}

func nullableTimeString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func isPaused(annotations map[string]string) bool {
	if len(annotations) == 0 {
		return false
	}
	for _, key := range []string{
		"autoscaling.keda.sh/paused",
		"autoscaling.keda.sh/paused-replicas",
	} {
		if strings.TrimSpace(annotations[key]) != "" {
			return true
		}
	}
	return false
}

func newestKEDAEventSignal(events eventListResource) (kedaEventSignal, bool) {
	var selected kedaEventSignal
	var selectedTime time.Time
	selectedTimeValid := false
	for _, event := range events.Items {
		if !isKEDADegradedEventReason(event.Reason) {
			continue
		}
		at := eventTimestamp(event)
		timestamp, timestampValid := parseTimestamp(at)
		if selected.Reason != "" {
			if !timestampValid {
				continue
			}
			if selectedTimeValid && !timestamp.After(selectedTime) {
				continue
			}
		}
		selected = kedaEventSignal{
			At:      at,
			Message: sanitizeEventMessage(event.Message),
			Reason:  strings.TrimSpace(event.Reason),
			Type:    strings.TrimSpace(event.Type),
		}
		selectedTime = timestamp
		selectedTimeValid = timestampValid
	}
	return selected, selected.Reason != ""
}

func isKEDADegradedEventReason(reason string) bool {
	switch strings.TrimSpace(reason) {
	case "ScaledObjectFallbackActivated",
		"KEDAScalerFailed",
		"KEDAMetricSourceFailed",
		"ScaledObjectCheckFailed":
		return true
	default:
		return false
	}
}

func eventTimestamp(event eventResource) string {
	for _, value := range []string{
		event.EventTime,
		event.LastTimestamp,
		event.Metadata.CreationTimestamp,
		event.FirstTimestamp,
	} {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func parseTimestamp(value string) (time.Time, bool) {
	timestamp, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
	return timestamp, err == nil
}

func sanitizeEventMessage(message string) string {
	const maxRunes = 500
	trimmed := strings.TrimSpace(message)
	runes := []rune(trimmed)
	if len(runes) <= maxRunes {
		return trimmed
	}
	return string(runes[:maxRunes-3]) + "..."
}
