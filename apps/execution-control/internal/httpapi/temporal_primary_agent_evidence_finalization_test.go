package httpapi

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestPrimaryAgentEvidenceClosureBuildsSourcesFromSearchSteps(t *testing.T) {
	steps := []execution.StepResultProjection{
		knowledgeSearchStepForFinalizationTest(
			1,
			"curriculum",
			"found",
			[]map[string]any{knowledgeEvidenceForFinalizationTest(
				"evidence://sha256/curriculum-1",
				"curriculum",
			)},
		),
	}
	envelope := map[string]any{
		"kind":          "answer",
		"answer_text":   "该培养方案要求完成 160 学分。",
		"evidence_refs": []string{"evidence://sha256/curriculum-1"},
		"session_update": map[string]any{
			"upsert_slots": []any{map[string]any{
				"confirmed": true,
				"name":      "curriculum_program",
				"value":     "计算机科学与技术",
			}},
		},
	}
	closure, err := primaryAgentEvidenceClosureForFinalization(
		map[string]any{"activity_attempt": 1, "selected_tools": []string{"knowledge_query"}},
		envelope,
		steps,
	)
	if err != nil {
		t.Fatalf("evidence closure: %v", err)
	}
	if len(closure.ResolvedTargets) != 1 || closure.ResolvedTargets[0] != "curriculum" ||
		len(closure.Sources) != 1 {
		t.Fatalf("closure = %#v", closure)
	}
	if closure.Sources[0]["retrieval_target"] != "curriculum" ||
		closure.Sources[0]["version_id"] != "2024" {
		t.Fatalf("sources = %#v", closure.Sources)
	}
	if closure.SessionUpdate == nil || len(closure.SessionUpdate.UpsertSlots) != 1 {
		t.Fatalf("session update = %#v", closure.SessionUpdate)
	}
}

func TestPrimaryAgentEvidenceClosureIgnoresPriorActivityAttempt(t *testing.T) {
	priorSearch := knowledgeSearchStepForFinalizationTest(
		1,
		"student_rules",
		"found",
		[]map[string]any{knowledgeEvidenceForFinalizationTest(
			"evidence://sha256/prior-attempt",
			"student_rules",
		)},
	)
	successfulSearch := knowledgeSearchStepForFinalizationTest(
		1,
		"curriculum",
		"found",
		[]map[string]any{knowledgeEvidenceForFinalizationTest(
			"evidence://sha256/successful-attempt",
			"curriculum",
		)},
	)
	successfulSearch.AttemptID = temporalStepAttemptID(
		successfulSearch.RunID,
		successfulSearch.StepID,
		2,
	)
	successfulSearch.SanitizedPayload["activity_attempt"] = 2

	closure, err := primaryAgentEvidenceClosureForFinalization(
		map[string]any{"activity_attempt": 2, "selected_tools": []string{"knowledge_query"}},
		map[string]any{
			"kind":          "answer",
			"answer_text":   "该培养方案要求完成 160 学分。",
			"evidence_refs": []string{"evidence://sha256/successful-attempt"},
		},
		[]execution.StepResultProjection{priorSearch, successfulSearch},
	)
	if err != nil {
		t.Fatalf("evidence closure: %v", err)
	}
	if len(closure.ResolvedTargets) != 1 || closure.ResolvedTargets[0] != "curriculum" ||
		len(closure.Sources) != 1 ||
		closure.Sources[0]["retrieval_target"] != "curriculum" {
		t.Fatalf("closure = %#v", closure)
	}
}

func TestPrimaryAgentEvidenceClosureDerivesTargetsBySearchOrdinal(t *testing.T) {
	steps := []execution.StepResultProjection{
		knowledgeSearchStepForFinalizationTest(2, "curriculum", "no_evidence", nil),
		knowledgeSearchStepForFinalizationTest(1, "student_rules", "no_evidence", nil),
		knowledgeSearchStepForFinalizationTest(3, "student_rules", "no_evidence", nil),
	}
	closure, err := primaryAgentEvidenceClosureForFinalization(
		map[string]any{"activity_attempt": 1, "selected_tools": []string{"knowledge_query"}},
		map[string]any{
			"kind":          "unsupported_by_evidence",
			"answer_text":   "当前证据不足。",
			"reason":        "insufficient_evidence",
			"evidence_refs": []string{},
		},
		steps,
	)
	if err != nil {
		t.Fatalf("evidence closure: %v", err)
	}
	if len(closure.ResolvedTargets) != 2 ||
		closure.ResolvedTargets[0] != "student_rules" ||
		closure.ResolvedTargets[1] != "curriculum" {
		t.Fatalf("resolved targets = %#v", closure.ResolvedTargets)
	}
}

