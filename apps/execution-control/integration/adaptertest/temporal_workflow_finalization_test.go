package adaptertest

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	finalizationactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestWriteWorkflowFinalizationCompletesSynthesizedResult(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 9, 4, 11, 30, 0, 0, time.UTC)
	const runID = "run-workflow-finalization"
	createQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-workflow-finalization",
		now,
		agentRequestForDurableWorkerTest("hi 你是谁"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("start run: %v", err)
	}

	adapter := newAdapterForTest(config.Config{TemporalWorkerIdentity: "test:finalization:001"})
	attachAgentAdmissionProviderConfigsForTest(adapter)
	attachRunProjectionStoreForAdapterTest(adapter, store)
	snapshot, err := adapter.AdmissionService.BuildAgentAdmissionSnapshot(t.Context(), false)
	if err != nil {
		t.Fatalf("build admission snapshot: %v", err)
	}
	evidence := []temporalruntime.WorkflowEvidence{{SchemaVersion: "workflow_evidence.v1", ID: "evidence.finalization", Source: temporalruntime.WorkflowSourceCampusSearch, Title: "校园资料", Excerpt: "资料内容", CitationIndex: 1, URL: "https://example.edu/notice"}}
	input := temporalruntime.WriteWorkflowFinalizationActivityInput{
		RequestID:         runID,
		AdmissionSnapshot: workflowcontract.AdmissionToWorkflow(snapshot),
		WorkflowResult: temporalruntime.WorkflowOperationActivityOutput{
			Operation:               temporalruntime.WorkflowOperationSynthesize,
			WorkflowResultRef:       activityprojection.WorkflowOperationResultRef(runID, "answer.synthesize"),
			FinalOutput:             "你好，我是校园问答助手。",
			ModelName:               "gpt-5.6-terra",
			ModelProvider:           "openai",
			ProviderResponseID:      "resp-workflow-finalization",
			RequestID:               runID,
			RuntimeRelease:          "agent-runtime@test",
			Status:                  "completed",
			Evidence:                evidence,
			SourceAttempts:          []temporalruntime.WorkflowSourceAttempt{{Source: temporalruntime.WorkflowSourceCampusSearch, Status: "matched"}},
			SearchSuggestions:       []temporalruntime.SearchSuggestion{{Provider: "google", RenderedContent: "<div>Google search suggestions</div>"}},
			TerminalReason:          "answer_completed",
			ToolContractFingerprint: execution.ToolContractFingerprintSnapshotMap(snapshot.ToolContractFingerprint),
			Usage: temporalruntime.AgentUsageSummary{
				InputTokens:       12,
				OutputTokens:      8,
				UsageObserved:     true,
				ModelRequestCount: 1,
			},
		},
	}

	output, err := adapter.WriteWorkflowFinalization(context.Background(), input)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("finalization status = %q", output.Status)
	}
	completedRun, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	if completedRun.FinalResponseRef != output.ProjectionRef ||
		completedRun.TerminalReason != execution.DurableTerminalReasonAnswerCompleted {
		t.Fatalf("completed run = %#v, output = %#v", completedRun, output)
	}
	events, err := store.ListRunEvents(context.Background(), runID)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizedResponse := expectInternalFinalizationResponseForTest(t, events)
	serialized, _ := json.Marshal(finalizedResponse["result"])
	if !strings.Contains(string(serialized), "Google search suggestions") {
		t.Fatalf("search suggestions did not reach final product response: %s", serialized)
	}
	if finalizedResponse["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("answer_text = %#v", finalizedResponse["answer_text"])
	}
	results, err := store.ListStepResults(context.Background(), runID)
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	found := false
	for _, result := range results {
		if result.StepID == "finalization.write" && result.Status == "completed" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("finalization.write result missing: %#v", results)
	}
}

