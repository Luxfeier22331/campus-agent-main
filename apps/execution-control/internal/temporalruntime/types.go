package temporalruntime

import (
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type ToolExecutionWorkflowInput = execution.WorkflowStartInput

type WorkflowOperation string

const (
	WorkflowOperationSolve       WorkflowOperation = "solve"
	WorkflowOperationExecuteStep WorkflowOperation = "execute_step"
	WorkflowOperationReplan      WorkflowOperation = "replan"
	WorkflowOperationSynthesize  WorkflowOperation = "synthesize"
)

type WorkflowSource string

const (
	WorkflowSourceCampusSearch         WorkflowSource = "campus_search"
	WorkflowSourceWebSearch            WorkflowSource = "web_search"
	WorkflowSourcePersonalMemoryRecall WorkflowSource = "personal_memory_recall"
)

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

type WorkflowEvidence struct {
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
	CitationHref  string         `json:"citation_href,omitempty"`
	SectionRef    string         `json:"section_ref,omitempty"`
	SectionTitle  string         `json:"section_title,omitempty"`
	RootUnitIDs   []string       `json:"root_unit_ids,omitempty"`
	VersionID     string         `json:"version_id,omitempty"`
	VersionSlug   string         `json:"version_slug,omitempty"`
}

type WorkflowSourceAttempt struct {
	Source      WorkflowSource `json:"source"`
	Status      string         `json:"status"`
	FailureCode string         `json:"failure_code,omitempty"`
}

type WorkflowCompletedStep struct {
	Step           WorkflowTaskPlanStep    `json:"step"`
	ExecutionIndex int                     `json:"execution_index"`
	Summary        string                  `json:"summary"`
	Evidence       []WorkflowEvidence      `json:"evidence"`
	SourceAttempts []WorkflowSourceAttempt `json:"source_attempts"`
}

type WorkflowOperationActivityInputBase struct {
	AdmissionSnapshot execution.AgentAdmissionSnapshot `json:"admission_snapshot"`
	ConversationID    string                           `json:"conversation_id"`
	RequestID         string                           `json:"request_id"`
	TraceParent       string                           `json:"traceparent,omitempty"`
}

type SolveTaskActivityInput struct {
	WorkflowOperationActivityInputBase
	MaxSteps int `json:"max_steps"`
}

type ExecuteTaskStepActivityInput struct {
	WorkflowOperationActivityInputBase
	Plan           WorkflowTaskPlan        `json:"plan"`
	Step           WorkflowTaskPlanStep    `json:"step"`
	CompletedSteps []WorkflowCompletedStep `json:"completed_steps"`
	CitationStart  int                     `json:"citation_start"`
}

type ReplanTaskActivityInput struct {
	WorkflowOperationActivityInputBase
	Plan              WorkflowTaskPlan        `json:"plan"`
	CompletedSteps    []WorkflowCompletedStep `json:"completed_steps"`
	RemainingSteps    []WorkflowTaskPlanStep  `json:"remaining_steps"`
	MaxRemainingSteps int                     `json:"max_remaining_steps"`
	ReplanIndex       int                     `json:"replan_index"`
}

type SynthesizeAnswerActivityInput struct {
	WorkflowOperationActivityInputBase
	Plan           WorkflowTaskPlan        `json:"plan"`
	CompletedSteps []WorkflowCompletedStep `json:"completed_steps"`
	Evidence       []WorkflowEvidence      `json:"evidence"`
}

type ToolExecutionWorkflowResult struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RequestID     string    `json:"request_id"`
	Status        string    `json:"status"`
}

type AppendConversationMemoryActivityInput struct {
	RequestID string `json:"request_id"`
}

type AppendConversationMemoryActivityOutput struct {
	AppendedMessageCount int      `json:"appended_message_count"`
	RequestID            string   `json:"request_id"`
	SchemaVersion        string   `json:"schema_version"`
	SkipReasons          []string `json:"skip_reasons"`
	SkippedCount         int      `json:"skipped_count"`
	Status               string   `json:"status"`
	ThreadID             string   `json:"thread_id,omitempty"`
}

