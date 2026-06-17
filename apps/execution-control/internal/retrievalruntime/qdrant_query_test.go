package retrievalruntime

import "testing"

func TestBuildHybridQueryBodyUsesDenseSparsePrefetchAndRRF(t *testing.T) {
	profile := RuntimeProfile{
		Collection:            "student_rules",
		Corpus:                "regulations",
		DensePrefetchLimit:    20,
		DenseVectorName:       "dense",
		QdrantAliasName:       "student_rules_alias",
		QueryEnabledByDefault: true,
		RetrievalEnabled:      true,
		RetrievalTopK:         8,
		RRFK:                  60,
		ServingRevisionTracks: []string{"current-effective", "source-faithful"},
		ServingStage:          "query_serving",
		SparsePrefetchLimit:   20,
		SparseVectorName:      "sparse",
	}
	body, err := BuildHybridQueryBody(QueryRequest{
		DenseEmbedding: []float64{0.1, 0.2, 0.3},
		Mode:           "current",
		Profile:        profile,
		QueryText:      "学生请假手续",
		TopK:           8,
	})
	if err != nil {
		t.Fatalf("build hybrid query body: %v", err)
	}

	if body["using"] != nil {
		t.Fatalf("top-level using must not be present for hybrid query: %#v", body["using"])
	}
	prefetch, ok := body["prefetch"].([]map[string]any)
	if !ok || len(prefetch) != 2 {
		t.Fatalf("prefetch = %#v, want dense and sparse prefetches", body["prefetch"])
	}
	if prefetch[0]["using"] != "dense" {
		t.Fatalf("dense using = %#v", prefetch[0]["using"])
	}
	if prefetch[1]["using"] != "sparse" {
		t.Fatalf("sparse using = %#v", prefetch[1]["using"])
	}
	fusion, ok := body["query"].(map[string]any)
	if !ok || fusion["fusion"] != "rrf" {
		t.Fatalf("query = %#v, want fusion rrf", body["query"])
	}
}

func TestBuildHybridQueryBodyRejectsEnabledRerankerWithoutExecutor(t *testing.T) {
	profile := RuntimeProfile{
		Collection:               "student_rules",
		Corpus:                   "regulations",
		DensePrefetchLimit:       20,
		DenseVectorName:          "dense",
		QdrantAliasName:          "student_rules",
		QueryEnabledByDefault:    true,
		RerankerEnabledByDefault: true,
		RetrievalEnabled:         true,
		RetrievalTopK:            8,
		ServingStage:             "query_serving",
		SparsePrefetchLimit:      20,
		SparseVectorName:         "sparse",
	}
	_, err := BuildHybridQueryBody(QueryRequest{
		DenseEmbedding: []float64{0.1, 0.2, 0.3},
		Mode:           "current",
		Profile:        profile,
		QueryText:      "学生请假手续",
		TopK:           8,
	})
	if err == nil {
		t.Fatal("profile-gated reranker without Go executor must fail closed")
	}
}

func TestBuildHybridQueryBodyAsOfRequiresResolvedVersionID(t *testing.T) {
	body, err := BuildHybridQueryBody(QueryRequest{
		DenseEmbedding: []float64{0.1, 0.2, 0.3},
		Mode:           "as_of",
		Profile:        validRuntimeProfileForQueryTest(),
		QueryText:      "2025年请假规则",
		TopK:           3,
		VersionID:      "student_rules:v2025",
	})
	if err != nil {
		t.Fatalf("as_of with resolved version id must build query: %v", err)
	}
	must := qdrantMustConditionsForQueryTest(t, body)
	versionMatch, ok := must["version_id"]["match"].(map[string]any)
	if !ok {
		t.Fatalf("version_id match missing: %#v", must["version_id"])
	}
	values, ok := versionMatch["any"].([]string)
	if !ok || len(values) != 1 || values[0] != "student_rules:v2025" {
		t.Fatalf("version_id any = %#v, want resolved version id", versionMatch["any"])
	}
}

func TestBuildHybridQueryBodyAsOfWithoutResolvedVersionIDFailsClosed(t *testing.T) {
	_, err := BuildHybridQueryBody(QueryRequest{
		DenseEmbedding: []float64{0.1, 0.2, 0.3},
		Mode:           "as_of",
		Profile:        validRuntimeProfileForQueryTest(),
		QueryText:      "2025年请假规则",
		TopK:           3,
	})
	if err == nil {
		t.Fatal("as_of without resolved version id must fail closed")
	}
}

func validRuntimeProfileForQueryTest() RuntimeProfile {
	return RuntimeProfile{
		Collection:            "student_rules",
		Corpus:                "regulations",
		DensePrefetchLimit:    20,
		DenseVectorName:       "dense",
		QdrantAliasName:       "student_rules",
		QueryEnabledByDefault: true,
		RetrievalEnabled:      true,
		RetrievalTopK:         8,
		ServingStage:          "query_serving",
		SparsePrefetchLimit:   20,
		SparseVectorName:      "sparse",
	}
}

func qdrantMustConditionsForQueryTest(t *testing.T, body map[string]any) map[string]map[string]any {
	t.Helper()
	prefetch, ok := body["prefetch"].([]map[string]any)
	if !ok || len(prefetch) == 0 {
		t.Fatalf("prefetch = %#v", body["prefetch"])
	}
	filter, ok := prefetch[0]["filter"].(map[string]any)
	if !ok {
		t.Fatalf("filter = %#v", prefetch[0]["filter"])
	}
	rawMust, ok := filter["must"].([]map[string]any)
	if !ok {
		t.Fatalf("must = %#v", filter["must"])
	}
	must := map[string]map[string]any{}
	for _, condition := range rawMust {
		key, _ := condition["key"].(string)
		if key != "" {
			must[key] = condition
		}
	}
	return must
}
