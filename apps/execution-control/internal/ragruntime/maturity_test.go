package ragruntime

import (
	"strings"
	"testing"
)

func TestResolveVersionQueryAsOfRequiresSingleMatchingVersion(t *testing.T) {
	resolved, err := ResolveVersionQuery(PlanProjection{
		Collection: "student_rules",
		Corpus:     "regulations",
		QueryMode:  "as_of",
		VersionQuery: &VersionQueryProjection{
			Mode: "as_of",
			AsOf: "2025-09-01T00:00:00Z",
		},
	}, []VersionRecord{
		{
			Collection:    "student_rules",
			Corpus:        "regulations",
			EffectiveFrom: "2024-09-01T00:00:00Z",
			EffectiveTo:   "2025-12-31T23:59:59Z",
			IsCurrent:     false,
			VersionID:     "student_rules:v2024",
			Visibility:    "public",
		},
	})
	if err != nil {
		t.Fatalf("resolve as_of: %v", err)
	}
	if resolved.Mode != "as_of" || resolved.VersionID != "student_rules:v2024" {
		t.Fatalf("resolved = %#v, want as_of student_rules:v2024", resolved)
	}
}

func TestResolveVersionQueryAsOfFailsClosedWhenAmbiguous(t *testing.T) {
	_, err := ResolveVersionQuery(PlanProjection{
		Collection: "student_rules",
		Corpus:     "regulations",
		QueryMode:  "as_of",
		VersionQuery: &VersionQueryProjection{
			Mode: "as_of",
			AsOf: "2025-09-01T00:00:00Z",
		},
	}, []VersionRecord{
		{
			Collection:    "student_rules",
			Corpus:        "regulations",
			EffectiveFrom: "2024-09-01T00:00:00Z",
			EffectiveTo:   "2025-12-31T23:59:59Z",
			VersionID:     "student_rules:v2024",
			Visibility:    "public",
		},
		{
			Collection:    "student_rules",
			Corpus:        "regulations",
			EffectiveFrom: "2025-01-01T00:00:00Z",
			EffectiveTo:   "2025-12-31T23:59:59Z",
			VersionID:     "student_rules:v2025-overlap",
			Visibility:    "public",
		},
	})
	if err == nil {
		t.Fatal("ambiguous as_of version resolution must fail closed")
	}
	if !strings.Contains(err.Error(), "ambiguous") {
		t.Fatalf("error = %v, want ambiguous diagnostic", err)
	}
}

func TestResolveVersionQueryCurrentDoesNotRequireSingleCollectionVersion(t *testing.T) {
	resolved, err := ResolveVersionQuery(PlanProjection{
		Collection: "student_rules",
		Corpus:     "regulations",
		QueryMode:  "current",
	}, []VersionRecord{
		{
			Collection: "student_rules",
			Corpus:     "regulations",
			IsCurrent:  true,
			VersionID:  "doc-a:v-current",
			Visibility: "public",
		},
		{
			Collection: "student_rules",
			Corpus:     "regulations",
			IsCurrent:  true,
			VersionID:  "doc-b:v-current",
			Visibility: "public",
		},
	})
	if err != nil {
		t.Fatalf("resolve current with multiple current document versions: %v", err)
	}
	if resolved.Mode != "current" {
		t.Fatalf("resolved mode = %q, want current", resolved.Mode)
	}
	if resolved.VersionID != "" || len(resolved.TargetVersionIDs) != 0 {
		t.Fatalf("current resolution must not bind one collection-level version: %#v", resolved)
	}
}

