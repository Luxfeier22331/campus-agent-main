package temporalruntime

import (
	"context"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

type WorkerRuntime struct {
	client  client.Client
	workers []worker.Worker
}

type WorkerOptions struct {
	Address                string
	Namespace              string
	WorkflowQueue          string
	CoreQueue              string
	WorkerID               string
	ContextActivities      ContextActivities
	AgentActivities        AgentActivities
	FinalizationActivities FinalizationActivities
}

type WorkerProfile struct {
	ActivitySlots                int
	ActivityTaskPollers          int
	TaskQueueActivitiesPerSecond float64
	WorkerActivitiesPerSecond    float64
	WorkflowTaskSlots            int
	WorkflowTaskPollers          int
}

type ContextActivities interface {
	AppendConversationMemoryActivity(
		context.Context,
		AppendConversationMemoryActivityInput,
	) (AppendConversationMemoryActivityOutput, error)
	ExecutePersonalMemoryCommandActivity(
		context.Context,
		memoryruntime.PersonalMemoryCommandRequest,
	) (PersonalMemoryCommandActivityOutput, error)
	FinalizePersonalMemoryCommandReceiptActivity(
		context.Context,
		FinalizePersonalMemoryCommandReceiptActivityInput,
	) (PersonalMemoryCommandActivityOutput, error)
	WritePersonalMemoryCommandResultActivity(
		context.Context,
		PersonalMemoryCommandActivityOutput,
	) error
}

type AgentActivities interface {
	ExecutePrimaryAgentActivity(
		context.Context,
		ExecutePrimaryAgentActivityInput,
	) (ExecutePrimaryAgentActivityOutput, error)
}

type FinalizationActivities interface {
	FinalizeExecutionCancellationActivity(
		context.Context,
		FinalizeExecutionCancellationActivityInput,
	) (FinalizeExecutionCancellationActivityOutput, error)
	FinalizeExecutionFailureActivity(
		context.Context,
		FinalizeExecutionFailureActivityInput,
	) (FinalizeExecutionFailureActivityOutput, error)
	WriteFinalizationActivity(
		context.Context,
		WriteFinalizationActivityInput,
	) (WriteFinalizationActivityOutput, error)
}

func NewWorkerRuntime(ctx context.Context, options WorkerOptions) (*WorkerRuntime, error) {
	address := strings.TrimSpace(options.Address)
	namespace := strings.TrimSpace(options.Namespace)
	if address == "" || namespace == "" {
		return nil, ErrTemporalStarterNotConfigured
	}
	if options.ContextActivities == nil {
		return nil, errors.New("temporal context activities are required")
	}
	if options.AgentActivities == nil {
		return nil, errors.New("temporal agent activities are required")
	}
	if options.FinalizationActivities == nil {
		return nil, errors.New("temporal finalization activities are required")
	}
	clientOptions := client.Options{
		HostPort:  address,
		Namespace: namespace,
		Identity:  strings.TrimSpace(options.WorkerID),
	}
	temporalClient, err := client.DialContext(ctx, clientOptions)
	if err != nil {
		return nil, err
	}
	workflowQueue := strings.TrimSpace(options.WorkflowQueue)
	if workflowQueue == "" {
		workflowQueue = WorkflowTaskQueue
	}
	coreQueue := strings.TrimSpace(options.CoreQueue)
	if coreQueue == "" {
		coreQueue = ActivityTaskQueueCore
	}
	workerOptions := worker.Options{}
	workflowWorker := NewWorkflowWorkerWithOptions(temporalClient, workflowQueue, workerOptions)
	coreWorker := NewCoreActivityWorkerWithOptions(
		temporalClient,
		coreQueue,
		options.ContextActivities,
		options.FinalizationActivities,
		workerOptions,
	)
	agentWorker := NewAgentActivityWorkerWithOptions(
		temporalClient,
		ActivityTaskQueueAgent,
		options.AgentActivities,
		workerOptions,
	)
	return &WorkerRuntime{
		client: temporalClient,
		workers: []worker.Worker{
			workflowWorker,
			coreWorker,
			agentWorker,
		},
	}, nil
}

func WorkerOptionsForProfile(profile WorkerProfile) (worker.Options, error) {
	options := worker.Options{}
	if profile.ActivitySlots < 0 {
		return worker.Options{}, errors.New("activity slots must be a positive integer")
	}
	if profile.ActivitySlots > 0 {
		options.MaxConcurrentActivityExecutionSize = profile.ActivitySlots
	}
	if profile.ActivityTaskPollers < 0 {
		return worker.Options{}, errors.New("activity task pollers must be a non-negative integer")
	}
	if profile.ActivityTaskPollers > 0 {
		options.MaxConcurrentActivityTaskPollers = profile.ActivityTaskPollers
	}
	if profile.TaskQueueActivitiesPerSecond < 0 {
		return worker.Options{}, errors.New("task queue activities per second must be non-negative")
	}
	options.TaskQueueActivitiesPerSecond = profile.TaskQueueActivitiesPerSecond
	if profile.WorkerActivitiesPerSecond < 0 {
		return worker.Options{}, errors.New("worker activities per second must be non-negative")
	}
	options.WorkerActivitiesPerSecond = profile.WorkerActivitiesPerSecond
	if profile.WorkflowTaskSlots < 0 {
		return worker.Options{}, errors.New("workflow task slots must be a non-negative integer")
	}
	if profile.WorkflowTaskSlots > 0 {
		options.MaxConcurrentWorkflowTaskExecutionSize = profile.WorkflowTaskSlots
	}
	if profile.WorkflowTaskPollers < 0 {
		return worker.Options{}, errors.New("workflow task pollers must be a non-negative integer")
	}
	if profile.WorkflowTaskPollers > 0 {
		options.MaxConcurrentWorkflowTaskPollers = profile.WorkflowTaskPollers
	}
	if profile.ActivityTaskPollers > 0 && profile.ActivitySlots <= 0 {
		return worker.Options{}, errors.New("activity slots must be a positive integer when activity pollers are configured")
	}
	return options, nil
}

func NewTemporalClient(ctx context.Context, address string, namespace string, workerID string) (client.Client, error) {
	address = strings.TrimSpace(address)
	namespace = strings.TrimSpace(namespace)
	if address == "" || namespace == "" {
		return nil, ErrTemporalStarterNotConfigured
	}
	return client.DialContext(ctx, client.Options{
		HostPort:  address,
		Namespace: namespace,
		Identity:  strings.TrimSpace(workerID),
	})
}

func NewWorkflowWorker(temporalClient client.Client, queue string) worker.Worker {
	return NewWorkflowWorkerWithOptions(temporalClient, queue, worker.Options{})
}

func NewWorkflowWorkerWithOptions(
	temporalClient client.Client,
	queue string,
	options worker.Options,
) worker.Worker {
	workflowQueue := strings.TrimSpace(queue)
	if workflowQueue == "" {
		workflowQueue = WorkflowTaskQueue
	}
	workflowWorker := worker.New(temporalClient, workflowQueue, options)
	workflowWorker.RegisterWorkflowWithOptions(ToolExecutionWorkflow, workflow.RegisterOptions{
		Name: ToolExecutionWorkflowType,
	})
	workflowWorker.RegisterWorkflowWithOptions(PersonalMemoryCommandWorkflow, workflow.RegisterOptions{
		Name: PersonalMemoryCommandWorkflowType,
	})
	return workflowWorker
}

func NewCoreActivityWorkerWithOptions(
	temporalClient client.Client,
	queue string,
	contextActivities ContextActivities,
	finalizationActivities FinalizationActivities,
	options worker.Options,
) worker.Worker {
	coreQueue := strings.TrimSpace(queue)
	if coreQueue == "" {
		coreQueue = ActivityTaskQueueCore
	}
	options.Interceptors = append(options.Interceptors, &ActivityFailureSanitizer{})
	coreWorker := worker.New(temporalClient, coreQueue, options)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.AppendConversationMemoryActivity,
		activityRegisterOptions(AppendConversationMemoryActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.ExecutePersonalMemoryCommandActivity,
		activityRegisterOptions(ExecutePersonalMemoryCommandActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.FinalizePersonalMemoryCommandReceiptActivity,
		activityRegisterOptions(FinalizePersonalMemoryCommandReceiptActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.WritePersonalMemoryCommandResultActivity,
		activityRegisterOptions(WritePersonalMemoryCommandResultActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		finalizationActivities.FinalizeExecutionCancellationActivity,
		activityRegisterOptions(FinalizeExecutionCancellationActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		finalizationActivities.FinalizeExecutionFailureActivity,
		activityRegisterOptions(FinalizeExecutionFailureActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		finalizationActivities.WriteFinalizationActivity,
		activityRegisterOptions(WriteFinalizationActivityName),
	)
	return coreWorker
}

func NewAgentActivityWorker(temporalClient client.Client, queue string, activities AgentActivities) worker.Worker {
	return NewAgentActivityWorkerWithOptions(temporalClient, queue, activities, worker.Options{})
}

func NewAgentActivityWorkerWithOptions(
	temporalClient client.Client,
	queue string,
	activities AgentActivities,
	options worker.Options,
) worker.Worker {
	agentQueue := strings.TrimSpace(queue)
	if agentQueue == "" {
		agentQueue = ActivityTaskQueueAgent
	}
	options.Interceptors = append(options.Interceptors, &ActivityFailureSanitizer{})
	agentWorker := worker.New(temporalClient, agentQueue, options)
	agentWorker.RegisterActivityWithOptions(
		activities.ExecutePrimaryAgentActivity,
		activityRegisterOptions(ExecutePrimaryAgentActivityName),
	)
	return agentWorker
}

func activityRegisterOptions(name string) activity.RegisterOptions {
	return activity.RegisterOptions{Name: name}
}

func (r *WorkerRuntime) Start() error {
	if r == nil {
		return ErrTemporalStarterNotConfigured
	}
	started := []worker.Worker{}
	for _, runtimeWorker := range r.workers {
		if err := runtimeWorker.Start(); err != nil {
			for i := len(started) - 1; i >= 0; i-- {
				started[i].Stop()
			}
			return err
		}
		started = append(started, runtimeWorker)
	}
	return nil
}

func (r *WorkerRuntime) Stop() {
	if r == nil {
		return
	}
	for i := len(r.workers) - 1; i >= 0; i-- {
		r.workers[i].Stop()
	}
	if r.client != nil {
		r.client.Close()
	}
}
