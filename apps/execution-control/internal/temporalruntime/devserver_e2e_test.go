//go:build temporal_e2e

package temporalruntime

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func TestTemporalDevServerRunsToolExecutionWorkflowAndReplaysHistory(t *testing.T) {
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
		NewCoreActivityWorkerWithOptions(
			temporalClient,
			ActivityTaskQueueCore,
			activities,
			activities,
			worker.Options{},
		),
		NewAgentActivityWorker(temporalClient, ActivityTaskQueueAgent, activities),
	}
	for _, runtimeWorker := range workers {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}

	runID := "run-temporal-devserver-e2e"
	input := devServerWorkflowInput(runID)
	input.WorkflowID = "campus-agent.temporal-e2e." + runID
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        input.WorkflowID,
		TaskQueue: WorkflowTaskQueue,
	}, ToolExecutionWorkflow, input)
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	var result ToolExecutionWorkflowResult
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
	replayer.RegisterWorkflowWithOptions(ToolExecutionWorkflow, workflow.RegisterOptions{
		Name: ToolExecutionWorkflowType,
	})
	if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
		t.Fatalf("replay workflow history: %v", err)
	}
}

func TestTemporalDevServerRunsExplicitKnowledgeChoiceThroughLinearWorkflow(t *testing.T) {
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
	activities := &Activities{}
	workers := []worker.Worker{
		NewWorkflowWorker(temporalClient, WorkflowTaskQueue),
		NewCoreActivityWorkerWithOptions(
			temporalClient,
			ActivityTaskQueueCore,
			activities,
			activities,
			worker.Options{},
		),
		NewAgentActivityWorker(temporalClient, ActivityTaskQueueAgent, activities),
	}
	for _, runtimeWorker := range workers {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}

	runID := "run-temporal-devserver-rag"
	input := devServerWorkflowInput(runID)
	input.WorkflowID = "campus-agent.temporal-e2e." + runID
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        input.WorkflowID,
		TaskQueue: WorkflowTaskQueue,
	}, ToolExecutionWorkflow, input)
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	var result ToolExecutionWorkflowResult
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
		ExecutePrimaryAgentActivityName,
		WriteFinalizationActivityName,
		AppendConversationMemoryActivityName,
	} {
		if !historyContainsCompletedActivity(history, activityName) {
			t.Fatalf("workflow history missing completed activity %s", activityName)
		}
	}
}

func TestTemporalDevServerRunsPersonalMemoryCommandFinalizers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	server, err := testsuite.StartDevServer(ctx, testsuite.DevServerOptions{
		ClientOptions: &client.Options{Namespace: "campus-agent-temporal-memory-command-e2e"},
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
		NewCoreActivityWorkerWithOptions(
			temporalClient,
			ActivityTaskQueueCore,
			activities,
			activities,
			worker.Options{},
		),
	}
	for _, runtimeWorker := range workers {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}

	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "command-temporal-devserver-e2e",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-temporal-e2e",
		UserID:            "user-temporal-e2e",
	}
	workflowID := "campus-agent.temporal-e2e." + command.CommandID
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: WorkflowTaskQueue,
	}, PersonalMemoryCommandWorkflow, PersonalMemoryCommandWorkflowInput{
		Command:    command,
		WorkflowID: workflowID,
	})
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	var result PersonalMemoryCommandWorkflowResult
	if err := workflowRun.Get(ctx, &result); err != nil {
		t.Fatalf("get workflow result: %v", err)
	}
	if result.CommandID != command.CommandID || result.Status != "succeeded" {
		t.Fatalf("unexpected workflow result: %#v", result)
	}

	history, err := workflowHistory(ctx, temporalClient, workflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatalf("workflow history: %v", err)
	}
	for _, activityName := range []string{
		ExecutePersonalMemoryCommandActivityName,
		FinalizePersonalMemoryCommandReceiptActivityName,
		WritePersonalMemoryCommandResultActivityName,
	} {
		if !historyContainsCompletedActivity(history, activityName) {
			t.Fatalf("workflow history missing completed activity %s", activityName)
		}
	}
}

