package httpapi

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type staticProviderConfigResolver map[providerconfig.Kind]providerconfig.RuntimeSetting

func attachPrimaryAgentProviderConfigForTest(server *Server) {
	attachAgentAdmissionProviderConfigsForTest(server)
}

func attachAgentAdmissionProviderConfigsForTest(server *Server) {
	server.providerConfigResolver = staticProviderConfigResolver{
		providerconfig.KindLLM: primaryAgentProviderConfigSnapshotForTest(),
		providerconfig.KindEmbedding: embeddingProviderConfigSnapshotForTest(
			providerconfig.KindEmbedding,
			"https://embedding.example/v1",
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

func primaryAgentProviderConfigSnapshotForTest() providerconfig.RuntimeSetting {
	return providerconfig.RuntimeSetting{
		APIKey:    "sk-primary-agent",
		BaseURL:   "https://provider.example/v1",
		Kind:      providerconfig.KindLLM,
		Model:     "gpt-test",
		Provider:  "openai",
		Transport: "responses",
	}
}

func embeddingProviderConfigSnapshotForTest(
	kind providerconfig.Kind,
	baseURL string,
) providerconfig.RuntimeSetting {
	return providerconfig.RuntimeSetting{
		APIKey:    "test-embedding-key",
		BaseURL:   baseURL,
		Kind:      kind,
		Model:     providerconfig.CanonicalEmbeddingModel,
		Provider:  providerconfig.CanonicalEmbeddingProvider,
		Transport: providerconfig.CanonicalEmbeddingTransport,
	}
}

func (resolver staticProviderConfigResolver) ResolveActiveProviderConfig(
	_ context.Context,
	kind providerconfig.Kind,
) (providerconfig.RuntimeSetting, error) {
	snapshot, ok := resolver[kind]
	if !ok {
		return providerconfig.RuntimeSetting{}, fmt.Errorf("no active model setting for kind %s", kind)
	}
	if err := providerconfig.ValidateRuntimeSetting(snapshot, kind); err != nil {
		return providerconfig.RuntimeSetting{}, err
	}
	return snapshot, nil
}