func TestCommitWorkflowFinalizationMapsActiveProjectionConflictAfterSuccessEvidence(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 9, 5, 13, 0, 0, 0, time.UTC)
	const runID = "run-finalization-cas-conflict"
	const conversationID = "conv-finalization-cas-conflict"
	createQueuedDurableRunForTest(t, store, runID, conversationID, now, nil)
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusRunning,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("start run: %v", err)
	}
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get active run: %v", err)
	}
	finalizationRef := activityprojection.TemporalProjectionRef(runID, "finalization/write")
	run.FinalResponseRef = finalizationRef
	run.TerminalReason = execution.DurableTerminalReasonAnswerCompleted
	finalizedResponse := map[string]any{
		"answer_text": "答案。",
		"status":      "completed",
	}
	if _, err := store.AppendRunEvent(context.Background(), execution.DurableRunEvent{
		EventID:              runID + ":finalization-completed-internal",
		RequestID:            runID,
		ConversationID:       conversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           now.Add(3 * time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id": runID,
			"response":   finalizedResponse,
		},
	}); err != nil {
		t.Fatalf("seed finalization success evidence: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             runID + ":conflicting-finalization-result",
		StepID:               execution.FinalizationStepID,
		RequestID:            runID,
		AttemptID:            runID + ":missing-attempt",
		Status:               "completed",
		ResultKind:           execution.FinalizationResultKind,
		ProjectionRef:        finalizationRef,
		CreatedAt:            now.Add(4 * time.Second),
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{"activity_attempt": 1},
	}); err != nil {
		t.Fatalf("seed conflicting finalization result: %v", err)
	}

	adapter := newAdapterForTest(config.Config{TemporalWorkerIdentity: "test:finalization:conflict"})
	attachRunProjectionStoreForAdapterTest(adapter, store)
	input := temporalruntime.WriteWorkflowFinalizationActivityInput{
		RequestID: runID,
		WorkflowResult: temporalruntime.WorkflowOperationActivityOutput{
			WorkflowResultRef: activityprojection.WorkflowOperationResultRef(runID, "answer.synthesize"),
			RequestID:         runID,
		},
	}
	_, err = NewFinalizationAdapter(adapter).CommitWorkflowFinalizationStep(
		context.Background(),
		run,
		input,
		now.Add(3*time.Second),
		now.Add(5*time.Second),
		now.Add(5*time.Second),
		finalizedResponse,
	)
	assertTemporalFailureSanitized(t, err, "finalization_projection_conflict", true)

	latest, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run after projection conflict: %v", err)
	}
	if latest.Status != execution.DurableRunStatusRunning {
		t.Fatalf("run status = %s, want running", latest.Status)
	}
}

func TestFinalizeExecutionFailureBlocksAfterProductFinalizationEvidence(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	const runID = "run-finalization-projection-conflict"
	const conversationID = "conv-finalization-projection-conflict"
	createQueuedDurableRunForTest(t, store, runID, conversationID, now, nil)
	if _, err := store.AppendRunEvent(context.Background(), execution.DurableRunEvent{
		EventID:              runID + ":finalization-completed-internal",
		RequestID:            runID,
		ConversationID:       conversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           now.Add(time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id": runID,
			"response":   map[string]any{"status": "completed", "answer_text": "已提交"},
		},
	}); err != nil {
		t.Fatalf("seed finalization success evidence: %v", err)
	}

	adapter := newWorkerAuthAdapterForTest()
	attachRunProjectionStoreForAdapterTest(adapter, store)
	callbackCount := 0
	adapter.ProductFinalizationWriter = func(
		context.Context,
		execution.DurableRun,
		time.Time,
		map[string]any,
	) error {
		callbackCount++
		return nil
	}

	_, err := adapter.FinalizeExecutionFailure(context.Background(), temporalruntime.FinalizeExecutionFailureActivityInput{
		FailureKind: "agent_runtime_failed",
		FailedAt:    now.Add(2 * time.Second),
		RequestID:   runID,
		Stage:       "solve.initial",
	})
	assertTemporalFailureSanitized(t, err, "finalization_projection_conflict", true)
	if callbackCount != 0 {
		t.Fatalf("product callback count = %d, want 0", callbackCount)
	}

	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run after projection conflict: %v", err)
	}
	if run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("run status = %s, want queued", run.Status)
	}
	events, err := store.ListRunEvents(context.Background(), runID)
	if err != nil {
		t.Fatalf("list events after projection conflict: %v", err)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeActivityFailed ||
			event.EventType == execution.DurableRunEventTypeRunFailed {
			t.Fatalf("failure projection was written after product success evidence: %#v", events)
		}
	}
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RequestID:      runID + "-successor",
		ConversationID: conversationID,
		OwnerUserID:    "user-executor",
		Surface:        "campus-web",
		TaskQueue:      temporalruntime.WorkflowTaskQueue,
		Status:         execution.DurableRunStatusCreated,
		CreatedAt:      now.Add(3 * time.Second),
		Metadata:       v3ExecutionMetadataForTemporalTest(runID + "-successor"),
	}); !errors.Is(err, execution.ErrConversationActiveRun) {
		t.Fatalf("successor create error = %v, want execution.ErrConversationActiveRun", err)
	}
}

