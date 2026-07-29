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

func TestFinalizeSearchResultProjectsDocumentSectionEvidence(t *testing.T) {
	result, err := FinalizeSearchResult(SearchResult{
		RunID:          "run-search",
		InvocationID:   "call-search-1",
		SearchOrdinal:  2,
		DocumentScope:  "curriculum",
		CandidateCount: 2,
		DiscardedCount: 1,
		RetrieverModes: []string{"dense", "sparse"},
		Evidence: []Evidence{
			{
				EvidenceRef:   "evidence://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				SectionRef:    "section://curriculum/curriculum-2024/2024/graduation-credits",
				DocumentScope: "curriculum",
				DocumentID:    "curriculum-2024",
				VersionID:     "2024",
				Anchor:        "graduation-credits",
				DocumentTitle: "计算机科学与技术专业培养方案",
				SectionTitle:  "毕业学分要求",
				Content:       "毕业最低学分为 160 学分。",
				ContentSHA256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				CanonicalURL:  "https://example.edu/curriculum/2024#graduation-credits",
			},
		},
	})
	if err != nil {
		t.Fatalf("finalize search result: %v", err)
	}
	if result.Outcome != "found" ||
		result.SearchRef != "projection://runs/run-search/knowledge/evidence/2" ||
		result.CandidateCount != 2 || result.DiscardedCount != 1 {
		t.Fatalf("result = %#v", result)
	}
}

func TestFinalizeSearchResultRejectsEvidenceScopeDrift(t *testing.T) {
	result := SearchResult{
		RunID:         "run-search",
		InvocationID:  "call-search-1",
		SearchOrdinal: 1,
		DocumentScope: "curriculum",
		Evidence: []Evidence{{
			EvidenceRef:   "evidence://sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			SectionRef:    "section://student_rules/doc/v1/chunk",
			DocumentScope: "student_rules",
			DocumentID:    "doc",
			VersionID:     "v1",
			Anchor:        "chunk",
			DocumentTitle: "标题",
			SectionTitle:  "章节",
			Content:       "内容",
			ContentSHA256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			CanonicalURL:  "https://example.edu/doc#chunk",
		}},
	}
	if _, err := FinalizeSearchResult(result); err == nil {
		t.Fatal("evidence target drift must fail")
	}
}

func TestTruncateUTF8BytesPreservesRuneBoundary(t *testing.T) {
	value := strings.Repeat("培养方案", 100)
	const maxBytes = 17
	truncated, err := TruncateUTF8Bytes(value, maxBytes)
	if err != nil {
		t.Fatalf("truncate UTF-8: %v", err)
	}
	if len(truncated) > maxBytes {
		t.Fatalf("truncated bytes = %d, want <= %d", len(truncated), maxBytes)
	}
	if !strings.HasPrefix(value, truncated) || strings.ContainsRune(truncated, '\uFFFD') {
		t.Fatalf("truncated value is not a valid prefix: %q", truncated)
	}
}

func TestTruncateUTF8BytesRejectsInvalidUTF8(t *testing.T) {
	if _, err := TruncateUTF8Bytes(string([]byte{0xff}), MaxEvidenceContent); err == nil {
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
		DocumentScope:     "curriculum",
		ServingConfigPath: "curriculum/curriculum_plan/serving-config.json",
		CandidateTopK:     8,
		RetrievalAccess: RetrievalAccess{
			PolicyProjectionVersion: "retrieval-access-v1",
			VisibilityLevel:         "public",
		},
	}
}
