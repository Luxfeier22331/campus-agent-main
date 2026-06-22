package retrievalruntime

import "testing"

func TestBuildHybridQueryBodyUsesDenseSparsePrefetchAndRRF(t *testing.T) {
	profile := RuntimeProfile{
		Collection:              "student_rules",
		Corpus:                  "regulations",
		DensePrefetchLimit:      20,
		DenseVectorName:         "dense",
		QdrantAliasName:         "student_rules_alias",
		QueryEnabledByDefault:   true,
		RetrievalEnabled:        true,
		RetrievalTopK:           8,
		RRFK:                    60,
		ServingRevisionTracks:   []string{"current-effective", "source-faithful"},
		ServingStage:            "query_serving",
		ServingVisibilityLevels: []string{"public"},
		SparsePrefetchLimit:     20,
		SparseVectorName:        "sparse",
	}
	body, err := BuildHybridQueryBody(QueryRequest{
		DenseEmbedding: []float64{0.1, 0.2, 0.3},
		Mode:           "current",
		Profile:        profile,
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

func TestBuildHybridQueryBodyAllowsProfileGatedRerankerCandidateQuery(t *testing.T) {
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
		ServingVisibilityLevels:  []string{"public"},
		SparsePrefetchLimit:      20,
		SparseVectorName:         "sparse",
	}
	body, err := BuildHybridQueryBody(QueryRequest{
		DenseEmbedding: []float64{0.1, 0.2, 0.3},
		Mode:           "current",
		Profile:        profile,
		QueryText:      "学生请假手续",
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "public",
		},
		TopK: 8,
	})
	if err != nil {
		t.Fatalf("profile-gated reranker candidate query must still build: %v", err)
	}
	if body["prefetch"] == nil {
		t.Fatalf("query body = %#v, want candidate prefetch before executor rerank", body)
	}
}

func TestBuildQdrantFilterUsesRestrictedCampusAccess(t *testing.T) {
	profile := RuntimeProfile{
		Collection:              "institutional_rules",
		Corpus:                  "regulations",
		CurrentOnly:             true,
		ServingRevisionTracks:   []string{"current-effective"},
		ServingVisibilityLevels: []string{"restricted"},
		ServingVisibilityScopes: []string{"campus"},
	}

	filter, err := BuildQdrantFilter(QueryRequest{
		Mode:    "current",
		Profile: profile,
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

func TestBuildQdrantFilterUsesVisibilityBranchesForMixedProfile(t *testing.T) {
	profile := RuntimeProfile{
		Collection:              "mixed_rules",
		Corpus:                  "regulations",
		ServingVisibilityLevels: []string{"public", "restricted"},
		ServingVisibilityScopes: []string{"campus"},
	}

	filter, err := BuildQdrantFilter(QueryRequest{
		Mode:    "current",
		Profile: profile,
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
	if visibilityBranch == nil {
		t.Fatalf("visibility branch missing in filter: %#v", filter)
	}
	should, ok := visibilityBranch["should"].([]map[string]any)
	if !ok || len(should) != 2 {
		t.Fatalf("visibility should = %#v, want public and restricted branches", visibilityBranch["should"])
	}
	publicBranch := qdrantMustConditionsFromFilterForQueryTest(t, should[0])
	assertQdrantMatchValueForQueryTest(t, publicBranch, "visibility_level", "public")
	restrictedBranch := qdrantMustConditionsFromFilterForQueryTest(t, should[1])
	assertQdrantMatchValueForQueryTest(t, restrictedBranch, "visibility_level", "restricted")
	assertQdrantMatchValueForQueryTest(t, restrictedBranch, "visibility_scope", "campus")
	assertQdrantMatchAnyForQueryTest(t, restrictedBranch, "entitlement_groups", []string{"campus_members"})
}

func TestBuildQdrantFilterFailsClosedWhenAccessNotAdmittedByProfile(t *testing.T) {
	profile := RuntimeProfile{
		Collection:              "institutional_rules",
		Corpus:                  "regulations",
		ServingVisibilityLevels: []string{"restricted"},
		ServingVisibilityScopes: []string{"campus"},
	}

	_, err := BuildQdrantFilter(QueryRequest{
		Mode:    "current",
		Profile: profile,
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "public",
		},
	})
	if err == nil {
		t.Fatal("public access against restricted-only profile must fail closed")
	}
}

func TestBuildHybridQueryBodyAsOfRequiresResolvedVersionID(t *testing.T) {
	body, err := BuildHybridQueryBody(QueryRequest{
		DenseEmbedding: []float64{0.1, 0.2, 0.3},
		Mode:           "as_of",
		Profile:        validRuntimeProfileForQueryTest(),
		QueryText:      "2025年请假规则",
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "public",
		},
		TopK:      3,
		VersionID: "student_rules:v2025",
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
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "public",
		},
		TopK: 3,
	})
	if err == nil {
		t.Fatal("as_of without resolved version id must fail closed")
	}
}

func validRuntimeProfileForQueryTest() RuntimeProfile {
	return RuntimeProfile{
		Collection:              "student_rules",
		Corpus:                  "regulations",
		DensePrefetchLimit:      20,
		DenseVectorName:         "dense",
		QdrantAliasName:         "student_rules",
		QueryEnabledByDefault:   true,
		RetrievalEnabled:        true,
		RetrievalTopK:           8,
		ServingStage:            "query_serving",
		ServingVisibilityLevels: []string{"public"},
		SparsePrefetchLimit:     20,
		SparseVectorName:        "sparse",
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

func qdrantMustConditionsFromFilterForQueryTest(t *testing.T, filter map[string]any) map[string]map[string]any {
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
