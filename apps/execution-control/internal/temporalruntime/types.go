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

type PlanRAGActivityInput struct {
	RunID           string `json:"run_id"`
	TraceID         string `json:"trace_id"`
	WorkflowPlanRef string `json:"workflow_plan_ref"`
}

type PlanRAGActivityOutput struct {
	PlanRef string `json:"plan_ref"`
	RunID   string `json:"run_id"`
	Status  string `json:"status"`
}

type RetrieveIndexedLookupActivityInput struct {
	RAGPlanRef string `json:"rag_plan_ref"`
	RunID      string `json:"run_id"`
	TraceID    string `json:"trace_id"`
}

type RetrieveIndexedLookupActivityOutput struct {
	LookupRef string `json:"lookup_ref"`
	RunID     string `json:"run_id"`
	Status    string `json:"status"`
}

type ExpandOrRescueRetrievalActivityInput struct {
	LookupRef  string `json:"lookup_ref"`
	RAGPlanRef string `json:"rag_plan_ref"`
	RunID      string `json:"run_id"`
	TraceID    string `json:"trace_id"`
}

type ExpandOrRescueRetrievalActivityOutput struct {
	LookupRef string `json:"lookup_ref"`
	RescueRef string `json:"rescue_ref"`
	RunID     string `json:"run_id"`
	Status    string `json:"status"`
}

type SelectEvidenceActivityInput struct {
	LookupRef  string `json:"lookup_ref"`
	RAGPlanRef string `json:"rag_plan_ref"`
	RescueRef  string `json:"rescue_ref"`
	RunID      string `json:"run_id"`
	TraceID    string `json:"trace_id"`
}

type SelectEvidenceActivityOutput struct {
	EvidenceRef string `json:"evidence_ref"`
	RunID       string `json:"run_id"`
	Status      string `json:"status"`
}

type SynthesizeRAGAnswerActivityInput struct {
	EvidenceRef string `json:"evidence_ref"`
	RAGPlanRef  string `json:"rag_plan_ref"`
	RunID       string `json:"run_id"`
	TraceID     string `json:"trace_id"`
}

type SynthesizeRAGAnswerActivityOutput struct {
	RunID        string `json:"run_id"`
	Status       string `json:"status"`
	SynthesisRef string `json:"synthesis_ref"`
}

type VerifyGroundingActivityInput struct {
	EvidenceRef  string `json:"evidence_ref"`
	RunID        string `json:"run_id"`
	SynthesisRef string `json:"synthesis_ref"`
	TraceID      string `json:"trace_id"`
}

type VerifyGroundingActivityOutput struct {
	GroundingRef string `json:"grounding_ref"`
	RunID        string `json:"run_id"`
	Status       string `json:"status"`
}

type WriteFinalizationActivityInput struct {
	GroundingRef string `json:"grounding_ref"`
	RunID        string `json:"run_id"`
	SynthesisRef string `json:"synthesis_ref"`
	TraceID      string `json:"trace_id"`
}

type WriteFinalizationActivityOutput struct {
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
