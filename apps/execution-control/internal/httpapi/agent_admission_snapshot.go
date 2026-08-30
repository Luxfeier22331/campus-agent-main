package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const executionStrategySchemaVersion = "execution_strategy.v3"

var lowercaseSHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var sha256RefPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

func (s *Server) buildAgentAdmissionSnapshot(
	ctx context.Context,
	personalMemoryRecallAvailable bool,
) (temporalruntime.AgentAdmissionSnapshot, error) {
	strategy := executionStrategyForAdmission(personalMemoryRecallAvailable)
	visibleToolNames := strategy.VisibleToolNames
	limits := s.primaryAgentRuntimeLimits()
	limitSnapshot := temporalruntime.AgentRuntimeLimitsSnapshot{
		AgentDeadlineMS:       limits.AgentDeadlineMS,
		ContextCharLimit:      limits.ContextCharLimit,
		CurrentInputCharLimit: limits.CurrentInputCharLimit,
		MaxOutputTokens:       limits.MaxOutputTokens,
	}
	toolContract, err := buildToolContractFingerprint()
	if err != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, executionDependencyNotReady(
			fmt.Errorf("build tool contract admission snapshot: %w", err),
		)
	}
	toolContractSnapshot := toolContract.toAdmissionSnapshot()
	snapshot := temporalruntime.AgentAdmissionSnapshot{
		AgentLimits:                   limitSnapshot,
		AgentLimitsSHA256:             hashAdmissionJSON(limitSnapshot),
		ExecutionStrategy:             strategy,
		ExecutionStrategySHA256:       hashAdmissionJSON(strategy),
		ToolContractFingerprint:       toolContractSnapshot,
		ToolContractFingerprintSHA256: hashAdmissionJSON(toolContractSnapshot),
	}
	target, targetErr := s.resolvePrimaryAgentTarget(ctx)
	if targetErr != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, executionDependencyNotReady(
			fmt.Errorf("resolve primary agent model target: %w", targetErr),
		)
	}
	snapshot.PrimaryAgentTargetSHA256 = target.TargetSHA256
	if err := validateAdmissionSnapshotForVisibleTools(snapshot, visibleToolNames); err != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, err
	}
	return snapshot, nil
}

func executionStrategyForAdmission(personalMemoryRecallAvailable bool) temporalruntime.ExecutionStrategySnapshot {
	visibleToolNames := []string{campusSearchToolName}
	maxModelTurns := 3
	maxToolCalls := 2
	if personalMemoryRecallAvailable {
		visibleToolNames = append(visibleToolNames, personalMemoryRecallToolName)
		maxModelTurns = 4
		maxToolCalls = 3
	}
	strategy := temporalruntime.ExecutionStrategySnapshot{
		Kind:             "direct",
		MaxModelTurns:    maxModelTurns,
		MaxToolCalls:     maxToolCalls,
		SchemaVersion:    executionStrategySchemaVersion,
		VisibleToolNames: visibleToolNames,
	}
	return strategy
}

func executionStrategyProjectionPayload(strategy temporalruntime.ExecutionStrategySnapshot) map[string]any {
	return map[string]any{
		"kind":               strategy.Kind,
		"max_model_turns":    strategy.MaxModelTurns,
		"max_tool_calls":     strategy.MaxToolCalls,
		"schema_version":     strategy.SchemaVersion,
		"visible_tool_names": append([]string{}, strategy.VisibleToolNames...),
	}
}

func hashAdmissionJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func limitsFromAdmissionSnapshot(snapshot temporalruntime.AgentRuntimeLimitsSnapshot) primaryAgentRuntimeLimits {
	return primaryAgentRuntimeLimits{
		AgentDeadlineMS:       snapshot.AgentDeadlineMS,
		ContextCharLimit:      snapshot.ContextCharLimit,
		CurrentInputCharLimit: snapshot.CurrentInputCharLimit,
		MaxOutputTokens:       snapshot.MaxOutputTokens,
	}
}

func validateAdmissionSnapshot(snapshot temporalruntime.AgentAdmissionSnapshot) error {
	if snapshot.AgentLimitsSHA256 == "" || hashAdmissionJSON(snapshot.AgentLimits) != snapshot.AgentLimitsSHA256 {
		return errors.New("agent limits admission snapshot hash mismatch")
	}
	if snapshot.ExecutionStrategySHA256 == "" ||
		hashAdmissionJSON(snapshot.ExecutionStrategy) != snapshot.ExecutionStrategySHA256 {
		return errors.New("execution strategy admission snapshot hash mismatch")
	}
	if err := validateExecutionStrategy(snapshot.ExecutionStrategy); err != nil {
		return err
	}
	if !validModelTargetHash(snapshot.PrimaryAgentTargetSHA256) {
		return errors.New("primary agent model target admission snapshot is invalid")
	}
	if err := validateToolContractFingerprintSnapshot(snapshot.ToolContractFingerprint); err != nil {
		return err
	}
	if snapshot.ToolContractFingerprintSHA256 == "" ||
		hashAdmissionJSON(snapshot.ToolContractFingerprint) != snapshot.ToolContractFingerprintSHA256 {
		return errors.New("tool contract admission snapshot hash mismatch")
	}
	limits := limitsFromAdmissionSnapshot(snapshot.AgentLimits)
	for name, value := range map[string]int{
		"agent_deadline_ms":        limits.AgentDeadlineMS,
		"context_char_limit":       limits.ContextCharLimit,
		"current_input_char_limit": limits.CurrentInputCharLimit,
		"max_output_tokens":        limits.MaxOutputTokens,
	} {
		if value <= 0 {
			return fmt.Errorf("%s admission snapshot must be positive", name)
		}
	}
	return nil
}

