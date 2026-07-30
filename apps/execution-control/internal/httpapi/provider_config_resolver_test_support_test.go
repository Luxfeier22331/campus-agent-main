package httpapi

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type staticProviderConfigResolver map[providerConfigKind]providerConfigSnapshot

func attachPrimaryAgentProviderConfigForTest(server *Server) {
	attachAgentAdmissionProviderConfigsForTest(server)
}

func attachAgentAdmissionProviderConfigsForTest(server *Server) {
	server.providerConfigResolver = staticProviderConfigResolver{
		providerConfigKindLLM: primaryAgentProviderConfigSnapshotForTest(),
		providerConfigKindEmbedding: embeddingProviderConfigSnapshotForTest(
			providerConfigKindEmbedding,
			"https://embedding.example/v1",
			"embedding-test",
			2560,
		),
	}
	server.providerConfigErr = nil
	server.toolReadModel = knowledgeReadModelForTest()
}

func withAgentAdmissionSnapshotForTest(
	t *testing.T,
	server *Server,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) temporalruntime.ExecutePrimaryAgentActivityInput {
	t.Helper()
	memoryAllowed := len(input.VisibleToolNames) == 1 && input.VisibleToolNames[0] == personalMemoryRecallToolName
	run, err := server.runProjectionStore.GetRun(t.Context(), input.RunID)
	if err != nil {
		t.Fatalf("load run for admission fixture: %v", err)
	}
	wire, err := server.loadExecutionInput(t.Context(), run)
	if err != nil {
		t.Fatalf("load execution input for admission fixture: %v", err)
	}
	query := groundingQueryForExecutionInput(
		wire,
		positiveOrDefault(server.config.AgentRuntimeInputCharLimit, defaultAgentCurrentInputChars),
	)
	snapshot, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		memoryAllowed,
		allowsUngroundedAnswer(wire.UserGoal),
		groundingPlanForTest(query),
	)
	if err != nil {
		t.Fatalf("build agent admission snapshot: %v", err)
	}
	input.AdmissionSnapshot = snapshot
	return withGroundingContextForTest(t, server, input)
}

func withGroundingContextForTest(
	t *testing.T,
	server *Server,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) temporalruntime.ExecutePrimaryAgentActivityInput {
	t.Helper()
	run, err := server.runProjectionStore.GetRun(t.Context(), input.RunID)
	if err != nil {
		t.Fatalf("load run for grounding fixture: %v", err)
	}
	grounding := groundingContext{
		AdmissionSHA256: sha256JSONRef(input.AdmissionSnapshot),
		CoveredScopes:   []string{},
		Evidence:        []groundingEvidence{},
		Mode:            input.AdmissionSnapshot.GroundingPlan.Mode,
		PlanSHA256:      input.AdmissionSnapshot.GroundingPlanSHA256,
		PreparedAt:      time.Date(2026, 7, 26, 8, 0, 0, 0, time.UTC),
		QuerySHA256:     input.AdmissionSnapshot.GroundingPlan.QuerySHA256,
		RunID:           run.RunID,
		SchemaVersion:   groundingContextSchemaVersion,
		SelectedScopes:  append([]string{}, input.AdmissionSnapshot.GroundingPlan.SelectedScopes...),
		Status: groundingStatus(
			input.AdmissionSnapshot.GroundingPlan.Mode,
			input.AdmissionSnapshot.GroundingPlan.SelectedScopes,
			nil,
		),
	}
	grounding.ModelContextChars = groundingModelContextCharacterCount(grounding.Status, grounding.Evidence)
	input.GroundingContext = grounding
	return input
}

func groundingPlanForTest(query string, scopes ...string) temporalruntime.GroundingPlanSnapshot {
	mode := "none"
	switch len(scopes) {
	case 1:
		mode = "single_scope"
	case 2, 3:
		mode = "multi_scope"
	default:
		if len(scopes) > 3 {
			mode = "multi_scope"
		}
	}
	return temporalruntime.GroundingPlanSnapshot{
		Mode:           mode,
		QuerySHA256:    sha256TextRef(strings.TrimSpace(query)),
		SchemaVersion:  groundingPlanSchemaVersion,
		SelectedScopes: append([]string{}, scopes...),
	}
}

func primaryAgentProviderConfigSnapshotForTest() providerConfigSnapshot {
	return providerConfigSnapshot{
		APIKey:    "sk-primary-agent",
		BaseURL:   "https://provider.example/v1",
		Kind:      providerConfigKindLLM,
		Model:     "gpt-test",
		Provider:  "openai",
		Transport: "responses",
	}
}

func embeddingProviderConfigSnapshotForTest(
	kind providerConfigKind,
	baseURL string,
	model string,
	dimensions int,
) providerConfigSnapshot {
	return providerConfigSnapshot{
		APIKey:     "test-embedding-key",
		BaseURL:    baseURL,
		Dimensions: dimensions,
		Kind:       kind,
		Model:      model,
		Provider:   "openai-compatible",
		Transport:  "embeddings",
	}
}

func (resolver staticProviderConfigResolver) ResolveActiveProviderConfig(
	_ context.Context,
	kind providerConfigKind,
) (providerConfigSnapshot, error) {
	snapshot, ok := resolver[kind]
	if !ok {
		return providerConfigSnapshot{}, fmt.Errorf("no active model setting for kind %s", kind)
	}
	if err := validateProviderConfigSnapshot(snapshot, kind); err != nil {
		return providerConfigSnapshot{}, err
	}
	return snapshot, nil
}
