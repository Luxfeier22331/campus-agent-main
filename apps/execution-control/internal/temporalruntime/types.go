package temporalruntime

import (
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type ToolExecutionWorkflowInput struct {
	AdmissionSnapshot            AgentAdmissionSnapshot `json:"admission_snapshot"`
	AdmissionSnapshotSHA256      string                 `json:"admission_snapshot_sha256"`
	ConversationID               string                 `json:"conversation_id"`
	Namespace                    string                 `json:"namespace"`
	PayloadSHA256                string                 `json:"payload_sha256"`
	PolicyVersions               map[string]string      `json:"policy_versions"`
	PersonalMemoryTimeoutSeconds float64                `json:"personal_memory_timeout_seconds"`
	RequestID                    string                 `json:"request_id"`
	RunID                        string                 `json:"run_id"`
	TaskQueue                    string                 `json:"task_queue"`
	TraceID                      string                 `json:"trace_id"`
	TraceParent                  string                 `json:"traceparent,omitempty"`
	TurnID                       string                 `json:"turn_id"`
	WorkflowID                   string                 `json:"workflow_id"`
}

// AgentAdmissionSnapshot contains only bounded, non-secret execution policy
// inputs. Provider credentials and model responses are deliberately excluded.
type AgentAdmissionSnapshot struct {
	AgentLimits                   AgentRuntimeLimitsSnapshot `json:"agent_limits"`
	AgentLimitsSHA256             string                     `json:"agent_limits_sha256"`
	EmbeddingProviderConfigSHA256 string                     `json:"embedding_provider_config_sha256"`
	DocumentScopes                []DocumentScope            `json:"document_scopes"`
	DocumentScopesSHA256          string                     `json:"document_scopes_sha256"`
	ExecutionStrategy             ExecutionStrategySnapshot  `json:"execution_strategy"`
	ExecutionStrategySHA256       string                     `json:"execution_strategy_sha256"`
	GroundingPlan                 GroundingPlanSnapshot      `json:"grounding_plan"`
	GroundingPlanSHA256           string                     `json:"grounding_plan_sha256"`
	// ProviderConfigSHA256 fingerprints the active LLM setting used by the
	// Primary Agent. It excludes credentials and storage identifiers.
	ProviderConfigSHA256         string                         `json:"provider_config_sha256"`
	ToolRuntimeFingerprint       ToolRuntimeFingerprintSnapshot `json:"tool_runtime_fingerprint"`
	ToolRuntimeFingerprintSHA256 string                         `json:"tool_runtime_fingerprint_sha256"`
}

type GroundingPlanSnapshot struct {
	Mode           string   `json:"mode"`
	QuerySHA256    string   `json:"query_sha256"`
	SchemaVersion  string   `json:"schema_version"`
	SelectedScopes []string `json:"selected_scopes"`
}

// GroundingContext is the bounded retrieval result consumed by the Primary
// Agent and terminal finalization. It is carried through the workflow history
// rather than persisted in a separate runtime-owned payload store.
type GroundingContext struct {
	AdmissionSHA256   string              `json:"admission_sha256"`
	CoveredScopes     []string            `json:"covered_scopes"`
	Evidence          []GroundingEvidence `json:"evidence"`
	Mode              string              `json:"mode"`
	ModelContextChars int                 `json:"model_context_chars"`
	PlanSHA256        string              `json:"plan_sha256"`
	PreparedAt        time.Time           `json:"prepared_at"`
	QuerySHA256       string              `json:"query_sha256"`
	RunID             string              `json:"run_id"`
	SchemaVersion     string              `json:"schema_version"`
	SelectedScopes    []string            `json:"selected_scopes"`
	Status            string              `json:"status"`
	TokenCount        int                 `json:"token_count"`
}

type GroundingEvidence struct {
	EvidenceRef   string  `json:"evidence_ref"`
	DocumentScope string  `json:"document_scope"`
	ReleaseID     string  `json:"release_id"`
	ChunkID       string  `json:"chunk_id"`
	SectionRef    string  `json:"section_ref"`
	DocumentID    string  `json:"document_id"`
	SectionID     string  `json:"section_id"`
	DocumentTitle string  `json:"document_title"`
	SectionTitle  string  `json:"section_title"`
	CanonicalURL  string  `json:"canonical_url"`
	Text          string  `json:"text"`
	TextSHA256    string  `json:"text_sha256"`
	TokenCount    int     `json:"token_count"`
	RerankScore   float64 `json:"rerank_score"`
}

type ExecutionStrategySnapshot struct {
	AllowUngroundedAnswer bool     `json:"allow_ungrounded_answer"`
	Kind                  string   `json:"kind"`
	MaxModelTurns         int      `json:"max_model_turns"`
	MaxToolCalls          int      `json:"max_tool_calls"`
	MemoryRecall          string   `json:"memory_recall"`
	SchemaVersion         string   `json:"schema_version"`
	VisibleToolNames      []string `json:"visible_tool_names"`
}

// ToolRuntimeFingerprintSnapshot binds an admitted run to the exact tool
// registry and function schemas expected from agent-runtime. It contains no
// credentials or model data.
type ToolRuntimeFingerprintSnapshot struct {
	CombinedSHA256        string `json:"combined_sha256"`
	FunctionSchemaSHA256  string `json:"function_schema_sha256"`
	FunctionSchemaVersion string `json:"function_schema_version"`
	SchemaVersion         string `json:"schema_version"`
	ToolsRegistryVersion  string `json:"tools_registry_version"`
	ToolsSchemaVersion    string `json:"tools_schema_version"`
	ToolsSHA256           string `json:"tools_sha256"`
	RuntimeRelease        string `json:"runtime_release"`
}

type AgentRuntimeLimitsSnapshot struct {
	AgentDeadlineMS       int `json:"agent_deadline_ms"`
	ContextCharLimit      int `json:"context_char_limit"`
	CurrentInputCharLimit int `json:"current_input_char_limit"`
	MaxOutputTokens       int `json:"max_output_tokens"`
}

type ToolExecutionWorkflowResult struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RunID         string    `json:"run_id"`
	Status        string    `json:"status"`
}

