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
	CancelCapabilityExecutionWorkflow(context.Context, CapabilityExecutionWorkflowCancelInput) error
	CheckReadiness(context.Context) RuntimeReadiness
	StartCapabilityExecutionWorkflow(context.Context, CapabilityExecutionWorkflowInput) error
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

func NewStarter(ctx context.Context, options StarterOptions) (*Starter, error) {
	address := strings.TrimSpace(options.Address)
	namespace := strings.TrimSpace(options.Namespace)
	if address == "" || namespace == "" {
		return nil, ErrTemporalStarterNotConfigured
	}
	temporalClient, err := client.DialContext(ctx, client.Options{
		HostPort:  address,
		Namespace: namespace,
	})
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

func (s *Starter) StartCapabilityExecutionWorkflow(
	ctx context.Context,
	input CapabilityExecutionWorkflowInput,
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
		CapabilityExecutionWorkflow,
		input,
	)
	return err
}

func (s *Starter) CancelCapabilityExecutionWorkflow(
	ctx context.Context,
	input CapabilityExecutionWorkflowCancelInput,
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
		ActivityTaskQueueContext,
		ActivityTaskQueueAgent,
		ActivityTaskQueueKnowledgePlan,
		ActivityTaskQueueKnowledgeRetrieval,
		ActivityTaskQueueKnowledgeSynthesis,
		ActivityTaskQueueFinalization,
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
	Address                 string
	Namespace               string
	WorkflowQueue           string
	ContextQueue            string
	KnowledgePlanQueue      string
	KnowledgeRetrievalQueue string
	KnowledgeSynthesisQueue string
	FinalizationQueue       string
	WorkerID                string
	ContextActivities       ContextActivities
	AgentActivities         AgentActivities
	KnowledgeActivities     KnowledgeActivities
	FinalizationActivities  FinalizationActivities
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
	PlanRouteActivity(context.Context, PlanRouteActivityInput) (PlanRouteActivityOutput, error)
	PlanReplanActivity(context.Context, PlanReplanActivityInput) (PlanReplanActivityOutput, error)
}

type AgentActivities interface {
	ExecutePrimaryAgentActivity(
		context.Context,
		ExecutePrimaryAgentActivityInput,
	) (ExecutePrimaryAgentActivityOutput, error)
}

type KnowledgeActivities interface {
	PlanRAGActivity(
		context.Context,
		PlanRAGActivityInput,
	) (PlanRAGActivityOutput, error)
	RetrieveIndexedLookupActivity(
		context.Context,
		RetrieveIndexedLookupActivityInput,
	) (RetrieveIndexedLookupActivityOutput, error)
	ExpandOrRescueRetrievalActivity(
		context.Context,
		ExpandOrRescueRetrievalActivityInput,
	) (ExpandOrRescueRetrievalActivityOutput, error)
	SelectEvidenceActivity(
		context.Context,
		SelectEvidenceActivityInput,
	) (SelectEvidenceActivityOutput, error)
	SynthesizeRAGAnswerActivity(
		context.Context,
		SynthesizeRAGAnswerActivityInput,
	) (SynthesizeRAGAnswerActivityOutput, error)
	VerifyGroundingActivity(
		context.Context,
		VerifyGroundingActivityInput,
	) (VerifyGroundingActivityOutput, error)
}

