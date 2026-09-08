package execution

import "context"

// AgentAdmissionSnapshot contains only bounded, non-secret execution policy
// inputs. Provider credentials and model responses are deliberately excluded.
type AgentAdmissionSnapshot struct {
	AgentLimits       AgentRuntimeLimitsSnapshot `json:"agent_limits"`
	AgentCapabilities AgentCapabilitiesSnapshot  `json:"agent_capabilities"`
	AgentBudget       AgentRuntimeBudgetSnapshot `json:"agent_budget"`
	// ModelTargetSHA256 is the opaque Model Config target hash frozen
	// for this run. The JSON name stays stable for persisted Temporal history.
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

type ModelTarget struct {
	TargetSHA256    string
	HostedWebSearch bool
}

type ModelTargetResolver interface {
	ResolveModelTarget(context.Context) (ModelTarget, error)
}

type AdmissionSnapshotBuilder interface {
	BuildAgentAdmissionSnapshot(context.Context, bool) (AgentAdmissionSnapshot, error)
}

type AdmissionService interface {
	AdmissionSnapshotBuilder
	ValidateLocalToolContractFingerprintMap(map[string]any) error
}