func TestTemporalDevServerReplaysLegacyPersonalMemoryEraseHistory(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	server, err := testsuite.StartDevServer(ctx, testsuite.DevServerOptions{
		ClientOptions: &client.Options{Namespace: "campus-agent-temporal-memory-replay-e2e"},
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
	legacyWorker := worker.New(temporalClient, WorkflowTaskQueue, worker.Options{})
	legacyWorker.RegisterWorkflowWithOptions(
		legacyPersonalMemoryCommandWorkflow,
		workflow.RegisterOptions{Name: PersonalMemoryCommandWorkflowType},
	)
	coreWorker := NewCoreActivityWorkerWithOptions(
		temporalClient,
		ActivityTaskQueueCore,
		activities,
		activities,
		worker.Options{},
	)
	for _, runtimeWorker := range []worker.Worker{legacyWorker, coreWorker} {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}

	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "command-temporal-legacy-erase",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-08-17T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-temporal-e2e",
		UserID:            "user-temporal-e2e",
	}
	workflowID := "campus-agent.temporal-e2e." + command.CommandID
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: WorkflowTaskQueue,
	}, PersonalMemoryCommandWorkflowType, PersonalMemoryCommandWorkflowInput{
		Command:    command,
		WorkflowID: workflowID,
	})
	if err != nil {
		t.Fatalf("execute legacy workflow: %v", err)
	}
	history, err := waitForWorkflowHistoryEvent(
		ctx,
		temporalClient,
		workflowID,
		workflowRun.GetRunID(),
		enumspb.EVENT_TYPE_TIMER_STARTED,
	)
	if err != nil {
		t.Fatalf("wait for legacy workflow timer: %v", err)
	}
	replayer := worker.NewWorkflowReplayer()
	replayer.RegisterWorkflowWithOptions(PersonalMemoryCommandWorkflow, workflow.RegisterOptions{
		Name: PersonalMemoryCommandWorkflowType,
	})
	if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
		t.Fatalf("replay legacy personal memory history: %v", err)
	}
	if err := temporalClient.CancelWorkflow(ctx, workflowID, workflowRun.GetRunID()); err != nil {
		t.Fatalf("cancel legacy workflow: %v", err)
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
		NewCoreActivityWorkerWithOptions(
			temporalClient,
			ActivityTaskQueueCore,
			&activities.Activities,
			&activities.Activities,
			worker.Options{},
		),
		NewAgentActivityWorker(temporalClient, ActivityTaskQueueAgent, &activities),
	}
	for _, runtimeWorker := range workers {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}
	runID := "run-temporal-devserver-cancel"
	input := devServerWorkflowInput(runID)
	input.WorkflowID = "campus-agent.temporal-e2e." + runID
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        input.WorkflowID,
		TaskQueue: WorkflowTaskQueue,
	}, ToolExecutionWorkflow, input)
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
	if err := starter.CancelToolExecutionWorkflow(ctx, ToolExecutionWorkflowCancelInput{
		RunID:         runID,
		TemporalRunID: workflowRun.GetRunID(),
		WorkflowID:    input.WorkflowID,
	}); err != nil {
		t.Fatalf("cancel workflow: %v", err)
	}
	if err := workflowRun.Get(ctx, nil); !temporal.IsCanceledError(err) {
		t.Fatalf("get canceled workflow error = %v, want canceled error", err)
	}
	history, err := workflowHistory(ctx, temporalClient, input.WorkflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatalf("workflow history: %v", err)
	}
	if !historyContains(history, enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED) {
		t.Fatal("workflow history did not contain canceled event")
	}
	if !historyContainsCompletedActivity(history, FinalizeExecutionCancellationActivityName) {
		t.Fatalf("workflow history missing completed activity %s", FinalizeExecutionCancellationActivityName)
	}
}

type blockingAgentActivities struct {
	Activities
	started chan struct{}
	once    sync.Once
}

func legacyPersonalMemoryCommandWorkflow(
	ctx workflow.Context,
	input PersonalMemoryCommandWorkflowInput,
) (PersonalMemoryCommandWorkflowResult, error) {
	providerOptions := personalMemoryCommandProviderActivityOptions(input.Command.CommandKind)
	var result PersonalMemoryCommandActivityOutput
	if err := executePersonalMemoryCommandProvider(ctx, providerOptions, input.Command, &result); err != nil {
		result = PersonalMemoryCommandActivityOutput{
			CommandID: input.Command.CommandID,
			ErrorCode: "personal_memory_command_failed",
			Status:    "failed",
		}
	}
	if result.Status == "succeeded" && input.Command.CommandKind == "owner_erase" {
		if err := executePersonalMemoryTraceErase(ctx, input.Command); err != nil {
			result = PersonalMemoryCommandActivityOutput{
				CommandID: input.Command.CommandID,
				ErrorCode: "personal_memory_trace_erase_failed",
				Status:    "failed",
			}
		}
	}
	finalizerCtx := workflow.WithActivityOptions(ctx, unlimitedFinalizerActivityOptions(15*time.Second))
	if err := workflow.ExecuteActivity(
		finalizerCtx,
		FinalizePersonalMemoryCommandReceiptActivityName,
		FinalizePersonalMemoryCommandReceiptActivityInput{Command: input.Command, Result: result},
	).Get(ctx, &result); err != nil {
		return PersonalMemoryCommandWorkflowResult{}, err
	}
	callbackCtx := workflow.WithActivityOptions(ctx, unlimitedFinalizerActivityOptions(15*time.Second))
	if err := workflow.ExecuteActivity(
		callbackCtx,
		WritePersonalMemoryCommandResultActivityName,
		result,
	).Get(ctx, nil); err != nil {
		return PersonalMemoryCommandWorkflowResult{}, err
	}
	return result, nil
}

func devServerWorkflowInput(runID string) ToolExecutionWorkflowInput {
	return ToolExecutionWorkflowInput{
		ConversationID: "conversation-" + runID,
		RequestID:      "request-" + runID,
		RunID:          runID,
		TraceID:        "trace-" + runID,
		TurnID:         "turn-" + runID,
	}
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

func waitForWorkflowHistoryEvent(
	ctx context.Context,
	temporalClient client.Client,
	workflowID string,
	runID string,
	eventType enumspb.EventType,
) (*historypb.History, error) {
	for {
		history, err := workflowHistory(ctx, temporalClient, workflowID, runID)
		if err != nil {
			return nil, err
		}
		if historyContains(history, eventType) {
			return history, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
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
