package executionpersistence

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"reflect"
	"testing"
	"time"
)

type stepResultStructuredPayloadForTest struct {
	Labels   []string          `json:"labels"`
	Metadata map[string]string `json:"metadata"`
}

func TestInMemoryStepResultProjectionReplaysExactFirstWrite(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 14, 0, 0, 123456789, time.FixedZone("test", 8*60*60))
	createRunProjectionForTest(t, store, "run-step-result-replay", "conv-step-result-replay", now)
	incoming := stepResultProjectionForImmutabilityTest("run-step-result-replay", now.Add(time.Second))
	want := incoming
	want.CreatedAt = want.CreatedAt.UTC().Truncate(time.Microsecond)

	created, err := store.UpsertStepResult(ctx, incoming)
	if err != nil {
		t.Fatalf("create step result: %v", err)
	}
	assertStepResultProjectionForImmutabilityTest(t, created, want)

	replay := stepResultProjectionForImmutabilityTest("run-step-result-replay", now.Add(time.Second))
	replayed, err := store.UpsertStepResult(ctx, replay)
	if err != nil {
		t.Fatalf("replay exact step result: %v", err)
	}
	assertStepResultProjectionForImmutabilityTest(t, replayed, want)
	canonicalReplay := stepResultProjectionForImmutabilityTest("run-step-result-replay", now.Add(time.Second))
	canonicalReplay.SanitizedPayload["labels"] = []any{"evidence_based", "memory"}
	canonicalReplay.SanitizedPayload["metadata"] = map[string]any{"source": "agent"}
	canonicalReplay.SanitizedPayload["observed_at"] = now.Add(time.Second).Format(time.RFC3339Nano)
	canonicalReplay.SanitizedPayload["structured"] = map[string]any{
		"labels":   []any{"first", "second"},
		"metadata": map[string]any{"source": "structured-agent"},
	}
	canonicalReplayed, err := store.UpsertStepResult(ctx, canonicalReplay)
	if err != nil {
		t.Fatalf("replay canonical JSON-equivalent step result: %v", err)
	}
	assertStepResultProjectionForImmutabilityTest(t, canonicalReplayed, want)

	created.SanitizedPayload["outcome"] = "mutated"
	replayed.SanitizedPayload["usage"].(map[string]any)["input_tokens"] = float64(999)
	created.SanitizedPayload["labels"].([]string)[0] = "mutated"
	replayed.SanitizedPayload["metadata"].(map[string]string)["source"] = "mutated"
	structured := created.SanitizedPayload["structured"].(stepResultStructuredPayloadForTest)
	structured.Labels[0] = "mutated"
	structured.Metadata["source"] = "mutated"
	assertStoredStepResultForImmutabilityTest(t, store, want)
}

func TestInMemoryStepResultProjectionRejectsConflictingReplayWithoutOverwrite(t *testing.T) {
	now := time.Date(2026, 7, 23, 14, 10, 0, 0, time.UTC)
	tests := map[string]func(*execution.StepResultProjection){
		"step identity": func(result *execution.StepResultProjection) {
			result.StepID = "agent.secondary"
		},
		"attempt identity": func(result *execution.StepResultProjection) {
			result.AttemptID = "attempt-agent-2"
		},
		"status": func(result *execution.StepResultProjection) {
			result.Status = "published"
		},
		"result kind": func(result *execution.StepResultProjection) {
			result.ResultKind = "tool_output"
		},
		"projection reference": func(result *execution.StepResultProjection) {
			result.ProjectionRef = "runtime.agent_run_steps/agent.secondary"
		},
		"created time": func(result *execution.StepResultProjection) {
			result.CreatedAt = result.CreatedAt.Add(time.Microsecond)
		},
		"payload schema": func(result *execution.StepResultProjection) {
			result.PayloadSchemaVersion = "step-result-v2"
		},
		"nested JSON payload": func(result *execution.StepResultProjection) {
			result.SanitizedPayload["usage"].(map[string]any)["input_tokens"] = float64(13)
		},
	}

	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			ctx := context.Background()
			const requestID = "run-step-result-conflict"
			createRunProjectionForTest(t, store, requestID, "conv-step-result-conflict", now)
			want := stepResultProjectionForImmutabilityTest(requestID, now.Add(time.Second))
			if _, err := store.UpsertStepResult(ctx, want); err != nil {
				t.Fatalf("create step result: %v", err)
			}

			conflict := stepResultProjectionForImmutabilityTest(requestID, now.Add(time.Second))
			mutate(&conflict)
			if _, err := store.UpsertStepResult(ctx, conflict); !errors.Is(err, execution.ErrStepResultProjectionConflict) {
				t.Fatalf("conflicting replay error = %v, want execution.ErrStepResultProjectionConflict", err)
			}

			assertStoredStepResultForImmutabilityTest(t, store, want)
		})
	}
}

