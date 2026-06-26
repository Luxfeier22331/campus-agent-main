//go:build temporal_e2e

package temporalruntime

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func TestTemporalDevServerRunsCapabilityExecutionWorkflowAndReplaysHistory(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	server, err := testsuite.StartDevServer(ctx, testsuite.DevServerOptions{
		ClientOptions: &client.Options{Namespace: "campus-agent-temporal-e2e"},
		LogLevel:      "error",
	})
	if err != nil {
		t.Fatalf("start Temporal dev server: %v", err)
	}
	defer func() {
		if err := server.Stop(); err != nil {
			t.Fatalf("stop Temporal dev server: %v", err)
		}
	}()
	temporalClient := server.Client()
	activities := &Activities{}
	workers := []worker.Worker{
		NewWorkflowWorker(temporalClient, WorkflowTaskQueue),
		NewContextActivityWorker(temporalClient, ActivityTaskQueueContext, activities),
		NewAgentActivityWorker(temporalClient, ActivityTaskQueueAgent, activities),
		NewKnowledgePlanActivityWorker(temporalClient, ActivityTaskQueueKnowledgePlan, activities, worker.Options{}),
		NewKnowledgeRetrievalActivityWorker(
			temporalClient,
			ActivityTaskQueueKnowledgeRetrieval,
			activities,
			worker.Options{},
		),
		NewKnowledgeSynthesisActivityWorker(
			temporalClient,
			ActivityTaskQueueKnowledgeSynthesis,
			activities,
			worker.Options{},
		),
		NewFinalizationActivityWorker(temporalClient, ActivityTaskQueueFinalization, activities),
	}
	for _, runtimeWorker := range workers {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}

	runID := "run-temporal-devserver-e2e"
	input := workflowTestInput(runID)
	input.WorkflowID = "campus-agent.temporal-e2e." + runID
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        input.WorkflowID,
		TaskQueue: WorkflowTaskQueue,
	}, CapabilityExecutionWorkflow, input)
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	var result CapabilityExecutionWorkflowResult
	if err := workflowRun.Get(ctx, &result); err != nil {
		t.Fatalf("get workflow result: %v", err)
	}
	if result.RunID != runID || result.Status != "completed" {
		t.Fatalf("unexpected workflow result: %#v", result)
	}
	readiness := (&Starter{
		activityTaskQueues: normalizeActivityTaskQueues(nil),
		client:             temporalClient,
		namespace:          "campus-agent-temporal-e2e",
		taskQueue:          WorkflowTaskQueue,
		startTimeout:       5 * time.Second,
	}).CheckReadiness(ctx)
	if !readiness.Healthy {
		t.Fatalf("temporal readiness = %#v", readiness)
	}

	history, err := workflowHistory(ctx, temporalClient, input.WorkflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatalf("workflow history: %v", err)
	}
	if !historyContains(history, enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED) {
		t.Fatal("workflow history did not contain completed event")
	}
	replayer := worker.NewWorkflowReplayer()
	replayer.RegisterWorkflowWithOptions(CapabilityExecutionWorkflow, workflow.RegisterOptions{
		Name: CapabilityExecutionWorkflowType,
	})
	if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
		t.Fatalf("replay workflow history: %v", err)
	}
}

