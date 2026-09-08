package temporalruntime

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

var ErrTemporalStarterNotConfigured = errors.New("temporal starter not configured")

const (
	defaultWorkflowExecutionTTL            = 15 * time.Minute
	workflowCancellationRecoveryStartDelay = time.Minute
)

type StarterOptions struct {
	ActivityTaskQueues       []string
	Address                  string
	Namespace                string
	TaskQueue                string
	WorkerID                 string
	StartTimeout             time.Duration
	WorkflowExecutionTimeout time.Duration
}

type Starter struct {
	activityTaskQueues       []string
	client                   client.Client
	namespace                string
	taskQueue                string
	workerID                 string
	startTimeout             time.Duration
	workflowExecutionTimeout time.Duration
}

func (s *Starter) SDKClient() client.Client {
	if s == nil {
		return nil
	}
	return s.client
}

func NewStarter(_ context.Context, options StarterOptions, temporalClient client.Client) (*Starter, error) {
	address := strings.TrimSpace(options.Address)
	namespace := strings.TrimSpace(options.Namespace)
	if address == "" || namespace == "" {
		return nil, ErrTemporalStarterNotConfigured
	}
	taskQueue := strings.TrimSpace(options.TaskQueue)
	if taskQueue == "" {
		taskQueue = WorkflowTaskQueue
	}
	startTimeout := options.StartTimeout
	if startTimeout <= 0 {
		startTimeout = 5 * time.Second
	}
	workflowExecutionTimeout := options.WorkflowExecutionTimeout
	if workflowExecutionTimeout <= 0 {
		workflowExecutionTimeout = defaultWorkflowExecutionTTL
	}
	return &Starter{
		activityTaskQueues:       normalizeActivityTaskQueues(options.ActivityTaskQueues),
		client:                   temporalClient,
		namespace:                namespace,
		taskQueue:                taskQueue,
		workerID:                 strings.TrimSpace(options.WorkerID),
		startTimeout:             startTimeout,
		workflowExecutionTimeout: workflowExecutionTimeout,
	}, nil
}

func (s *Starter) StartToolExecutionWorkflow(
	ctx context.Context,
	input ToolExecutionWorkflowInput,
) (string, error) {
	return s.startToolExecutionWorkflow(ctx, input, 0)
}

func (s *Starter) EnsureToolExecutionWorkflowForCancellation(
	ctx context.Context,
	input ToolExecutionWorkflowInput,
) (string, error) {
	return s.startToolExecutionWorkflow(ctx, input, workflowCancellationRecoveryStartDelay)
}

func (s *Starter) startToolExecutionWorkflow(
	ctx context.Context,
	input ToolExecutionWorkflowInput,
	startDelay time.Duration,
) (string, error) {
	if s == nil || s.client == nil {
		return "", ErrTemporalStarterNotConfigured
	}
	workflowID := strings.TrimSpace(input.WorkflowID)
	if workflowID == "" {
		workflowID = "campus-agent.chat." + strings.TrimSpace(input.RequestID)
	}
	taskQueue := strings.TrimSpace(input.TaskQueue)
	if taskQueue == "" {
		taskQueue = s.taskQueue
	}
	input.WorkflowID = workflowID
	input.TaskQueue = taskQueue
	identity, err := ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		return "", err
	}
	startCtx, cancel := context.WithTimeout(ctx, s.startTimeout)
	defer cancel()
	workflowExecutionTimeout := s.workflowExecutionTimeout
	if workflowExecutionTimeout <= 0 {
		workflowExecutionTimeout = defaultWorkflowExecutionTTL
	}
	workflowRun, err := s.client.ExecuteWorkflow(
		startCtx,
		client.StartWorkflowOptions{
			ID:                       workflowID,
			TaskQueue:                taskQueue,
			WorkflowExecutionTimeout: workflowExecutionTimeout,
			StartDelay:               startDelay,
			Memo: map[string]interface{}{
				workflowMemoRequestIDKey:  identity.RequestID,
				workflowMemoWorkflowIDKey: identity.WorkflowID,
				workflowMemoPayloadSHAKey: identity.PayloadSHA256,
				workflowMemoInputSHAKey:   identity.WorkflowInputSHA256,
			},
			// Retries after an accepted StartWorkflowExecution must attach to an
			// already-open execution with this canonical ID. Closed executions are
			// still fenced by REJECT_DUPLICATE below.
			WorkflowIDConflictPolicy:                 enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING,
			WorkflowIDReusePolicy:                    enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
			WorkflowExecutionErrorWhenAlreadyStarted: true,
		},
		ToolExecutionWorkflow,
		input,
	)
	var alreadyStarted *serviceerror.WorkflowExecutionAlreadyStarted
	if errors.As(err, &alreadyStarted) {
		return s.validateStartedToolExecutionWorkflow(
			startCtx,
			workflowID,
			strings.TrimSpace(alreadyStarted.RunId),
			identity,
		)
	}
	if err != nil {
		return "", err
	}
	if workflowRun == nil {
		return "", fmt.Errorf("%w: start response omitted workflow execution", ErrWorkflowIdentityUnknown)
	}
	return s.validateStartedToolExecutionWorkflow(
		startCtx,
		workflowID,
		strings.TrimSpace(workflowRun.GetRunID()),
		identity,
	)
}

