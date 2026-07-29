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

const maxAdmissionDocumentScopes = 32

const executionStrategySchemaVersion = "execution_strategy.v2"

var lowercaseSHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var sha256RefPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

func (s *Server) buildAgentAdmissionSnapshot(
	ctx context.Context,
	personalMemoryRecallAllowed bool,
	allowUngroundedAnswer bool,
	groundingPlan temporalruntime.GroundingPlanSnapshot,
) (temporalruntime.AgentAdmissionSnapshot, error) {
	if err := validateGroundingPlan(groundingPlan); err != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, err
	}
	strategy := executionStrategyForAdmission(
		personalMemoryRecallAllowed,
		allowUngroundedAnswer,
	)
	visibleToolNames := strategy.VisibleToolNames
	targets := []temporalruntime.DocumentScope{}
	if groundingPlan.Mode != "none" {
		var err error
		targets, err = s.documentScopesForAgent(ctx, groundingPlan.SelectedScopes)
		if err != nil {
			return temporalruntime.AgentAdmissionSnapshot{}, fmt.Errorf("load document scope admission snapshot: %w", err)
		}
	}
	if len(targets) > maxAdmissionDocumentScopes {
		return temporalruntime.AgentAdmissionSnapshot{}, errors.New("document scope admission snapshot exceeds bounded scope count")
	}
	for index := range targets {
		targets[index].Scope = strings.TrimSpace(targets[index].Scope)
		targets[index].Description = strings.TrimSpace(targets[index].Description)
		if targets[index].Scope == "" || len([]rune(targets[index].Scope)) > 256 || len([]rune(targets[index].Description)) > 512 {
			return temporalruntime.AgentAdmissionSnapshot{}, fmt.Errorf("document scope admission snapshot item %d is invalid", index)
		}
	}
	limits := s.primaryAgentRuntimeLimits()
	limitSnapshot := temporalruntime.AgentRuntimeLimitsSnapshot{
		AgentDeadlineMS:       limits.AgentDeadlineMS,
		ContextCharLimit:      limits.ContextCharLimit,
		CurrentInputCharLimit: limits.CurrentInputCharLimit,
		MaxOutputTokens:       limits.MaxOutputTokens,
	}
	targets = canonicalDocumentScopes(targets)
	toolRuntime, err := buildToolRuntimeFingerprint(s.config.DeploymentRelease)
	if err != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, fmt.Errorf("build tool runtime admission snapshot: %w", err)
	}
	toolRuntimeSnapshot := toolRuntime.toAdmissionSnapshot()
	snapshot := temporalruntime.AgentAdmissionSnapshot{
		AgentLimits:                  limitSnapshot,
		AgentLimitsSHA256:            hashAdmissionJSON(limitSnapshot),
		DocumentScopes:               targets,
		DocumentScopesSHA256:         hashDocumentScopes(targets),
		ExecutionStrategy:            strategy,
		ExecutionStrategySHA256:      hashAdmissionJSON(strategy),
		GroundingPlan:                groundingPlan,
		GroundingPlanSHA256:          hashAdmissionJSON(groundingPlan),
		ToolRuntimeFingerprint:       toolRuntimeSnapshot,
		ToolRuntimeFingerprintSHA256: hashAdmissionJSON(toolRuntimeSnapshot),
	}
	provider, providerErr := s.resolveProviderConfigSnapshot(ctx, providerConfigKindLLM)
	if providerErr != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, fmt.Errorf("resolve active llm setting: %w", providerErr)
	}
	snapshot.ProviderConfigSHA256 = providerConfigAdmissionHash(provider)
	if groundingPlan.Mode != "none" {
		embedding, err := s.resolveProviderConfigSnapshot(ctx, providerConfigKindEmbedding)
		if err != nil {
			return temporalruntime.AgentAdmissionSnapshot{}, fmt.Errorf("resolve active embedding setting: %w", err)
		}
		snapshot.EmbeddingProviderConfigSHA256 = providerConfigAdmissionHash(embedding)
	}
	if err := validateAdmissionSnapshotForVisibleTools(snapshot, visibleToolNames); err != nil {
		return temporalruntime.AgentAdmissionSnapshot{}, err
	}
	return snapshot, nil
}

