//go:build stream_integration

package stream_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	temporaladapter "github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/adaptertest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/agenttest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
)

// Characterize #401 without changing visibility semantics: deltas are already
// browser-visible before completed validation and survive failure finalization.
func TestInvalidCompletedResponseRetainsPreviouslyVisibleDelta(t *testing.T) {
	for _, kind := range []string{"citation", "source_attempts", "json"} {
		t.Run(kind, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			store := executionpersistence.NewInMemoryRunProjectionStore()
			requestID := "stream-invalid-" + kind
			input := agenttest.CreateQueuedRun(t, store, requestID)
			snapshot := agenttest.AdmissionSnapshot(t)
			fake := temporalfake.Activities{}
			base := temporalruntime.WorkflowOperationActivityInputBase{
				RequestID: requestID, ConversationID: input.Wire.ConversationID, AdmissionSnapshot: workflowcontract.AdmissionToWorkflow(snapshot),
			}
			planned, err := fake.SolveTaskActivity(ctx, temporalruntime.SolveTaskActivityInput{WorkflowOperationActivityInputBase: base})
			if err != nil {
				t.Fatal(err)
			}
			step, err := fake.ExecuteTaskStepActivity(ctx, temporalruntime.ExecuteTaskStepActivityInput{Step: planned.Plan.Steps[0]})
			if err != nil {
				t.Fatal(err)
			}
			synthesis := temporalruntime.SynthesizeAnswerActivityInput{
				WorkflowOperationActivityInputBase: base,
				SourceAttempts:                     step.SourceAttempts,
				Evidence:                           step.Evidence,
			}
			allowCompleted := make(chan struct{})
			defer close(allowCompleted)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/internal/agent-requests/stream" || r.Header.Get("authorization") != "Bearer integration-secret" {
					http.Error(w, "unexpected runtime request", http.StatusBadRequest)
					return
				}
				w.Header().Set("content-type", "text/event-stream")
				_, _ = fmt.Fprint(w, "event: answer_delta\ndata: {\"schema_version\":\"workflow_runtime_answer_delta.v1\",\"delta\":\"visible draft\"}\n\n")
				w.(http.Flusher).Flush()
				select {
				case <-allowCompleted:
				case <-r.Context().Done():
					return
				}
				if kind == "json" {
					_, _ = fmt.Fprint(w, "event: completed\ndata: {invalid\n\n")
					return
				}
				completed := map[string]any{
					"request_id": requestID, "operation": "synthesize", "status": "completed",
					"final_output": "visible draft",
					"evidence":     step.Evidence, "source_attempts": step.SourceAttempts,
					"tool_contract_fingerprint": execution.ToolContractFingerprintSnapshotMap(snapshot.ToolContractFingerprint),
				}
				if kind == "source_attempts" {
					completed["source_attempts"] = []temporalruntime.WorkflowSourceAttempt{}
				}
				if kind == "citation" {
					evidence := append([]temporalruntime.WorkflowEvidence(nil), step.Evidence...)
					evidence[0].CitationIndex = 99
					completed["evidence"] = evidence
				}
				encoded, marshalErr := json.Marshal(completed)
				if marshalErr != nil {
					t.Error(marshalErr)
					return
				}
				_, _ = fmt.Fprintf(w, "event: completed\ndata: %s\n\n", encoded)
			}))
			t.Cleanup(server.Close)
			cfg := config.Config{AgentRuntimeBaseURL: server.URL, AgentRuntimeSharedSecret: "integration-secret"}
			adapter := temporaladapter.New(temporaladapter.Options{
				Config: cfg, RunProjectionStore: store, ExecutionInputLoader: input,
				AgentRuntimeClient:        outboundadapter.NewAgentRuntimeClient(cfg),
				ProductFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error { return nil },
			})
			done := make(chan error, 1)
			go func() { _, err := adapter.SynthesizeAnswer(ctx, synthesis); done <- err }()
			before := waitForDelta(t, ctx, store, requestID)
			if before.Visibility != execution.DurableRunEventVisibilityBrowser || before.Payload["delta"] != "visible draft" {
				t.Fatalf("pre-validation delta = %#v", before)
			}
			allowCompleted <- struct{}{}
			select {
			case err = <-done:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			var failure *temporal.ApplicationError
			if !errors.As(err, &failure) {
				t.Fatalf("expected completed validation failure, got %v", err)
			}
			_, err = adapter.FinalizeExecutionFailure(ctx, temporalruntime.FinalizeExecutionFailureActivityInput{
				RequestID: requestID, Stage: "answer.synthesize", FailureKind: failure.Type(), FailedAt: time.Now().UTC(),
			})
			if err != nil {
				t.Fatal(err)
			}
			run, err := store.GetRun(ctx, requestID)
			if err != nil || run.Status != execution.DurableRunStatusFailed || run.FinalResponseRef != "" {
				t.Fatalf("final run=%#v err=%v", run, err)
			}
			after := waitForDelta(t, ctx, store, requestID)
			if !reflect.DeepEqual(before, after) {
				t.Fatalf("delta changed after failure: before=%#v after=%#v", before, after)
			}
		})
	}
}

func waitForDelta(t *testing.T, ctx context.Context, store executionapplication.RunStore, requestID string) execution.DurableRunEvent {
	t.Helper()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		events, err := store.ListRunEvents(ctx, requestID)
		if err != nil {
			t.Fatal(err)
		}
		for _, event := range events {
			if event.EventType == execution.DurableRunEventTypeRunAnswerDelta {
				return event
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}
