package outboundadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestCampusSearchDiagnosticsRecordsEvidenceBudgetExclusion(t *testing.T) {
	collection := "campus_docs_" + strings.Repeat("c", 64)
	points := []qdrantPoint{validCampusDocsPointAtTest(0), validCampusDocsPointAtTest(1)}
	for index := range points {
		text := strings.Repeat("字", 3000)
		points[index].Payload["text"] = text
		points[index].Payload["text_sha256"] = execution.SHA256TextRef(text)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/embeddings":
			writeJSON(w, 200, map[string]any{"data": []map[string]any{{"embedding": make([]float64, campusdocs.EmbeddingDimensions)}}})
		case "/v1/rerank":
			writeJSON(w, 200, map[string]any{"results": []map[string]any{{"index": 0, "relevance_score": 0.9}, {"index": 1, "relevance_score": 0.8}}})
		default:
			writeJSON(w, 200, map[string]any{"result": map[string]any{"points": points}})
		}
	}))
	defer provider.Close()
	client := newCampusDocsHTTPClientForTest(t, config.Config{
		DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "test-key",
	}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
	snapshot := &campusdiagnostics.Snapshot{CitationStart: 1, Durations: map[string]int64{}}
	ctx := campusdocs.WithSearchObserver(t.Context(), &campusdocs.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
	results, err := client.Search(ctx, campusdocs.Index{Collection: collection}, "查询", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || len(snapshot.Candidates) != 2 {
		t.Fatalf("unexpected selection: %d results, %d candidates", len(results), len(snapshot.Candidates))
	}
	if len([]rune(snapshot.Candidates[0].Text)) != 3000 || len([]rune(snapshot.Candidates[1].Text)) != 160 || snapshot.Candidates[1].ExclusionReason != "evidence_char_budget" {
		t.Fatal("diagnostic body bounds or exclusion reason are incorrect")
	}
	encoded := campusdocs.EncodeSearchResult(results, 1)
	if len(encoded) != 2 {
		t.Fatal("diagnostics leaked into tool response")
	}
}
