package finalization

import (
	"encoding/json"
	searchapi "github.com/MUC-WIKI/campus-agent/packages/search-api-go"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
)

// Real notice output as produced by the campus-search builder.
func contractNoticeItem() searchapi.SearchResultItem {
	return searchapi.SearchResultItem{
		SourceKind: "notice", ResultRef: "result://" + strings.Repeat("a1", 32),
		Title: "关于国庆放假的通知", Text: "放假安排以通知为准", SectionTitle: "正文",
		NoticeID: "952401", CitationHref: "/notices/952401",
		ReleasedAt: "2026-10-01T08:00:00Z",
	}
}

// Real document output as produced by the campus-search builder.
func contractDocumentItem() searchapi.SearchResultItem {
	return searchapi.SearchResultItem{
		SourceKind: "document", ResultRef: "result://" + strings.Repeat("b2", 32),
		Title: "学生守则", Text: "考勤管理要求", SectionTitle: "考勤",
		DocumentID: "handbook:student-rules", VersionID: "version-2026", VersionSlug: "2026",
		SectionRef:  "/docs/regulations/student_rules/attendance/v/2026#attendance",
		RootUnitIDs: []string{"unit-attendance"},
	}
}

func contractWebEvidence() executioncontract.WorkflowEvidence {
	return executioncontract.WorkflowEvidence{
		SchemaVersion: "workflow-evidence.v1", ID: "web-evidence-1",
		Source: executioncontract.WorkflowSourceWebSearch,
		Title:  "中央民族大学官网", Excerpt: "学校简介", URL: "https://www.muc.edu.cn/",
	}
}

func contractEvidenceFromNotice(item searchapi.SearchResultItem, index int) executioncontract.WorkflowEvidence {
	return executioncontract.WorkflowEvidence{
		SchemaVersion: "workflow-evidence.v1", ID: "notice-evidence-1",
		Source: executioncontract.WorkflowSourceCampusSearch, Title: item.Title, Excerpt: item.Text,
		CitationIndex: index, NoticeID: item.NoticeID, CitationHref: item.CitationHref,
		SectionTitle: item.SectionTitle, ReleasedAt: item.ReleasedAt,
	}
}

func contractEvidenceFromDocument(item searchapi.SearchResultItem, index int) executioncontract.WorkflowEvidence {
	return executioncontract.WorkflowEvidence{
		SchemaVersion: "workflow-evidence.v1", ID: "document-evidence-1",
		Source: executioncontract.WorkflowSourceCampusSearch, Title: item.Title, Excerpt: item.Text,
		CitationIndex: index, DocumentID: item.DocumentID, SectionRef: item.SectionRef,
		SectionTitle: item.SectionTitle, RootUnitIDs: item.RootUnitIDs,
		VersionID: item.VersionID, VersionSlug: item.VersionSlug,
	}
}

func finalizedRecoveryResponse(t *testing.T, workflowResult map[string]any) (map[string]any, recoveryResponse) {
	t.Helper()
	adapter := &FinalizationService{Writer: &activityprojection.Writer{RunProjectionStore: executionpersistence.NewInMemoryRunProjectionStore()}}
	response, err := adapter.WorkflowFinalizedResponse(t.Context(), execution.DurableRun{RequestID: "contract"}, workflowResult)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateRecoveryResponseFields(encoded); err != nil {
		t.Fatalf("recovery validation rejected finalized response: %v", err)
	}
	var restored recoveryResponse
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	return response, restored
}

func TestDirectAnswerCampusSourcesSurviveRecovery(t *testing.T) {
	notice := contractNoticeItem()
	document := contractDocumentItem()
	_, restored := finalizedRecoveryResponse(t, map[string]any{
		"final_output": "放假安排[1]，考勤要求[2]",
		"tool_results": []map[string]any{
			citationToolResult([]searchapi.SearchResultItem{notice, document}, 1),
		},
	})
	if len(restored.Result.Sources) != 2 {
		t.Fatalf("sources = %#v", restored.Result.Sources)
	}
	noticeSource := restored.Result.Sources[0]
	if noticeSource.Kind != "campus_notice" || noticeSource.NoticeID != notice.NoticeID ||
		noticeSource.CitationHref != notice.CitationHref || noticeSource.SectionTitle != notice.SectionTitle ||
		noticeSource.ReleasedAt != notice.ReleasedAt || noticeSource.CitationIndex != 1 {
		t.Fatalf("notice source = %#v", noticeSource)
	}
	documentSource := restored.Result.Sources[1]
	if documentSource.Kind != "campus_document" || documentSource.DocumentID != document.DocumentID ||
		documentSource.SectionRef != document.SectionRef || documentSource.CitationHref != document.SectionRef ||
		documentSource.VersionID != document.VersionID || documentSource.VersionSlug != document.VersionSlug ||
		len(documentSource.RootUnitIDs) != 1 || documentSource.RootUnitIDs[0] != "unit-attendance" ||
		documentSource.CitationIndex != 2 {
		t.Fatalf("document source = %#v", documentSource)
	}
}

