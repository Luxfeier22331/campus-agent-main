package adaptertest

import (
	"context"
	"fmt"
	applicationcontract "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
)

func TestRetrievalStreamPersistsReplayAndClosesInterruptedSearch(t *testing.T) {
	for _, status := range []string{"completed", "no_match", "failed", "canceled", "interrupted"} {
		t.Run(status, func(t *testing.T) {
			ctx := context.Background()
			store := executionpersistence.NewInMemoryRunProjectionStore()
			createQueuedDurableRunForTest(t, store, "retrieval", "conv", time.Now(), agentRequestForDurableWorkerTest("test"))
			for _, state := range []execution.DurableRunStatus{execution.DurableRunStatusAdmitted, execution.DurableRunStatusRunning} {
				if _, err := store.TransitionRun(ctx, "retrieval", state, "", time.Now()); err != nil {
					t.Fatal(err)
				}
			}
			run, _ := store.GetRun(ctx, "retrieval")
			adapter := &executionactivities.OperationService{StateWriter: store, Writer: &activityprojection.Writer{RunProjectionStore: store}}
			frame := func(status string) string {
				return fmt.Sprintf("event: retrieval_status\ndata: {\"schema_version\":\"workflow_runtime_retrieval_status.v1\",\"source\":\"campus\",\"status\":\"%s\",\"occurred_at\":\"2026-09-18T00:00:00Z\"}\n\n", status)
			}
			body := frame("started")
			if status != "interrupted" {
				body += frame(status)
			}
			body += "event: failed\ndata: {\"request_id\":\"retrieval\",\"status\":\"failed\",\"operation\":\"execute_step\",\"failure\":{\"code\":\"provider_timeout\",\"operation\":\"execute_step\"}}\n\n"
			result, err := adapter.ConsumeWorkflowRuntimeStream(ctx, run, applicationcontract.WorkflowOperationExecuteStep, runtimeEvents(strings.NewReader(body)))
			if err != nil || result.AnswerStarted {
				t.Fatalf("result=%#v err=%v", result, err)
			}
			events, err := store.ListRunEvents(ctx, "retrieval")
			if err != nil {
				t.Fatal(err)
			}
			retrieval := []execution.DurableRunEvent{}
			for _, event := range events {
				if event.EventType == execution.DurableRunEventTypeRunRetrievalStatus {
					retrieval = append(retrieval, event)
				}
				if event.EventType == execution.DurableRunEventTypeRunAnswerDelta {
					t.Fatal("executor emitted an answer")
				}
			}
			want := status
			if want == "interrupted" {
				want = "failed"
			}
			if len(retrieval) != 2 || retrieval[0].Payload["status"] != "started" || retrieval[1].Payload["status"] != want {
				t.Fatalf("events=%#v", retrieval)
			}
			if len(retrieval[0].Payload) != 2 {
				t.Fatal("unexpected public payload")
			}
			replay, err := store.ListRunEventsAfter(ctx, "retrieval", retrieval[0].Sequence)
			if err != nil || len(replay) != 1 || replay[0].Sequence != retrieval[1].Sequence {
				t.Fatalf("replay=%#v err=%v", replay, err)
			}
		})
	}
}
