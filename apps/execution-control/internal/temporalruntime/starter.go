package temporalruntime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	commonpb "go.temporal.io/api/common/v1"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

var (
	ErrTemporalStarterNotConfigured = errors.New("temporal starter not configured")
	ErrWorkflowIdentityUnknown      = errors.New("temporal workflow identity is not yet observable")
	ErrWorkflowIdentityConflict     = errors.New("temporal workflow identity conflicts with durable intent")
	ErrWorkflowOwnershipUnsafe      = errors.New("temporal workflow execution ownership is unsafe to converge")
)

const (
	workflowMemoRunIDKey                   = "campus_agent_run_id"
	workflowMemoWorkflowIDKey              = "campus_agent_workflow_id"
	workflowMemoPayloadSHAKey              = "campus_agent_payload_sha256"
	workflowMemoInputSHAKey                = "campus_agent_input_sha256"
	defaultWorkflowExecutionTTL            = 15 * time.Minute
	workflowCancellationRecoveryStartDelay = time.Minute
)

type ChatWorkflowStarter interface {
	CancelToolExecutionWorkflow(context.Context, ToolExecutionWorkflowCancelInput) error
	CheckReadiness(context.Context) RuntimeReadiness
	StartPersonalMemoryCommandWorkflow(context.Context, PersonalMemoryCommandWorkflowInput) error
	StartToolExecutionWorkflow(context.Context, ToolExecutionWorkflowInput) (string, error)
}

// WorkflowControl is separate from ChatWorkflowStarter so command-only test
// doubles do not need to implement Temporal visibility. The lifecycle
// reconciler uses it to verify cancellation and timeout ownership.
type WorkflowControl interface {
	DescribeToolExecutionWorkflow(context.Context, string, string) (WorkflowExecutionInfo, error)
}

// WorkflowCancellationRecoveryStarter recreates an execution whose durable
// dispatch fence committed but whose StartWorkflowExecution call may never
// have happened. Implementations must preserve the canonical workflow input
// and delay the first workflow task long enough for the caller to bind and
// cancel the concrete root execution.
type WorkflowCancellationRecoveryStarter interface {
	EnsureToolExecutionWorkflowForCancellation(context.Context, ToolExecutionWorkflowInput) (string, error)
}

type WorkflowExecutionInfo struct {
	Found           bool
	WorkflowID      string
	RunID           string
	FirstRunID      string
	Status          enumspb.WorkflowExecutionStatus
	CloseTime       time.Time
	ResetStateKnown bool
	LastResetTime   time.Time
	ResetRunID      string
	IdentityState   WorkflowIdentityState
	Identity        ToolExecutionWorkflowIdentity
}

type WorkflowIdentityState string

const (
	WorkflowIdentityUnknown WorkflowIdentityState = "unknown"
	WorkflowIdentityKnown   WorkflowIdentityState = "known"
	WorkflowIdentityInvalid WorkflowIdentityState = "invalid"
)

