package httpapi

import (
	"context"
	"fmt"
	"strings"
	"testing"

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
			"provider-model-alias",
		),
	}
	server.providerConfigErr = nil
	server.campusDocsIndexStore = campusDocsIndexStoreForTest()
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
	querySHA256, err := server.campusDocsQuerySHA256ForAdmission(wire)
	if err != nil {
		t.Fatalf("build Campus Docs retrieval admission query: %v", err)
	}
	snapshot, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		memoryAllowed,
		querySHA256,
	)
	if err != nil {
		t.Fatalf("build agent admission snapshot: %v", err)
	}
	input.AdmissionSnapshot = snapshot
	return withCampusDocsRetrievalForTest(t, input)
}

func withCampusDocsRetrievalForTest(
	t *testing.T,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) temporalruntime.ExecutePrimaryAgentActivityInput {
	t.Helper()
	input.CampusDocsRetrieval = temporalruntime.CampusDocsRetrievalResult{
		Evidence: []temporalruntime.CampusDocsEvidence{},
	}
	return input
}

func campusDocsQuerySHA256ForTest(query string) string {
	return sha256TextRef(strings.TrimSpace(query))
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
) providerConfigSnapshot {
	return providerConfigSnapshot{
		APIKey:    "test-embedding-key",
		BaseURL:   baseURL,
		Kind:      kind,
		Model:     model,
		Provider:  "openai-compatible",
		Transport: "embeddings",
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
