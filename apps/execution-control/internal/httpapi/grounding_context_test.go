package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type groundingExecutorForTest struct {
	calls       int
	preparation groundingPreparation
}

func (executor *groundingExecutorForTest) Prepare(
	_ context.Context,
	_ string,
	_ retrievalruntime.RetrievalAccess,
	_ temporalruntime.AgentAdmissionSnapshot,
) (groundingPreparation, error) {
	executor.calls++
	result := executor.preparation
	result.Evidence = append([]groundingEvidence{}, result.Evidence...)
	return result, nil
}

func TestPrepareGroundingContextActivityCarriesOneBoundContext(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	const runID = "run-grounding-activity"
	const query = "学生请假手续是什么？"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-grounding-activity",
		time.Date(2026, 7, 26, 8, 0, 0, 0, time.UTC),
		agentRequestForDurableWorkerTest(query),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:grounding"})
	attachRunProjectionStoreForHandlerTest(server, store)
	attachAgentAdmissionProviderConfigsForTest(server)
	snapshot, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		false,
		false,
		groundingPlanForTest(query, "student_rules"),
	)
	if err != nil {
		t.Fatalf("build admission snapshot: %v", err)
	}
	evidence := groundingEvidenceForTest()
	executor := &groundingExecutorForTest{preparation: groundingPreparation{
		CandidateCount: 3,
		Evidence:       []groundingEvidence{evidence},
		StageTiming: groundingStageTiming{
			Embedding: 11 * time.Millisecond,
			Search:    12 * time.Millisecond,
			Rerank:    13 * time.Millisecond,
			Pack:      14 * time.Millisecond,
		},
	}}
	server.groundingExecutor = executor
	server.groundingErr = nil
	input := temporalruntime.PrepareGroundingContextActivityInput{
		AdmissionSnapshot:       snapshot,
		AdmissionSnapshotSHA256: sha256JSONRef(snapshot),
		RunID:                   runID,
		TraceID:                 "trace-executor-001",
	}

	output, err := server.PrepareGroundingContextActivity(t.Context(), input)
	if err != nil {
		steps, _ := store.ListRunSteps(t.Context(), runID)
		t.Fatalf("prepare grounding context: %v; calls=%d steps=%#v", err, executor.calls, steps)
	}
	if output.Status != "ready" || output.EvidenceCount != 1 || output.TokenCount != evidence.TokenCount {
		t.Fatalf("grounding output = %#v", output)
	}
	if output.GroundingContext.AdmissionSHA256 != input.AdmissionSnapshotSHA256 ||
		output.GroundingContext.QuerySHA256 != sha256TextRef(query) ||
		sha256JSONRef(output.GroundingContext) != output.PayloadSHA256 {
		t.Fatalf("workflow grounding is not bound to the run: %#v", output.GroundingContext)
	}
	results, err := store.ListStepResults(t.Context(), runID)
	if err != nil || len(results) != 1 {
		t.Fatalf("grounding results = %#v, error = %v", results, err)
	}
	payload := results[0].SanitizedPayload
	stageTiming := cloneAnyMapFromMetadata(payload["stage_timing"])
	if intFromAny(payload["candidate_count"]) != 3 ||
		stageTiming["grounding.embedding_ms"] != float64(11) ||
		stageTiming["grounding.search_ms"] != float64(12) ||
		stageTiming["grounding.rerank_ms"] != float64(13) ||
		stageTiming["grounding.pack_ms"] != float64(14) {
		t.Fatalf("grounding diagnostics = %#v", payload)
	}

}

func TestSelectGroundingEvidenceAppliesThresholdAndTokenBudget(t *testing.T) {
	candidates := []groundingCandidate{
		groundingCandidateWithScoreForTest("a", 0.95, 3_500),
		groundingCandidateWithScoreForTest("b", 0.90, 800),
		groundingCandidateWithScoreForTest("c", 0.80, 500),
		groundingCandidateWithScoreForTest("d", 0.49, 100),
	}

	evidence := selectGroundingEvidence(candidates, []temporalruntime.DocumentScope{{
		Scope:               "student_rules",
		MaxEvidenceSections: 6,
	}}, 0.5)
	if len(evidence) != 2 || evidence[0].ChunkID != "a" || evidence[1].ChunkID != "c" {
		t.Fatalf("selected grounding evidence = %#v", evidence)
	}
	for _, item := range evidence {
		if !strings.HasPrefix(item.EvidenceRef, "evidence://") || len(item.EvidenceRef) != len("evidence://")+64 {
			t.Fatalf("unstable evidence ref = %q", item.EvidenceRef)
		}
	}
}