type AppendConversationMemoryActivityInput struct {
	RequestID string `json:"request_id"`
	RunID     string `json:"run_id"`
	TraceID   string `json:"trace_id"`
}

type AppendConversationMemoryActivityOutput struct {
	AppendedMessageCount int      `json:"appended_message_count"`
	PayloadSHA256        string   `json:"payload_sha256"`
	RunID                string   `json:"run_id"`
	SchemaVersion        string   `json:"schema_version"`
	SkipReasons          []string `json:"skip_reasons"`
	SkippedCount         int      `json:"skipped_count"`
	Status               string   `json:"status"`
	ThreadID             string   `json:"thread_id,omitempty"`
}

type ExecutePrimaryAgentActivityInput struct {
	AdmissionSnapshot AgentAdmissionSnapshot `json:"admission_snapshot"`
	ConversationID    string                 `json:"conversation_id"`
	GroundingContext  GroundingContext       `json:"grounding_context"`
	RequestID         string                 `json:"request_id"`
	RunID             string                 `json:"run_id"`
	TraceID           string                 `json:"trace_id"`
	TurnID            string                 `json:"turn_id"`
	VisibleToolNames  []string               `json:"visible_tool_names"`
}

type PrepareGroundingContextActivityInput struct {
	AdmissionSnapshot       AgentAdmissionSnapshot `json:"admission_snapshot"`
	AdmissionSnapshotSHA256 string                 `json:"admission_snapshot_sha256"`
	RunID                   string                 `json:"run_id"`
	TraceID                 string                 `json:"trace_id"`
}

type PrepareGroundingContextActivityOutput struct {
	CoveredScopes       []string         `json:"covered_scopes"`
	EvidenceCount       int              `json:"evidence_count"`
	GroundingContext    GroundingContext `json:"grounding_context"`
	GroundingContextRef string           `json:"grounding_context_ref"`
	Mode                string           `json:"mode"`
	ModelContextChars   int              `json:"model_context_chars"`
	PayloadSHA256       string           `json:"payload_sha256"`
	RunID               string           `json:"run_id"`
	SelectedScopes      []string         `json:"selected_scopes"`
	Status              string           `json:"status"`
	TokenCount          int              `json:"token_count"`
}

type DocumentScope struct {
	Collection          string                         `json:"collection"`
	Corpus              string                         `json:"corpus"`
	CandidateTopK       int                            `json:"candidate_top_k"`
	Description         string                         `json:"description"`
	MaxEvidenceSections int                            `json:"max_evidence_sections"`
	QdrantCollection    string                         `json:"qdrant_collection"`
	ReleaseID           string                         `json:"release_id"`
	ServingConfig       KnowledgeServingConfigSnapshot `json:"serving_config"`
	ServingConfigPath   string                         `json:"serving_config_path"`
	ServingConfigSHA256 string                         `json:"serving_config_sha256"`
	Scope               string                         `json:"scope"`
}

