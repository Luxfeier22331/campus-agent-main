package retrievalruntime

import "testing"

func TestBuildHybridQueryBodyUsesDenseSparsePrefetchAndRRF(t *testing.T) {
	body, err := BuildHybridQueryBody(QueryRequest{
		DenseEmbedding: []float64{0.1, 0.2, 0.3},
		ServingConfig:  validServingConfigForQueryTest(),
		QueryText:      "学生请假手续",
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "public",
		},
		TopK: 8,
	})
	if err != nil {
		t.Fatalf("build hybrid query body: %v", err)
	}
	prefetch, ok := body["prefetch"].([]map[string]any)
	if !ok || len(prefetch) != 2 {
		t.Fatalf("prefetch = %#v, want dense and sparse prefetches", body["prefetch"])
	}
	if prefetch[0]["using"] != "dense" || prefetch[1]["using"] != "sparse" {
		t.Fatalf("prefetch vector names = %#v", prefetch)
	}
	fusion, ok := body["query"].(map[string]any)
	if !ok || fusion["fusion"] != "rrf" {
		t.Fatalf("query = %#v, want fusion rrf", body["query"])
	}
	if body["limit"] != 8 {
		t.Fatalf("limit = %#v, want target-provided top k", body["limit"])
	}
}

func TestBuildHybridQueryBodyRequiresExplicitTopK(t *testing.T) {
	_, err := BuildHybridQueryBody(QueryRequest{
		DenseEmbedding: []float64{0.1},
		ServingConfig:  validServingConfigForQueryTest(),
		QueryText:      "学生请假手续",
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "public",
		},
	})
	if err == nil {
		t.Fatal("missing target top_k must fail")
	}
}

func TestBuildQdrantFilterRequiresCurrentRelease(t *testing.T) {
	filter, err := BuildQdrantFilter(QueryRequest{
		ServingConfig: validServingConfigForQueryTest(),
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "public",
		},
	})
	if err != nil {
		t.Fatalf("build current filter: %v", err)
	}
	must := qdrantMustConditionsFromFilterForQueryTest(t, filter)
	assertQdrantMatchValueForQueryTest(t, must, "is_current", true)
}

func TestBuildQdrantFilterUsesRestrictedCampusAccess(t *testing.T) {
	profile := validServingConfigForQueryTest()
	profile.Collection = "institutional_rules"
	profile.ServingVisibilityLevels = []string{"restricted"}
	profile.ServingVisibilityScopes = []string{"campus"}
	filter, err := BuildQdrantFilter(QueryRequest{
		ServingConfig: profile,
		RetrievalAccess: RetrievalAccess{
			EntitlementGroups:       []string{"campus_members"},
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "restricted",
			VisibilityScope:         "campus",
		},
	})
	if err != nil {
		t.Fatalf("build restricted filter: %v", err)
	}
	must := qdrantMustConditionsFromFilterForQueryTest(t, filter)
	assertQdrantMatchValueForQueryTest(t, must, "visibility_level", "restricted")
	assertQdrantMatchValueForQueryTest(t, must, "visibility_scope", "campus")
	assertQdrantMatchAnyForQueryTest(t, must, "entitlement_groups", []string{"campus_members"})
}

func TestBuildQdrantFilterUsesVisibilityBranchesForMixedServingConfig(t *testing.T) {
	profile := validServingConfigForQueryTest()
	profile.ServingVisibilityLevels = []string{"public", "restricted"}
	profile.ServingVisibilityScopes = []string{"campus"}
	filter, err := BuildQdrantFilter(QueryRequest{
		ServingConfig: profile,
		RetrievalAccess: RetrievalAccess{
			EntitlementGroups:       []string{"campus_members"},
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "restricted",
			VisibilityScope:         "campus",
		},
	})
	if err != nil {
		t.Fatalf("build mixed visibility filter: %v", err)
	}
	rawMust, ok := filter["must"].([]map[string]any)
	if !ok {
		t.Fatalf("must = %#v", filter["must"])
	}
	var visibilityBranch map[string]any
	for _, condition := range rawMust {
		if _, ok := condition["should"]; ok {
			visibilityBranch = condition
			break
		}
	}
	should, ok := visibilityBranch["should"].([]map[string]any)
	if !ok || len(should) != 2 {
		t.Fatalf("visibility branches = %#v", visibilityBranch)
	}
}

func TestBuildQdrantFilterFailsWhenAccessNotAdmitted(t *testing.T) {
	profile := validServingConfigForQueryTest()
	profile.ServingVisibilityLevels = []string{"restricted"}
	profile.ServingVisibilityScopes = []string{"campus"}
	_, err := BuildQdrantFilter(QueryRequest{
		ServingConfig: profile,
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "public",
		},
	})
	if err == nil {
		t.Fatal("public access against restricted-only serving config must fail")
	}
}

func validServingConfigForQueryTest() ServingConfig {
	return ServingConfig{
		Collection:              "student_rules",
		Corpus:                  "regulations",
		DensePrefetchLimit:      20,
		DenseVectorName:         "dense",
		RetrievalEnabled:        true,
		ServingRevisionTracks:   []string{"current-effective", "source-faithful"},
		ServingStage:            "query_serving",
		ServingVisibilityLevels: []string{"public"},
		SparsePrefetchLimit:     20,
		SparseVectorName:        "sparse",
	}
}

func qdrantMustConditionsFromFilterForQueryTest(
	t *testing.T,
	filter map[string]any,
) map[string]map[string]any {
	t.Helper()
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

func assertQdrantMatchValueForQueryTest(
	t *testing.T,
	must map[string]map[string]any,
	key string,
	want any,
) {
	t.Helper()
	condition, ok := must[key]
	if !ok {
		t.Fatalf("missing condition %s in %#v", key, must)
	}
	match, ok := condition["match"].(map[string]any)
	if !ok || match["value"] != want {
		t.Fatalf("%s match = %#v, want value %#v", key, condition["match"], want)
	}
}

func assertQdrantMatchAnyForQueryTest(
	t *testing.T,
	must map[string]map[string]any,
	key string,
	want []string,
) {
	t.Helper()
	condition, ok := must[key]
	if !ok {
		t.Fatalf("missing condition %s in %#v", key, must)
	}
	match, ok := condition["match"].(map[string]any)
	if !ok {
		t.Fatalf("%s match = %#v", key, condition["match"])
	}
	values, ok := match["any"].([]string)
	if !ok || len(values) != len(want) {
		t.Fatalf("%s any = %#v, want %#v", key, match["any"], want)
	}
	for index := range want {
		if values[index] != want[index] {
			t.Fatalf("%s any = %#v, want %#v", key, values, want)
		}
	}
}