func TestSynthesizedAnswerCampusAndWebSourcesSurviveRecovery(t *testing.T) {
	notice := contractNoticeItem()
	document := contractDocumentItem()
	web := contractWebEvidence()
	evidence := []executioncontract.WorkflowEvidence{
		contractEvidenceFromNotice(notice, 1),
		contractEvidenceFromDocument(document, 2),
		func() executioncontract.WorkflowEvidence { web.CitationIndex = 3; return web }(),
	}
	_, restored := finalizedRecoveryResponse(t, map[string]any{
		"operation":    string(executioncontract.WorkflowOperationSynthesize),
		"final_output": "放假[1]，考勤[2]，官网[3]",
		"evidence":     evidence,
	})
	if len(restored.Result.Sources) != 3 {
		t.Fatalf("sources = %#v", restored.Result.Sources)
	}
	if s := restored.Result.Sources[0]; s.Kind != "campus_notice" || s.NoticeID != notice.NoticeID ||
		s.ReleasedAt != notice.ReleasedAt || s.CitationHref != notice.CitationHref || s.CitationIndex != 1 {
		t.Fatalf("notice source = %#v", s)
	}
	if s := restored.Result.Sources[1]; s.Kind != "campus_document" || s.DocumentID != document.DocumentID ||
		s.SectionRef != document.SectionRef || s.VersionSlug != document.VersionSlug ||
		len(s.RootUnitIDs) != 1 || s.CitationIndex != 2 {
		t.Fatalf("document source = %#v", s)
	}
	if s := restored.Result.Sources[2]; s.Kind != "web_page" || s.URL != "https://www.muc.edu.cn/" ||
		s.Hostname != "www.muc.edu.cn" || s.CitationHref != "https://www.muc.edu.cn/" || s.CitationIndex != 3 {
		t.Fatalf("web source = %#v", s)
	}
}

func TestUnavailableWebSourceKeepsSemanticsThroughRecovery(t *testing.T) {
	unavailable := contractWebEvidence()
	unavailable.SourceLink = &executioncontract.SourceLink{}
	unavailable.CitationIndex = 1
	_, restored := finalizedRecoveryResponse(t, map[string]any{
		"operation":    string(executioncontract.WorkflowOperationSynthesize),
		"final_output": "官网未说明[1]",
		"evidence":     []executioncontract.WorkflowEvidence{unavailable},
	})
	if len(restored.Result.Sources) != 1 {
		t.Fatalf("sources = %#v", restored.Result.Sources)
	}
	if s := restored.Result.Sources[0]; s.Kind != "web_page" || s.UnavailableReason != "source_unavailable" {
		t.Fatalf("unavailable source = %#v", s)
	}
}

func TestRecoveryRejectsUnknownFieldsOnEverySourceKind(t *testing.T) {
	notice := contractNoticeItem()
	response, _ := finalizedRecoveryResponse(t, map[string]any{
		"final_output": "放假安排[1]",
		"tool_results": []map[string]any{
			citationToolResult([]searchapi.SearchResultItem{notice}, 1),
		},
	})
	sources := WorkflowToolResultMaps(response["result"].(map[string]any)["sources"])
	sources[0]["unexpected_field"] = true
	response["result"].(map[string]any)["sources"] = sources
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateRecoveryResponseFields(encoded); err == nil || !strings.Contains(err.Error(), "unexpected_field") {
		t.Fatalf("unknown field error = %v", err)
	}
}

func TestSynthesisRejectsInvalidCitationsBeforeRecovery(t *testing.T) {
	notice := contractNoticeItem()
	valid := contractEvidenceFromNotice(notice, 1)
	for _, tc := range []struct {
		name     string
		evidence []executioncontract.WorkflowEvidence
		answer   string
	}{
		{"missing evidence", []executioncontract.WorkflowEvidence{valid}, "放假[1]，考勤[2]"},
		{
			"duplicate citation index",
			[]executioncontract.WorkflowEvidence{valid, func() executioncontract.WorkflowEvidence {
				dupe := contractEvidenceFromDocument(contractDocumentItem(), 1)
				dupe.ID = "document-evidence-2"
				return dupe
			}()},
			"放假[1]，考勤[1]",
		},
		{
			"invalid notice identity",
			[]executioncontract.WorkflowEvidence{func() executioncontract.WorkflowEvidence {
				broken := valid
				broken.CitationHref = "/notices/999999"
				return broken
			}()},
			"放假[1]",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			adapter := &FinalizationService{Writer: &activityprojection.Writer{RunProjectionStore: executionpersistence.NewInMemoryRunProjectionStore()}}
			_, err := adapter.WorkflowFinalizedResponse(t.Context(), execution.DurableRun{RequestID: "contract-negative"}, map[string]any{
				"operation":    string(executioncontract.WorkflowOperationSynthesize),
				"final_output": tc.answer,
				"evidence":     tc.evidence,
			})
			if err == nil {
				t.Fatal("accepted invalid citation chain")
			}
		})
	}
}
