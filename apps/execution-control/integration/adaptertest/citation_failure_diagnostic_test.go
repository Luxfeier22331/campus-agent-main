package adaptertest

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/execution"
	finalizationactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type citationRuntimeClient struct {
	body   string
	status int
}

func (c citationRuntimeClient) Execute(context.Context, executionapplication.AgentRuntimeRequest) (executionapplication.AgentRuntimeResponse, error) {
	return executionapplication.AgentRuntimeResponse{StatusCode: c.status, Body: io.NopCloser(strings.NewReader(c.body))}, nil
}

func TestRecoveryCitationDiagnosticSurvivesTerminalAndReplay(t *testing.T) {
	const wireFailure = `{"code":"citation_validation_failed","operation":"workflow.synthesize","reason":"span_out_of_bounds","citation":{"schema_version":1,"validation_stage":"provider_annotation","start":0,"end":9,"text_length":4,"offset_unit":"utf16_code_unit"}}`
	for _, mode := range []string{"http_error", "sse_error", "failed_result"} {
		t.Run(mode, func(t *testing.T) {
			ctx := context.Background()
			store := executionpersistence.NewInMemoryRunProjectionStore()
			now := time.Now().UTC()
			createQueuedDurableRunForTest(t, store, "recovery-citation", "citation-conv", now, nil)
			server := newWorkerAuthAdapterForTest()
			attachRunProjectionStoreForAdapterTest(server, store)
			callbacks := 0
			server.ProductFinalizationWriter = func(context.Context, execution.DurableRun, time.Time, map[string]any) error { callbacks++; return nil }
			run, err := store.GetRun(ctx, "recovery-citation")
			if err != nil {
				t.Fatal(err)
			}
			runtime := &executionactivities.Adapter{AgentRuntimeClient: citationRuntimeClient{body: `{"error":` + wireFailure + `}`, status: 422}}
			payload := map[string]any{"failure": map[string]any{"code": "citation_validation_failed"}}
			switch mode {
			case "http_error":
				_, err = runtime.CallWorkflowOperationRuntime(ctx, run, temporalruntime.WorkflowOperationSynthesize, "", []byte(`{}`), 60000, false)
			case "sse_error":
				_, err = runtime.ConsumeWorkflowRuntimeStream(ctx, run, temporalruntime.WorkflowOperationSynthesize, strings.NewReader("event: error\ndata: "+wireFailure+"\n\n"))
			case "failed_result":
				runtime.AgentRuntimeClient = citationRuntimeClient{body: `{"request_id":"recovery-citation","status":"failed","failure":` + wireFailure + `}`, status: 200}
				response, callErr := runtime.CallWorkflowOperationRuntime(ctx, run, temporalruntime.WorkflowOperationSynthesize, "", []byte(`{}`), 60000, false)
				if callErr != nil {
					t.Fatal(callErr)
				}
				output, outputErr := executionactivities.WorkflowOperationOutputFromRuntimeResponse(response, temporalruntime.WorkflowOperationSynthesize, "review-result")
				if outputErr != nil {
					t.Fatal(outputErr)
				}
				encoded, encodeErr := json.Marshal(output.Failure)
				if encodeErr != nil {
					t.Fatal(encodeErr)
				}
				var failure map[string]any
				if decodeErr := json.Unmarshal(encoded, &failure); decodeErr != nil {
					t.Fatal(decodeErr)
				}
				payload["failure"] = failure
			}
			if mode != "failed_result" {
				if err == nil {
					t.Fatal("expected runtime failure")
				}
				executionactivities.AddWorkflowFailureEvidence(payload, err)
			}
			// A different step with the same code must not supply the terminal cause.
			for _, step := range []activityprojection.TemporalStepProjection{
				{Run: run, StepID: "solve.initial", StepKind: "solver", Status: "failed", UpdatedAt: now, Payload: map[string]any{"failure": map[string]any{"code": "citation_validation_failed", "reason": "invalid_url"}}},
				{Run: run, StepID: "answer.synthesize", StepKind: "synthesizer", Status: "failed", UpdatedAt: now, Payload: payload},
			} {
				if err := server.ProjectTemporalStep(ctx, step); err != nil {
					t.Fatal(err)
				}
			}
			input := temporalruntime.FinalizeExecutionFailureActivityInput{RequestID: run.RequestID, Stage: "answer.synthesize", FailureKind: "answer_synthesis_failed", FailedAt: time.Now().UTC()}
			for range 2 {
				if _, err := server.FinalizeExecutionFailure(ctx, input); err != nil {
					t.Fatal(err)
				}
			}
			events, err := store.ListRunEvents(ctx, run.RequestID)
			if err != nil {
				t.Fatal(err)
			}
			count := 0
			for _, event := range events {
				if event.EventType == execution.DurableRunEventTypeRunFailed && event.Payload["failure_kind"] != "answer_synthesis_failed" {
					t.Fatalf("terminal classification changed: %#v", event.Payload)
				}
				if event.EventType != execution.DurableRunEventTypeActivityFailed {
					continue
				}
				count++
				failure := execution.CloneAnyMapFromValue(event.Payload["failure"])
				if failure["code"] != "answer_synthesis_failed" || failure["source_code"] != "citation_validation_failed" || failure["reason"] != "span_out_of_bounds" || failure["citation"] == nil {
					t.Fatalf("terminal lost original cause: %#v", failure)
				}
				if event.Payload["step_id"] != "answer.synthesize" {
					t.Fatalf("wrong step: %#v", event.Payload)
				}
			}
			if count != 1 || callbacks != 1 {
				t.Fatalf("events=%d callbacks=%d", count, callbacks)
			}
		})
	}
}