func TestInMemoryStepResultProjectionRejectsNonJSONPayload(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 14, 15, 0, 0, time.UTC)
	const requestID = "run-step-result-invalid-json"
	createRunProjectionForTest(t, store, requestID, "conv-step-result-invalid-json", now)
	result := stepResultProjectionForImmutabilityTest(requestID, now.Add(time.Second))
	result.SanitizedPayload["invalid"] = make(chan struct{})
	if _, err := store.UpsertStepResult(ctx, result); !errors.Is(err, execution.ErrInvalidStepResult) {
		t.Fatalf("invalid JSON payload error = %v, want execution.ErrInvalidStepResult", err)
	}
	results, err := store.ListStepResults(ctx, requestID)
	if err != nil || len(results) != 0 {
		t.Fatalf("results after invalid payload = %#v, error = %v", results, err)
	}
}

func TestInMemoryStepResultProjectionRejectsWritesAfterRunTerminal(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 14, 20, 0, 0, time.UTC)
	const requestID = "run-step-result-terminal"
	createRunProjectionForTest(t, store, requestID, "conv-step-result-terminal", now)
	want := stepResultProjectionForImmutabilityTest(requestID, now.Add(time.Second))
	if _, err := store.UpsertStepResult(ctx, want); err != nil {
		t.Fatalf("create step result: %v", err)
	}
	transitionRunToCompletedForStepResultTest(t, store, requestID, now.Add(2*time.Second))

	if _, err := store.UpsertStepResult(ctx, stepResultProjectionForImmutabilityTest(requestID, now.Add(time.Second))); !errors.Is(err, execution.ErrDurableRunTerminalConflict) {
		t.Fatalf("terminal exact replay error = %v, want execution.ErrDurableRunTerminalConflict", err)
	}
	newResult := stepResultProjectionForImmutabilityTest(requestID, now.Add(6*time.Second))
	newResult.ResultID = "result-agent-2"
	if _, err := store.UpsertStepResult(ctx, newResult); !errors.Is(err, execution.ErrDurableRunTerminalConflict) {
		t.Fatalf("terminal new result error = %v, want execution.ErrDurableRunTerminalConflict", err)
	}

	assertStoredStepResultForImmutabilityTest(t, store, want)
}

func TestInMemoryStepResultProjectionAllowsOnlyPostCompletionMemoryAppend(t *testing.T) {
	now := time.Date(2026, 7, 23, 14, 30, 0, 0, time.UTC)
	allowed := []struct {
		name       string
		stepID     string
		resultKind string
	}{
		{
			name:       "memory append",
			stepID:     "memory.append",
			resultKind: "memory_conversation_append_result",
		},
	}
	for _, testCase := range allowed {
		t.Run(testCase.name, func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			ctx := context.Background()
			requestID := "run-post-completion-" + testCase.stepID
			createRunProjectionForTest(t, store, requestID, "conv-"+requestID, now)
			transitionRunToCompletedForStepResultTest(t, store, requestID, now.Add(time.Second))
			result := postCompletionMemoryResultForTest(
				requestID,
				testCase.stepID,
				testCase.resultKind,
				now.Add(6*time.Second),
			)
			created, err := store.UpsertStepResult(ctx, result)
			if err != nil {
				t.Fatalf("create post-completion memory result: %v", err)
			}
			if _, err := store.UpsertStepResult(ctx, result); err != nil {
				t.Fatalf("replay post-completion memory result: %v", err)
			}
			conflict := result
			conflict.SanitizedPayload = map[string]any{"status": "changed"}
			if _, err := store.UpsertStepResult(ctx, conflict); !errors.Is(
				err,
				execution.ErrStepResultProjectionConflict,
			) {
				t.Fatalf("post-completion conflicting replay error = %v", err)
			}
			assertStoredStepResultForImmutabilityTest(t, store, created)
		})
	}

	disallowed := []struct {
		id             string
		name           string
		status         execution.DurableRunStatus
		terminalReason execution.DurableTerminalReason
		stepID         string
		resultKind     string
	}{
		{
			id:         "completed-append-wrong-kind",
			name:       "completed append with wrong kind",
			status:     execution.DurableRunStatusCompleted,
			stepID:     "memory.append",
			resultKind: "agent_final_output",
		},
		{
			id:         "completed-personal-memory-tool",
			name:       "completed personal memory tool",
			status:     execution.DurableRunStatusCompleted,
			stepID:     "sdk_tool.execute.personal_memory_recall.1",
			resultKind: "typed_tool_result",
		},
		{
			id:             "failed-memory-append",
			name:           "failed memory append",
			status:         execution.DurableRunStatusFailed,
			terminalReason: execution.DurableTerminalReasonRuntimeInvariant,
			stepID:         "memory.append",
			resultKind:     "memory_conversation_append_result",
		},
		{
			id:             "canceled-memory-append",
			name:           "canceled memory append",
			status:         execution.DurableRunStatusCanceled,
			terminalReason: execution.DurableTerminalReasonUserCanceled,
			stepID:         "memory.append",
			resultKind:     "memory_conversation_append_result",
		},
		{
			id:             "expired-memory-append",
			name:           "expired memory append",
			status:         execution.DurableRunStatusExpired,
			terminalReason: execution.DurableTerminalReasonRunTimeout,
			stepID:         "memory.append",
			resultKind:     "memory_conversation_append_result",
		},
	}
	for _, testCase := range disallowed {
		t.Run(testCase.name, func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			ctx := context.Background()
			requestID := "run-disallowed-" + testCase.id
			createRunProjectionForTest(t, store, requestID, "conv-"+requestID, now)
			if testCase.status == execution.DurableRunStatusCompleted {
				transitionRunToCompletedForStepResultTest(t, store, requestID, now.Add(time.Second))
			} else if _, err := store.TransitionRun(
				ctx,
				requestID,
				testCase.status,
				testCase.terminalReason,
				now.Add(time.Second),
			); err != nil {
				t.Fatalf("transition run to %s: %v", testCase.status, err)
			}
			result := postCompletionMemoryResultForTest(
				requestID,
				testCase.stepID,
				testCase.resultKind,
				now.Add(6*time.Second),
			)
			if _, err := store.UpsertStepResult(ctx, result); !errors.Is(
				err,
				execution.ErrDurableRunTerminalConflict,
			) {
				t.Fatalf("terminal memory result error = %v, want execution.ErrDurableRunTerminalConflict", err)
			}
		})
	}
}

