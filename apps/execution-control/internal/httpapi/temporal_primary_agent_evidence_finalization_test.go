package httpapi

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestPrimaryAgentEvidenceClosureBuildsSourcesFromRunSearches(t *testing.T) {
	run := runWithKnowledgeSearchForFinalizationTest("found", []map[string]any{
		knowledgeEvidenceForFinalizationTest("evidence://sha256/curriculum-1"),
	})
	agentResult := map[string]any{"selected_tools": []string{"knowledge_search"}}
	envelope := map[string]any{
		"kind":           "answer",
		"answer_text":    "该培养方案要求完成 160 学分。",
		"evidence_refs":  []string{"evidence://sha256/curriculum-1"},
		"resolved_scope": "curriculum",
		"session_update": map[string]any{
			"upsert_slots": []any{map[string]any{
				"confirmed": true,
				"name":      "curriculum_program",
				"value":     "计算机科学与技术",
			}},
		},
	}

	closure, err := primaryAgentEvidenceClosureForFinalization(run, agentResult, envelope)
	if err != nil {
		t.Fatalf("evidence closure: %v", err)
	}
	if closure.ResolvedScope != "curriculum" || len(closure.Sources) != 1 {
		t.Fatalf("closure = %#v", closure)
	}
	if closure.Sources[0]["title"] != "计算机科学与技术专业培养方案" ||
		closure.Sources[0]["canonical_url"] != "https://www.muc.edu.cn/curriculum/2024" {
		t.Fatalf("sources = %#v", closure.Sources)
	}
	if closure.SessionUpdate == nil || len(closure.SessionUpdate.UpsertSlots) != 1 {
		t.Fatalf("session update = %#v", closure.SessionUpdate)
	}
}

func TestPrimaryAgentEvidenceClosureRejectsForgedEvidenceReference(t *testing.T) {
	run := runWithKnowledgeSearchForFinalizationTest("found", []map[string]any{
		knowledgeEvidenceForFinalizationTest("evidence://sha256/curriculum-1"),
	})
	_, err := primaryAgentEvidenceClosureForFinalization(
		run,
		map[string]any{"selected_tools": []string{"knowledge_search"}},
		map[string]any{
			"kind":           "answer",
			"answer_text":    "该培养方案要求完成 160 学分。",
			"evidence_refs":  []string{"evidence://sha256/forged"},
			"resolved_scope": "curriculum",
		},
	)
	if err == nil || !strings.Contains(err.Error(), "not produced by this run") {
		t.Fatalf("error = %v", err)
	}
}

func TestPrimaryAgentEvidenceClosureRejectsKnowledgeAnswerWithoutSearch(t *testing.T) {
	_, err := primaryAgentEvidenceClosureForFinalization(
		execution.DurableRun{Metadata: map[string]any{}},
		map[string]any{"selected_tools": []string{"knowledge_search"}},
		map[string]any{
			"kind":           "answer",
			"answer_text":    "未检索也不应回答。",
			"evidence_refs":  []string{"evidence://sha256/missing"},
			"resolved_scope": "curriculum",
		},
	)
	if err == nil || !strings.Contains(err.Error(), "requires at least one knowledge search") {
		t.Fatalf("error = %v", err)
	}
}

func TestPrimaryAgentEvidenceClosureRejectsResolvedScopeDrift(t *testing.T) {
	run := runWithKnowledgeSearchForFinalizationTest("found", []map[string]any{
		knowledgeEvidenceForFinalizationTest("evidence://sha256/curriculum-1"),
	})
	_, err := primaryAgentEvidenceClosureForFinalization(
		run,
		map[string]any{"selected_tools": []string{"knowledge_search"}},
		map[string]any{
			"kind":           "answer",
			"answer_text":    "scope 不应漂移。",
			"evidence_refs":  []string{"evidence://sha256/curriculum-1"},
			"resolved_scope": "student_rules",
		},
	)
	if err == nil || !strings.Contains(err.Error(), "resolved_scope") {
		t.Fatalf("error = %v", err)
	}
}

func TestPrimaryAgentEvidenceClosureRejectsUnsupportedOutcomeWithEvidence(t *testing.T) {
	run := runWithKnowledgeSearchForFinalizationTest("found", []map[string]any{
		knowledgeEvidenceForFinalizationTest("evidence://sha256/curriculum-1"),
	})
	_, err := primaryAgentEvidenceClosureForFinalization(
		run,
		map[string]any{"selected_tools": []string{"knowledge_search"}},
		map[string]any{
			"kind":           "unsupported_by_evidence",
			"answer_text":    "当前证据不足。",
			"reason":         "no_evidence",
			"evidence_refs":  []string{},
			"resolved_scope": "curriculum",
		},
	)
	if err == nil || !strings.Contains(err.Error(), "requires searches with no evidence") {
		t.Fatalf("error = %v", err)
	}
}

func TestPrimaryAgentEvidenceClosureRejectsInternalLocatorInAnswer(t *testing.T) {
	run := runWithKnowledgeSearchForFinalizationTest("no_evidence", []map[string]any{})
	_, err := primaryAgentEvidenceClosureForFinalization(
		run,
		map[string]any{"selected_tools": []string{"knowledge_search"}},
		map[string]any{
			"kind":           "unsupported_by_evidence",
			"answer_text":    "请查看 projection://runs/private/result。",
			"reason":         "no_evidence",
			"evidence_refs":  []string{},
			"resolved_scope": "curriculum",
		},
	)
	if err == nil || !strings.Contains(err.Error(), "internal locator") {
		t.Fatalf("error = %v", err)
	}
}

func TestPrimaryAgentEvidenceClosureAllowsDirectAnswerWithoutSearch(t *testing.T) {
	closure, err := primaryAgentEvidenceClosureForFinalization(
		execution.DurableRun{Metadata: map[string]any{}},
		map[string]any{"selected_tools": []string{}},
		map[string]any{"kind": "answer", "answer_text": "你好。"},
	)
	if err != nil {
		t.Fatalf("direct answer closure: %v", err)
	}
	if closure.ResolvedScope != "" || len(closure.Sources) != 0 || closure.SessionUpdate != nil {
		t.Fatalf("closure = %#v", closure)
	}
}

func runWithKnowledgeSearchForFinalizationTest(
	outcome string,
	evidence []map[string]any,
) execution.DurableRun {
	return execution.DurableRun{Metadata: map[string]any{
		"knowledge_searches": map[string]any{
			"call-search-1": map[string]any{
				"query_sha256": "sha256:test",
				"result": map[string]any{
					"outcome":          outcome,
					"search_ref":       "projection://runs/run-knowledge/knowledge/search/call-search-1",
					"resolved_scope":   "curriculum",
					"resolved_version": map[string]any{"mode": "current"},
					"evidence":         evidence,
				},
			},
		},
	}}
}

func knowledgeEvidenceForFinalizationTest(evidenceRef string) map[string]any {
	return map[string]any{
		"evidence_ref":  evidenceRef,
		"title":         "计算机科学与技术专业培养方案",
		"snippet":       "毕业最低学分为 160 学分。",
		"canonical_url": "https://www.muc.edu.cn/curriculum/2024",
		"version_id":    "2024",
	}
}
