//go:build temporal_integration

package temporal_test

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/adaptertest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/agentruntimetest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/agenttest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporaltest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeassembly"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolcontract"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
)

type runtimeContractStore struct {
	*executionpersistence.InMemoryRunProjectionStore
	intent execution.WorkflowStartIntent
}

func (s *runtimeContractStore) GetWorkflowStartIntent(context.Context, string) (execution.WorkflowStartIntent, error) {
	return s.intent, nil
}

func TestProductionAgentRuntimeWorkflowContract(t *testing.T) {
	for _, memory := range []bool{false, true} {
		name := "campus"
		if memory {
			name = "memory"
		}
		t.Run(name, func(t *testing.T) { testProductionAgentRuntimeWorkflowContract(t, memory) })
	}
}

func testProductionAgentRuntimeWorkflowContract(t *testing.T, memory bool) {
	address := agentruntimetest.Start(t)
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	store := &runtimeContractStore{InMemoryRunProjectionStore: executionpersistence.NewInMemoryRunProjectionStore()}
	requestID := packageHarness.NewWorkflowID("runtime-contract")
	if memory {
		requestID = packageHarness.NewWorkflowID("runtime-memory")
	}
	input := agenttest.CreateQueuedRun(t, store, requestID)
	snapshot := agenttest.AdmissionSnapshot(t, memory)
	cfg := config.Config{AgentRuntimeBaseURL: address, AgentRuntimeSharedSecret: "integration-secret"}
	callbacks := 0
	adapter := adaptertest.New(adaptertest.Options{
		Config: cfg, RunProjectionStore: store, ReceiptStore: store.Receipts, ExecutionInputLoader: input,
		AdmissionService:   executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{ToolContract: toolcontract.Files{}}),
		AgentRuntimeClient: outboundadapter.NewAgentRuntimeClient(cfg),
		ProductFinalizationWriter: func(_ context.Context, _ execution.DurableRun, _ time.Time, response map[string]any) error {
			callbacks++
			if response["answer_text"] != "暂未找到相关校园服务资料。" {
				return context.Canceled
			}
			return nil
		},
	})
	workflowID := packageHarness.NewWorkflowID("runtime-workflow")
	workflowRun, err := packageHarness.Client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{ID: workflowID, TaskQueue: temporalruntime.WorkflowTaskQueue}, temporalruntime.ToolExecutionWorkflow, temporalruntime.ToolExecutionWorkflowInput{
		RequestID: requestID, ConversationID: input.Wire.ConversationID, WorkflowID: workflowID,
		AdmissionSnapshot: workflowcontract.AdmissionToWorkflow(snapshot),
	})
	if err != nil {
		t.Fatal(err)
	}
	// Bind the actual root execution before workers can consume the first task.
	store.intent = execution.WorkflowStartIntent{RequestID: requestID, WorkflowID: workflowID, TemporalRunID: workflowRun.GetRunID(), State: execution.LifecycleIntentStateConfirmed}
	fake := &temporalfake.Activities{}
	packageHarness.StartCustomWorkers(t,
		temporaltest.WorkerSpec{Queue: temporalruntime.WorkflowTaskQueue, Kind: "workflow", New: func(c client.Client) worker.Worker {
			return runtimeassembly.NewWorkflowWorkerWithOptions(c, temporalruntime.WorkflowTaskQueue, temporaltest.Options())
		}},
		temporaltest.WorkerSpec{Queue: temporalruntime.ActivityTaskQueueCore, Kind: "core", New: func(c client.Client) worker.Worker {
			return runtimeassembly.NewCoreActivityWorkerWithOptions(c, temporalruntime.ActivityTaskQueueCore, fake, adapter.FinalizationAdapter, temporaltest.Options())
		}},
		temporaltest.WorkerSpec{Queue: temporalruntime.ActivityTaskQueueAgent, Kind: "agent", New: func(c client.Client) worker.Worker {
			return runtimeassembly.NewWorkflowOperationActivityWorkerWithOptions(c, temporalruntime.ActivityTaskQueueAgent, adapter.ExecutionAdapter, temporaltest.Options())
		}},
	)
	packageHarness.CleanupRun(t, workflowID, workflowRun.GetRunID())
	var result temporalruntime.ToolExecutionWorkflowResult
	if err := workflowRun.Get(ctx, &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || callbacks != 1 {
		t.Fatalf("result=%+v callbacks=%d", result, callbacks)
	}
	history, err := packageHarness.History(ctx, workflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatal(err)
	}
	scheduled := map[int64]string{}
	counts := map[string]int{}
	for _, event := range history.Events {
		if attrs := event.GetActivityTaskScheduledEventAttributes(); attrs != nil {
			scheduled[event.EventId] = attrs.ActivityType.Name
			for _, payload := range attrs.Input.Payloads {
				if len(payload.Data) > execution.MaxAgentOperationPayloadBytes {
					t.Fatal("oversized input entered history")
				}
				if strings.Contains(string(payload.Data), "private-query-sentinel") {
					t.Fatal("raw query entered history")
				}
				if attrs.ActivityType.Name == temporalruntime.SynthesizeAnswerActivityName {
					var value map[string]any
					if err := json.Unmarshal(payload.Data, &value); err != nil {
						t.Fatal(err)
					}
					if _, ok := value["plan"]; ok {
						t.Fatal("synthesis retained plan")
					}
					if _, ok := value["completed_steps"]; ok {
						t.Fatal("synthesis retained completed steps")
					}
					if _, ok := value["remaining_facts"]; !ok {
						t.Fatal("synthesis lost remaining facts")
					}
				}
			}
		}
		if attrs := event.GetActivityTaskCompletedEventAttributes(); attrs != nil {
			counts[scheduled[attrs.ScheduledEventId]]++
			for _, payload := range attrs.Result.Payloads {
				if len(payload.Data) > execution.MaxAgentOperationPayloadBytes {
					t.Fatal("oversized output entered history")
				}
				if strings.Contains(string(payload.Data), "private-query-sentinel") || strings.Contains(string(payload.Data), "structured_output") || strings.Contains(string(payload.Data), "arguments_json") {
					t.Fatal("redundant/raw output entered history")
				}
				if strings.Contains(string(payload.Data), "private-debug-sentinel") || strings.Contains(string(payload.Data), "memory_text") {
					t.Fatal("raw memory tool result entered history")
				}
				if memory && scheduled[attrs.ScheduledEventId] == temporalruntime.ExecuteTaskStepActivityName {
					if strings.Count(string(payload.Data), strings.Repeat("😀", 4000)) != 1 {
						t.Fatal("memory excerpt must occur exactly once in operation output")
					}
				}
			}
		}
	}
	for _, name := range []string{temporalruntime.SolveTaskActivityName, temporalruntime.ExecuteTaskStepActivityName, temporalruntime.ReplanTaskActivityName, temporalruntime.SynthesizeAnswerActivityName, temporalruntime.WriteWorkflowFinalizationActivityName} {
		want := 1
		if memory && name == temporalruntime.ReplanTaskActivityName {
			want = 0
		}
		if counts[name] != want {
			t.Fatalf("activity %s count=%d", name, counts[name])
		}
	}
	replayer := worker.NewWorkflowReplayer()
	replayer.RegisterWorkflowWithOptions(temporalruntime.ToolExecutionWorkflow, workflow.RegisterOptions{Name: temporalruntime.ToolExecutionWorkflowType})
	if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("UPDATE_TEMPORAL_REPLAY_FIXTURES") == "1" && !memory {
		raw, err := protojson.Marshal(history)
		if err != nil {
			t.Fatal(err)
		}
		fixture := replayFixture{WorkflowType: temporalruntime.ToolExecutionWorkflowType, GenerationVersion: "tool-execution/current", Producer: "production-node-runtime", ExpectedStatus: "completed", History: raw}
		encoded, err := json.MarshalIndent(fixture, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile("testdata/replay/tool_execution_current.json", append(encoded, '\n'), 0644); err != nil {
			t.Fatal(err)
		}
	}
}