func executionStrategyForAdmission(
	personalMemoryRecallAllowed bool,
	allowUngroundedAnswer bool,
) temporalruntime.ExecutionStrategySnapshot {
	strategy := temporalruntime.ExecutionStrategySnapshot{
		AllowUngroundedAnswer: allowUngroundedAnswer,
		Kind:                  "direct",
		MaxModelTurns:         1,
		MaxToolCalls:          0,
		MemoryRecall:          "disabled",
		SchemaVersion:         executionStrategySchemaVersion,
		VisibleToolNames:      []string{},
	}
	if personalMemoryRecallAllowed {
		strategy.MaxModelTurns = 2
		strategy.MaxToolCalls = 1
		strategy.MemoryRecall = "model_optional"
		strategy.VisibleToolNames = []string{"personal_memory_recall"}
	}
	return strategy
}

func executionStrategyProjectionPayload(strategy temporalruntime.ExecutionStrategySnapshot) map[string]any {
	return map[string]any{
		"allow_ungrounded_answer": strategy.AllowUngroundedAnswer,
		"kind":                    strategy.Kind,
		"max_model_turns":         strategy.MaxModelTurns,
		"max_tool_calls":          strategy.MaxToolCalls,
		"memory_recall":           strategy.MemoryRecall,
		"schema_version":          strategy.SchemaVersion,
		"visible_tool_names":      append([]string{}, strategy.VisibleToolNames...),
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

// Document scopes are part of the admission fingerprint. Treat nil and an
// empty list identically so a missing optional source cannot change the hash
// merely because JSON encoded it as null instead of [].
func canonicalDocumentScopes(targets []temporalruntime.DocumentScope) []temporalruntime.DocumentScope {
	if len(targets) == 0 {
		return []temporalruntime.DocumentScope{}
	}
	return append([]temporalruntime.DocumentScope{}, targets...)
}

func hashDocumentScopes(targets []temporalruntime.DocumentScope) string {
	return hashAdmissionJSON(canonicalDocumentScopes(targets))
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
	if snapshot.DocumentScopesSHA256 == "" || hashDocumentScopes(snapshot.DocumentScopes) != snapshot.DocumentScopesSHA256 {
		return errors.New("document scopes admission snapshot hash mismatch")
	}
	if len(snapshot.DocumentScopes) > maxAdmissionDocumentScopes {
		return errors.New("document scopes admission snapshot exceeds bounded scope count")
	}
	if snapshot.ExecutionStrategySHA256 == "" ||
		hashAdmissionJSON(snapshot.ExecutionStrategy) != snapshot.ExecutionStrategySHA256 {
		return errors.New("execution strategy admission snapshot hash mismatch")
	}
	if err := validateExecutionStrategy(snapshot.ExecutionStrategy); err != nil {
		return err
	}
	if snapshot.GroundingPlanSHA256 == "" ||
		hashAdmissionJSON(snapshot.GroundingPlan) != snapshot.GroundingPlanSHA256 {
		return errors.New("grounding plan admission snapshot hash mismatch")
	}
	if err := validateGroundingPlan(snapshot.GroundingPlan); err != nil {
		return err
	}
	if snapshot.ExecutionStrategy.AllowUngroundedAnswer && snapshot.GroundingPlan.Mode != "none" {
		return errors.New("ungrounded answers require a none grounding plan")
	}
	seenTargets := make(map[string]struct{}, len(snapshot.DocumentScopes))
	for index, target := range snapshot.DocumentScopes {
		if err := validateDocumentScopeAdmission(target); err != nil {
			return fmt.Errorf("document scope admission snapshot item %d is invalid", index)
		}
		normalizedTarget := target.Scope
		if _, exists := seenTargets[normalizedTarget]; exists {
			return fmt.Errorf("document scope admission snapshot scope %s is duplicated", normalizedTarget)
		}
		seenTargets[normalizedTarget] = struct{}{}
	}
	if len(snapshot.DocumentScopes) != len(snapshot.GroundingPlan.SelectedScopes) {
		return errors.New("document scopes differ from the grounding plan")
	}
	for index, scope := range snapshot.GroundingPlan.SelectedScopes {
		if snapshot.DocumentScopes[index].Scope != scope {
			return errors.New("document scope order differs from the grounding plan")
		}
	}
	if !validProviderConfigHash(snapshot.ProviderConfigSHA256) {
		return errors.New("provider admission snapshot is invalid")
	}
	if snapshot.GroundingPlan.Mode == "none" {
		if snapshot.EmbeddingProviderConfigSHA256 != "" {
			return errors.New("direct grounding plan must not pin retrieval providers")
		}
	} else {
		if !validProviderConfigHash(snapshot.EmbeddingProviderConfigSHA256) {
			return errors.New("embedding provider admission snapshot is invalid")
		}
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

func validateGroundingPlan(plan temporalruntime.GroundingPlanSnapshot) error {
	if plan.SchemaVersion != groundingPlanSchemaVersion || !validSHA256Ref(plan.QuerySHA256) {
		return errors.New("grounding plan identity is invalid")
	}
	seen := map[string]struct{}{}
	for _, scope := range plan.SelectedScopes {
		if strings.TrimSpace(scope) == "" || scope != strings.TrimSpace(scope) {
			return errors.New("grounding plan selected scope is invalid")
		}
		if _, exists := seen[scope]; exists {
			return errors.New("grounding plan selected scope is duplicated")
		}
		seen[scope] = struct{}{}
	}
	switch plan.Mode {
	case "none":
		if len(plan.SelectedScopes) != 0 {
			return errors.New("none grounding plan must not select scopes")
		}
	case "single_scope":
		if len(plan.SelectedScopes) != 1 {
			return errors.New("single-scope grounding plan must select one scope")
		}
	case "multi_scope":
		if len(plan.SelectedScopes) < 2 {
			return errors.New("multi-scope grounding plan must select multiple scopes")
		}
	default:
		return errors.New("grounding plan mode is invalid")
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
		strings.TrimSpace(snapshot.RuntimeRelease) == "" ||
		strings.TrimSpace(snapshot.WorkflowArtifactSchemaVersion) == "" ||
		strings.TrimSpace(snapshot.WorkflowArtifactRegistryVersion) == "" {
		return errors.New("tool runtime admission snapshot identity is invalid")
	}
	for _, value := range []string{
		snapshot.ToolsSHA256,
		snapshot.FunctionSchemaSHA256,
		snapshot.WorkflowArtifactSHA256,
		snapshot.CombinedSHA256,
	} {
		if !sha256RefPattern.MatchString(value) {
			return errors.New("tool runtime admission snapshot hash is invalid")
		}
	}
	wantCombined := sha256JSONRef(map[string]any{
		"function_schema_sha256":             snapshot.FunctionSchemaSHA256,
		"function_schema_version":            snapshot.FunctionSchemaVersion,
		"runtime_release":                    snapshot.RuntimeRelease,
		"schema_version":                     snapshot.SchemaVersion,
		"tools_registry_version":             snapshot.ToolsRegistryVersion,
		"tools_schema_version":               snapshot.ToolsSchemaVersion,
		"tools_sha256":                       snapshot.ToolsSHA256,
		"workflow_artifact_registry_version": snapshot.WorkflowArtifactRegistryVersion,
		"workflow_artifact_schema_version":   snapshot.WorkflowArtifactSchemaVersion,
		"workflow_artifact_sha256":           snapshot.WorkflowArtifactSHA256,
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
		"combined_sha256":                    snapshot.CombinedSHA256,
		"function_schema_sha256":             snapshot.FunctionSchemaSHA256,
		"function_schema_version":            snapshot.FunctionSchemaVersion,
		"runtime_release":                    snapshot.RuntimeRelease,
		"schema_version":                     snapshot.SchemaVersion,
		"tools_registry_version":             snapshot.ToolsRegistryVersion,
		"tools_schema_version":               snapshot.ToolsSchemaVersion,
		"tools_sha256":                       snapshot.ToolsSHA256,
		"workflow_artifact_registry_version": snapshot.WorkflowArtifactRegistryVersion,
		"workflow_artifact_schema_version":   snapshot.WorkflowArtifactSchemaVersion,
		"workflow_artifact_sha256":           snapshot.WorkflowArtifactSHA256,
	}
}

type providerConfigAdmissionPin struct {
	ConfigSHA256 string
}

func embeddingProviderAdmissionPin(snapshot temporalruntime.AgentAdmissionSnapshot) providerConfigAdmissionPin {
	return providerConfigAdmissionPin{
		ConfigSHA256: snapshot.EmbeddingProviderConfigSHA256,
	}
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

func providerConfigAdmissionPinFromProjection(value any) (providerConfigAdmissionPin, error) {
	payload := cloneAnyMapFromMetadata(value)
	pin := providerConfigAdmissionPin{
		ConfigSHA256: strings.TrimSpace(stringValue(payload["config_sha256"])),
	}
	if !pin.valid() {
		return providerConfigAdmissionPin{}, errors.New("embedding provider admission projection is invalid")
	}
	return pin, nil
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