func TestWriteWorkflowFinalizationReservesStableCompletionBeforeCallbackRetry(t *testing.T) {
	store, adapter, input := workflowFinalizationFixture(t, "run-finalization-reservation-retry")
	var callbackTimes []time.Time
	adapter.ProductFinalizationWriter = func(
		_ context.Context,
		_ execution.DurableRun,
		completedAt time.Time,
		_ map[string]any,
	) error {
		callbackTimes = append(callbackTimes, completedAt)
		if len(callbackTimes) == 1 {
			return errors.New("transient product callback failure")
		}
		return nil
	}

	if _, err := adapter.WriteWorkflowFinalization(context.Background(), input); err == nil {
		t.Fatal("first callback failure should be returned")
	}
	firstEvents, err := store.ListRunEvents(context.Background(), input.RequestID)
	if err != nil {
		t.Fatalf("list events after callback failure: %v", err)
	}
	var reservationEvent execution.DurableRunEvent
	for _, event := range firstEvents {
		if event.EventType == execution.DurableRunEventTypeFinalizationReserved {
			reservationEvent = event
		}
	}
	if reservationEvent.EventID == "" {
		t.Fatalf("finalization reservation missing after callback failure: %#v", firstEvents)
	}
	reservation, err := finalizationactivities.ParseFinalizationReservationEvent(reservationEvent)
	if err != nil {
		t.Fatalf("parse finalization reservation: %v", err)
	}
	if reservation.StartedAt.IsZero() || reservation.CompletedAt.IsZero() ||
		reservation.CompletedAt.Before(reservation.StartedAt) {
		t.Fatalf("reservation timing = %#v", reservation)
	}

	output, err := adapter.WriteWorkflowFinalization(context.Background(), input)
	if err != nil {
		t.Fatalf("replay finalization after callback retry: %v", err)
	}
	if !output.CompletedAt.Equal(reservation.CompletedAt) {
		t.Fatalf("completed_at = %s, want reserved %s", output.CompletedAt, reservation.CompletedAt)
	}
	if len(callbackTimes) != 2 {
		t.Fatalf("callback count = %d, want two exact replays", len(callbackTimes))
	}

	run, err := store.GetRun(context.Background(), input.RequestID)
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	if !run.CompletedAt.Equal(reservation.CompletedAt) {
		t.Fatalf("run completed_at = %s, want %s", run.CompletedAt, reservation.CompletedAt)
	}
	steps, err := store.ListRunSteps(context.Background(), input.RequestID)
	if err != nil {
		t.Fatalf("list finalization steps: %v", err)
	}
	if len(steps) != 2 {
		t.Fatalf("finalization steps = %#v", steps)
	}
	var step execution.RunStepProjection
	for _, candidate := range steps {
		if candidate.StepID == "finalization.write" {
			step = candidate
		}
	}
	if step.StepID == "" {
		t.Fatalf("finalization.write step missing: %#v", steps)
	}
	if !step.StartedAt.Equal(reservation.StartedAt) ||
		!step.CompletedAt.Equal(reservation.CompletedAt) ||
		!step.UpdatedAt.Equal(reservation.CompletedAt) {
		t.Fatalf("canonical finalization step timing = %#v, reservation = %#v", step, reservation)
	}
	results, err := store.ListStepResults(context.Background(), input.RequestID)
	if err != nil {
		t.Fatalf("list finalization results: %v", err)
	}
	if len(results) != 1 || !results[0].CreatedAt.Equal(reservation.CompletedAt) {
		t.Fatalf("canonical finalization result = %#v, reservation = %#v", results, reservation)
	}
	finalEvents, err := store.ListRunEvents(context.Background(), input.RequestID)
	if err != nil {
		t.Fatalf("list final events: %v", err)
	}
	reservationCount := 0
	completionCount := 0
	for _, event := range finalEvents {
		if event.EventType == execution.DurableRunEventTypeFinalizationReserved {
			reservationCount++
		}
		if event.EventType == execution.DurableRunEventTypeFinalizationCompleted {
			completionCount++
		}
	}
	if reservationCount != 1 || completionCount != 1 || !callbackTimes[0].Equal(callbackTimes[1]) {
		t.Fatalf("finalization event counts = reservation %d, completion %d: %#v", reservationCount, completionCount, finalEvents)
	}
}

