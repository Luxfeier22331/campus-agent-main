package temporalclient

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"time"
)

type ToolExecutionWorkflowInput struct {
	MemoryDeliveryExternal       bool                                     `json:"memory_delivery_external,omitempty"`
	DeadlineAt                   time.Time                                `json:"deadline_at"`
	AdmissionSnapshot            executioncontract.AgentAdmissionSnapshot `json:"admission_snapshot"`
	AdmissionSnapshotSHA256      string                                   `json:"admission_snapshot_sha256"`
	ConversationID               string                                   `json:"conversation_id"`
	Namespace                    string                                   `json:"namespace"`
	PayloadSHA256                string                                   `json:"payload_sha256"`
	PersonalMemoryTimeoutSeconds float64                                  `json:"personal_memory_timeout_seconds"`
	RequestID                    string                                   `json:"request_id"`
	TaskQueue                    string                                   `json:"task_queue"`
	TraceParent                  string                                   `json:"traceparent,omitempty"`
	WorkflowID                   string                                   `json:"workflow_id"`
}
type ToolExecutionWorkflowCancelInput struct {
	Reason        string `json:"reason"`
	RequestID     string `json:"request_id"`
	TemporalRunID string `json:"temporal_run_id"`
	WorkflowID    string `json:"workflow_id"`
}
