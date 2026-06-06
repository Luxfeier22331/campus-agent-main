package temporalruntime

import (
	"context"
	"errors"
	"strings"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

var ErrTemporalStarterNotConfigured = errors.New("temporal starter not configured")

type ChatWorkflowStarter interface {
	CancelChatAnswerWorkflow(context.Context, ChatAnswerWorkflowCancelInput) error
	StartChatAnswerWorkflow(context.Context, ChatAnswerWorkflowInput) error
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

func (s *Starter) Close() {
	if s != nil && s.client != nil {
		s.client.Close()
	}
}

type WorkerRuntime struct {
	client             client.Client
	workflowWorker     worker.Worker
	ragWorker          worker.Worker
	finalizationWorker worker.Worker
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
	workflowWorker := worker.New(temporalClient, workflowQueue, worker.Options{})
	workflowWorker.RegisterWorkflow(ChatAnswerWorkflow)
	ragWorker := worker.New(temporalClient, ragQueue, worker.Options{})
	ragWorker.RegisterActivity(options.RAGActivities)
	finalizationWorker := worker.New(temporalClient, finalizationQueue, worker.Options{})
	finalizationWorker.RegisterActivity(options.FinalizationActivities)
	return &WorkerRuntime{
		client:             temporalClient,
		workflowWorker:     workflowWorker,
		ragWorker:          ragWorker,
		finalizationWorker: finalizationWorker,
	}, nil
}

func (r *WorkerRuntime) Start() error {
	if r == nil {
		return ErrTemporalStarterNotConfigured
	}
	if err := r.workflowWorker.Start(); err != nil {
		return err
	}
	if err := r.ragWorker.Start(); err != nil {
		r.workflowWorker.Stop()
		return err
	}
	if err := r.finalizationWorker.Start(); err != nil {
		r.ragWorker.Stop()
		r.workflowWorker.Stop()
		return err
	}
	return nil
}

func (r *WorkerRuntime) Stop() {
	if r == nil {
		return
	}
	if r.ragWorker != nil {
		r.ragWorker.Stop()
	}
	if r.finalizationWorker != nil {
		r.finalizationWorker.Stop()
	}
	if r.workflowWorker != nil {
		r.workflowWorker.Stop()
	}
	if r.client != nil {
		r.client.Close()
	}
}
