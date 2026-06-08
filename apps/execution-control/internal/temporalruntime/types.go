package temporalruntime

import "time"

type ChatAnswerWorkflowInput struct {
	ConversationID string            `json:"conversation_id"`
	Namespace      string            `json:"namespace"`
	PayloadSHA256  string            `json:"payload_sha256"`
	PolicyVersions map[string]string `json:"policy_versions"`
	RequestID      string            `json:"request_id"`
	RunID          string            `json:"run_id"`
	TaskQueue      string            `json:"task_queue"`
	TraceID        string            `json:"trace_id"`
	TurnID         string            `json:"turn_id"`
	WorkflowID     string            `json:"workflow_id"`
}

type ChatAnswerWorkflowResult struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RunID         string    `json:"run_id"`
	Status        string    `json:"status"`
}

type PlanChatAnswerActivityInput struct {
	ConversationID string            `json:"conversation_id"`
	Namespace      string            `json:"namespace"`
	PayloadSHA256  string            `json:"payload_sha256"`
	PolicyVersions map[string]string `json:"policy_versions"`
	RequestID      string            `json:"request_id"`
	RunID          string            `json:"run_id"`
	TraceID        string            `json:"trace_id"`
	TurnID         string            `json:"turn_id"`
	WorkflowID     string            `json:"workflow_id"`
}

type PlanChatAnswerActivityOutput struct {
	PlanRef string `json:"plan_ref"`
	RunID   string `json:"run_id"`
	Status  string `json:"status"`
}

type InvokeSemanticWorkerActivityInput struct {
	PlanRef string `json:"plan_ref"`
	RunID   string `json:"run_id"`
	TraceID string `json:"trace_id"`
}

type InvokeSemanticWorkerActivityOutput struct {
	BridgeRef string `json:"bridge_ref"`
	RunID     string `json:"run_id"`
	Status    string `json:"status"`
}

type SynthesizeRAGAnswerActivityInput struct {
	BridgeRef string `json:"bridge_ref"`
	PlanRef   string `json:"plan_ref"`
	RunID     string `json:"run_id"`
	TraceID   string `json:"trace_id"`
}

type SynthesizeRAGAnswerActivityOutput struct {
	BridgeRef string `json:"bridge_ref"`
	RunID     string `json:"run_id"`
	Status    string `json:"status"`
}

type FinalizeChatAnswerActivityInput struct {
	BridgeRef string `json:"bridge_ref"`
	PlanRef   string `json:"plan_ref"`
	RunID     string `json:"run_id"`
	TraceID   string `json:"trace_id"`
}

type FinalizeChatAnswerActivityOutput struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RunID         string    `json:"run_id"`
	Status        string    `json:"status"`
}

type ChatAnswerWorkflowCancelInput struct {
	Reason     string `json:"reason"`
	RunID      string `json:"run_id"`
	WorkflowID string `json:"workflow_id"`
}