func TestWriteWorkflowFinalizationCompletedReplayUsesDurableTiming(t *testing.T) {
	store, adapter, input := workflowFinalizationFixture(t, "run-finalization-completed-replay")
	first, err := adapter.WriteWorkflowFinalization(context.Background(), input)
	if err != nil {
		t.Fatalf("write initial finalization: %v", err)
	}
	second, err := adapter.WriteWorkflowFinalization(context.Background(), input)
	if err != nil {
		t.Fatalf("replay completed finalization: %v", err)
	}
	if !second.CompletedAt.Equal(first.CompletedAt) {
		t.Fatalf("replayed completed_at = %s, initial = %s", second.CompletedAt, first.CompletedAt)
	}
	run, err := store.GetRun(context.Background(), input.RequestID)
	if err != nil {
		t.Fatalf("get replayed run: %v", err)
	}
	if !run.CompletedAt.Equal(first.CompletedAt) {
		t.Fatalf("stored completed_at = %s, initial = %s", run.CompletedAt, first.CompletedAt)
	}
}

func TestWorkflowFinalizationProjectsCitationsOnCompletionAndRepair(t *testing.T) {
	for _, mode := range []string{"solve", "planned", "recovery", "diagnostics unavailable", "invalid citation"} {
		t.Run(mode, func(t *testing.T) {
			store, adapter, input := workflowFinalizationFixture(t, "run-citations-"+strings.ReplaceAll(mode, " ", "-"))
			diagnostics := &finalizationCitationStore{InMemoryRunProjectionStore: store}
			adapter.RunProjectionStore = diagnostics
			ref := "result://" + strings.Repeat("a", 64)
			input.WorkflowResult.Evidence = []temporalruntime.WorkflowEvidence{{
				ID: "campus:" + ref, ResultRef: ref, Source: temporalruntime.WorkflowSourceCampusSearch,
				SchemaVersion: "workflow_evidence.v1", Title: "通知", Excerpt: "报名要求", SectionTitle: "报名",
				NoticeID: "12345", CitationHref: "/notices/12345", CitationIndex: 1,
			}}
			input.WorkflowResult.FinalOutput = "报名要求见 [1]。"
			if mode == "solve" || mode == "diagnostics unavailable" || mode == "invalid citation" {
				input.WorkflowResult.Operation = temporalruntime.WorkflowOperationSolve
				input.WorkflowResult.SolveOutcome = "answer"
				input.WorkflowResult.WorkflowResultRef = activityprojection.WorkflowOperationResultRef(input.RequestID, "solve.initial")
				input.WorkflowResult.FinalOutput = "报名要求见 [5]。"
				item := campusdocs.SearchResultItem{ResultRef: ref, SourceKind: "notice", Title: "通知", Text: "报名要求", SectionTitle: "报名", NoticeID: "12345", CitationHref: "/notices/12345"}
				for _, start := range []int{1, 5} {
					input.WorkflowResult.ToolResults = append(input.WorkflowResult.ToolResults, temporalruntime.AgentToolResult{
						ToolName: "campus_search", Status: "completed", Result: campusdocs.EncodeSearchResult([]campusdocs.SearchResultItem{item}, start),
					})
				}
			}
			if mode == "recovery" {
				input.WorkflowResult.SourceAttempts = append(input.WorkflowResult.SourceAttempts, temporalruntime.WorkflowSourceAttempt{Source: temporalruntime.WorkflowSourceCampusSearch, Status: "failed"})
			}
			if mode == "diagnostics unavailable" {
				diagnostics.writeError = errors.New("diagnostics unavailable")
			}
			if mode == "invalid citation" {
				input.WorkflowResult.FinalOutput = "报名要求见 [9]。"
			}
			output, err := adapter.WriteWorkflowFinalization(t.Context(), input)
			if mode == "invalid citation" {
				if err == nil && output.Status == "completed" {
					t.Fatal("invalid answer completed")
				}
				if len(diagnostics.writes) != 0 {
					t.Fatalf("failed finalization marked citations: %v", diagnostics.writes)
				}
				return
			}
			if err != nil || output.Status != "completed" {
				t.Fatalf("finalize = %#v, %v", output, err)
			}
			if !reflect.DeepEqual(diagnostics.writes, [][]string{{ref}}) {
				t.Fatalf("citation writes = %v", diagnostics.writes)
			}
			events, err := store.ListRunEvents(t.Context(), input.RequestID)
			if err != nil {
				t.Fatal(err)
			}
			response := expectInternalFinalizationResponseForTest(t, events)
			if response["answer_text"] != "报名要求见 [1](/notices/12345)。" {
				t.Fatalf("answer = %v", response["answer_text"])
			}
			diagnostics.writes = nil
			repaired, err := adapter.WriteWorkflowFinalization(t.Context(), input)
			if err != nil || repaired.Status != "completed" || !repaired.CompletedAt.Equal(output.CompletedAt) {
				t.Fatalf("repair = %#v, %v", repaired, err)
			}
			if !reflect.DeepEqual(diagnostics.writes, [][]string{{ref}}) {
				t.Fatalf("repaired citation writes = %v", diagnostics.writes)
			}
		})
	}
}

