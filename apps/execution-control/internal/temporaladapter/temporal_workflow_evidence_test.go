package temporaladapter

import (
	"errors"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestWorkflowEvidenceCitationClosureProjectsMixedCampusSources(t *testing.T) {
	closure, err := workflowEvidenceCitationClosureForFinalization(
		[]temporalruntime.WorkflowEvidence{
			{
				CitationIndex: 1,
				DocumentID:    "handbook:student-rules",
				Excerpt:       "学生应当按规定提交材料。",
				ID:            "campus:result://document-1",
				RootUnitIDs:   []string{"unit-attendance"},
				SchemaVersion: "workflow_evidence.v1",
				SectionRef:    "/docs/regulations/student_rules/attendance/v/2026#attendance",
				SectionTitle:  "申请条件",
				Source:        temporalruntime.WorkflowSourceCampusSearch,
				Title:         "学生管理规定",
				VersionID:     "version-2026",
				VersionSlug:   "2026",
			},
			{
				CitationHref:  "/notices/12345",
				CitationIndex: 2,
				Excerpt:       "请在规定时间内完成报名。",
				ID:            "campus:result://notice-1",
				NoticeID:      "12345",
				SchemaVersion: "workflow_evidence.v1",
				SectionTitle:  "报名要求",
				Source:        temporalruntime.WorkflowSourceCampusSearch,
				Title:         "关于报名的通知",
			},
		},
		"通知要求见 [2]，制度依据见 [1]。",
	)
	if err != nil {
		t.Fatalf("close mixed campus evidence: %v", err)
	}
	if closure.AnswerText != "通知要求见 [2](/notices/12345)，制度依据见 [1](/docs/regulations/student_rules/attendance/v/2026#attendance)。" {
		t.Fatalf("answer = %q", closure.AnswerText)
	}
	if len(closure.Sources) != 2 ||
		closure.Sources[0]["kind"] != "campus_notice" ||
		closure.Sources[0]["notice_id"] != "12345" ||
		closure.Sources[0]["section_title"] != "报名要求" ||
		closure.Sources[1]["kind"] != "campus_document" {
		t.Fatalf("sources = %#v", closure.Sources)
	}
	rootUnitIDs, ok := closure.Sources[1]["root_unit_ids"].([]string)
	if !ok || len(rootUnitIDs) != 1 || rootUnitIDs[0] != "unit-attendance" {
		t.Fatalf("document root_unit_ids = %#v", closure.Sources[1]["root_unit_ids"])
	}
}

func TestWorkflowEvidenceCitationClosureRejectsMismatchedNoticeIdentity(t *testing.T) {
	_, err := workflowEvidenceCitationClosureForFinalization(
		[]temporalruntime.WorkflowEvidence{{
			CitationHref:  "/notices/54321",
			CitationIndex: 1,
			Excerpt:       "正文",
			ID:            "campus:result://notice-1",
			NoticeID:      "12345",
			SchemaVersion: "workflow_evidence.v1",
			SectionTitle:  "正文",
			Source:        temporalruntime.WorkflowSourceCampusSearch,
			Title:         "通知",
		}},
		"通知内容 [1]。",
	)
	if err == nil {
		t.Fatal("accepted mismatched notice citation identity")
	}
	var citationError *workflowCitationValidationError
	if !errors.As(err, &citationError) {
		t.Fatalf("error = %T %v, want workflow citation validation error", err, err)
	}
}
