package autoscaler

const (
	SchemaVersion = "temporal_task_queue_metrics_snapshot.v1"

	ActuationStatusApplied = "applied"
	ActuationStatusFailed  = "failed"
	ActuationStatusSkipped = "skipped"

	ActuatorKindDockerCompose = "docker_compose"

	ScalerKindDockerCompose = "docker_compose"
	ScalerKindKEDATemporal  = "keda_temporal"

	ScalerStatusHealthy  = "healthy"
	ScalerStatusDegraded = "degraded"
	ScalerStatusPaused   = "paused"
	ScalerStatusDisabled = "disabled"
)

type Actuation struct {
	ActedAt       string `json:"actedAt"`
	Action        string `json:"action"`
	ActuationID   string `json:"actuationId"`
	ActuatorKind  string `json:"actuatorKind"`
	DecisionID    string `json:"decisionId"`
	ErrorCode     string `json:"errorCode,omitempty"`
	FromReplicas  int    `json:"fromReplicas"`
	Status        string `json:"status"`
	TargetService string `json:"targetService"`
	ToReplicas    int    `json:"toReplicas"`
}

type WorkerAutoscalerPosture struct {
	CurrentReplicas  int            `json:"currentReplicas"`
	DesiredReplicas  int            `json:"desiredReplicas"`
	Evidence         map[string]any `json:"evidence"`
	LastScaleEventAt *string        `json:"lastScaleEventAt"`
	LastScaleEventID *string        `json:"lastScaleEventId"`
	MaxReplicas      int            `json:"maxReplicas"`
	MetricFreshness  SourceMetric   `json:"metricFreshness"`
	MinReplicas      int            `json:"minReplicas"`
	ObservedAt       string         `json:"observedAt"`
	Reason           string         `json:"reason"`
	ScalerKind       string         `json:"scalerKind"`
	ScalerStatus     string         `json:"scalerStatus"`
	TargetService    string         `json:"targetService"`
	TaskQueue        string         `json:"taskQueue"`
	TaskQueueKind    string         `json:"taskQueueKind"`
}

type AppAPIRuntimePayload struct {
	Actuations    []Actuation                 `json:"actuations,omitempty"`
	Decisions     []WorkerAutoscalerDecision  `json:"decisions,omitempty"`
	Postures      []WorkerAutoscalerPosture   `json:"postures,omitempty"`
	SchemaVersion string                      `json:"schemaVersion"`
	Snapshots     []TemporalTaskQueueSnapshot `json:"snapshots,omitempty"`
}

func BuildAppAPIRuntimePayload(input TemporalRuntimeInput, plan Plan) AppAPIRuntimePayload {
	return AppAPIRuntimePayload{
		Decisions:     plan.Decisions,
		SchemaVersion: SchemaVersion,
		Snapshots:     input.Snapshots,
	}
}

func BuildAppAPIRuntimePayloadWithActuations(
	input TemporalRuntimeInput,
	plan Plan,
	actuations []Actuation,
) AppAPIRuntimePayload {
	payload := BuildAppAPIRuntimePayload(input, plan)
	payload.Actuations = actuations
	return payload
}