type KnowledgeServingConfigSnapshot struct {
	Collection                string   `json:"collection"`
	Corpus                    string   `json:"corpus"`
	DensePrefetchLimit        int      `json:"dense_prefetch_limit"`
	DenseVectorName           string   `json:"dense_vector_name"`
	EmbeddingQueryInstruction string   `json:"embedding_query_instruction"`
	EmbeddingDimensions       int      `json:"embedding_dimensions"`
	EmbeddingModel            string   `json:"embedding_model"`
	EmbeddingProvider         string   `json:"embedding_provider"`
	EmbeddingVectorName       string   `json:"embedding_vector_name"`
	RetrievalEnabled          bool     `json:"retrieval_enabled"`
	ServingRevisionTracks     []string `json:"serving_revision_tracks"`
	ServingStage              string   `json:"serving_stage"`
	ServingVisibilityLevels   []string `json:"serving_visibility_levels"`
	ServingVisibilityScopes   []string `json:"serving_visibility_scopes"`
	SparsePrefetchLimit       int      `json:"sparse_prefetch_limit"`
	SparseVectorName          string   `json:"sparse_vector_name"`
}

type AgentToolResult struct {
	ArgumentsJSON   map[string]any `json:"arguments_json"`
	DurationMS      float64        `json:"duration_ms"`
	FailCloseReason string         `json:"fail_close_reason"`
	PayloadKind     string         `json:"payload_kind"`
	Result          map[string]any `json:"result"`
	ResultRef       string         `json:"result_ref"`
	Status          string         `json:"status"`
	ToolName        string         `json:"tool_name"`
}

type ExecutePrimaryAgentActivityOutput struct {
	AgentResultRef         string            `json:"agent_result_ref"`
	FinalOutput            string            `json:"final_output"`
	GroundingContext       GroundingContext  `json:"grounding_context"`
	ModelName              string            `json:"model_name"`
	ModelProvider          string            `json:"model_provider"`
	PromptTrace            map[string]any    `json:"prompt_trace"`
	ProviderResponseID     string            `json:"provider_response_id"`
	RunID                  string            `json:"run_id"`
	StageTiming            map[string]any    `json:"stage_timing,omitempty"`
	Status                 string            `json:"status"`
	TerminalEnvelope       map[string]any    `json:"terminal_envelope"`
	TerminalReason         string            `json:"terminal_reason"`
	ToolResults            []AgentToolResult `json:"tool_results"`
	ToolRuntimeFingerprint map[string]any    `json:"tool_runtime_fingerprint"`
	Usage                  AgentUsageSummary `json:"usage"`
}

type AgentUsageSummary struct {
	ModelRequestCount int64 `json:"model_request_count"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	InputTokens       int64 `json:"input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	UsageObserved     bool  `json:"usage_observed"`
}

type WriteFinalizationActivityInput struct {
	AgentResult       ExecutePrimaryAgentActivityOutput `json:"agent_result"`
	AdmissionSnapshot AgentAdmissionSnapshot            `json:"admission_snapshot"`
	FinalizedAt       time.Time                         `json:"finalized_at"`
	RunID             string                            `json:"run_id"`
	TraceID           string                            `json:"trace_id"`
}

type WriteFinalizationActivityOutput struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RunID         string    `json:"run_id"`
	Status        string    `json:"status"`
}

type FinalizeExecutionCancellationActivityOutput struct {
	RunID  string `json:"run_id"`
	Status string `json:"status"`
}

type FinalizeExecutionCancellationActivityInput struct {
	CanceledAt time.Time `json:"canceled_at"`
	Reason     string    `json:"reason"`
	RunID      string    `json:"run_id"`
	TraceID    string    `json:"trace_id"`
}

type ToolExecutionWorkflowCancelInput struct {
	Reason        string `json:"reason"`
	RunID         string `json:"run_id"`
	TemporalRunID string `json:"temporal_run_id"`
	WorkflowID    string `json:"workflow_id"`
}

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

type PersonalMemoryTraceMaintenanceActivityInput struct {
	Command memoryruntime.PersonalMemoryCommandRequest `json:"command"`
}

type PersonalMemoryTraceMaintenanceActivityOutput struct {
	DeletedTraceCount   int `json:"deleted_trace_count,omitempty"`
	RemainingTraceCount int `json:"remaining_trace_count"`
}

type FinalizeExecutionFailureActivityInput struct {
	FailureHash string    `json:"failure_hash"`
	FailureKind string    `json:"failure_kind"`
	FailedAt    time.Time `json:"failed_at"`
	RunID       string    `json:"run_id"`
	Stage       string    `json:"stage"`
	TraceID     string    `json:"trace_id"`
}

type FinalizeExecutionFailureActivityOutput struct {
	CompletedAt time.Time `json:"completed_at"`
	RunID       string    `json:"run_id"`
	Status      string    `json:"status"`
}

type PersonalMemoryCommandWorkflowResult = PersonalMemoryCommandActivityOutput