func TestSelectGroundingEvidenceHonorsPerScopeLimitAfterGlobalRerank(t *testing.T) {
	studentFirst := groundingCandidateWithScoreForTest("student-a", 0.95, 100)
	studentSecond := groundingCandidateWithScoreForTest("student-b", 0.90, 100)
	curriculum := groundingCandidateWithScoreForTest("curriculum-a", 0.85, 100)
	curriculum.DocumentScope = "curriculum"
	curriculum.dedupKey = "curriculum\x00release\x00curriculum-a"

	evidence := selectGroundingEvidence(
		[]groundingCandidate{studentFirst, studentSecond, curriculum},
		[]temporalruntime.DocumentScope{
			{Scope: "student_rules", MaxEvidenceSections: 1},
			{Scope: "curriculum", MaxEvidenceSections: 1},
		},
		0.5,
	)
	if len(evidence) != 2 || evidence[0].ChunkID != "student-a" ||
		evidence[1].ChunkID != "curriculum-a" {
		t.Fatalf("scope-limited grounding evidence = %#v", evidence)
	}
}

func TestSelectGroundingEvidencePrefersDistinctSections(t *testing.T) {
	first := groundingCandidateWithScoreForTest("first", 0.95, 100)
	sameSection := groundingCandidateWithScoreForTest("same-section", 0.94, 100)
	differentSection := groundingCandidateWithScoreForTest("different-section", 0.90, 100)
	differentSection.SectionID = "appeal"
	differentSection.SectionRef = "section://student_rules/appeal"
	differentSection.SectionTitle = "申诉程序"

	evidence := selectGroundingEvidence(
		[]groundingCandidate{first, sameSection, differentSection},
		[]temporalruntime.DocumentScope{{Scope: "student_rules", MaxEvidenceSections: 3}},
		0.5,
	)
	if len(evidence) != 3 || evidence[0].ChunkID != "first" ||
		evidence[1].ChunkID != "different-section" || evidence[2].ChunkID != "same-section" {
		t.Fatalf("section-diverse evidence = %#v", evidence)
	}
}

func TestGroundingStatusDistinguishesEmptyPartialAndReady(t *testing.T) {
	selected := []string{"student_rules", "curriculum"}
	for _, test := range []struct {
		covered []string
		want    string
	}{
		{covered: nil, want: "empty"},
		{covered: []string{"student_rules"}, want: "partial"},
		{covered: selected, want: "ready"},
	} {
		if got := groundingStatus("multi_scope", selected, test.covered); got != test.want {
			t.Fatalf("grounding status for %#v = %q, want %q", test.covered, got, test.want)
		}
	}
	if got := groundingStatus("none", nil, nil); got != "not_required" {
		t.Fatalf("direct grounding status = %q", got)
	}
	if got := groundingStatus("single_scope", []string{"student_rules"}, []string{"student_rules"}); got != "ready" {
		t.Fatalf("grounding coverage status = %q, want ready; unsupported_by_evidence is a terminal kind", got)
	}
}

func TestPrimaryAgentEvidenceClosureUsesOnlyBoundGrounding(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	const runID = "run-grounding-finalization"
	const query = "学生请假手续和培养方案学分要求分别是什么？"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-grounding-finalization",
		time.Date(2026, 7, 26, 8, 30, 0, 0, time.UTC),
		agentRequestForDurableWorkerTest(query),
	)
	server := NewServer(config.Config{})
	attachRunProjectionStoreForHandlerTest(server, store)
	run, err := store.GetRun(t.Context(), runID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	evidence := groundingEvidenceForTest()
	admissionSHA256 := sha256JSONRef(map[string]any{"run_id": runID, "fixture": "admission"})
	plan := groundingPlanForTest(query, "student_rules", "curriculum")
	grounding := groundingContext{
		AdmissionSHA256: admissionSHA256,
		CoveredScopes:   []string{"student_rules"},
		Evidence:        []groundingEvidence{evidence},
		Mode:            plan.Mode,
		PlanSHA256:      hashAdmissionJSON(plan),
		PreparedAt:      time.Date(2026, 7, 26, 8, 30, 1, 0, time.UTC),
		QuerySHA256:     plan.QuerySHA256,
		RunID:           runID,
		SchemaVersion:   groundingContextSchemaVersion,
		SelectedScopes:  append([]string{}, plan.SelectedScopes...),
		Status:          "partial",
		TokenCount:      evidence.TokenCount,
	}
	grounding.ModelContextChars = groundingModelContextCharacterCount(grounding.Status, grounding.Evidence)
	contextRef := groundingContextRef(runID)
	agentResult := map[string]any{
		"admission_snapshot_sha256": admissionSHA256,
		"allow_ungrounded_answer":   false,
		"grounding_context_ref":     contextRef,
		"grounding_context_sha256":  sha256JSONRef(grounding),
	}
	envelope := map[string]any{
		"kind":          "answer",
		"answer_text":   "学生应按规定办理请假手续。",
		"evidence_refs": []any{evidence.EvidenceRef},
	}

	closure, err := server.primaryAgentEvidenceClosureForFinalization(
		run,
		agentResult,
		grounding,
		envelope,
	)
	if err != nil {
		t.Fatalf("build grounding closure: %v", err)
	}
	if len(closure.Sources) != 1 || closure.Sources[0]["evidence_ref"] != evidence.EvidenceRef ||
		closure.Sources[0]["target_kind"] != "canonical_reader" {
		t.Fatalf("grounding sources = %#v", closure.Sources)
	}

	envelope["evidence_refs"] = []any{}
	_, err = server.primaryAgentEvidenceClosureForFinalization(
		run,
		agentResult,
		grounding,
		envelope,
	)
	if err == nil || !strings.Contains(err.Error(), "requires evidence_refs") {
		t.Fatalf("uncited grounded answer error = %v", err)
	}

	envelope["evidence_refs"] = []any{"evidence://" + strings.Repeat("f", 64)}
	if _, err := server.primaryAgentEvidenceClosureForFinalization(
		run,
		agentResult,
		grounding,
		envelope,
	); err == nil || !strings.Contains(err.Error(), "not present in this run's grounding context") {
		t.Fatalf("forged evidence ref error = %v", err)
	}
}

