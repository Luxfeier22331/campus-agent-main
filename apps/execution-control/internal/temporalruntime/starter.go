package temporalruntime

import (
	"context"
	"errors"
	"strings"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

var ErrTemporalStarterNotConfigured = errors.New("temporal starter not configured")

type ChatWorkflowStarter interface {
	CancelChatAnswerWorkflow(context.Context, ChatAnswerWorkflowCancelInput) error
	CheckReadiness(context.Context) RuntimeReadiness
	StartChatAnswerWorkflow(context.Context, ChatAnswerWorkflowInput) error
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
	Address      string
	Namespace    string
	TaskQueue    string
	WorkerID     string
	StartTimeout time.Duration
}

type Starter struct {
	client       client.Client
	namespace    string
	taskQueue    string
	workerID     string
	startTimeout time.Duration
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
		client:       temporalClient,
		namespace:    namespace,
		taskQueue:    taskQueue,
		workerID:     strings.TrimSpace(options.WorkerID),
		startTimeout: startTimeout,
	}, nil
}

func (s *Starter) StartChatAnswerWorkflow(
	ctx context.Context,
	input ChatAnswerWorkflowInput,
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
		ChatAnswerWorkflow,
		input,
	)
	return err
}

func (s *Starter) CancelChatAnswerWorkflow(
	ctx context.Context,
	input ChatAnswerWorkflowCancelInput,
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
		s.checkTaskQueue(ctx, ActivityTaskQueueRAG, TaskQueueTypeActivity, enumspb.TASK_QUEUE_TYPE_ACTIVITY),
		s.checkTaskQueue(ctx, ActivityTaskQueueFinalization, TaskQueueTypeActivity, enumspb.TASK_QUEUE_TYPE_ACTIVITY),
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
	RAGQueue               string
	FinalizationQueue      string
	WorkerID               string
	RAGActivities          any
	FinalizationActivities any
}

func NewWorkerRuntime(ctx context.Context, options WorkerOptions) (*WorkerRuntime, error) {
	address := strings.TrimSpace(options.Address)
	namespace := strings.TrimSpace(options.Namespace)
	if address == "" || namespace == "" {
		return nil, ErrTemporalStarterNotConfigured
	}
	if options.RAGActivities == nil {
		return nil, errors.New("temporal rag activities are required")
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
	ragQueue := strings.TrimSpace(options.RAGQueue)
	if ragQueue == "" {
		ragQueue = ActivityTaskQueueRAG
	}
	finalizationQueue := strings.TrimSpace(options.FinalizationQueue)
	if finalizationQueue == "" {
		finalizationQueue = ActivityTaskQueueFinalization
	}
	workflowWorker := NewWorkflowWorker(temporalClient, workflowQueue)
	ragWorker := NewRAGActivityWorker(temporalClient, ragQueue, options.RAGActivities)
	finalizationWorker := NewFinalizationActivityWorker(
		temporalClient,
		finalizationQueue,
		options.FinalizationActivities,
	)
	return &WorkerRuntime{
		client:  temporalClient,
		workers: []worker.Worker{workflowWorker, ragWorker, finalizationWorker},
	}, nil
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
	workflowWorker.RegisterWorkflow(ChatAnswerWorkflow)
	return workflowWorker
}

func NewRAGActivityWorker(temporalClient client.Client, queue string, activities any) worker.Worker {
	ragQueue := strings.TrimSpace(queue)
	if ragQueue == "" {
		ragQueue = ActivityTaskQueueRAG
	}
	ragWorker := worker.New(temporalClient, ragQueue, worker.Options{})
	ragWorker.RegisterActivity(activities)
	return ragWorker
}

func NewFinalizationActivityWorker(temporalClient client.Client, queue string, activities any) worker.Worker {
	finalizationQueue := strings.TrimSpace(queue)
	if finalizationQueue == "" {
		finalizationQueue = ActivityTaskQueueFinalization
	}
	finalizationWorker := worker.New(temporalClient, finalizationQueue, worker.Options{})
	finalizationWorker.RegisterActivity(activities)
	return finalizationWorker
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
