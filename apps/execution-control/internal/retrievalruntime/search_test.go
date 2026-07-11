package retrievalruntime

import "testing"

func TestValidateSearchRequestRejectsMissingRunContext(t *testing.T) {
	request := validSearchRequest()
	request.InvocationID = ""
	if err := ValidateSearchRequest(request); err == nil {
		t.Fatal("missing invocation_id must fail")
	}
}

func TestResolveSearchVersionAsOfRequiresOneVisibleVersion(t *testing.T) {
	request := validSearchRequest()
	request.VersionQuery = VersionQuery{Mode: "as_of", AsOf: "2025-03-01"}
	resolved, err := ResolveSearchVersion(request, []VersionRecord{
		{
			Corpus:        "curriculum",
			Collection:    "curriculum_plan",
			EffectiveFrom: "2024-09-01",
			EffectiveTo:   "2025-08-31",
			VersionID:     "2024",
			Visibility:    "public",
		},
	})
	if err != nil {
		t.Fatalf("resolve as_of version: %v", err)
	}
	if resolved.Mode != "as_of" || resolved.VersionID != "2024" || resolved.AsOf != "2025-03-01" {
		t.Fatalf("resolved = %#v", resolved)
	}
}

func TestFinalizeSearchResultKeepsOnlyPublicSafeEvidence(t *testing.T) {
	result, err := FinalizeSearchResult(SearchResult{
		RunID:           "run-search",
		InvocationID:    "call-search-1",
		ResolvedScope:   "curriculum",
		ResolvedVersion: ResolvedVersion{Mode: "current"},
		Evidence: []Evidence{
			{
				EvidenceRef:  "evidence://run-search/1",
				Title:        "计算机科学与技术专业培养方案",
				Snippet:      "毕业最低学分为 160 学分。",
				CanonicalURL: "https://example.edu/curriculum/2024",
				VersionID:    "2024",
			},
		},
	})
	if err != nil {
		t.Fatalf("finalize search result: %v", err)
	}
	if result.Outcome != "found" || result.SearchRef == "" {
		t.Fatalf("result = %#v", result)
	}
}

func validSearchRequest() SearchRequest {
	return SearchRequest{
		RunID:        "run-search",
		RequestID:    "req-search",
		TraceID:      "trace-search",
		InvocationID: "call-search-1",
		QueryText:    "毕业学分要求",
		Scope:        "curriculum",
		Corpus:       "curriculum",
		Collection:   "curriculum_plan",
		TopK:         8,
		VersionQuery: VersionQuery{Mode: "current"},
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "retrieval-access-v1",
			VisibilityLevel:         "public",
		},
	}
}
