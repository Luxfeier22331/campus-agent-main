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

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const executionStrategySchemaVersion = "execution_strategy.v2"

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
	toolRuntime, err := buildToolRuntimeFingerprint(s.config.DeploymentRelease)
	if err != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, executionDependencyNotReady(
			fmt.Errorf("build tool runtime admission snapshot: %w", err),
		)
	}
	toolRuntimeSnapshot := toolRuntime.toAdmissionSnapshot()
	snapshot := temporalruntime.AgentAdmissionSnapshot{
		AgentLimits:                  limitSnapshot,
		AgentLimitsSHA256:            hashAdmissionJSON(limitSnapshot),
		ExecutionStrategy:            strategy,
		ExecutionStrategySHA256:      hashAdmissionJSON(strategy),
		ToolRuntimeFingerprint:       toolRuntimeSnapshot,
		ToolRuntimeFingerprintSHA256: hashAdmissionJSON(toolRuntimeSnapshot),
	}
	provider, providerErr := s.resolveProviderConfig(ctx, providerconfig.KindLLM)
	if providerErr != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, executionDependencyNotReady(
			fmt.Errorf("resolve active llm setting: %w", providerErr),
		)
	}
	snapshot.ProviderConfigSHA256 = providerconfig.AdmissionHash(provider)
	if err := validateAdmissionSnapshotForVisibleTools(snapshot, visibleToolNames); err != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, err
	}
	return snapshot, nil
}

func executionStrategyForAdmission(personalMemoryRecallAvailable bool) temporalruntime.ExecutionStrategySnapshot {
	strategy := temporalruntime.ExecutionStrategySnapshot{
		Kind:             "direct",
		MaxModelTurns:    1,
		MaxToolCalls:     0,
		MemoryRecall:     "disabled",
		SchemaVersion:    executionStrategySchemaVersion,
		VisibleToolNames: []string{},
	}
	if personalMemoryRecallAvailable {
		strategy.MaxModelTurns = 2
		strategy.MaxToolCalls = 1
		strategy.MemoryRecall = "model_optional"
		strategy.VisibleToolNames = []string{personalMemoryRecallToolName}
	}
	return strategy
}