func stepResultProjectionForImmutabilityTest(requestID string, createdAt time.Time) execution.StepResultProjection {
	return execution.StepResultProjection{
		ResultID:             "result-agent-1",
		StepID:               "agent.primary",
		RequestID:            requestID,
		AttemptID:            "attempt-agent-1",
		Status:               "completed",
		ResultKind:           "agent_final_output",
		ProjectionRef:        "runtime.agent_run_steps/agent.primary",
		CreatedAt:            createdAt,
		PayloadSchemaVersion: "step-result-v1",
		SanitizedPayload: map[string]any{
			"citations":     []any{"doc-1", "doc-2"},
			"large_counter": int64(9007199254740993),
			"labels":        []string{"evidence_based", "memory"},
			"metadata":      map[string]string{"source": "agent"},
			"observed_at":   createdAt,
			"outcome":       "answer",
			"structured": stepResultStructuredPayloadForTest{
				Labels:   []string{"first", "second"},
				Metadata: map[string]string{"source": "structured-agent"},
			},
			"usage": map[string]any{"input_tokens": float64(12)},
		},
	}
}

func postCompletionMemoryResultForTest(
	requestID string,
	stepID string,
	resultKind string,
	createdAt time.Time,
) execution.StepResultProjection {
	return execution.StepResultProjection{
		ResultID:             requestID + ":" + stepID + ":result:1",
		StepID:               stepID,
		RequestID:            requestID,
		AttemptID:            requestID + ":" + stepID + ":attempt:1",
		Status:               "completed",
		ResultKind:           resultKind,
		ProjectionRef:        "projection://runs/" + requestID + "/" + stepID,
		CreatedAt:            createdAt,
		PayloadSchemaVersion: "step-result-v1",
		SanitizedPayload:     map[string]any{"status": "completed"},
	}
}

func transitionRunToCompletedForStepResultTest(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	requestID string,
	now time.Time,
) {
	t.Helper()
	ctx := context.Background()
	transitions := []struct {
		status execution.DurableRunStatus
		reason execution.DurableTerminalReason
	}{
		{status: execution.DurableRunStatusQueued},
		{status: execution.DurableRunStatusAdmitted},
		{status: execution.DurableRunStatusRunning},
		{status: execution.DurableRunStatusCompleted, reason: execution.DurableTerminalReasonAnswerCompleted},
	}
	for index, transition := range transitions {
		if _, err := store.TransitionRun(
			ctx,
			requestID,
			transition.status,
			transition.reason,
			now.Add(time.Duration(index)*time.Second),
		); err != nil {
			t.Fatalf("transition run to %s: %v", transition.status, err)
		}
	}
}

func assertStoredStepResultForImmutabilityTest(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	want execution.StepResultProjection,
) {
	t.Helper()
	results, err := store.ListStepResults(context.Background(), want.RequestID)
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("step result count = %d, want 1: %#v", len(results), results)
	}
	assertStepResultProjectionForImmutabilityTest(t, results[0], want)
}

func assertStepResultProjectionForImmutabilityTest(
	t *testing.T,
	got execution.StepResultProjection,
	want execution.StepResultProjection,
) {
	t.Helper()
	if got.ResultID != want.ResultID ||
		got.StepID != want.StepID ||
		got.RequestID != want.RequestID ||
		got.AttemptID != want.AttemptID ||
		got.Status != want.Status ||
		got.ResultKind != want.ResultKind ||
		got.ProjectionRef != want.ProjectionRef ||
		!got.CreatedAt.Equal(want.CreatedAt) ||
		got.PayloadSchemaVersion != want.PayloadSchemaVersion ||
		!reflect.DeepEqual(got.SanitizedPayload, want.SanitizedPayload) {
		t.Fatalf("step result = %#v, want %#v", got, want)
	}
}