type finalizationCitationStore struct {
	*executionpersistence.InMemoryRunProjectionStore
	writes     [][]string
	writeError error
}

func (*finalizationCitationStore) ObserveCampusSearch(context.Context, campusdiagnostics.Observation) error {
	return nil
}

func (s *finalizationCitationStore) MarkCampusSearchCitations(ctx context.Context, requestID string, refs []string) error {
	run, err := s.GetRun(ctx, requestID)
	if err != nil {
		return err
	}
	if run.Status != execution.DurableRunStatusCompleted {
		return errors.New("citations projected before completion")
	}
	s.writes = append(s.writes, append([]string{}, refs...))
	return s.writeError
}

func TestFinalizationTimingReservationClampsClockRollback(t *testing.T) {
	store, adapter, input := workflowFinalizationFixture(t, "run-finalization-clock-rollback")
	run, err := store.GetRun(context.Background(), input.RequestID)
	if err != nil {
		t.Fatalf("get fixture run: %v", err)
	}
	startedAt := finalizationactivities.CanonicalFinalizationTime(time.Now().Add(time.Hour))
	agentResult := finalizationactivities.WorkflowFinalizationResultMap(input)
	finalizedResponse, err := NewFinalizationAdapter(adapter).WorkflowFinalizedResponse(context.Background(), run, agentResult)
	if err != nil {
		t.Fatalf("build finalization response: %v", err)
	}
	payload := finalizationactivities.TemporalFinalizationResultPayload(finalizedResponse, input, run)
	reservation, err := NewFinalizationAdapter(adapter).EnsureFinalizationTimingReservation(
		context.Background(),
		run,
		input,
		finalizedResponse,
		startedAt,
		execution.StringValue(payload[execution.FinalizationFingerprintPayloadKey]),
	)
	if err != nil {
		t.Fatalf("reserve finalization timing: %v", err)
	}
	if !reservation.StartedAt.Equal(startedAt) || !reservation.CompletedAt.Equal(startedAt) {
		t.Fatalf("clock rollback reservation = %#v, want both boundaries at %s", reservation, startedAt)
	}
}

