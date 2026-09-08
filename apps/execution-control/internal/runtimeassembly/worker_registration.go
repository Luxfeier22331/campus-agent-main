package runtimeassembly

import (
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

type WorkerProfile struct {
	ActivitySlots                int
	ActivityTaskPollers          int
	TaskQueueActivitiesPerSecond float64
	WorkerActivitiesPerSecond    float64
	WorkflowTaskSlots            int
	WorkflowTaskPollers          int
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
		workflowQueue = temporalruntime.WorkflowTaskQueue
	}
	workflowWorker := worker.New(temporalClient, workflowQueue, options)
	workflowWorker.RegisterWorkflowWithOptions(temporalruntime.ToolExecutionWorkflow, workflow.RegisterOptions{
		Name: temporalruntime.ToolExecutionWorkflowType,
	})
	workflowWorker.RegisterWorkflowWithOptions(temporalruntime.PersonalMemoryCommandWorkflow, workflow.RegisterOptions{
		Name: temporalruntime.PersonalMemoryCommandWorkflowType,
	})
	return workflowWorker
}

func NewCoreActivityWorkerWithOptions(
	temporalClient client.Client,
	queue string,
	contextActivities temporalruntime.ContextActivities,
	finalizationActivities temporalruntime.FinalizationActivities,
	options worker.Options,
) worker.Worker {
	coreQueue := strings.TrimSpace(queue)
	if coreQueue == "" {
		coreQueue = temporalruntime.ActivityTaskQueueCore
	}
	coreWorker := worker.New(temporalClient, coreQueue, options)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.AppendConversationMemoryActivity,
		activityRegisterOptions(temporalruntime.AppendConversationMemoryActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.ExecutePersonalMemoryCommandActivity,
		activityRegisterOptions(temporalruntime.ExecutePersonalMemoryCommandActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.FinalizePersonalMemoryCommandReceiptActivity,
		activityRegisterOptions(temporalruntime.FinalizePersonalMemoryCommandReceiptActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.WritePersonalMemoryCommandResultActivity,
		activityRegisterOptions(temporalruntime.WritePersonalMemoryCommandResultActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		finalizationActivities.FinalizeExecutionCancellationActivity,
		activityRegisterOptions(temporalruntime.FinalizeExecutionCancellationActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		finalizationActivities.FinalizeExecutionFailureActivity,
		activityRegisterOptions(temporalruntime.FinalizeExecutionFailureActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		finalizationActivities.WriteWorkflowFinalizationActivity,
		activityRegisterOptions(temporalruntime.WriteWorkflowFinalizationActivityName),
	)
	return coreWorker
}

func NewWorkflowOperationActivityWorker(
	temporalClient client.Client,
	queue string,
	activities temporalruntime.WorkflowActivities,
) worker.Worker {
	return NewWorkflowOperationActivityWorkerWithOptions(temporalClient, queue, activities, worker.Options{})
}

func NewWorkflowOperationActivityWorkerWithOptions(
	temporalClient client.Client,
	queue string,
	activities temporalruntime.WorkflowActivities,
	options worker.Options,
) worker.Worker {
	agentQueue := strings.TrimSpace(queue)
	if agentQueue == "" {
		agentQueue = temporalruntime.ActivityTaskQueueAgent
	}
	agentWorker := worker.New(temporalClient, agentQueue, options)
	agentWorker.RegisterActivityWithOptions(activities.SolveTaskActivity, activityRegisterOptions(temporalruntime.SolveTaskActivityName))
	agentWorker.RegisterActivityWithOptions(
		activities.ExecuteTaskStepActivity,
		activityRegisterOptions(temporalruntime.ExecuteTaskStepActivityName),
	)
	agentWorker.RegisterActivityWithOptions(activities.ReplanTaskActivity, activityRegisterOptions(temporalruntime.ReplanTaskActivityName))
	agentWorker.RegisterActivityWithOptions(
		activities.SynthesizeAnswerActivity,
		activityRegisterOptions(temporalruntime.SynthesizeAnswerActivityName),
	)
	return agentWorker
}

func activityRegisterOptions(name string) activity.RegisterOptions {
	return activity.RegisterOptions{Name: name}
}
