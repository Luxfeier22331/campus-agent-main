package httpapi

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func repeatedHex(value string, count int) string {
	result := ""
	for len(result) < count {
		result += value
	}
	return result[:count]
}

func TestValidateCampusDocsRetrievalResultRepresentsEmptyEvidenceDirectly(t *testing.T) {
	result := temporalruntime.CampusDocsRetrievalResult{
		Evidence: []temporalruntime.CampusDocsEvidence{},
	}
	if err := validateCampusDocsRetrievalResult(result); err != nil {
		t.Fatalf("valid empty retrieval result rejected: %v", err)
	}
}

func TestCampusDocsCandidateReadsPointV3WithVersionedSource(t *testing.T) {
	text := "学生应按时参加教学活动。"
	candidate, err := campusDocsCandidateFromQdrantPoint(campusDocsTargetForHTTPTest(), qdrantPoint{
		Payload: map[string]any{
			"chunk_id":              "chunk_current",
			"document_id":           "doc_attendance",
			"document_title":        "学生考勤规定",
			"retrieval_text_sha256": "sha256:" + repeatedHex("b", 64),
			"root_unit_ids":         []any{"root-paragraph", "root-list"},
			"schema_version":        "campus_docs_point.v3",
			"section_ref":           "/docs/regulations/student_rules/attendance/v/2026-current",
			"section_title":         "学生考勤规定",
			"text":                  text,
			"text_sha256":           sha256TextRef(text),
			"version_id":            "version-attendance-2026",
			"version_label":         "2026 版",
			"version_slug":          "2026-current",
		},
		Score: -0.25,
	})
	if err != nil {
		t.Fatalf("parse current point: %v", err)
	}
	if strings.Join(candidate.RootUnitIDs, ",") != "root-paragraph,root-list" {
		t.Fatalf("root_unit_ids = %#v", candidate.RootUnitIDs)
	}
	if candidate.SectionRef != "/docs/regulations/student_rules/attendance/v/2026-current" {
		t.Fatalf("section_ref = %q", candidate.SectionRef)
	}
	if candidate.VersionSlug != "2026-current" || candidate.VersionLabel != "2026 版" {
		t.Fatalf("candidate version = %#v", candidate.CampusDocsEvidence)
	}
	if candidate.score != -0.25 {
		t.Fatalf("candidate score = %v", candidate.score)
	}
}

func TestCampusDocsCandidateRejectsLegacyPointSchema(t *testing.T) {
	text := "旧分块"
	_, err := campusDocsCandidateFromQdrantPoint(campusDocsTargetForHTTPTest(), qdrantPoint{
		Payload: map[string]any{
			"chunk_id":              "chunk_legacy",
			"document_id":           "doc_legacy",
			"document_title":        "旧文档",
			"retrieval_text_sha256": "sha256:" + repeatedHex("b", 64),
			"root_unit_ids":         []any{"root-legacy"},
			"schema_version":        "campus_docs_point.v2",
			"section_ref":           "/docs/regulations/student_rules/legacy/v/2025-history#section",
			"section_title":         "旧章节",
			"text":                  text,
			"text_sha256":           sha256TextRef(text),
			"version_id":            "version-legacy-2025",
			"version_label":         "2025 版",
			"version_slug":          "2025-history",
		},
		Score: 0.5,
	})
	if err == nil || !strings.Contains(err.Error(), "does not match admitted index") {
		t.Fatalf("legacy point error = %v", err)
	}
}

