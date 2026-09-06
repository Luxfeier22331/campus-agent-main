package execution

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
)

const (
	AgentCapabilitiesSchemaVersion       = "agent_capabilities.v1"
	AgentRuntimeBudgetSchemaVersion      = "agent_runtime_budget.v1"
	ToolContractFingerprintSchemaVersion = "tool_contract_fingerprint.v1"
)

var (
	lowercaseSHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	sha256RefPattern       = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
)

func AgentCapabilitiesForAdmission(
	personalMemoryRecallAvailable bool,
	hostedWebSearch bool,
) AgentCapabilitiesSnapshot {
	visibleFunctionToolNames := []string{string(contracts.ModelVisibleToolNameCampusSearch)}
	if personalMemoryRecallAvailable {
		visibleFunctionToolNames = append(visibleFunctionToolNames, string(contracts.ModelVisibleToolNamePersonalMemoryRecall))
	}
	return AgentCapabilitiesSnapshot{
		SchemaVersion:            AgentCapabilitiesSchemaVersion,
		HostedWebSearch:          hostedWebSearch,
		VisibleFunctionToolNames: visibleFunctionToolNames,
	}
}

func AgentCapabilitiesProjectionPayload(capabilities AgentCapabilitiesSnapshot) map[string]any {
	return map[string]any{
		"schema_version":              capabilities.SchemaVersion,
		"hosted_web_search":           capabilities.HostedWebSearch,
		"visible_function_tool_names": append([]string{}, capabilities.VisibleFunctionToolNames...),
	}
}

func AgentRuntimeBudgetProjectionPayload(budget AgentRuntimeBudgetSnapshot) map[string]any {
	return map[string]any{
		"max_function_tool_calls": budget.MaxFunctionToolCalls,
		"max_model_turns":         budget.MaxModelTurns,
		"max_plan_steps":          budget.MaxPlanSteps,
		"max_replans":             budget.MaxReplans,
		"schema_version":          budget.SchemaVersion,
	}
}

func HashAdmissionJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func ValidateAdmissionSnapshot(snapshot AgentAdmissionSnapshot) error {
	if snapshot.AgentLimitsSHA256 == "" || HashAdmissionJSON(snapshot.AgentLimits) != snapshot.AgentLimitsSHA256 {
		return errors.New("agent limits admission snapshot hash mismatch")
	}
	if snapshot.AgentCapabilitiesSHA256 == "" ||
		HashAdmissionJSON(snapshot.AgentCapabilities) != snapshot.AgentCapabilitiesSHA256 {
		return errors.New("agent capabilities admission snapshot hash mismatch")
	}
	if err := ValidateAgentCapabilities(snapshot.AgentCapabilities); err != nil {
		return err
	}
	if snapshot.AgentBudgetSHA256 == "" ||
		HashAdmissionJSON(snapshot.AgentBudget) != snapshot.AgentBudgetSHA256 {
		return errors.New("agent budget admission snapshot hash mismatch")
	}
	if err := ValidateAgentRuntimeBudget(snapshot.AgentBudget); err != nil {
		return err
	}
	if !lowercaseSHA256Pattern.MatchString(strings.TrimSpace(snapshot.ModelTargetSHA256)) {
		return errors.New("workflow model target admission snapshot is invalid")
	}
	if err := ValidateToolContractFingerprintSnapshot(snapshot.ToolContractFingerprint); err != nil {
		return err
	}
	if snapshot.ToolContractFingerprintSHA256 == "" ||
		HashAdmissionJSON(snapshot.ToolContractFingerprint) != snapshot.ToolContractFingerprintSHA256 {
		return errors.New("tool contract admission snapshot hash mismatch")
	}
	for name, value := range map[string]int{
		"agent_deadline_ms":        snapshot.AgentLimits.AgentDeadlineMS,
		"context_char_limit":       snapshot.AgentLimits.ContextCharLimit,
		"current_input_char_limit": snapshot.AgentLimits.CurrentInputCharLimit,
		"max_output_tokens":        snapshot.AgentLimits.MaxOutputTokens,
	} {
		if value <= 0 {
			return fmt.Errorf("%s admission snapshot must be positive", name)
		}
	}
	return nil
}