type TypedToolActivities interface {
	ExecuteTypedToolActivity(
		context.Context,
		ExecuteTypedToolActivityInput,
	) (ExecuteTypedToolActivityOutput, error)
	ExecuteAgentAsToolActivity(
		context.Context,
		ExecuteAgentAsToolActivityInput,
	) (ExecuteAgentAsToolActivityOutput, error)
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
	if options.KnowledgeActivities == nil {
		return nil, errors.New("temporal knowledge activities are required")
	}
	if options.FinalizationActivities == nil {
		return nil, errors.New("temporal finalization activities are required")
	}
	temporalClient, err := client.DialContext(ctx, client.Options{
		HostPort:  address,
		Namespace: namespace,
		Identity:  strings.TrimSpace(options.WorkerID),
	})
	if err != nil {
		return nil, err
	}
	workflowQueue := strings.TrimSpace(options.WorkflowQueue)
	if workflowQueue == "" {
		workflowQueue = WorkflowTaskQueue
	}
	contextQueue := strings.TrimSpace(options.ContextQueue)
	if contextQueue == "" {
		contextQueue = ActivityTaskQueueContext
	}
	knowledgePlanQueue := strings.TrimSpace(options.KnowledgePlanQueue)
	if knowledgePlanQueue == "" {
		knowledgePlanQueue = ActivityTaskQueueKnowledgePlan
	}
	knowledgeRetrievalQueue := strings.TrimSpace(options.KnowledgeRetrievalQueue)
	if knowledgeRetrievalQueue == "" {
		knowledgeRetrievalQueue = ActivityTaskQueueKnowledgeRetrieval
	}
	knowledgeSynthesisQueue := strings.TrimSpace(options.KnowledgeSynthesisQueue)
	if knowledgeSynthesisQueue == "" {
		knowledgeSynthesisQueue = ActivityTaskQueueKnowledgeSynthesis
	}
	finalizationQueue := strings.TrimSpace(options.FinalizationQueue)
	if finalizationQueue == "" {
		finalizationQueue = ActivityTaskQueueFinalization
	}
	workflowWorker := NewWorkflowWorker(temporalClient, workflowQueue)
	contextWorker := NewContextActivityWorker(temporalClient, contextQueue, options.ContextActivities)
	agentWorker := NewAgentActivityWorker(temporalClient, ActivityTaskQueueAgent, options.AgentActivities)
	knowledgePlanWorker := NewKnowledgePlanActivityWorker(
		temporalClient,
		knowledgePlanQueue,
		options.KnowledgeActivities,
		worker.Options{},
	)
	knowledgeRetrievalWorker := NewKnowledgeRetrievalActivityWorker(
		temporalClient,
		knowledgeRetrievalQueue,
		options.KnowledgeActivities,
		worker.Options{},
	)
	knowledgeSynthesisWorker := NewKnowledgeSynthesisActivityWorker(
		temporalClient,
		knowledgeSynthesisQueue,
		options.KnowledgeActivities,
		worker.Options{},
	)
	finalizationWorker := NewFinalizationActivityWorker(
		temporalClient,
		finalizationQueue,
		options.FinalizationActivities,
	)
	return &WorkerRuntime{
		client: temporalClient,
		workers: []worker.Worker{
			workflowWorker,
			contextWorker,
			agentWorker,
			knowledgePlanWorker,
			knowledgeRetrievalWorker,
			knowledgeSynthesisWorker,
			finalizationWorker,
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
	workflowQueue := strings.TrimSpace(queue)
	if workflowQueue == "" {
		workflowQueue = WorkflowTaskQueue
	}
	workflowWorker := worker.New(temporalClient, workflowQueue, worker.Options{})
	workflowWorker.RegisterWorkflowWithOptions(CapabilityExecutionWorkflow, workflow.RegisterOptions{
		Name: CapabilityExecutionWorkflowType,
	})
	return workflowWorker
}

func NewContextActivityWorker(temporalClient client.Client, queue string, activities ContextActivities) worker.Worker {
	contextQueue := strings.TrimSpace(queue)
	if contextQueue == "" {
		contextQueue = ActivityTaskQueueContext
	}
	contextWorker := worker.New(temporalClient, contextQueue, worker.Options{})
	contextWorker.RegisterActivityWithOptions(
		activities.MemoryRecallActivity,
		activityRegisterOptions(MemoryRecallActivityName),
	)
	contextWorker.RegisterActivityWithOptions(
		activities.AppendConversationMemoryActivity,
		activityRegisterOptions(AppendConversationMemoryActivityName),
	)
	contextWorker.RegisterActivityWithOptions(
		activities.PlanRouteActivity,
		activityRegisterOptions(PlanRouteActivityName),
	)
	contextWorker.RegisterActivityWithOptions(
		activities.PlanReplanActivity,
		activityRegisterOptions(PlanReplanActivityName),
	)
	return contextWorker
}

func NewAgentActivityWorker(temporalClient client.Client, queue string, activities AgentActivities) worker.Worker {
	agentQueue := strings.TrimSpace(queue)
	if agentQueue == "" {
		agentQueue = ActivityTaskQueueAgent
	}
	agentWorker := worker.New(temporalClient, agentQueue, worker.Options{})
	agentWorker.RegisterActivityWithOptions(
		activities.ExecutePrimaryAgentActivity,
		activityRegisterOptions(ExecutePrimaryAgentActivityName),
	)
	return agentWorker
}

func NewKnowledgePlanActivityWorker(
	temporalClient client.Client,
	queue string,
	activities KnowledgeActivities,
	options worker.Options,
) worker.Worker {
	knowledgeQueue := strings.TrimSpace(queue)
	if knowledgeQueue == "" {
		knowledgeQueue = ActivityTaskQueueKnowledgePlan
	}
	knowledgeWorker := worker.New(temporalClient, knowledgeQueue, options)
	knowledgeWorker.RegisterActivityWithOptions(
		activities.PlanRAGActivity,
		activityRegisterOptions(PlanRAGActivityName),
	)
	knowledgeWorker.RegisterActivityWithOptions(
		activities.SelectEvidenceActivity,
		activityRegisterOptions(SelectEvidenceActivityName),
	)
	knowledgeWorker.RegisterActivityWithOptions(
		activities.VerifyGroundingActivity,
		activityRegisterOptions(VerifyGroundingActivityName),
	)
	return knowledgeWorker
}

func NewKnowledgeRetrievalActivityWorker(
	temporalClient client.Client,
	queue string,
	activities KnowledgeActivities,
	options worker.Options,
) worker.Worker {
	knowledgeQueue := strings.TrimSpace(queue)
	if knowledgeQueue == "" {
		knowledgeQueue = ActivityTaskQueueKnowledgeRetrieval
	}
	knowledgeWorker := worker.New(temporalClient, knowledgeQueue, options)
	knowledgeWorker.RegisterActivityWithOptions(
		activities.RetrieveIndexedLookupActivity,
		activityRegisterOptions(RetrieveIndexedLookupActivityName),
	)
	knowledgeWorker.RegisterActivityWithOptions(
		activities.ExpandOrRescueRetrievalActivity,
		activityRegisterOptions(ExpandOrRescueRetrievalActivityName),
	)
	return knowledgeWorker
}

func NewKnowledgeSynthesisActivityWorker(
	temporalClient client.Client,
	queue string,
	activities KnowledgeActivities,
	options worker.Options,
) worker.Worker {
	knowledgeQueue := strings.TrimSpace(queue)
	if knowledgeQueue == "" {
		knowledgeQueue = ActivityTaskQueueKnowledgeSynthesis
	}
	knowledgeWorker := worker.New(temporalClient, knowledgeQueue, options)
	knowledgeWorker.RegisterActivityWithOptions(
		activities.SynthesizeRAGAnswerActivity,
		activityRegisterOptions(SynthesizeRAGAnswerActivityName),
	)
	return knowledgeWorker
}

func NewTypedToolActivityWorker(
	temporalClient client.Client,
	queue string,
	activities TypedToolActivities,
) worker.Worker {
	typedToolQueue := strings.TrimSpace(queue)
	if typedToolQueue == "" {
		typedToolQueue = ActivityTaskQueueStructured
	}
	typedToolWorker := worker.New(temporalClient, typedToolQueue, worker.Options{})
	typedToolWorker.RegisterActivityWithOptions(
		activities.ExecuteTypedToolActivity,
		activityRegisterOptions(ExecuteTypedToolActivityName),
	)
	typedToolWorker.RegisterActivityWithOptions(
		activities.ExecuteAgentAsToolActivity,
		activityRegisterOptions(ExecuteAgentAsToolActivityName),
	)
	return typedToolWorker
}

func NewFinalizationActivityWorker(
	temporalClient client.Client,
	queue string,
	activities FinalizationActivities,
) worker.Worker {
	finalizationQueue := strings.TrimSpace(queue)
	if finalizationQueue == "" {
		finalizationQueue = ActivityTaskQueueFinalization
	}
	finalizationWorker := worker.New(temporalClient, finalizationQueue, worker.Options{})
	finalizationWorker.RegisterActivityWithOptions(
		activities.WriteFinalizationActivity,
		activityRegisterOptions(WriteFinalizationActivityName),
	)
	return finalizationWorker
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
