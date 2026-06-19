package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/rageval"
)

func TestRAGFirstStageEvalExecutorCapturesDenseSparsePrefetchAndRRFFinal(t *testing.T) {
	embedding := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/embeddings" {
			t.Fatalf("embedding path = %q", request.URL.Path)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(embeddingResponseForTest(2560)))
	}))
	defer embedding.Close()

	queryKinds := []string{}
	qdrant := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/collections/student_rules":
			_, _ = response.Write([]byte(qdrantCollectionMetadataResponseForTest(t, "regulations", "student_rules")))
		case "/collections/student_rules/points/query":
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatalf("decode qdrant body: %v", err)
			}
			kind := "hybrid"
			if using, ok := body["using"].(string); ok {
				kind = using
			}
			queryKinds = append(queryKinds, kind)
			switch kind {
			case "dense":
				_, _ = response.Write([]byte(qdrantEvalPointResponse("doc-dense", "chunk-dense", "v1", 0.93)))
			case "sparse":
				_, _ = response.Write([]byte(qdrantEvalPointResponse("doc-sparse", "chunk-sparse", "v1", 0.82)))
			default:
				if _, ok := body["prefetch"].([]any); !ok {
					t.Fatalf("hybrid query missing prefetch: %#v", body)
				}
				_, _ = response.Write([]byte(qdrantEvalPointResponse("doc-final", "chunk-final", "v2", 0.97)))
			}
		default:
			t.Fatalf("unexpected qdrant path %q", request.URL.Path)
		}
	}))
	defer qdrant.Close()

	executor := ragFirstStageEvalExecutor{
		qdrant: qdrantRAGLookupExecutor{
			configResolver: staticProviderConfigResolver{
				"rag_query_embedding": embeddingProviderConfigSnapshotForTest(
					providerConfigRoleRAGQueryEmbedding,
					embedding.URL,
					"Qwen3-Embedding-4B",
					2560,
				),
			},
			embeddingHTTPClient: embedding.Client(),
			httpClient:          qdrant.Client(),
			qdrantQueryAPIKey:   "query-key",
			qdrantURL:           qdrant.URL,
			timeout:             time.Second,
		},
	}

	result, err := executor.Lookup(context.Background(), rageval.LookupRequest{
		CaseID:              "leave-policy",
		Collection:          "student_rules",
		Corpus:              "regulations",
		DensePrefetchLimit:  10,
		QueryText:           "学生请假手续",
		RetrievalTopK:       3,
		RRFK:                60,
		RRFDenseWeight:      1,
		RRFSparseWeight:     1,
		SparsePrefetchLimit: 10,
		VariantID:           "topk3-d10-s10",
	})
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if got := len(result.PrefetchSources); got != 2 {
		t.Fatalf("prefetch count = %d, want dense+sparse", got)
	}
	if result.PrefetchSources[0].Stage != rageval.StageDensePrefetch ||
		result.PrefetchSources[1].Stage != rageval.StageSparsePrefetch {
		t.Fatalf("prefetch stages = %#v", result.PrefetchSources)
	}
	if len(result.FinalSources) != 1 || result.FinalSources[0].Stage != rageval.StageRRFFinal {
		t.Fatalf("final sources = %#v", result.FinalSources)
	}
	if result.FinalSources[0].DocID != "doc-final" || *result.FinalSources[0].VersionID != "v2" {
		t.Fatalf("final source identity = %#v", result.FinalSources[0])
	}
	wantKinds := "dense,sparse,hybrid"
	if got := strings.Join(queryKinds, ","); got != wantKinds {
		t.Fatalf("query kinds = %s, want %s", got, wantKinds)
	}
	if result.LatencyMS <= 0 {
		t.Fatalf("latency = %d, want positive", result.LatencyMS)
	}
}

func qdrantEvalPointResponse(docID string, chunkID string, versionID string, score float64) string {
	body, _ := json.Marshal(map[string]any{
		"result": map[string]any{
			"points": []map[string]any{{
				"id":    chunkID,
				"score": score,
				"payload": map[string]any{
					"chunk_id":          chunkID,
					"document_id":       docID,
					"is_answer_bearing": true,
					"source_title":      "学生手册",
					"text":              "学生应当按照学校规定办理请假手续。",
					"version_id":        versionID,
				},
			}},
		},
		"status": "ok",
	})
	return string(body)
}
