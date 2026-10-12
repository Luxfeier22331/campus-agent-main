// Code generated from agent-runtime-control.v1.schema.json. DO NOT EDIT.
package executioncontract

import (
	"encoding/json"
	"time"
)

type AgentAdmissionSnapshot struct {
	AgentLimits             AgentRuntimeLimitsSnapshot      `json:"agent_limits"`
	AgentCapabilities       AgentCapabilitiesSnapshot       `json:"agent_capabilities"`
	AgentBudget             AgentRuntimeBudgetSnapshot      `json:"agent_budget"`
	ModelTargetSHA256       string                          `json:"provider_config_sha256"`
	ToolContractFingerprint ToolContractFingerprintSnapshot `json:"tool_contract_fingerprint"`
}

type AgentCapabilitiesSnapshot struct {
	SchemaVersion            string   `json:"schema_version"`
	HostedWebSearch          bool     `json:"hosted_web_search"`
	VisibleFunctionToolNames []string `json:"visible_function_tool_names"`
}

type AgentRuntimeBudgetSnapshot struct {
	MaxFunctionToolCalls int    `json:"max_function_tool_calls"`
	MaxModelTurns        int    `json:"max_model_turns"`
	MaxPlanSteps         int    `json:"max_plan_steps"`
	MaxReplans           int    `json:"max_replans"`
	SchemaVersion        string `json:"schema_version"`
}

type AgentRuntimeLimitsSnapshot struct {
	AgentDeadlineMS       int `json:"agent_deadline_ms"`
	ContextCharLimit      int `json:"context_char_limit"`
	CurrentInputCharLimit int `json:"current_input_char_limit"`
	MaxOutputTokens       int `json:"max_output_tokens"`
}

type AgentToolResult struct {
	StartedAt    *time.Time        `json:"started_at,omitempty"`
	CompletedAt  *time.Time        `json:"completed_at,omitempty"`
	DurationMS   float64           `json:"duration_ms"`
	Failure      *ExecutionFailure `json:"failure,omitempty"`
	InvocationID string            `json:"invocation_id"`
	Result       map[string]any    `json:"result"`
	Status       string            `json:"status"`
	ToolName     string            `json:"tool_name"`
}

type AgentUsageSummary struct {
	ModelRequestCount int64 `json:"model_request_count"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	InputTokens       int64 `json:"input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	UsageObserved     bool  `json:"usage_observed"`
}

type ExecutionFailure struct {
	Reason       string          `json:"reason,omitempty"`
	Citation     json.RawMessage `json:"citation,omitempty"`
	Stage        string          `json:"stage,omitempty"`
	Code         string          `json:"code"`
	Operation    string          `json:"operation"`
	Detail       string          `json:"detail,omitempty"`
	HTTPStatus   int             `json:"http_status,omitempty"`
	InvocationID string          `json:"invocation_id,omitempty"`
}

type CancellationInput struct {
	CanceledAt time.Time `json:"canceled_at"`
	Reason     string    `json:"reason"`
	RequestID  string    `json:"request_id"`
}

type CancellationOutput struct {
	RequestID string `json:"request_id"`
	Status    string `json:"status"`
}

type FailureInput struct {
	FailureKind string    `json:"failure_kind"`
	FailedAt    time.Time `json:"failed_at"`
	RequestID   string    `json:"request_id"`
	Stage       string    `json:"stage"`
}

type FailureOutput struct {
	CompletedAt time.Time `json:"completed_at"`
	RequestID   string    `json:"request_id"`
	Status      string    `json:"status"`
}

type SourceLink struct {
	Href *string `json:"href"`
}

type ToolContractFingerprintSnapshot struct {
	FunctionSchemaSHA256 string `json:"function_schema_sha256"`
	SchemaVersion        string `json:"schema_version"`
	ToolsSHA256          string `json:"tools_sha256"`
}

type WebEvidence struct {
	SourceLink *SourceLink `json:"source_link,omitempty"`
	Title      string      `json:"title"`
	URL        string      `json:"url"`
	Excerpt    string      `json:"excerpt"`
	StartIndex int         `json:"start_index"`
	EndIndex   int         `json:"end_index"`
}

type WebSearchDiagnostic struct {
	SchemaVersion  int            `json:"schema_version"`
	State          string         `json:"state"`
	QueryCount     int            `json:"query_count"`
	ChunkCount     int            `json:"chunk_count"`
	SupportCount   int            `json:"support_count"`
	ConvertedCount int            `json:"converted_count"`
	DiscardedCount int            `json:"discarded_count"`
	DiscardReasons map[string]int `json:"discard_reasons"`
}

type WorkflowCompletedStep struct {
	RemainingFacts []string                `json:"remaining_facts"`
	Failure        *ExecutionFailure       `json:"failure,omitempty"`
	Step           WorkflowTaskPlanStep    `json:"step"`
	ExecutionIndex int                     `json:"execution_index"`
	Summary        string                  `json:"summary"`
	Evidence       []WorkflowEvidence      `json:"evidence"`
	SourceAttempts []WorkflowSourceAttempt `json:"source_attempts"`
}