func TestSelectSupportingEvidenceRequiresCanonicalReference(t *testing.T) {
	_, err := SelectSupportingEvidence(EvidenceSelectionRequest{
		Lookup: RetrievalLookupResult{
			CandidateCount: 1,
			Candidates: []EvidenceRef{{
				ChunkID:         "chunk-1",
				Excerpt:         "学生应当按照学校规定办理请假手续。",
				IsAnswerBearing: true,
				Score:           0.91,
				SourceID:        "doc-1",
				SourceRef:       "source://doc-1",
				SpanRef:         "span://doc-1/chunk-1",
				Title:           "学生手册",
			}},
			SchemaVersion: "retrieval_lookup_result_v1",
		},
		Plan: PlanProjection{
			Collection: "student_rules",
			Corpus:     "regulations",
			QueryMode:  "current",
		},
		RunID: "run-missing-reference",
	})
	if err == nil {
		t.Fatal("supporting evidence without canonical reference must fail closed")
	}
	if !strings.Contains(err.Error(), "canonical reference") {
		t.Fatalf("error = %v, want canonical reference diagnostic", err)
	}
}

func TestSelectSupportingEvidenceAsOfRequiresResolvedVersionCoverage(t *testing.T) {
	_, err := SelectSupportingEvidence(EvidenceSelectionRequest{
		Lookup: RetrievalLookupResult{
			CandidateCount: 1,
			Candidates: []EvidenceRef{{
				Anchor:          "article-1",
				ChunkID:         "chunk-wrong-version",
				DocumentID:      "doc-1",
				Excerpt:         "旧版规定。",
				IsAnswerBearing: true,
				RootUnitID:      "root-1",
				Score:           0.91,
				SourceID:        "doc-1",
				SourceRef:       "https://docs.example.edu/doc-1#article-1",
				SpanRef:         "span://doc-1/chunk-wrong-version",
				Title:           "学生手册",
				VersionID:       "v1",
			}},
			SchemaVersion: "retrieval_lookup_result_v1",
		},
		Plan: PlanProjection{
			Collection: "student_rules",
			Corpus:     "regulations",
			QueryMode:  "as_of",
			VersionQuery: &VersionQueryProjection{
				Mode: "as_of",
				AsOf: "2025-09-01T00:00:00Z",
			},
			ResolvedVersionQuery: &ResolvedVersionQueryProjection{
				AsOf:             "2025-09-01T00:00:00Z",
				Mode:             "as_of",
				TargetVersionIDs: []string{"v2"},
				VersionID:        "v2",
			},
		},
		RunID: "run-as-of-wrong-version",
	})
	if err == nil {
		t.Fatal("as_of evidence outside resolved version must fail closed")
	}
	if !strings.Contains(err.Error(), "version v2") {
		t.Fatalf("error = %v, want resolved version diagnostic", err)
	}
}

func TestSelectSupportingEvidenceCompareRequiresBothVersions(t *testing.T) {
	_, err := SelectSupportingEvidence(EvidenceSelectionRequest{
		Lookup: RetrievalLookupResult{
			CandidateCount: 1,
			Candidates: []EvidenceRef{{
				Anchor:          "article-1",
				ChunkID:         "chunk-left",
				DocumentID:      "doc-1",
				Excerpt:         "旧版规定。",
				IsAnswerBearing: true,
				RootUnitID:      "root-left",
				Score:           0.91,
				SourceID:        "doc-1",
				SourceRef:       "https://docs.example.edu/doc-1#article-1",
				SpanRef:         "span://doc-1/chunk-left",
				Title:           "学生手册",
				VersionID:       "v1",
			}},
			SchemaVersion: "retrieval_lookup_result_v1",
		},
		Plan: PlanProjection{
			Collection: "student_rules",
			Corpus:     "regulations",
			QueryMode:  "compare",
			VersionQuery: &VersionQueryProjection{
				Mode:               "compare",
				VersionID:          "v1",
				CompareToVersionID: "v2",
			},
		},
		RunID: "run-compare-one-sided",
	})
	if err == nil {
		t.Fatal("compare evidence without both version sides must fail closed")
	}
	if !strings.Contains(err.Error(), "compare") {
		t.Fatalf("error = %v, want compare diagnostic", err)
	}
}