func (s *Starter) validateStartedToolExecutionWorkflow(
	ctx context.Context,
	workflowID string,
	temporalRunID string,
	expected execution.WorkflowIdentity,
) (string, error) {
	temporalRunID = strings.TrimSpace(temporalRunID)
	if temporalRunID == "" {
		return "", fmt.Errorf("%w: start response omitted Temporal Run ID", ErrWorkflowIdentityUnknown)
	}
	exact, err := s.describeToolExecutionWorkflow(ctx, workflowID, temporalRunID)
	if err != nil {
		return "", fmt.Errorf("%w: describe started execution: %v", ErrWorkflowIdentityUnknown, err)
	}
	if err := ValidateToolExecutionWorkflowIdentity(exact, expected); err != nil {
		return "", err
	}
	if strings.TrimSpace(exact.RunID) != temporalRunID || strings.TrimSpace(exact.FirstRunID) != temporalRunID {
		return "", fmt.Errorf("%w: started execution is not the root run", ErrWorkflowOwnershipUnsafe)
	}
	return temporalRunID, nil
}

func (s *Starter) StartPersonalMemoryCommandWorkflow(
	ctx context.Context,
	input PersonalMemoryCommandWorkflowInput,
) error {
	if s == nil || s.client == nil {
		return ErrTemporalStarterNotConfigured
	}
	workflowID := strings.TrimSpace(input.WorkflowID)
	if workflowID == "" {
		workflowID = "campus-agent.memory.command." + strings.TrimSpace(input.Command.CommandID)
	}
	input.WorkflowID = workflowID
	startCtx, cancel := context.WithTimeout(ctx, s.startTimeout)
	defer cancel()
	_, err := s.client.ExecuteWorkflow(
		startCtx,
		client.StartWorkflowOptions{ID: workflowID, TaskQueue: s.taskQueue},
		PersonalMemoryCommandWorkflow,
		input,
	)
	var alreadyStarted *serviceerror.WorkflowExecutionAlreadyStarted
	if errors.As(err, &alreadyStarted) {
		return nil
	}
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
		workflowID = "campus-agent.chat." + strings.TrimSpace(input.RequestID)
	}
	temporalRunID := strings.TrimSpace(input.TemporalRunID)
	if temporalRunID == "" {
		return errors.New("temporal run id is required for workflow cancellation")
	}
	cancelCtx, cancel := context.WithTimeout(ctx, s.startTimeout)
	defer cancel()
	return s.client.CancelWorkflow(cancelCtx, workflowID, temporalRunID)
}

