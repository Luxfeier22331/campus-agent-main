package temporalruntime

import (
	"context"
	"errors"
	"strings"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

var ErrTemporalStarterNotConfigured = errors.New("temporal starter not configured")

type ChatWorkflowStarter interface {
	CancelToolExecutionWorkflow(context.Context, ToolExecutionWorkflowCancelInput) error
	CheckReadiness(context.Context) RuntimeReadiness
	StartToolExecutionWorkflow(context.Context, ToolExecutionWorkflowInput) error
}

const (
	TaskQueueTypeWorkflow = "workflow"
	TaskQueueTypeActivity = "activity"
)

type RuntimeReadiness struct {
	Healthy    bool
	LastError  string
	TaskQueues []TaskQueueReadiness
}

type TaskQueueReadiness struct {
	Name    string
	Type    string
	Pollers int
	Healthy bool
}

type StarterOptions struct {
	ActivityTaskQueues []string
	Address            string
	Namespace          string
	TaskQueue          string
	Tracing            TracingOptions
	WorkerID           string
	StartTimeout       time.Duration
}

type Starter struct {
	activityTaskQueues []string
	client             client.Client
	namespace          string
	taskQueue          string
	workerID           string
	startTimeout       time.Duration
}

func (s *Starter) SDKClient() client.Client {
	if s == nil {
		return nil
	}
	return s.client
}

func NewStarter(_ context.Context, options StarterOptions) (*Starter, error) {
	address := strings.TrimSpace(options.Address)
	namespace := strings.TrimSpace(options.Namespace)
	if address == "" || namespace == "" {
		return nil, ErrTemporalStarterNotConfigured
	}
	tracing, err := NewTracingInterceptors(options.Tracing)
	if err != nil {
		return nil, err
	}
	clientOptions := ApplyTracingToClientOptions(client.Options{
		HostPort:  address,
		Namespace: namespace,
	}, tracing)
	temporalClient, err := client.NewLazyClient(clientOptions)
	if err != nil {
		return nil, err
	}
	taskQueue := strings.TrimSpace(options.TaskQueue)
	if taskQueue == "" {
		taskQueue = WorkflowTaskQueue
	}
	startTimeout := options.StartTimeout
	if startTimeout <= 0 {
		startTimeout = 5 * time.Second
	}
	return &Starter{
		activityTaskQueues: normalizeActivityTaskQueues(options.ActivityTaskQueues),
		client:             temporalClient,
		namespace:          namespace,
		taskQueue:          taskQueue,
		workerID:           strings.TrimSpace(options.WorkerID),
		startTimeout:       startTimeout,
	}, nil
}

func (s *Starter) StartToolExecutionWorkflow(
	ctx context.Context,
	input ToolExecutionWorkflowInput,
) error {
	if s == nil || s.client == nil {
		return ErrTemporalStarterNotConfigured
	}
	workflowID := strings.TrimSpace(input.WorkflowID)
	if workflowID == "" {
		workflowID = "campus-agent.chat." + strings.TrimSpace(input.RunID)
	}
	taskQueue := strings.TrimSpace(input.TaskQueue)
	if taskQueue == "" {
		taskQueue = s.taskQueue
	}
	startCtx, cancel := context.WithTimeout(ctx, s.startTimeout)
	defer cancel()
	_, err := s.client.ExecuteWorkflow(
		startCtx,
		client.StartWorkflowOptions{
			ID:        workflowID,
			TaskQueue: taskQueue,
		},
		ToolExecutionWorkflow,
		input,
	)
	return err
}

func (s *Starter) CancelToolExecutionWorkflow(
	ctx context.Context,
	input ToolExecutionWorkflowCancelInput,
) error {
	if s == nil || s.client == nil {
		return ErrTemporalStarterNotConfigured
	}
	workflowID := strings.TrimSpace(input.WorkflowID)
	if workflowID == "" {
		workflowID = "campus-agent.chat." + strings.TrimSpace(input.RunID)
	}
	cancelCtx, cancel := context.WithTimeout(ctx, s.startTimeout)
	defer cancel()
	return s.client.CancelWorkflow(cancelCtx, workflowID, "")
}

func (s *Starter) CheckReadiness(ctx context.Context) RuntimeReadiness {
	if s == nil || s.client == nil {
		return RuntimeReadiness{Healthy: false, LastError: "temporal client is not configured"}
	}
	taskQueues := []TaskQueueReadiness{
		s.checkTaskQueue(ctx, s.taskQueue, TaskQueueTypeWorkflow, enumspb.TASK_QUEUE_TYPE_WORKFLOW),
	}
	for _, queue := range s.activityTaskQueues {
		taskQueues = append(
			taskQueues,
			s.checkTaskQueue(ctx, queue, TaskQueueTypeActivity, enumspb.TASK_QUEUE_TYPE_ACTIVITY),
		)
	}
	readiness := RuntimeReadiness{
		Healthy:    true,
		TaskQueues: taskQueues,
	}
	for _, taskQueue := range taskQueues {
		if !taskQueue.Healthy {
			readiness.Healthy = false
			if readiness.LastError == "" {
				readiness.LastError = "temporal task queue has no pollers"
			}
		}
	}
	return readiness
}

func normalizeActivityTaskQueues(values []string) []string {
	queues := []string{
		ActivityTaskQueueCore,
		ActivityTaskQueueAgent,
	}
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized == "" {
			continue
		}
		queues = appendUnique(queues, normalized)
	}
	return queues
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func (s *Starter) checkTaskQueue(
	ctx context.Context,
	name string,
	queueType string,
	temporalQueueType enumspb.TaskQueueType,
) TaskQueueReadiness {
	describeCtx, cancel := context.WithTimeout(ctx, s.startTimeout)
	defer cancel()
	response, err := s.client.DescribeTaskQueue(describeCtx, name, temporalQueueType)
	if err != nil {
		return TaskQueueReadiness{Name: name, Type: queueType, Healthy: false}
	}
	pollerCount := len(response.GetPollers())
	return TaskQueueReadiness{
		Name:    name,
		Type:    queueType,
		Pollers: pollerCount,
		Healthy: pollerCount > 0,
	}
}

func (s *Starter) Close() {
	if s != nil && s.client != nil {
		s.client.Close()
	}
}

type WorkerRuntime struct {
	client  client.Client
	workers []worker.Worker
}

type WorkerOptions struct {
	Address                string
	Namespace              string
	WorkflowQueue          string
	CoreQueue              string
	Tracing                TracingOptions
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
	MemoryRecallActivity(context.Context, MemoryRecallActivityInput) (MemoryRecallActivityOutput, error)
	AppendConversationMemoryActivity(
		context.Context,
		AppendConversationMemoryActivityInput,
	) (AppendConversationMemoryActivityOutput, error)
	MemoryOperationStatusActivity(
		context.Context,
		MemoryOperationStatusActivityInput,
	) (MemoryOperationStatusActivityOutput, error)
	MemoryReflectActivity(
		context.Context,
		MemoryReflectActivityInput,
	) (MemoryReflectActivityOutput, error)
}

type AgentActivities interface {
	ExecutePrimaryAgentActivity(
		context.Context,
		ExecutePrimaryAgentActivityInput,
	) (ExecutePrimaryAgentActivityOutput, error)
}

type FinalizationActivities interface {
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
	tracing, err := NewTracingInterceptors(options.Tracing)
	if err != nil {
		return nil, err
	}
	clientOptions := ApplyTracingToClientOptions(client.Options{
		HostPort:  address,
		Namespace: namespace,
		Identity:  strings.TrimSpace(options.WorkerID),
	}, tracing)
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
	tracingWorkerOptions := ApplyTracingToWorkerOptions(worker.Options{}, tracing)
	workflowWorker := NewWorkflowWorkerWithOptions(temporalClient, workflowQueue, tracingWorkerOptions)
	coreWorker := NewCoreActivityWorkerWithOptions(
		temporalClient,
		coreQueue,
		options.ContextActivities,
		options.FinalizationActivities,
		tracingWorkerOptions,
	)
	agentWorker := NewAgentActivityWorkerWithOptions(
		temporalClient,
		ActivityTaskQueueAgent,
		options.AgentActivities,
		tracingWorkerOptions,
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

func ApplyWorkerDeploymentVersioning(
	options worker.Options,
	deploymentName string,
	buildID string,
) (worker.Options, error) {
	deploymentName = strings.TrimSpace(deploymentName)
	buildID = strings.TrimSpace(buildID)
	if deploymentName == "" && buildID == "" {
		return options, nil
	}
	if deploymentName == "" || buildID == "" {
		return worker.Options{}, errors.New(
			"TEMPORAL_DEPLOYMENT_NAME and TEMPORAL_WORKER_BUILD_ID must be configured together",
		)
	}
	options.DeploymentOptions = worker.DeploymentOptions{
		UseVersioning: true,
		Version: worker.WorkerDeploymentVersion{
			DeploymentName: deploymentName,
			BuildID:        buildID,
		},
		DefaultVersioningBehavior: workflow.VersioningBehaviorPinned,
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
	coreWorker := worker.New(temporalClient, coreQueue, options)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.MemoryRecallActivity,
		activityRegisterOptions(MemoryRecallActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.AppendConversationMemoryActivity,
		activityRegisterOptions(AppendConversationMemoryActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.MemoryOperationStatusActivity,
		activityRegisterOptions(MemoryOperationStatusActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.MemoryReflectActivity,
		activityRegisterOptions(MemoryReflectActivityName),
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