func TestPrimaryAgentEvidenceClosureRequiresFrozenUngroundedAnswerAuthorization(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	const runID = "run-ungrounded-finalization"
	const query = "今天天气怎么样？"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-ungrounded-finalization",
		time.Date(2026, 7, 26, 8, 45, 0, 0, time.UTC),
		agentRequestForDurableWorkerTest(query),
	)
	server := NewServer(config.Config{})
	attachRunProjectionStoreForHandlerTest(server, store)
	run, err := store.GetRun(t.Context(), runID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	admissionSHA256 := sha256JSONRef(map[string]any{"run_id": runID, "fixture": "admission"})
	plan := groundingPlanForTest(query)
	grounding := groundingContext{
		AdmissionSHA256:   admissionSHA256,
		CoveredScopes:     []string{},
		Evidence:          []groundingEvidence{},
		Mode:              plan.Mode,
		ModelContextChars: groundingModelContextCharacterCount("not_required", nil),
		PlanSHA256:        hashAdmissionJSON(plan),
		PreparedAt:        time.Date(2026, 7, 26, 8, 45, 1, 0, time.UTC),
		QuerySHA256:       plan.QuerySHA256,
		RunID:             runID,
		SchemaVersion:     groundingContextSchemaVersion,
		SelectedScopes:    []string{},
		Status:            "not_required",
	}
	contextRef := groundingContextRef(runID)
	agentResult := map[string]any{
		"admission_snapshot_sha256": admissionSHA256,
		"allow_ungrounded_answer":   false,
		"grounding_context_ref":     contextRef,
		"grounding_context_sha256":  sha256JSONRef(grounding),
	}
	envelope := map[string]any{
		"kind":        "answer",
		"answer_text": "今天是晴天。",
	}
	if _, err := server.primaryAgentEvidenceClosureForFinalization(
		run, agentResult, grounding, envelope,
	); err == nil || !strings.Contains(err.Error(), "not allowed by the execution strategy") {
		t.Fatalf("unauthorized ungrounded answer error = %v", err)
	}

	agentResult["allow_ungrounded_answer"] = true
	closure, err := server.primaryAgentEvidenceClosureForFinalization(
		run, agentResult, grounding, envelope,
	)
	if err != nil {
		t.Fatalf("authorized ungrounded answer: %v", err)
	}
	if len(closure.Sources) != 0 {
		t.Fatalf("ungrounded answer sources = %#v", closure.Sources)
	}
}

func groundingEvidenceForTest() groundingEvidence {
	text := "学生应当按照学校规定办理请假手续。"
	return groundingEvidence{
		EvidenceRef:   "evidence://" + strings.Repeat("a", 64),
		DocumentScope: "student_rules",
		ReleaseID:     "knowledge:student-rules:2026",
		ChunkID:       "student-rules-leave-1",
		SectionRef:    "section://student_rules/leave",
		DocumentID:    "student-rules",
		SectionID:     "leave",
		DocumentTitle: "学生手册",
		SectionTitle:  "请假手续",
		CanonicalURL:  "/docs/regulations/student-rules/leave",
		Text:          text,
		TextSHA256:    sha256TextRef(text),
		TokenCount:    16,
		RerankScore:   0.92,
	}
}

func groundingCandidateWithScoreForTest(
	chunkID string,
	score float64,
	tokenCount int,
) groundingCandidate {
	evidence := groundingEvidenceForTest()
	evidence.ChunkID = chunkID
	evidence.TokenCount = tokenCount
	evidence.RerankScore = score
	return groundingCandidate{
		groundingEvidence: evidence,
		dedupKey:          "student_rules\x00release\x00" + chunkID,
	}
}