func TestTemporalDevServerRunsKnowledgeBranchAcrossActivityQueues(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	server, err := testsuite.StartDevServer(ctx, testsuite.DevServerOptions{
		ClientOptions: &client.Options{Namespace: "campus-agent-temporal-rag-e2e"},
		LogLevel:      "error",
	})
	if err != nil {
		t.Fatalf("start Temporal dev server: %v", err)
	}
	defer func() {
		if err := server.Stop(); err != nil {
			t.Fatalf("stop Temporal dev server: %v", err)
		}
	}()
	temporalClient := server.Client()
	activities := &knowledgeBranchActivities{}
	workers := []worker.Worker{
		NewWorkflowWorker(temporalClient, WorkflowTaskQueue),
		NewContextActivityWorker(temporalClient, ActivityTaskQueueContext, &activities.Activities),
		NewAgentActivityWorker(temporalClient, ActivityTaskQueueAgent, activities),
		NewKnowledgePlanActivityWorker(temporalClient, ActivityTaskQueueKnowledgePlan, &activities.Activities, worker.Options{}),
		NewKnowledgeRetrievalActivityWorker(
			temporalClient,
			ActivityTaskQueueKnowledgeRetrieval,
			&activities.Activities,
			worker.Options{},
		),
		NewKnowledgeSynthesisActivityWorker(
			temporalClient,
			ActivityTaskQueueKnowledgeSynthesis,
			&activities.Activities,
			worker.Options{},
		),
		NewFinalizationActivityWorker(temporalClient, ActivityTaskQueueFinalization, &activities.Activities),
	}
	for _, runtimeWorker := range workers {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}

	runID := "run-temporal-devserver-rag"
	input := workflowTestInput(runID)
	input.RequestedCapability = "knowledge"
	input.WorkflowID = "campus-agent.temporal-e2e." + runID
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        input.WorkflowID,
		TaskQueue: WorkflowTaskQueue,
	}, CapabilityExecutionWorkflow, input)
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	var result CapabilityExecutionWorkflowResult
	if err := workflowRun.Get(ctx, &result); err != nil {
		t.Fatalf("get workflow result: %v", err)
	}
	if result.RunID != runID || result.Status != "completed" {
		t.Fatalf("unexpected workflow result: %#v", result)
	}

	history, err := workflowHistory(ctx, temporalClient, input.WorkflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatalf("workflow history: %v", err)
	}
	for _, activityName := range []string{
		MemoryRecallActivityName,
		ExecutePrimaryAgentActivityName,
		PlanRAGActivityName,
		RetrieveIndexedLookupActivityName,
		ExpandOrRescueRetrievalActivityName,
		SelectEvidenceActivityName,
		SynthesizeRAGAnswerActivityName,
		VerifyGroundingActivityName,
		WriteFinalizationActivityName,
		AppendConversationMemoryActivityName,
	} {
		if !historyContainsCompletedActivity(history, activityName) {
			t.Fatalf("workflow history missing completed activity %s", activityName)
		}
	}
}

func TestTemporalDevServerCancelWorkflow(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	server, err := testsuite.StartDevServer(ctx, testsuite.DevServerOptions{
		ClientOptions: &client.Options{Namespace: "campus-agent-temporal-cancel-e2e"},
		LogLevel:      "error",
	})
	if err != nil {
		t.Fatalf("start Temporal dev server: %v", err)
	}
	defer func() {
		if err := server.Stop(); err != nil {
			t.Fatalf("stop Temporal dev server: %v", err)
		}
	}()
	temporalClient := server.Client()
	activities := blockingAgentActivities{Activities: Activities{}, started: make(chan struct{})}
	workers := []worker.Worker{
		NewWorkflowWorker(temporalClient, WorkflowTaskQueue),
		NewContextActivityWorker(temporalClient, ActivityTaskQueueContext, &activities.Activities),
		NewAgentActivityWorker(temporalClient, ActivityTaskQueueAgent, &activities),
		NewFinalizationActivityWorker(temporalClient, ActivityTaskQueueFinalization, &activities.Activities),
	}
	for _, runtimeWorker := range workers {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}
	runID := "run-temporal-devserver-cancel"
	input := workflowTestInput(runID)
	input.WorkflowID = "campus-agent.temporal-e2e." + runID
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        input.WorkflowID,
		TaskQueue: WorkflowTaskQueue,
	}, CapabilityExecutionWorkflow, input)
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	select {
	case <-activities.started:
	case <-ctx.Done():
		t.Fatalf("wait for agent activity start: %v", ctx.Err())
	}
	starter := &Starter{
		client:       temporalClient,
		namespace:    "campus-agent-temporal-cancel-e2e",
		taskQueue:    WorkflowTaskQueue,
		startTimeout: 5 * time.Second,
	}
	if err := starter.CancelCapabilityExecutionWorkflow(ctx, CapabilityExecutionWorkflowCancelInput{
		RunID:      runID,
		WorkflowID: input.WorkflowID,
	}); err != nil {
		t.Fatalf("cancel workflow: %v", err)
	}
	var result CapabilityExecutionWorkflowResult
	err = workflowRun.Get(ctx, &result)
	if err == nil || !strings.Contains(err.Error(), "canceled") {
		t.Fatalf("workflow get err = %v, want canceled", err)
	}
	history, err := workflowHistory(ctx, temporalClient, input.WorkflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatalf("workflow history: %v", err)
	}
	if !historyContains(history, enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED) {
		t.Fatal("workflow history did not contain canceled event")
	}
}