func ValidateAgentCapabilities(capabilities AgentCapabilitiesSnapshot) error {
	if capabilities.SchemaVersion != AgentCapabilitiesSchemaVersion {
		return errors.New("agent capabilities identity is invalid")
	}
	seen := map[string]struct{}{}
	for _, name := range capabilities.VisibleFunctionToolNames {
		if strings.TrimSpace(name) != name || name == "" {
			return errors.New("agent capabilities visible tools are not canonical")
		}
		if _, exists := seen[name]; exists {
			return errors.New("agent capabilities contains duplicate visible tools")
		}
		seen[name] = struct{}{}
		if !supportedModelVisibleToolName(name) {
			return fmt.Errorf("agent capability tool %s is not registered as model visible", name)
		}
	}
	return nil
}

func ValidateAgentRuntimeBudget(budget AgentRuntimeBudgetSnapshot) error {
	if budget.SchemaVersion != AgentRuntimeBudgetSchemaVersion ||
		budget.MaxFunctionToolCalls < 0 || budget.MaxModelTurns < 1 ||
		budget.MaxPlanSteps < 1 || budget.MaxReplans < 0 {
		return errors.New("agent runtime budget is invalid")
	}
	return nil
}

func supportedModelVisibleToolName(name string) bool {
	switch contracts.ModelVisibleToolName(name) {
	case contracts.ModelVisibleToolNameCampusSearch,
		contracts.ModelVisibleToolNamePersonalMemoryRecall:
		return true
	default:
		return false
	}
}

func ValidateAdmissionSnapshotForVisibleTools(
	snapshot AgentAdmissionSnapshot,
	visibleFunctionToolNames []string,
) error {
	if err := ValidateAdmissionSnapshot(snapshot); err != nil {
		return err
	}
	frozen := stringSet(snapshot.AgentCapabilities.VisibleFunctionToolNames)
	visible := stringSet(visibleFunctionToolNames)
	if len(visible) != len(visibleFunctionToolNames) || len(frozen) != len(visible) {
		return errors.New("visible tools differ from the frozen agent capabilities")
	}
	for _, name := range visibleFunctionToolNames {
		if strings.TrimSpace(name) != name || name == "" {
			return errors.New("visible tools differ from the frozen agent capabilities")
		}
		if _, ok := frozen[name]; !ok {
			return errors.New("visible tools differ from the frozen agent capabilities")
		}
	}
	return nil
}

func ValidateToolContractFingerprintSnapshot(snapshot ToolContractFingerprintSnapshot) error {
	if snapshot.SchemaVersion != ToolContractFingerprintSchemaVersion {
		return errors.New("tool contract admission snapshot identity is invalid")
	}
	for _, value := range []string{snapshot.ToolsSHA256, snapshot.FunctionSchemaSHA256} {
		if !sha256RefPattern.MatchString(value) {
			return errors.New("tool contract admission snapshot hash is invalid")
		}
	}
	return nil
}

func ToolContractFingerprintSnapshotMap(snapshot ToolContractFingerprintSnapshot) map[string]any {
	if strings.TrimSpace(snapshot.SchemaVersion) == "" {
		return nil
	}
	return map[string]any{
		"function_schema_sha256": snapshot.FunctionSchemaSHA256,
		"schema_version":         snapshot.SchemaVersion,
		"tools_sha256":           snapshot.ToolsSHA256,
	}
}

func ValidateAgentRuntimeToolContract(expected ToolContractFingerprintSnapshot, actual map[string]any) error {
	if err := ValidateToolContractFingerprintSnapshot(expected); err != nil {
		return err
	}
	expectedPayload := ToolContractFingerprintSnapshotMap(expected)
	if len(actual) == 0 || HashAdmissionJSON(expectedPayload) != HashAdmissionJSON(actual) {
		return errors.New("agent runtime tool contract does not match admission")
	}
	return nil
}

func stringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}
