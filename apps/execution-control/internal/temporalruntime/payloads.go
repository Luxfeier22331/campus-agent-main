package temporalruntime

type AgentAdmissionSnapshot struct {
	AgentLimits       AgentRuntimeLimitsSnapshot `json:"agent_limits"`
	AgentCapabilities AgentCapabilitiesSnapshot  `json:"agent_capabilities"`
	AgentBudget       AgentRuntimeBudgetSnapshot `json:"agent_budget"`
	// ModelTargetSHA256 is the frozen model target hash.
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

// ToolContractFingerprintSnapshot binds an admitted run to the exact tool
// registry and function schemas expected from agent-runtime. It contains no
// credentials or model data.
type ToolContractFingerprintSnapshot struct {
	FunctionSchemaSHA256 string `json:"function_schema_sha256"`
	SchemaVersion        string `json:"schema_version"`
	ToolsSHA256          string `json:"tools_sha256"`
}

type AgentRuntimeLimitsSnapshot struct {
	AgentDeadlineMS       int `json:"agent_deadline_ms"`
	ContextCharLimit      int `json:"context_char_limit"`
	CurrentInputCharLimit int `json:"current_input_char_limit"`
	MaxOutputTokens       int `json:"max_output_tokens"`
}

type PersonalMemoryCommandItem struct {
	Text string `json:"text,omitempty"`
}

type PersonalMemoryCommandRequest struct {
	CommandID         string                     `json:"command_id"`
	CommandKind       string                     `json:"command_kind"`
	Item              *PersonalMemoryCommandItem `json:"item,omitempty"`
	LifecycleState    string                     `json:"lifecycle_state"`
	OwnerGeneration   int64                      `json:"owner_generation"`
	OwnerSequence     int64                      `json:"owner_sequence"`
	SchemaVersion     string                     `json:"schema_version"`
	SubjectID         string                     `json:"subject_id,omitempty"`
	SourceUpdatedAt   string                     `json:"source_updated_at"`
	SubjectScopeHash  string                     `json:"-"`
	SupersessionScope string                     `json:"supersession_scope"`
	TenantID          string                     `json:"tenant_id"`
	UserID            string                     `json:"user_id"`
}

type FinalizeMemoryAppendActivityInput struct {
	RequestID   string `json:"request_id"`
	FailureKind string `json:"failure_kind"`
}