func executionStrategyProjectionPayload(strategy temporalruntime.ExecutionStrategySnapshot) map[string]any {
	return map[string]any{
		"kind":               strategy.Kind,
		"max_model_turns":    strategy.MaxModelTurns,
		"max_tool_calls":     strategy.MaxToolCalls,
		"memory_recall":      strategy.MemoryRecall,
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
	if !validProviderConfigHash(snapshot.ProviderConfigSHA256) {
		return errors.New("provider admission snapshot is invalid")
	}
	if err := validateToolRuntimeFingerprintSnapshot(snapshot.ToolRuntimeFingerprint); err != nil {
		return err
	}
	if snapshot.ToolRuntimeFingerprintSHA256 == "" ||
		hashAdmissionJSON(snapshot.ToolRuntimeFingerprint) != snapshot.ToolRuntimeFingerprintSHA256 {
		return errors.New("tool runtime admission snapshot hash mismatch")
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
	visible := canonicalStringSlice(strategy.VisibleToolNames)
	if !equalStringSlices(visible, strategy.VisibleToolNames) {
		return errors.New("execution strategy visible tools are not canonical")
	}
	switch strategy.MemoryRecall {
	case "disabled":
		if strategy.MaxModelTurns != 1 || strategy.MaxToolCalls != 0 || len(visible) != 0 {
			return errors.New("disabled memory execution strategy budget is invalid")
		}
	case "model_optional":
		if strategy.MaxModelTurns != 2 || strategy.MaxToolCalls != 1 ||
			len(visible) != 1 || visible[0] != "personal_memory_recall" {
			return errors.New("optional memory execution strategy budget is invalid")
		}
		if _, ok := runtimepolicy.ModelVisibleToolByName("personal_memory_recall"); !ok {
			return errors.New("personal memory recall tool is not registered as model visible")
		}
	default:
		return errors.New("execution strategy memory_recall is invalid")
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
	if !equalStringSlices(
		canonicalStringSlice(snapshot.ExecutionStrategy.VisibleToolNames),
		canonicalStringSlice(visibleToolNames),
	) {
		return errors.New("visible tools differ from the frozen execution strategy")
	}
	return nil
}

func validProviderConfigHash(configSHA256 string) bool {
	return lowercaseSHA256Pattern.MatchString(strings.TrimSpace(configSHA256))
}

func validateToolRuntimeFingerprintSnapshot(snapshot temporalruntime.ToolRuntimeFingerprintSnapshot) error {
	if snapshot.SchemaVersion != toolRuntimeFingerprintSchemaVersion ||
		strings.TrimSpace(snapshot.ToolsSchemaVersion) == "" ||
		strings.TrimSpace(snapshot.ToolsRegistryVersion) == "" ||
		strings.TrimSpace(snapshot.FunctionSchemaVersion) == "" ||
		strings.TrimSpace(snapshot.RuntimeRelease) == "" {
		return errors.New("tool runtime admission snapshot identity is invalid")
	}
	for _, value := range []string{
		snapshot.ToolsSHA256,
		snapshot.FunctionSchemaSHA256,
		snapshot.CombinedSHA256,
	} {
		if !sha256RefPattern.MatchString(value) {
			return errors.New("tool runtime admission snapshot hash is invalid")
		}
	}
	wantCombined := sha256JSONRef(map[string]any{
		"function_schema_sha256":  snapshot.FunctionSchemaSHA256,
		"function_schema_version": snapshot.FunctionSchemaVersion,
		"runtime_release":         snapshot.RuntimeRelease,
		"schema_version":          snapshot.SchemaVersion,
		"tools_registry_version":  snapshot.ToolsRegistryVersion,
		"tools_schema_version":    snapshot.ToolsSchemaVersion,
		"tools_sha256":            snapshot.ToolsSHA256,
	})
	if snapshot.CombinedSHA256 != wantCombined {
		return errors.New("tool runtime admission snapshot combined hash mismatch")
	}
	return nil
}

func toolRuntimeFingerprintSnapshotMap(snapshot temporalruntime.ToolRuntimeFingerprintSnapshot) map[string]any {
	if strings.TrimSpace(snapshot.SchemaVersion) == "" {
		return nil
	}
	return map[string]any{
		"combined_sha256":         snapshot.CombinedSHA256,
		"function_schema_sha256":  snapshot.FunctionSchemaSHA256,
		"function_schema_version": snapshot.FunctionSchemaVersion,
		"runtime_release":         snapshot.RuntimeRelease,
		"schema_version":          snapshot.SchemaVersion,
		"tools_registry_version":  snapshot.ToolsRegistryVersion,
		"tools_schema_version":    snapshot.ToolsSchemaVersion,
		"tools_sha256":            snapshot.ToolsSHA256,
	}
}

type providerConfigAdmissionPin struct {
	ConfigSHA256 string
}

func (pin providerConfigAdmissionPin) valid() bool {
	return validProviderConfigHash(pin.ConfigSHA256)
}

func (pin providerConfigAdmissionPin) projectionPayload() map[string]any {
	if !pin.valid() {
		return nil
	}
	return map[string]any{
		"config_sha256": pin.ConfigSHA256,
	}
}

func validateAgentRuntimeToolFingerprint(
	expected temporalruntime.ToolRuntimeFingerprintSnapshot,
	actual map[string]any,
) error {
	if err := validateToolRuntimeFingerprintSnapshot(expected); err != nil {
		return err
	}
	expectedPayload := toolRuntimeFingerprintSnapshotMap(expected)
	if len(actual) == 0 || hashAdmissionJSON(expectedPayload) != hashAdmissionJSON(actual) {
		return errors.New("agent runtime tool fingerprint does not match admission")
	}
	return nil
}

func (s *Server) validateLocalToolRuntimeFingerprint(
	expected temporalruntime.ToolRuntimeFingerprintSnapshot,
) error {
	local, err := buildToolRuntimeFingerprint(s.config.DeploymentRelease)
	if err != nil {
		return fmt.Errorf("build local tool runtime fingerprint: %w", err)
	}
	if err := validateAgentRuntimeToolFingerprint(expected, local.toMap()); err != nil {
		return fmt.Errorf("local execution-control tool runtime fingerprint: %w", err)
	}
	return nil
}

func (s *Server) validateLocalToolRuntimeFingerprintMap(expected map[string]any) error {
	if len(expected) == 0 {
		return errors.New("admitted tool runtime fingerprint is unavailable")
	}
	local, err := buildToolRuntimeFingerprint(s.config.DeploymentRelease)
	if err != nil {
		return fmt.Errorf("build local tool runtime fingerprint: %w", err)
	}
	if hashAdmissionJSON(expected) != hashAdmissionJSON(local.toMap()) {
		return errors.New("local execution-control tool runtime fingerprint does not match admission")
	}
	return nil
}
