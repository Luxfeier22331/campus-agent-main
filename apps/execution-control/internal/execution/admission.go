package execution

import "context"

// AgentAdmissionSnapshot contains only bounded, non-secret execution policy
// inputs. Provider credentials and model responses are deliberately excluded.
type AgentAdmissionSnapshot struct {
	AgentLimits             AgentRuntimeLimitsSnapshot `json:"agent_limits"`
	AgentLimitsSHA256       string                     `json:"agent_limits_sha256"`
	ExecutionStrategy       ExecutionStrategySnapshot  `json:"execution_strategy"`
	ExecutionStrategySHA256 string                     `json:"execution_strategy_sha256"`
	// PrimaryAgentTargetSHA256 is the opaque Model Config target hash frozen
	// for this run. The JSON name stays stable for persisted Temporal history.
	PrimaryAgentTargetSHA256      string                          `json:"provider_config_sha256"`
	ToolContractFingerprint       ToolContractFingerprintSnapshot `json:"tool_contract_fingerprint"`
	ToolContractFingerprintSHA256 string                          `json:"tool_contract_fingerprint_sha256"`
}

type ExecutionStrategySnapshot struct {
	Kind                     string   `json:"kind"`
	MaxModelTurns            int      `json:"max_model_turns"`
	MaxFunctionToolCalls     int      `json:"max_function_tool_calls"`
	SchemaVersion            string   `json:"schema_version"`
	VisibleFunctionToolNames []string `json:"visible_function_tool_names"`
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

type PrimaryAgentTarget struct {
	TargetSHA256 string
}

type PrimaryAgentTargetResolver interface {
	ResolvePrimaryAgentTarget(context.Context) (PrimaryAgentTarget, error)
}

type AdmissionSnapshotBuilder interface {
	BuildAgentAdmissionSnapshot(context.Context, bool) (AgentAdmissionSnapshot, error)
}

type WorkflowAdmissionValidator interface {
	ValidateWorkflowAdmission(AgentAdmissionSnapshot, []string) error
}

type AdmissionService interface {
	AdmissionSnapshotBuilder
	WorkflowAdmissionValidator
	ValidateLocalToolContractFingerprint(ToolContractFingerprintSnapshot) error
	ValidateLocalToolContractFingerprintMap(map[string]any) error
}