type blockingAgentActivities struct {
	Activities
	started chan struct{}
	once    sync.Once
}

type knowledgeBranchActivities struct {
	Activities
}

func (a *knowledgeBranchActivities) ExecutePrimaryAgentActivity(
	_ context.Context,
	input ExecutePrimaryAgentActivityInput,
) (ExecutePrimaryAgentActivityOutput, error) {
	return ExecutePrimaryAgentActivityOutput{
		AgentResultRef: "projection://runs/" + input.RunID + "/agent/primary/result",
		FinalOutput:    "需要查询知识库。",
		RunID:          input.RunID,
		SelectedTools:  []string{"knowledge_query"},
		Status:         "completed",
		TerminalReason: "tool_selected",
		ToolResults: []AgentToolResult{{
			Capability:  "knowledge",
			PayloadKind: "rag_request",
			Result: map[string]any{
				"workflow_signal": "knowledge_query",
			},
			ResultRef: "projection://runs/" + input.RunID + "/agent/primary/tools/knowledge_query",
			Status:    "completed",
			ToolName:  "knowledge_query",
		}},
	}, nil
}

func (a *blockingAgentActivities) ExecutePrimaryAgentActivity(
	ctx context.Context,
	input ExecutePrimaryAgentActivityInput,
) (ExecutePrimaryAgentActivityOutput, error) {
	a.once.Do(func() { close(a.started) })
	<-ctx.Done()
	return ExecutePrimaryAgentActivityOutput{}, ctx.Err()
}

func workflowHistory(
	ctx context.Context,
	temporalClient client.Client,
	workflowID string,
	runID string,
) (*historypb.History, error) {
	var history historypb.History
	iter := temporalClient.GetWorkflowHistory(ctx, workflowID, runID, false, enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)
	for iter.HasNext() {
		event, err := iter.Next()
		if err != nil {
			return nil, err
		}
		history.Events = append(history.Events, event)
	}
	return &history, nil
}

func historyContains(history *historypb.History, eventType enumspb.EventType) bool {
	for _, event := range history.GetEvents() {
		if event.GetEventType() == eventType {
			return true
		}
	}
	return false
}

func historyContainsCompletedActivity(history *historypb.History, activityName string) bool {
	for _, event := range history.GetEvents() {
		if event.GetEventType() != enumspb.EVENT_TYPE_ACTIVITY_TASK_COMPLETED {
			continue
		}
		attributes := event.GetActivityTaskCompletedEventAttributes()
		if attributes == nil {
			continue
		}
		scheduledID := attributes.GetScheduledEventId()
		for _, scheduledEvent := range history.GetEvents() {
			if scheduledEvent.GetEventId() != scheduledID {
				continue
			}
			scheduledAttributes := scheduledEvent.GetActivityTaskScheduledEventAttributes()
			if scheduledAttributes == nil || scheduledAttributes.GetActivityType() == nil {
				continue
			}
			if scheduledAttributes.GetActivityType().GetName() == activityName {
				return true
			}
		}
	}
	return false
}