func TestPrimaryAgentEvidenceClosureRejectsForgedEvidenceReference(t *testing.T) {
	steps := []execution.StepResultProjection{knowledgeSearchStepForFinalizationTest(
		1,
		"curriculum",
		"found",
		[]map[string]any{knowledgeEvidenceForFinalizationTest(
			"evidence://sha256/curriculum-1",
			"curriculum",
		)},
	)}
	_, err := primaryAgentEvidenceClosureForFinalization(
		map[string]any{"activity_attempt": 1, "selected_tools": []string{"knowledge_query"}},
		map[string]any{
			"kind":          "answer",
			"answer_text":   "该培养方案要求完成 160 学分。",
			"evidence_refs": []string{"evidence://sha256/forged"},
		},
		steps,
	)
	if err == nil || !strings.Contains(err.Error(), "not produced by this run") {
		t.Fatalf("error = %v", err)
	}
}

func TestPrimaryAgentEvidenceClosureRejectsKnowledgeAnswerWithoutSearch(t *testing.T) {
	_, err := primaryAgentEvidenceClosureForFinalization(
		map[string]any{"activity_attempt": 1, "selected_tools": []string{"knowledge_query"}},
		map[string]any{
			"kind":          "answer",
			"answer_text":   "未检索也不应回答。",
			"evidence_refs": []string{"evidence://sha256/missing"},
		},
		nil,
	)
	if err == nil || !strings.Contains(err.Error(), "requires at least one knowledge search") {
		t.Fatalf("error = %v", err)
	}
}

func TestPrimaryAgentEvidenceClosureAllowsUnsupportedOutcomeWithEvidence(t *testing.T) {
	steps := []execution.StepResultProjection{knowledgeSearchStepForFinalizationTest(
		1,
		"curriculum",
		"found",
		[]map[string]any{knowledgeEvidenceForFinalizationTest(
			"evidence://sha256/curriculum-1",
			"curriculum",
		)},
	)}
	closure, err := primaryAgentEvidenceClosureForFinalization(
		map[string]any{"activity_attempt": 1, "selected_tools": []string{"knowledge_query"}},
		map[string]any{
			"kind":          "unsupported_by_evidence",
			"answer_text":   "检索到的材料没有明确回答该问题。",
			"reason":        "insufficient_evidence",
			"evidence_refs": []string{"evidence://sha256/curriculum-1"},
		},
		steps,
	)
	if err != nil {
		t.Fatalf("unsupported evidence closure: %v", err)
	}
	if len(closure.Sources) != 1 || closure.Sources[0]["retrieval_target"] != "curriculum" {
		t.Fatalf("sources = %#v", closure.Sources)
	}
}

func TestPrimaryAgentEvidenceClosureRejectsInternalLocatorInAnswer(t *testing.T) {
	_, err := primaryAgentEvidenceClosureForFinalization(
		map[string]any{"activity_attempt": 1, "selected_tools": []string{"knowledge_query"}},
		map[string]any{
			"kind":          "unsupported_by_evidence",
			"answer_text":   "请查看 projection://runs/private/result。",
			"reason":        "no_evidence",
			"evidence_refs": []string{},
		},
		[]execution.StepResultProjection{
			knowledgeSearchStepForFinalizationTest(1, "curriculum", "no_evidence", nil),
		},
	)
	if err == nil || !strings.Contains(err.Error(), "internal locator") {
		t.Fatalf("error = %v", err)
	}
}

func TestPrimaryAgentEvidenceClosureAllowsDirectAnswerWithoutSearch(t *testing.T) {
	closure, err := primaryAgentEvidenceClosureForFinalization(
		map[string]any{"activity_attempt": 1, "selected_tools": []string{}},
		map[string]any{"kind": "answer", "answer_text": "你好。"},
		nil,
	)
	if err != nil {
		t.Fatalf("direct answer closure: %v", err)
	}
	if len(closure.ResolvedTargets) != 0 || len(closure.Sources) != 0 ||
		closure.SessionUpdate != nil {
		t.Fatalf("closure = %#v", closure)
	}
}

func knowledgeSearchStepForFinalizationTest(
	ordinal int,
	target string,
	outcome string,
	evidence []map[string]any,
) execution.StepResultProjection {
	if evidence == nil {
		evidence = []map[string]any{}
	}
	return execution.StepResultProjection{
		AttemptID:     temporalStepAttemptID("run-knowledge", "knowledge.search."+string(rune('0'+ordinal)), 1),
		ResultID:      "result-knowledge-search",
		StepID:        "knowledge.search." + string(rune('0'+ordinal)),
		RunID:         "run-knowledge",
		Status:        "completed",
		ResultKind:    "knowledge_search_result",
		ProjectionRef: "projection://runs/run-knowledge/knowledge/search",
		SanitizedPayload: map[string]any{
			"activity_attempt": 1,
			"evidence":         evidence,
			"outcome":          outcome,
			"retrieval_target": target,
			"search_ordinal":   ordinal,
		},
	}
}

func knowledgeEvidenceForFinalizationTest(
	evidenceRef string,
	target string,
) map[string]any {
	return map[string]any{
		"canonical_url":    "https://www.muc.edu.cn/curriculum/2024",
		"chunk_id":         "graduation-credits",
		"document_id":      "curriculum-2024",
		"evidence_ref":     evidenceRef,
		"retrieval_target": target,
		"title":            "计算机科学与技术专业培养方案",
		"snippet":          "毕业最低学分为 160 学分。",
		"version_id":       "2024",
	}
}