type WorkflowEvidence struct {
	SourceLink    *SourceLink    `json:"source_link,omitempty"`
	SchemaVersion string         `json:"schema_version"`
	ID            string         `json:"id"`
	Source        WorkflowSource `json:"source"`
	Title         string         `json:"title"`
	Excerpt       string         `json:"excerpt"`
	CitationIndex int            `json:"citation_index,omitempty"`
	URL           string         `json:"url,omitempty"`
	ResultRef     string         `json:"result_ref,omitempty"`
	DocumentID    string         `json:"document_id,omitempty"`
	NoticeID      string         `json:"notice_id,omitempty"`
	ReleasedAt    string         `json:"released_at,omitempty"`
	CitationHref  string         `json:"citation_href,omitempty"`
	SectionRef    string         `json:"section_ref,omitempty"`
	SectionTitle  string         `json:"section_title,omitempty"`
	RootUnitIDs   []string       `json:"root_unit_ids,omitempty"`
	VersionID     string         `json:"version_id,omitempty"`
	VersionSlug   string         `json:"version_slug,omitempty"`
}

type FinalizationOutput struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RequestID     string    `json:"request_id"`
	Status        string    `json:"status"`
}

type OperationOutput struct {
	WebEvidence             []WebEvidence           `json:"web_evidence,omitempty"`
	WebSearchDiagnostic     *WebSearchDiagnostic    `json:"web_search_diagnostic,omitempty"`
	Failure                 *ExecutionFailure       `json:"failure,omitempty"`
	AnswerStarted           bool                    `json:"answer_started,omitempty"`
	Operation               WorkflowOperation       `json:"operation"`
	SolveOutcome            string                  `json:"solve_outcome,omitempty"`
	WorkflowResultRef       string                  `json:"agent_result_ref"`
	FinalOutput             string                  `json:"final_output"`
	Plan                    *WorkflowTaskPlan       `json:"plan,omitempty"`
	Replan                  *WorkflowTaskReplan     `json:"replan,omitempty"`
	RemainingFacts          []string                `json:"remaining_facts,omitempty"`
	Evidence                []WorkflowEvidence      `json:"evidence"`
	SourceAttempts          []WorkflowSourceAttempt `json:"source_attempts"`
	ModelName               string                  `json:"model_name"`
	ModelProvider           string                  `json:"model_provider"`
	ProviderResponseID      string                  `json:"provider_response_id"`
	RequestID               string                  `json:"request_id"`
	StageTiming             map[string]any          `json:"stage_timing,omitempty"`
	Status                  string                  `json:"status"`
	TerminalReason          string                  `json:"terminal_reason"`
	ToolResults             []AgentToolResult       `json:"tool_results"`
	ToolContractFingerprint map[string]any          `json:"tool_contract_fingerprint"`
	RuntimeRelease          string                  `json:"runtime_release"`
	Usage                   AgentUsageSummary       `json:"usage"`
}

type WorkflowRemainingFacts struct {
	Objective string   `json:"objective"`
	Facts     []string `json:"facts"`
}

type WorkflowSourceAttempt struct {
	Source      WorkflowSource `json:"source"`
	Status      string         `json:"status"`
	FailureCode string         `json:"failure_code,omitempty"`
}

type WorkflowTaskPlan struct {
	SchemaVersion string                 `json:"schema_version"`
	Goal          string                 `json:"goal"`
	Steps         []WorkflowTaskPlanStep `json:"steps"`
}

type WorkflowTaskPlanStep struct {
	ID               string           `json:"id"`
	Objective        string           `json:"objective"`
	CandidateSources []WorkflowSource `json:"candidate_sources"`
	DependsOn        []string         `json:"depends_on"`
}

type WorkflowTaskReplan struct {
	SchemaVersion  string                 `json:"schema_version"`
	Decision       string                 `json:"decision"`
	Reason         string                 `json:"reason"`
	RemainingSteps []WorkflowTaskPlanStep `json:"remaining_steps"`
}

type FinalizationInput struct {
	WorkflowResult    OperationOutput        `json:"workflow_result"`
	AdmissionSnapshot AgentAdmissionSnapshot `json:"admission_snapshot"`
	RequestID         string                 `json:"request_id"`
}

type ActivityMetadata struct {
	WorkflowID      string    `json:"workflow_id"`
	TemporalRunID   string    `json:"temporal_run_id"`
	ActivityID      string    `json:"activity_id"`
	ActivityType    string    `json:"activity_type"`
	ActivityAttempt int32     `json:"activity_attempt"`
	TaskQueue       string    `json:"task_queue"`
	ScheduledAt     time.Time `json:"scheduled_at"`
	StartedAt       time.Time `json:"started_at"`
}