func workflowFinalizationFixture(
	t *testing.T,
	runID string,
) (*executionpersistence.InMemoryRunProjectionStore, *Adapter, temporalruntime.WriteWorkflowFinalizationActivityInput) {
	t.Helper()
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 9, 1, 11, 30, 0, 0, time.UTC)
	createQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-"+runID,
		now,
		agentRequestForDurableWorkerTest("fixture"),
	)
	if _, err := store.TransitionRun(context.Background(), runID, execution.DurableRunStatusAdmitted, "", now.Add(2*time.Second)); err != nil {
		t.Fatalf("admit fixture run: %v", err)
	}
	if _, err := store.TransitionRun(context.Background(), runID, execution.DurableRunStatusRunning, "", now.Add(3*time.Second)); err != nil {
		t.Fatalf("start fixture run: %v", err)
	}
	adapter := newAdapterForTest(config.Config{TemporalWorkerIdentity: "test:finalization:fixture"})
	attachAgentAdmissionProviderConfigsForTest(adapter)
	attachRunProjectionStoreForAdapterTest(adapter, store)
	snapshot, err := adapter.AdmissionService.BuildAgentAdmissionSnapshot(t.Context(), false)
	if err != nil {
		t.Fatalf("build fixture admission snapshot: %v", err)
	}
	evidence := []temporalruntime.WorkflowEvidence{{SchemaVersion: "workflow_evidence.v1", ID: "evidence.fixture", Source: temporalruntime.WorkflowSourceCampusSearch, Title: "校园资料", Excerpt: "资料内容", CitationIndex: 1, URL: "https://example.edu/notice"}}
	return store, adapter, temporalruntime.WriteWorkflowFinalizationActivityInput{
		AdmissionSnapshot: workflowcontract.AdmissionToWorkflow(snapshot),
		RequestID:         runID,
		WorkflowResult: temporalruntime.WorkflowOperationActivityOutput{
			Operation:               temporalruntime.WorkflowOperationSynthesize,
			WorkflowResultRef:       activityprojection.WorkflowOperationResultRef(runID, "answer.synthesize"),
			FinalOutput:             "fixture answer",
			ModelName:               "fixture-model",
			ModelProvider:           "fixture-provider",
			ProviderResponseID:      "fixture-response",
			RequestID:               runID,
			RuntimeRelease:          "fixture-runtime",
			Status:                  "completed",
			Evidence:                evidence,
			SourceAttempts:          []temporalruntime.WorkflowSourceAttempt{{Source: temporalruntime.WorkflowSourceCampusSearch, Status: "matched"}},
			TerminalReason:          "answer_completed",
			ToolContractFingerprint: execution.ToolContractFingerprintSnapshotMap(snapshot.ToolContractFingerprint),
			Usage: temporalruntime.AgentUsageSummary{
				InputTokens:       10,
				OutputTokens:      5,
				UsageObserved:     true,
				ModelRequestCount: 1,
			},
		},
	}
}
