package outboundadapter

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestOptionalQdrantTimingCannotFailRetrieval(t *testing.T) {
	for _, value := range []string{"null", "\"unknown\"", "-1", "1e400", "true"} {
		meta := &campusdiagnostics.RetrievalMeta{}
		points, err := decodeCampusDocsQdrantQueryResponse([]byte(`{"time":`+value+`,"result":{"points":[]}}`), meta)
		if err != nil || len(points) != 0 || meta.QdrantMs != nil {
			t.Fatalf("optional time %s changed retrieval: %v %v", value, points, err)
		}
	}
}

func TestCampusSearchKeepsComplementaryNoticeSectionsAndExcludesPriorEvidence(t *testing.T) {
	notice := func(id, chunk string) qdrantPoint {
		return qdrantPoint{ID: chunk, Score: .1, Payload: map[string]any{
			"source_kind": "notice", "schema_version": "campus_rag_point.v1",
			"notice_id": id, "chunk_id": chunk, "title": "通知", "section_title": "正文",
			"citation_href": "/notices/" + id, "text": chunk,
			"text_sha256":           execution.SHA256TextRef(chunk),
			"retrieval_text_sha256": execution.SHA256TextRef("通知\n" + chunk),
		}}
	}
	points := []qdrantPoint{notice("1", "first"), notice("1", "sibling"), validCampusDocsPointAtTest(0), validCampusDocsPointAtTest(1), notice("2", "other")}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/embeddings":
			writeJSON(w, 200, map[string]any{"data": []any{map[string]any{"embedding": make([]float64, campusdocs.EmbeddingDimensions)}}})
		case "/v1/rerank":
			// Equal top scores arrive reversed. Retrieval order is the tie breaker.
			writeJSON(w, 200, map[string]any{"results": []any{
				map[string]any{"index": 1, "relevance_score": .9}, map[string]any{"index": 0, "relevance_score": .9},
				map[string]any{"index": 2, "relevance_score": .8}, map[string]any{"index": 3, "relevance_score": .7}, map[string]any{"index": 4, "relevance_score": .6},
			}})
		default:
			writeJSON(w, 200, map[string]any{"time": 0, "result": map[string]any{"points": points}})
		}
	}))
	defer provider.Close()
	client := newCampusDocsHTTPClientForTest(t, config.Config{DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "key"}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
	snapshot := &campusdiagnostics.Snapshot{CitationStart: 4, Durations: map[string]int64{}}
	ctx := campusdocs.WithSearchObserver(t.Context(), &campusdocs.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
	results, err := client.Search(ctx, campusdocs.Index{Collection: "campus_docs_" + strings.Repeat("a", 64)}, campusdocs.SearchQuery{RetrievalQuery: "查询", RerankQuery: "查询"}, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 3 || results[0].Text != "first" || results[1].Text != "sibling" || results[2].SourceKind != "document" {
		t.Fatalf("selection=%+v", results)
	}
	if snapshot.Candidates[1].ExclusionReason != "" || snapshot.Candidates[4].ExclusionReason != "result_limit" {
		t.Fatalf("exclusions=%+v", snapshot.Candidates)
	}
	if snapshot.SourceGroupedCount != 5 || snapshot.SourceGroupedExcludedCount != 0 || snapshot.ExcludedCount != 2 || snapshot.ReturnedCount != 3 {
		t.Fatalf("counts=%+v", snapshot)
	}
	for i, candidateIndex := range []int{0, 1, 2} {
		if got := snapshot.Candidates[candidateIndex].CitationIndex; got == nil || *got != i+4 {
			t.Fatalf("citation %d=%v", candidateIndex, got)
		}
	}
	if snapshot.Retrieval.QdrantMs == nil || *snapshot.Retrieval.QdrantMs != 0 || snapshot.Retrieval.DecodeMs == nil || snapshot.Retrieval.PostprocessMs == nil {
		t.Fatal("zero/missing timing conflated")
	}
	prior := results[0].ResultRef
	snapshot = &campusdiagnostics.Snapshot{CitationStart: 11, Durations: map[string]int64{}}
	ctx = campusdocs.WithSearchObserver(t.Context(), &campusdocs.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
	results, err = client.Search(ctx, campusdocs.Index{Collection: "campus_docs_" + strings.Repeat("a", 64)}, campusdocs.SearchQuery{RetrievalQuery: "费用", RerankQuery: "项目费用是什么", ExcludedResultRefs: []string{prior}}, 3)
	if err != nil || len(results) != 3 || results[0].Text != "sibling" || snapshot.Candidates[0].ExclusionReason != "already_returned" {
		t.Fatalf("prior evidence consumed a result slot: %+v %v", results, err)
	}
}

func TestCampusSearchRecordsActualFailureStageAndTimings(t *testing.T) {
	for _, stage := range []string{"embedding", "retrieval", "rerank"} {
		t.Run(stage, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				current := "retrieval"
				if r.URL.Path == "/v1/embeddings" {
					current = "embedding"
				}
				if r.URL.Path == "/v1/rerank" {
					current = "rerank"
				}
				if current == stage {
					w.WriteHeader(503)
					return
				}
				switch current {
				case "embedding":
					writeJSON(w, 200, map[string]any{"data": []any{map[string]any{"embedding": make([]float64, campusdocs.EmbeddingDimensions)}}})
				default:
					writeJSON(w, 200, map[string]any{"time": 0.001, "result": map[string]any{"points": []qdrantPoint{validCampusDocsPointAtTest(0)}}})
				}
			}))
			defer provider.Close()
			client := newCampusDocsHTTPClientForTest(t, config.Config{DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "secret"}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
			snapshot := &campusdiagnostics.Snapshot{Durations: map[string]int64{}}
			ctx := campusdocs.WithSearchObserver(t.Context(), &campusdocs.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
			_, err := client.Search(ctx, campusdocs.Index{Collection: "campus_docs_" + strings.Repeat("c", 64)}, campusdocs.SearchQuery{RetrievalQuery: "查询", RerankQuery: "查询"}, 5)
			if err == nil || snapshot.FailedStage != stage {
				t.Fatalf("err=%v stage=%s", err, snapshot.FailedStage)
			}
			if _, ok := snapshot.Durations[stage]; !ok {
				t.Fatal("failed stage duration missing")
			}
			if stage == "embedding" && snapshot.Retrieval.HTTPMs != nil {
				t.Fatal("unexecuted retrieval has a duration")
			}
			if stage != "embedding" && snapshot.Retrieval.HTTPMs == nil {
				t.Fatal("attempted HTTP duration missing")
			}
			if stage == "rerank" && (snapshot.Rerank.HTTPMs == nil || snapshot.Retrieval.QdrantMs == nil || *snapshot.Retrieval.QdrantMs != 1) {
				t.Fatal("upstream durations missing or wrong units")
			}
			bytes, _ := json.Marshal(snapshot)
			if strings.Contains(string(bytes), "secret") || strings.Contains(snapshot.Embedding.ServiceOrigin, "/v1") {
				t.Fatal("credentials or provider path leaked")
			}
		})
	}
}

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
	results, err := client.Search(ctx, campusdocs.Index{Collection: collection}, campusdocs.SearchQuery{RetrievalQuery: "查询", RerankQuery: "查询"}, 5)
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
