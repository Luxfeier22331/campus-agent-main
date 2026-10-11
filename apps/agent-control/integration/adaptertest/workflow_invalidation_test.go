package adaptertest

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/integration/agenttest"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	applicationcontract "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
)

func TestAnswerInvalidationPreservesFailureAndRejectsSuccess(t *testing.T) {
	for _, terminal := range []string{"error", "failed", "completed", "answer_delta"} {
		t.Run(terminal, func(t *testing.T) {
			store := executionpersistence.NewInMemoryRunProjectionStore()
			agenttest.CreateQueuedRun(t, store, "invalidation")
			for _, status := range []execution.DurableRunStatus{execution.DurableRunStatusAdmitted, execution.DurableRunStatusRunning} {
				if _, err := store.TransitionRun(t.Context(), "invalidation", status, "", time.Now()); err != nil {
					t.Fatal(err)
				}
			}
			run, err := store.GetRun(t.Context(), "invalidation")
			if err != nil {
				t.Fatal(err)
			}
			adapter := &executionactivities.OperationService{StateWriter: store, Writer: &activityprojection.Writer{RunProjectionStore: store}}
			body := "event: answer_delta\ndata: {\"schema_version\":\"workflow_runtime_answer_delta.v2\",\"delta\":\"draft\",\"provisional\":true}\n\nevent: answer_invalidated\ndata: {\"schema_version\":\"workflow_runtime_answer_invalidation.v1\",\"reason\":\"terminal_result_unavailable\"}\n\n"
			payload := `{"request_id":"invalidation","operation":"synthesize","status":"` + terminal + `","failure":{"code":"model_output_invalid","operation":"workflow.synthesize"}}`
			if terminal == "answer_delta" {
				payload = `{"schema_version":"workflow_runtime_answer_delta.v2","delta":"late draft","provisional":true}`
			}
			if terminal == "error" {
				payload = `{"code":"provider_timeout","operation":"workflow.synthesize","detail":"original error"}`
			}
			response, err := adapter.ConsumeWorkflowRuntimeStream(t.Context(), run, applicationcontract.WorkflowOperationSynthesize, runtimeEvents(strings.NewReader(body+"event: "+terminal+"\ndata: "+payload+"\n\n")))
			switch terminal {
			case "error":
				var failure executionapplication.AgentRuntimeFailure
				if !errors.As(err, &failure) || failure.Code != "provider_timeout" || failure.Detail != "original error" {
					t.Fatalf("lost failure: %v", err)
				}
			case "failed":
				if err != nil || response.Failure == nil || response.Failure.Code != "model_output_invalid" || !response.AnswerStarted {
					t.Fatalf("response=%#v error=%v", response, err)
				}
			default:
				if err == nil || !strings.Contains(err.Error(), "invalidation") {
					t.Fatalf("accepted invalid continuation: %v", err)
				}
			}
			events, err := store.ListRunEvents(t.Context(), run.RequestID)
			if err != nil {
				t.Fatal(err)
			}
			for _, event := range events {
				if event.EventType == execution.DurableRunEventTypeRunAnswerCompleted {
					t.Fatal("failed draft marked complete")
				}
			}
		})
	}
}