func validateExecutionStrategy(strategy temporalruntime.ExecutionStrategySnapshot) error {
	if strategy.SchemaVersion != executionStrategySchemaVersion || strategy.Kind != "direct" {
		return errors.New("execution strategy identity is invalid")
	}
	if strategy.MaxToolCalls < 0 || strategy.MaxModelTurns < 1 {
		return errors.New("execution strategy tool budget is invalid")
	}
	seen := map[string]struct{}{}
	for _, name := range strategy.VisibleToolNames {
		if strings.TrimSpace(name) != name || name == "" {
			return errors.New("execution strategy visible tools are not canonical")
		}
		if _, exists := seen[name]; exists {
			return errors.New("execution strategy contains duplicate visible tools")
		}
		seen[name] = struct{}{}
		if _, ok := runtimepolicy.ModelVisibleToolByName(name); !ok {
			return fmt.Errorf("execution strategy tool %s is not registered as model visible", name)
		}
	}
	return nil
}

func validateAdmissionSnapshotForVisibleTools(
	snapshot temporalruntime.AgentAdmissionSnapshot,
	visibleToolNames []string,
) error {
	if err := validateAdmissionSnapshot(snapshot); err != nil {
		return err
	}
	frozen := stringSet(snapshot.ExecutionStrategy.VisibleToolNames)
	visible := stringSet(visibleToolNames)
	if len(visible) != len(visibleToolNames) || len(frozen) != len(visible) {
		return errors.New("visible tools differ from the frozen execution strategy")
	}
	for _, name := range visibleToolNames {
		if strings.TrimSpace(name) != name || name == "" {
			return errors.New("visible tools differ from the frozen execution strategy")
		}
		if _, ok := frozen[name]; !ok {
			return errors.New("visible tools differ from the frozen execution strategy")
		}
	}
	return nil
}

func validModelTargetHash(targetSHA256 string) bool {
	return lowercaseSHA256Pattern.MatchString(strings.TrimSpace(targetSHA256))
}

func validateToolContractFingerprintSnapshot(snapshot temporalruntime.ToolContractFingerprintSnapshot) error {
	if snapshot.SchemaVersion != toolContractFingerprintSchemaVersion {
		return errors.New("tool contract admission snapshot identity is invalid")
	}
	for _, value := range []string{
		snapshot.ToolsSHA256,
		snapshot.FunctionSchemaSHA256,
	} {
		if !sha256RefPattern.MatchString(value) {
			return errors.New("tool contract admission snapshot hash is invalid")
		}
	}
	return nil
}

func toolContractFingerprintSnapshotMap(snapshot temporalruntime.ToolContractFingerprintSnapshot) map[string]any {
	if strings.TrimSpace(snapshot.SchemaVersion) == "" {
		return nil
	}
	return map[string]any{
		"function_schema_sha256": snapshot.FunctionSchemaSHA256,
		"schema_version":         snapshot.SchemaVersion,
		"tools_sha256":           snapshot.ToolsSHA256,
	}
}

func validateAgentRuntimeToolContract(
	expected temporalruntime.ToolContractFingerprintSnapshot,
	actual map[string]any,
) error {
	if err := validateToolContractFingerprintSnapshot(expected); err != nil {
		return err
	}
	expectedPayload := toolContractFingerprintSnapshotMap(expected)
	if len(actual) == 0 || hashAdmissionJSON(expectedPayload) != hashAdmissionJSON(actual) {
		return errors.New("agent runtime tool contract does not match admission")
	}
	return nil
}

func (s *Server) validateLocalToolContractFingerprint(
	expected temporalruntime.ToolContractFingerprintSnapshot,
) error {
	local, err := buildToolContractFingerprint()
	if err != nil {
		return fmt.Errorf("build local tool contract fingerprint: %w", err)
	}
	if err := validateAgentRuntimeToolContract(expected, local.toMap()); err != nil {
		return fmt.Errorf("local execution-control tool contract fingerprint: %w", err)
	}
	return nil
}

func (s *Server) validateLocalToolContractFingerprintMap(expected map[string]any) error {
	if len(expected) == 0 {
		return errors.New("admitted tool contract fingerprint is unavailable")
	}
	local, err := buildToolContractFingerprint()
	if err != nil {
		return fmt.Errorf("build local tool contract fingerprint: %w", err)
	}
	if hashAdmissionJSON(expected) != hashAdmissionJSON(local.toMap()) {
		return errors.New("local execution-control tool contract fingerprint does not match admission")
	}
	return nil
}
