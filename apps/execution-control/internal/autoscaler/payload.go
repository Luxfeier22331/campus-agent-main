package autoscaler

const (
	SchemaVersion = "temporal_task_queue_metrics_snapshot.v1"

	ActuationStatusApplied = "applied"
	ActuationStatusFailed  = "failed"
	ActuationStatusSkipped = "skipped"

	ActuatorKindDockerCompose = "docker_compose"
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

type AppAPIRuntimePayload struct {
	Actuations    []Actuation                 `json:"actuations,omitempty"`
	Decisions     []WorkerAutoscalerDecision  `json:"decisions,omitempty"`
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