type ToolExecutionWorkflowIdentity struct {
	RunID               string
	WorkflowID          string
	PayloadSHA256       string
	WorkflowInputSHA256 string
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

func NewStarter(_ context.Context, options StarterOptions) (*Starter, error) {
	address := strings.TrimSpace(options.Address)
	namespace := strings.TrimSpace(options.Namespace)
	if address == "" || namespace == "" {
		return nil, ErrTemporalStarterNotConfigured
	}
	clientOptions := client.Options{
		HostPort:  address,
		Namespace: namespace,
	}
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
		workflowID = "campus-agent.chat." + strings.TrimSpace(input.RunID)
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
				workflowMemoRunIDKey:      identity.RunID,
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
	expected ToolExecutionWorkflowIdentity,
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
	latest, err := s.describeToolExecutionWorkflow(ctx, workflowID, "")
	if err != nil {
		return "", fmt.Errorf("%w: describe latest execution: %v", ErrWorkflowIdentityUnknown, err)
	}
	if err := ValidateToolExecutionWorkflowIdentity(latest, expected); err != nil {
		return "", err
	}
	if strings.TrimSpace(latest.RunID) != temporalRunID || strings.TrimSpace(latest.FirstRunID) != temporalRunID {
		return "", fmt.Errorf("%w: latest execution differs from started root run", ErrWorkflowOwnershipUnsafe)
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
		workflowID = "campus-agent.chat." + strings.TrimSpace(input.RunID)
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
) (WorkflowExecutionInfo, error) {
	if s == nil || s.client == nil {
		return WorkflowExecutionInfo{}, ErrTemporalStarterNotConfigured
	}
	workflowID = strings.TrimSpace(workflowID)
	if workflowID == "" {
		return WorkflowExecutionInfo{}, errors.New("workflow id is required")
	}
	return s.describeToolExecutionWorkflow(ctx, workflowID, strings.TrimSpace(temporalRunID))
}

func (s *Starter) describeToolExecutionWorkflow(
	ctx context.Context,
	workflowID string,
	temporalRunID string,
) (WorkflowExecutionInfo, error) {
	describeCtx, cancel := context.WithTimeout(ctx, s.startTimeout)
	defer cancel()
	description, err := s.client.DescribeWorkflowExecution(describeCtx, workflowID, temporalRunID)
	if err != nil {
		var notFound *serviceerror.NotFound
		if errors.As(err, &notFound) {
			return WorkflowExecutionInfo{Found: false}, nil
		}
		return WorkflowExecutionInfo{}, err
	}
	details := description.GetWorkflowExecutionInfo()
	execution := details.GetExecution()
	if details == nil || execution == nil || strings.TrimSpace(execution.WorkflowId) == "" ||
		strings.TrimSpace(execution.RunId) == "" {
		return WorkflowExecutionInfo{}, errors.New("temporal workflow description is incomplete")
	}
	describedRunID := strings.TrimSpace(execution.RunId)
	if temporalRunID = strings.TrimSpace(temporalRunID); temporalRunID != "" && describedRunID != temporalRunID {
		return WorkflowExecutionInfo{}, errors.New("temporal workflow description run id differs from requested execution")
	}
	identity, identityState := toolExecutionWorkflowIdentityFromMemo(details.Memo)
	extended := description.GetWorkflowExtendedInfo()
	info := WorkflowExecutionInfo{
		Found:           true,
		WorkflowID:      strings.TrimSpace(execution.WorkflowId),
		RunID:           describedRunID,
		FirstRunID:      strings.TrimSpace(details.FirstRunId),
		Status:          details.Status,
		ResetStateKnown: extended != nil,
		IdentityState:   identityState,
		Identity:        identity,
	}
	if details.CloseTime != nil {
		if err := details.CloseTime.CheckValid(); err != nil {
			return WorkflowExecutionInfo{}, errors.New("temporal workflow close time is invalid")
		}
		info.CloseTime = details.CloseTime.AsTime().UTC()
	}
	if extended != nil {
		info.ResetRunID = strings.TrimSpace(extended.ResetRunId)
		if extended.LastResetTime != nil {
			if err := extended.LastResetTime.CheckValid(); err != nil {
				return WorkflowExecutionInfo{}, errors.New("temporal workflow last reset time is invalid")
			}
			info.LastResetTime = extended.LastResetTime.AsTime().UTC()
		}
	}
	return info, nil
}

func ToolExecutionWorkflowIdentityForInput(input ToolExecutionWorkflowInput) (ToolExecutionWorkflowIdentity, error) {
	encoded, err := json.Marshal(input)
	if err != nil {
		return ToolExecutionWorkflowIdentity{}, fmt.Errorf("encode workflow input identity: %w", err)
	}
	digest := sha256.Sum256(encoded)
	identity := ToolExecutionWorkflowIdentity{
		RunID:               strings.TrimSpace(input.RunID),
		WorkflowID:          strings.TrimSpace(input.WorkflowID),
		PayloadSHA256:       strings.TrimSpace(input.PayloadSHA256),
		WorkflowInputSHA256: hex.EncodeToString(digest[:]),
	}
	if identity.RunID == "" || identity.WorkflowID == "" ||
		!validWorkflowIdentitySHA(identity.PayloadSHA256) ||
		!validWorkflowIdentitySHA(identity.WorkflowInputSHA256) {
		return ToolExecutionWorkflowIdentity{}, errors.New("workflow input identity is incomplete")
	}
	return identity, nil
}

func ValidateToolExecutionWorkflowIdentity(
	info WorkflowExecutionInfo,
	expected ToolExecutionWorkflowIdentity,
) error {
	if !info.Found {
		return ErrWorkflowIdentityUnknown
	}
	if strings.TrimSpace(info.WorkflowID) != expected.WorkflowID {
		return fmt.Errorf("%w: workflow id differs", ErrWorkflowIdentityConflict)
	}
	switch info.IdentityState {
	case WorkflowIdentityUnknown, "":
		return ErrWorkflowIdentityUnknown
	case WorkflowIdentityInvalid:
		return fmt.Errorf("%w: workflow memo identity is invalid", ErrWorkflowIdentityConflict)
	case WorkflowIdentityKnown:
	default:
		return ErrWorkflowIdentityUnknown
	}
	if info.Identity != expected {
		return fmt.Errorf("%w: workflow memo identity differs", ErrWorkflowIdentityConflict)
	}
	if !info.ResetStateKnown {
		return fmt.Errorf("%w: workflow reset state is unavailable", ErrWorkflowIdentityUnknown)
	}
	if !info.LastResetTime.IsZero() || strings.TrimSpace(info.ResetRunID) != "" {
		return fmt.Errorf("%w: workflow execution has reset evidence", ErrWorkflowOwnershipUnsafe)
	}
	return nil
}

func toolExecutionWorkflowIdentityFromMemo(memo *commonpb.Memo) (ToolExecutionWorkflowIdentity, WorkflowIdentityState) {
	if memo == nil {
		return ToolExecutionWorkflowIdentity{}, WorkflowIdentityUnknown
	}
	fields := memo.GetFields()
	keys := []string{workflowMemoRunIDKey, workflowMemoWorkflowIDKey, workflowMemoPayloadSHAKey, workflowMemoInputSHAKey}
	present := 0
	values := make([]string, len(keys))
	for index, key := range keys {
		payload, ok := fields[key]
		if !ok {
			continue
		}
		present++
		if err := converter.GetDefaultDataConverter().FromPayload(payload, &values[index]); err != nil {
			return ToolExecutionWorkflowIdentity{}, WorkflowIdentityInvalid
		}
		values[index] = strings.TrimSpace(values[index])
	}
	if present == 0 {
		return ToolExecutionWorkflowIdentity{}, WorkflowIdentityUnknown
	}
	identity := ToolExecutionWorkflowIdentity{
		RunID: values[0], WorkflowID: values[1], PayloadSHA256: values[2], WorkflowInputSHA256: values[3],
	}
	if present != len(keys) || identity.RunID == "" || identity.WorkflowID == "" ||
		!validWorkflowIdentitySHA(identity.PayloadSHA256) ||
		!validWorkflowIdentitySHA(identity.WorkflowInputSHA256) {
		return ToolExecutionWorkflowIdentity{}, WorkflowIdentityInvalid
	}
	return identity, WorkflowIdentityKnown
}

func validWorkflowIdentitySHA(value string) bool {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
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
	PurgePersonalMemoryTracesActivity(
		context.Context,
		PersonalMemoryTraceMaintenanceActivityInput,
	) (PersonalMemoryTraceMaintenanceActivityOutput, error)
	VerifyPersonalMemoryTracesActivity(
		context.Context,
		PersonalMemoryTraceMaintenanceActivityInput,
	) (PersonalMemoryTraceMaintenanceActivityOutput, error)
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
	PrepareGroundingContextActivity(
		context.Context,
		PrepareGroundingContextActivityInput,
	) (PrepareGroundingContextActivityOutput, error)
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
		contextActivities.PurgePersonalMemoryTracesActivity,
		activityRegisterOptions(PurgePersonalMemoryTracesActivityName),
	)
	coreWorker.RegisterActivityWithOptions(
		contextActivities.VerifyPersonalMemoryTracesActivity,
		activityRegisterOptions(VerifyPersonalMemoryTracesActivityName),
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
		activities.PrepareGroundingContextActivity,
		activityRegisterOptions(PrepareGroundingContextActivityName),
	)
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