func TestCitationDiagnosticSurvivesFinalizationAndReplay(t *testing.T) {
	ctx := context.Background()
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Now().UTC().Add(-time.Minute)
	createQueuedDurableRunForTest(t, store, "citation-diag", "citation-conv", now, nil)
	server := newWorkerAuthAdapterForTest()
	attachRunProjectionStoreForAdapterTest(server, store)
	callbacks := 0
	server.ProductFinalizationWriter = func(_ context.Context, _ execution.DurableRun, _ time.Time, response map[string]any) error {
		callbacks++
		encoded, _ := json.Marshal(response)
		var payload map[string]any
		if err := json.Unmarshal(encoded, &payload); err != nil {
			t.Fatal(err)
		}
		return nil
	}
	run, err := store.GetRun(ctx, "citation-diag")
	if err != nil {
		t.Fatal(err)
	}
	if err := server.ProjectTemporalStep(ctx, activityprojection.TemporalStepProjection{Run: run, StepID: "solve.initial", StepKind: "solver", Status: "failed", StartedAt: now, CompletedAt: now, UpdatedAt: now, Payload: map[string]any{"failure": map[string]any{"code": "citation_validation_failed", "reason": "invalid_url"}}}); err != nil {
		t.Fatal(err)
	}
	_, cause := finalizationactivities.WorkflowEvidenceCitationClosureForFinalization(nil, "缺失引用 [9]")
	if _, err := server.FailFinalizationActivity(ctx, run, "", "citation_validation_failed", "", cause); err == nil {
		t.Fatal("expected citation rejection")
	}
	input := temporalruntime.FinalizeExecutionFailureActivityInput{RequestID: run.RequestID, Stage: "finalization.write", FailureKind: "citation_validation_failed", FailedAt: time.Now().UTC()}
	for range 2 {
		if _, err := server.FinalizeExecutionFailure(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	events, err := store.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, event := range events {
		if event.EventType != execution.DurableRunEventTypeActivityFailed {
			continue
		}
		count++
		failure := execution.CloneAnyMapFromValue(event.Payload["failure"])
		if failure["reason"] != "missing_evidence" {
			t.Fatalf("wrong stage diagnostic: %#v", failure)
		}
		encoded, err := json.Marshal(failure["citation"])
		if err != nil {
			t.Fatal(err)
		}
		var facts map[string]any
		if err := json.Unmarshal(encoded, &facts); err != nil {
			t.Fatal(err)
		}
		if execution.StringValue(facts["validation_stage"]) != "finalization" {
			t.Fatalf("facts lost: %#v", failure)
		}
		if event.Payload["step_id"] != "finalization.write" {
			t.Fatalf("stage identity lost: %#v", event.Payload)
		}
	}
	if count != 1 || callbacks != 1 {
		t.Fatalf("events=%d callbacks=%d", count, callbacks)
	}
}

func TestRecoveryTerminalDoesNotBorrowUnrelatedDiagnosis(t *testing.T) {
	for _, scenario := range []string{"other_step", "successful_step", "other_terminal_code", "later_projection"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := context.Background()
			store := executionpersistence.NewInMemoryRunProjectionStore()
			now := time.Now().UTC()
			createQueuedDurableRunForTest(t, store, "unrelated-citation", "citation-conv", now, nil)
			server := newWorkerAuthAdapterForTest()
			attachRunProjectionStoreForAdapterTest(server, store)
			server.ProductFinalizationWriter = func(context.Context, execution.DurableRun, time.Time, map[string]any) error { return nil }
			run, err := store.GetRun(ctx, "unrelated-citation")
			if err != nil {
				t.Fatal(err)
			}
			step := activityprojection.TemporalStepProjection{Run: run, StepID: "answer.synthesize", StepKind: "synthesizer", Status: "failed", UpdatedAt: now, Payload: map[string]any{"failure": map[string]any{"code": "citation_validation_failed", "reason": "invalid_url"}}}
			input := temporalruntime.FinalizeExecutionFailureActivityInput{RequestID: run.RequestID, Stage: "answer.synthesize", FailureKind: "answer_synthesis_failed", FailedAt: now}
			switch scenario {
			case "other_step":
				step.StepID = "solve.initial"
			case "successful_step":
				step.Status = "completed"
			case "other_terminal_code":
				input.FailureKind = "provider_timeout"
			case "later_projection":
				step.UpdatedAt = now.Add(time.Second)
			}
			if err := server.ProjectTemporalStep(ctx, step); err != nil {
				t.Fatal(err)
			}
			if _, err := server.FinalizeExecutionFailure(ctx, input); err != nil {
				t.Fatal(err)
			}
			events, err := store.ListRunEvents(ctx, run.RequestID)
			if err != nil {
				t.Fatal(err)
			}
			for _, event := range events {
				if event.EventType != execution.DurableRunEventTypeActivityFailed {
					continue
				}
				failure := execution.CloneAnyMapFromValue(event.Payload["failure"])
				if failure["reason"] != nil || failure["source_code"] != nil {
					t.Fatalf("borrowed unrelated cause: %#v", failure)
				}
			}
		})
	}
}
