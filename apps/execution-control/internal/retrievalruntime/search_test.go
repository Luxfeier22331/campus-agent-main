package retrievalruntime

import (
	"strings"
	"testing"
)

func TestValidateSearchRequestRejectsMissingRunContext(t *testing.T) {
	request := validSearchRequest()
	request.InvocationID = ""
	if err := ValidateSearchRequest(request); err == nil {
		t.Fatal("missing invocation_id must fail")
	}
}

func TestValidateSearchRequestRequiresPositiveSearchOrdinal(t *testing.T) {
	request := validSearchRequest()
	request.SearchOrdinal = 0
	if err := ValidateSearchRequest(request); err == nil {
		t.Fatal("missing search_ordinal must fail")
	}
}

func TestFinalizeSearchResultProjectsTargetEvidence(t *testing.T) {
	result, err := FinalizeSearchResult(SearchResult{
		RunID:           "run-search",
		InvocationID:    "call-search-1",
		SearchOrdinal:   2,
		RetrievalTarget: "curriculum",
		CandidateCount:  2,
		DiscardedCount:  1,
		RetrieverModes:  []string{"dense", "sparse"},
		Evidence: []Evidence{
			{
				EvidenceRef:     "evidence://run-search/1",
				RetrievalTarget: "curriculum",
				DocumentID:      "curriculum-2024",
				ChunkID:         "graduation-credits",
				Title:           "计算机科学与技术专业培养方案",
				Snippet:         "毕业最低学分为 160 学分。",
				CanonicalURL:    "https://example.edu/curriculum/2024",
				VersionID:       "2024",
				Rank:            1,
				FusionScore:     0.9,
			},
		},
	})
	if err != nil {
		t.Fatalf("finalize search result: %v", err)
	}
	if result.Outcome != "found" ||
		result.SearchRef != "projection://runs/run-search/knowledge/search/2" ||
		result.CandidateCount != 2 || result.DiscardedCount != 1 {
		t.Fatalf("result = %#v", result)
	}
}

func TestFinalizeSearchResultRejectsEvidenceTargetDrift(t *testing.T) {
	result := SearchResult{
		RunID:           "run-search",
		InvocationID:    "call-search-1",
		SearchOrdinal:   1,
		RetrievalTarget: "curriculum",
		Evidence: []Evidence{{
			EvidenceRef:     "evidence://run-search/1",
			RetrievalTarget: "student_rules",
			DocumentID:      "doc",
			ChunkID:         "chunk",
			Title:           "标题",
			Snippet:         "内容",
			CanonicalURL:    "https://example.edu/doc",
			Rank:            1,
		}},
	}
	if _, err := FinalizeSearchResult(result); err == nil {
		t.Fatal("evidence target drift must fail")
	}
}

func TestTruncateUTF8BytesPreservesRuneBoundary(t *testing.T) {
	value := strings.Repeat("培养方案", 100)
	truncated, err := TruncateUTF8Bytes(value, MaxEvidenceSnippet)
	if err != nil {
		t.Fatalf("truncate UTF-8: %v", err)
	}
	if len(truncated) > MaxEvidenceSnippet {
		t.Fatalf("truncated bytes = %d, want <= %d", len(truncated), MaxEvidenceSnippet)
	}
	if !strings.HasPrefix(value, truncated) || strings.ContainsRune(truncated, '\uFFFD') {
		t.Fatalf("truncated value is not a valid prefix: %q", truncated)
	}
}

func TestTruncateUTF8BytesRejectsInvalidUTF8(t *testing.T) {
	if _, err := TruncateUTF8Bytes(string([]byte{0xff}), MaxEvidenceSnippet); err == nil {
		t.Fatal("invalid UTF-8 must fail")
	}
}

func validSearchRequest() SearchRequest {
	return SearchRequest{
		RunID:             "run-search",
		RequestID:         "req-search",
		TraceID:           "trace-search",
		InvocationID:      "call-search-1",
		SearchOrdinal:     1,
		QueryText:         "毕业学分要求",
		Target:            "curriculum",
		ServingConfigPath: "curriculum/curriculum_plan/serving-config.json",
		TopK:              8,
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "retrieval-access-v1",
			VisibilityLevel:         "public",
		},
	}
}