func TestSelectCampusDocsEvidencePreservesRankingWithinCharacterBudget(t *testing.T) {
	target := campusDocsTargetForHTTPTest()
	ranked := []campusDocsCandidate{
		campusDocsCandidateForTest(target.Collection, "chunk-a", "section-a", strings.Repeat("甲", 1500), 4),
		campusDocsCandidateForTest(target.Collection, "chunk-a2", "section-a", strings.Repeat("乙", 100), 3.5),
		campusDocsCandidateForTest(target.Collection, "chunk-b", "section-b", strings.Repeat("丙", 1500), 3),
		campusDocsCandidateForTest(target.Collection, "chunk-c", "section-c", strings.Repeat("丁", 1500), 2),
		campusDocsCandidateForTest(target.Collection, "chunk-d", "section-d", strings.Repeat("戊", 900), 1),
		campusDocsCandidateForTest(target.Collection, "chunk-negative", "section-negative", "负分候选", -0.5),
	}

	evidence := selectCampusDocsEvidence(ranked, target, 0)
	if len(evidence) != 4 {
		t.Fatalf("evidence count = %d, want 4", len(evidence))
	}
	wantTexts := []string{ranked[0].Text, ranked[1].Text, ranked[2].Text, ranked[4].Text}
	for index, want := range wantTexts {
		if evidence[index].Text != want {
			t.Fatalf("evidence[%d] did not preserve RRF ranking", index)
		}
	}
	total := 0
	for _, item := range evidence {
		total += len([]rune(item.Text))
	}
	if total != 4000 {
		t.Fatalf("evidence characters = %d, want 4000", total)
	}
}

func TestValidateCampusDocsRetrievalResultUsesUnicodeCharacterBudget(t *testing.T) {
	result := temporalruntime.CampusDocsRetrievalResult{Evidence: []temporalruntime.CampusDocsEvidence{
		campusDocsEvidenceForTest("a", strings.Repeat("甲", 2000)),
		campusDocsEvidenceForTest("b", strings.Repeat("乙", 2000)),
	}}
	if err := validateCampusDocsRetrievalResult(result); err != nil {
		t.Fatalf("4000-character evidence rejected: %v", err)
	}
	result.Evidence[1].Text += "丙"
	if err := validateCampusDocsRetrievalResult(result); err == nil || !strings.Contains(err.Error(), "character budget") {
		t.Fatalf("over-budget evidence error = %v", err)
	}
}

func TestPublicCampusDocsSourceCarriesEveryRootUnit(t *testing.T) {
	source := publicSourceFromCampusDocsEvidence(temporalruntime.CampusDocsEvidence{
		DocumentID:    "doc_attendance",
		DocumentTitle: "学生考勤规定",
		RootUnitIDs:   []string{"root-paragraph", "root-list"},
		SectionRef:    "/docs/regulations/student_rules/attendance/v/2026-current#requirements",
		SectionTitle:  "考勤要求",
		Text:          "学生应按时参加教学活动。",
		VersionID:     "version-attendance-2026",
		VersionLabel:  "2026 版",
		VersionSlug:   "2026-current",
	})
	if _, exists := source["root_unit_id"]; exists {
		t.Fatalf("public source contains legacy root_unit_id: %#v", source)
	}
	rootUnitIDs, ok := source["root_unit_ids"].([]string)
	if !ok || strings.Join(rootUnitIDs, ",") != "root-paragraph,root-list" {
		t.Fatalf("public root_unit_ids = %#v", source["root_unit_ids"])
	}
	if source["version_slug"] != "2026-current" || source["version_label"] != "2026 版" {
		t.Fatalf("public source version = %#v", source)
	}
}

func campusDocsCandidateForTest(
	collection string,
	chunkID string,
	section string,
	text string,
	score float64,
) campusDocsCandidate {
	evidence := campusDocsEvidenceForTest(chunkID, text)
	evidence.SectionRef = "/docs/regulations/student_rules/attendance/v/2026-current#" + section
	return campusDocsCandidate{
		CampusDocsEvidence: evidence,
		collection:         collection,
		dedupKey:           chunkID,
		score:              score,
	}
}

func campusDocsEvidenceForTest(identity string, text string) temporalruntime.CampusDocsEvidence {
	return temporalruntime.CampusDocsEvidence{
		DocumentID:    "doc_attendance",
		DocumentTitle: "学生考勤规定",
		EvidenceRef:   "evidence://" + repeatedHex(identity, 64),
		RootUnitIDs:   []string{"root-" + identity},
		SectionRef:    "/docs/regulations/student_rules/attendance/v/2026-current",
		SectionTitle:  "考勤要求",
		Text:          text,
		VersionID:     "version-attendance-2026",
		VersionLabel:  "2026 版",
		VersionSlug:   "2026-current",
	}
}
