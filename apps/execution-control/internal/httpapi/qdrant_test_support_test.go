package httpapi

import (
	"encoding/pem"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

func writeTestCACert(t *testing.T, server *httptest.Server) string {
	t.Helper()
	block := &pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}
	path := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatalf("write test ca: %v", err)
	}
	return path
}

func defaultDocumentEvidenceEmbeddingResolverForTest() providerConfigResolver {
	return staticProviderConfigResolver{
		providerConfigKindEmbedding: embeddingProviderConfigSnapshotForTest(
			providerConfigKindEmbedding,
			"https://provider.example/v1",
			"Qwen3-Embedding-4B",
			2560,
		),
	}
}

func qdrantMustConditionsForTest(t *testing.T, captured map[string]any) map[string]any {
	t.Helper()
	filter := qdrantFilterForTest(t, captured)
	rawMust, ok := filter["must"].([]any)
	if !ok {
		t.Fatalf("filter.must = %#v, want array", filter["must"])
	}
	must := map[string]any{}
	for _, rawCondition := range rawMust {
		condition, ok := rawCondition.(map[string]any)
		if !ok {
			t.Fatalf("condition = %#v, want object", rawCondition)
		}
		key, _ := condition["key"].(string)
		match, _ := condition["match"].(map[string]any)
		must[key] = match["value"]
	}
	return must
}

func qdrantFilterForTest(t *testing.T, captured map[string]any) map[string]any {
	t.Helper()
	prefetch, ok := captured["prefetch"].([]any)
	if !ok || len(prefetch) == 0 {
		t.Fatalf("prefetch = %#v, want array", captured["prefetch"])
	}
	firstPrefetch, ok := prefetch[0].(map[string]any)
	if !ok {
		t.Fatalf("prefetch[0] = %#v, want object", prefetch[0])
	}
	filter, ok := firstPrefetch["filter"].(map[string]any)
	if !ok {
		t.Fatalf("prefetch[0].filter = %#v, want object", firstPrefetch["filter"])
	}
	return filter
}

func assertQdrantMatchConditionForTest(
	t *testing.T,
	must map[string]any,
	key string,
	expected any,
) {
	t.Helper()
	if must[key] != expected {
		t.Fatalf("filter %s = %#v, want %#v", key, must[key], expected)
	}
}

func embeddingResponseForTest(dimensions int) string {
	values := make([]string, 0, dimensions)
	for index := range dimensions {
		values = append(values, fmt.Sprintf("%.1f", float64(index%3)/10))
	}
	return `{"data":[{"embedding":[` + strings.Join(values, ",") + `] }]}`
}

func retrievalServingConfigForTest(
	corpus string,
	collection string,
) (retrievalruntime.ServingConfig, error) {
	return retrievalruntime.LoadServingConfigPath(
		"",
		filepath.Join(corpus, collection, "serving-config.json"),
	)
}