func (s *Starter) DescribeToolExecutionWorkflow(
	ctx context.Context,
	workflowID string,
	temporalRunID string,
) (execution.WorkflowExecutionInfo, error) {
	if s == nil || s.client == nil {
		return execution.WorkflowExecutionInfo{}, ErrTemporalStarterNotConfigured
	}
	workflowID = strings.TrimSpace(workflowID)
	if workflowID == "" {
		return execution.WorkflowExecutionInfo{}, errors.New("workflow id is required")
	}
	return s.describeToolExecutionWorkflow(ctx, workflowID, strings.TrimSpace(temporalRunID))
}

func (s *Starter) describeToolExecutionWorkflow(
	ctx context.Context,
	workflowID string,
	temporalRunID string,
) (execution.WorkflowExecutionInfo, error) {
	describeCtx, cancel := context.WithTimeout(ctx, s.startTimeout)
	defer cancel()
	description, err := s.client.DescribeWorkflowExecution(describeCtx, workflowID, temporalRunID)
	if err != nil {
		var notFound *serviceerror.NotFound
		if errors.As(err, &notFound) {
			return execution.WorkflowExecutionInfo{Found: false}, nil
		}
		return execution.WorkflowExecutionInfo{}, err
	}
	details := description.GetWorkflowExecutionInfo()
	workflowExecution := details.GetExecution()
	if details == nil || workflowExecution == nil || strings.TrimSpace(workflowExecution.WorkflowId) == "" ||
		strings.TrimSpace(workflowExecution.RunId) == "" {
		return execution.WorkflowExecutionInfo{}, errors.New("temporal workflow description is incomplete")
	}
	describedRunID := strings.TrimSpace(workflowExecution.RunId)
	if temporalRunID = strings.TrimSpace(temporalRunID); temporalRunID != "" && describedRunID != temporalRunID {
		return execution.WorkflowExecutionInfo{}, errors.New("temporal workflow description run id differs from requested execution")
	}
	identity, identityState := toolExecutionWorkflowIdentityFromMemo(details.Memo)
	extended := description.GetWorkflowExtendedInfo()
	info := execution.WorkflowExecutionInfo{
		Found:           true,
		WorkflowID:      strings.TrimSpace(workflowExecution.WorkflowId),
		RunID:           describedRunID,
		FirstRunID:      strings.TrimSpace(details.FirstRunId),
		Status:          workflowExecutionStatus(details.Status),
		ResetStateKnown: extended != nil,
		IdentityState:   identityState,
		Identity:        identity,
	}
	if details.CloseTime != nil {
		if err := details.CloseTime.CheckValid(); err != nil {
			return execution.WorkflowExecutionInfo{}, errors.New("temporal workflow close time is invalid")
		}
		info.CloseTime = details.CloseTime.AsTime().UTC()
	}
	if extended != nil {
		info.ResetRunID = strings.TrimSpace(extended.ResetRunId)
		if extended.LastResetTime != nil {
			if err := extended.LastResetTime.CheckValid(); err != nil {
				// Reset metadata gates initial binding, not reads of an already
				// bound execution's status.
				info.ResetStateKnown = false
			} else {
				info.LastResetTime = extended.LastResetTime.AsTime().UTC()
			}
		}
	}
	return info, nil
}

func workflowExecutionStatus(status enumspb.WorkflowExecutionStatus) execution.WorkflowExecutionStatus {
	switch status {
	case enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING:
		return execution.WorkflowExecutionStatusRunning
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED:
		return execution.WorkflowExecutionStatusCompleted
	case enumspb.WORKFLOW_EXECUTION_STATUS_FAILED:
		return execution.WorkflowExecutionStatusFailed
	case enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED:
		return execution.WorkflowExecutionStatusCanceled
	case enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED:
		return execution.WorkflowExecutionStatusTerminated
	case enumspb.WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW:
		return execution.WorkflowExecutionStatusContinuedAsNew
	case enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT:
		return execution.WorkflowExecutionStatusTimedOut
	default:
		return execution.WorkflowExecutionStatusUnknown
	}
}

func (s *Starter) Close() {
	if s != nil && s.client != nil {
		s.client.Close()
	}
}