type ExecutionFailure struct {
	Code         string `json:"code"`
	Operation    string `json:"operation"`
	Detail       string `json:"detail,omitempty"`
	HTTPStatus   int    `json:"http_status,omitempty"`
	InvocationID string `json:"invocation_id,omitempty"`
}

type AgentToolResult struct {
	ArgumentsJSON map[string]any    `json:"arguments_json"`
	StartedAt     *time.Time        `json:"started_at,omitempty"`
	CompletedAt   *time.Time        `json:"completed_at,omitempty"`
	DurationMS    float64           `json:"duration_ms"`
	Failure       *ExecutionFailure `json:"failure,omitempty"`
	InvocationID  string            `json:"invocation_id"`
	Result        map[string]any    `json:"result"`
	Status        string            `json:"status"`
	ToolName      string            `json:"tool_name"`
}

type AgentWebCitation struct {
	EndIndex   int    `json:"end_index"`
	StartIndex int    `json:"start_index"`
	Title      string `json:"title"`
	URL        string `json:"url"`
}

type WorkflowOperationActivityOutput struct {
	Operation               WorkflowOperation       `json:"operation"`
	SolveOutcome            string                  `json:"solve_outcome,omitempty"`
	WorkflowResultRef       string                  `json:"agent_result_ref"`
	ContextUsage            map[string]any          `json:"context_usage"`
	FinalOutput             string                  `json:"final_output"`
	StructuredOutput        map[string]any          `json:"structured_output,omitempty"`
	Plan                    *WorkflowTaskPlan       `json:"plan,omitempty"`
	Replan                  *WorkflowTaskReplan     `json:"replan,omitempty"`
	CompletedStep           *WorkflowCompletedStep  `json:"completed_step,omitempty"`
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
	WebCitations            []AgentWebCitation      `json:"web_citations"`
	WebSearchUsed           bool                    `json:"web_search_used"`
}

type AgentUsageSummary struct {
	ModelRequestCount int64 `json:"model_request_count"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	InputTokens       int64 `json:"input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	UsageObserved     bool  `json:"usage_observed"`
}

type WriteWorkflowFinalizationActivityInput struct {
	WorkflowResult    WorkflowOperationActivityOutput  `json:"workflow_result"`
	AdmissionSnapshot execution.AgentAdmissionSnapshot `json:"admission_snapshot"`
	// FinalizedAt is retained for Temporal history compatibility. New
	// finalization uses execution-control's durable timing reservation.
	FinalizedAt time.Time `json:"finalized_at"`
	RequestID   string    `json:"request_id"`
}

type WorkflowFinalizationActivityOutput struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RequestID     string    `json:"request_id"`
	Status        string    `json:"status"`
}

type FinalizeExecutionCancellationActivityOutput = execution.ExecutionCancellationFinalizationOutput

type FinalizeExecutionCancellationActivityInput = execution.ExecutionCancellationFinalizationInput

type ToolExecutionWorkflowCancelInput = execution.WorkflowCancelInput

type PersonalMemoryCommandWorkflowInput struct {
	Command    memoryruntime.PersonalMemoryCommandRequest `json:"command"`
	WorkflowID string                                     `json:"workflow_id"`
}

type PersonalMemoryCommandActivityOutput struct {
	CommandID         string `json:"command_id"`
	ErrorCode         string `json:"error_code,omitempty"`
	ResultFingerprint string `json:"result_fingerprint"`
	Status            string `json:"status"`
}

type FinalizePersonalMemoryCommandReceiptActivityInput struct {
	Command memoryruntime.PersonalMemoryCommandRequest `json:"command"`
	Result  PersonalMemoryCommandActivityOutput        `json:"result"`
}

type FinalizeExecutionFailureActivityInput struct {
	FailureKind string    `json:"failure_kind"`
	FailedAt    time.Time `json:"failed_at"`
	RequestID   string    `json:"request_id"`
	Stage       string    `json:"stage"`
}

type FinalizeExecutionFailureActivityOutput struct {
	CompletedAt time.Time `json:"completed_at"`
	RequestID   string    `json:"request_id"`
	Status      string    `json:"status"`
}

type PersonalMemoryCommandWorkflowResult = PersonalMemoryCommandActivityOutput
