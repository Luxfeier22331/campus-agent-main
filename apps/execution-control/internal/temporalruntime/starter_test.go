package temporalruntime

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	commonpb "go.temporal.io/api/common/v1"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	workflowpb "go.temporal.io/api/workflow/v1"
	workflowservicepb "go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/converter"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// captureTemporalClient embeds the SDK interface so the tests only need to
// implement the client methods exercised by Starter. Any unexpected method
// call would dispatch through the embedded nil interface and fail loudly.
type captureTemporalClient struct {
	client.Client
	startOptions      client.StartWorkflowOptions
	startRunID        string
	startErr          error
	description       *workflowservicepb.DescribeWorkflowExecutionResponse
	descriptionSeries []*workflowservicepb.DescribeWorkflowExecutionResponse
	describeErr       error
	describedRunIDs   []string
	canceledID        string
	canceledRunID     string
}

type captureWorkflowRun struct {
	id    string
	runID string
}

func (r captureWorkflowRun) GetID() string { return r.id }

func (r captureWorkflowRun) GetRunID() string { return r.runID }

func (captureWorkflowRun) Get(context.Context, interface{}) error { return nil }

func (captureWorkflowRun) GetWithOptions(
	context.Context,
	interface{},
	client.WorkflowRunGetOptions,
) error {
	return nil
}

func (c *captureTemporalClient) ExecuteWorkflow(
	ctx context.Context,
	options client.StartWorkflowOptions,
	workflow interface{},
	args ...interface{},
) (client.WorkflowRun, error) {
	c.startOptions = options
	if c.startErr != nil {
		return nil, c.startErr
	}
	return captureWorkflowRun{id: options.ID, runID: c.startRunID}, nil
}

func (c *captureTemporalClient) DescribeWorkflowExecution(
	_ context.Context,
	_ string,
	runID string,
) (*workflowservicepb.DescribeWorkflowExecutionResponse, error) {
	describeIndex := len(c.describedRunIDs)
	c.describedRunIDs = append(c.describedRunIDs, runID)
	description := c.description
	if describeIndex < len(c.descriptionSeries) {
		description = c.descriptionSeries[describeIndex]
	}
	return description, c.describeErr
}

func (c *captureTemporalClient) CancelWorkflow(
	_ context.Context,
	workflowID string,
	runID string,
) error {
	c.canceledID = workflowID
	c.canceledRunID = runID
	return nil
}

func TestStarterUsesExistingWorkflowForOpenIDAndRejectsClosedReuse(t *testing.T) {
	input := starterWorkflowInputForTest("run-policy-test")
	identity, err := ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	fake := &captureTemporalClient{
		startRunID:  "temporal-policy-run",
		description: workflowDescriptionForTest(t, identity, "temporal-policy-run"),
	}
	starter := &Starter{
		client:       fake,
		taskQueue:    WorkflowTaskQueue,
		startTimeout: time.Second,
	}
	if runID, err := starter.StartToolExecutionWorkflow(context.Background(), input); err != nil {
		t.Fatalf("start workflow: %v", err)
	} else if runID != fake.startRunID {
		t.Fatalf("started Temporal run id = %q, want %q", runID, fake.startRunID)
	}
	if got := fake.startOptions.WorkflowIDConflictPolicy; got != enums.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING {
		t.Fatalf("workflow conflict policy = %s, want USE_EXISTING", got)
	}
	if got := fake.startOptions.WorkflowIDReusePolicy; got != enums.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE {
		t.Fatalf("workflow reuse policy = %s, want REJECT_DUPLICATE", got)
	}
	if !fake.startOptions.WorkflowExecutionErrorWhenAlreadyStarted {
		t.Fatal("WorkflowExecutionErrorWhenAlreadyStarted must remain enabled for explicit reconciliation")
	}
	if fake.startOptions.WorkflowExecutionTimeout != defaultWorkflowExecutionTTL {
		t.Fatalf("workflow execution timeout = %s, want %s", fake.startOptions.WorkflowExecutionTimeout, defaultWorkflowExecutionTTL)
	}
	if fake.startOptions.StartDelay != 0 {
		t.Fatalf("ordinary workflow start delay = %s, want zero", fake.startOptions.StartDelay)
	}
	if fake.startOptions.Memo[workflowMemoRunIDKey] != input.RunID ||
		fake.startOptions.Memo[workflowMemoPayloadSHAKey] != input.PayloadSHA256 {
		t.Fatalf("workflow identity memo = %#v", fake.startOptions.Memo)
	}
}

func TestStarterDelaysCancellationRecoveryWorkflowWithoutChangingIdentity(t *testing.T) {
	input := starterWorkflowInputForTest("run-cancellation-recovery")
	identity, err := ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	fake := &captureTemporalClient{
		startRunID:  "temporal-cancellation-recovery",
		description: workflowDescriptionForTest(t, identity, "temporal-cancellation-recovery"),
	}
	starter := &Starter{client: fake, taskQueue: WorkflowTaskQueue, startTimeout: time.Second}

	runID, err := starter.EnsureToolExecutionWorkflowForCancellation(context.Background(), input)
	if err != nil {
		t.Fatalf("ensure cancellation recovery workflow: %v", err)
	}
	if runID != fake.startRunID {
		t.Fatalf("recovery Temporal run id = %q, want %q", runID, fake.startRunID)
	}
	if fake.startOptions.StartDelay != workflowCancellationRecoveryStartDelay {
		t.Fatalf(
			"recovery workflow start delay = %s, want %s",
			fake.startOptions.StartDelay,
			workflowCancellationRecoveryStartDelay,
		)
	}
	if fake.startOptions.ID != input.WorkflowID || fake.startOptions.TaskQueue != input.TaskQueue {
		t.Fatalf("recovery workflow routing = %#v", fake.startOptions)
	}
	if fake.startOptions.Memo[workflowMemoInputSHAKey] != identity.WorkflowInputSHA256 ||
		fake.startOptions.Memo[workflowMemoPayloadSHAKey] != identity.PayloadSHA256 {
		t.Fatalf("recovery workflow identity memo = %#v", fake.startOptions.Memo)
	}
	if !reflect.DeepEqual(fake.describedRunIDs, []string{fake.startRunID, ""}) {
		t.Fatalf("recovery workflow described run ids = %#v, want exact/latest", fake.describedRunIDs)
	}
}

func TestStarterAcceptsAlreadyStartedOnlyWhenMemoIdentityMatches(t *testing.T) {
	input := starterWorkflowInputForTest("run-already-started")
	identity, err := ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	fake := &captureTemporalClient{
		startErr:    serviceerror.NewWorkflowExecutionAlreadyStarted("already started", "request", "temporal-run"),
		description: workflowDescriptionForTest(t, identity, "temporal-run"),
	}
	starter := &Starter{client: fake, taskQueue: WorkflowTaskQueue, startTimeout: time.Second}
	if runID, err := starter.StartToolExecutionWorkflow(context.Background(), input); err != nil {
		t.Fatalf("already-started response should be reconciled, got %v", err)
	} else if runID != "temporal-run" {
		t.Fatalf("already-started run id = %q", runID)
	}
	if !reflect.DeepEqual(fake.describedRunIDs, []string{"temporal-run", ""}) {
		t.Fatalf("described run ids = %#v, want exact/latest", fake.describedRunIDs)
	}
}

func TestStarterKeepsAlreadyStartedWithUnknownMemoRetryable(t *testing.T) {
	input := starterWorkflowInputForTest("run-identity-unknown")
	fake := &captureTemporalClient{
		startErr:    serviceerror.NewWorkflowExecutionAlreadyStarted("already started", "request", "temporal-run"),
		description: workflowDescriptionWithoutMemoForTest(input.WorkflowID, "temporal-run"),
	}
	starter := &Starter{client: fake, taskQueue: WorkflowTaskQueue, startTimeout: time.Second}
	if _, err := starter.StartToolExecutionWorkflow(context.Background(), input); !errors.Is(err, ErrWorkflowIdentityUnknown) {
		t.Fatalf("unknown memo error = %v, want ErrWorkflowIdentityUnknown", err)
	}
}

func TestStarterRejectsAlreadyStartedWithConflictingMemo(t *testing.T) {
	input := starterWorkflowInputForTest("run-identity-conflict")
	identity, err := ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	identity.PayloadSHA256 = strings.Repeat("b", 64)
	fake := &captureTemporalClient{
		startErr:    serviceerror.NewWorkflowExecutionAlreadyStarted("already started", "request", "temporal-run"),
		description: workflowDescriptionForTest(t, identity, "temporal-run"),
	}
	starter := &Starter{client: fake, taskQueue: WorkflowTaskQueue, startTimeout: time.Second}
	if _, err := starter.StartToolExecutionWorkflow(context.Background(), input); !errors.Is(err, ErrWorkflowIdentityConflict) {
		t.Fatalf("conflicting memo error = %v, want ErrWorkflowIdentityConflict", err)
	}
}

func TestStarterRejectsAlreadyStartedWithResetEvidence(t *testing.T) {
	input := starterWorkflowInputForTest("run-reset-conflict")
	identity, err := ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name   string
		mutate func(*workflowpb.WorkflowExecutionExtendedInfo)
	}{
		{
			name: "last reset time",
			mutate: func(info *workflowpb.WorkflowExecutionExtendedInfo) {
				info.LastResetTime = timestamppb.New(time.Now().UTC())
			},
		},
		{
			name: "reset run id",
			mutate: func(info *workflowpb.WorkflowExecutionExtendedInfo) {
				info.ResetRunId = "temporal-reset-successor"
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			description := workflowDescriptionForTest(t, identity, "temporal-reset-root")
			test.mutate(description.WorkflowExtendedInfo)
			fake := &captureTemporalClient{
				startErr: serviceerror.NewWorkflowExecutionAlreadyStarted(
					"already started",
					"request",
					"temporal-reset-root",
				),
				description: description,
			}
			starter := &Starter{client: fake, taskQueue: WorkflowTaskQueue, startTimeout: time.Second}
			if _, err := starter.StartToolExecutionWorkflow(context.Background(), input); !errors.Is(err, ErrWorkflowOwnershipUnsafe) {
				t.Fatalf("reset ownership error = %v, want ErrWorkflowOwnershipUnsafe", err)
			}
		})
	}
}

func TestStarterRejectsStartedExecutionWhenLatestRunDiffers(t *testing.T) {
	input := starterWorkflowInputForTest("run-latest-differs")
	identity, err := ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	exact := workflowDescriptionForTest(t, identity, "temporal-start-root")
	latest := workflowDescriptionForTest(t, identity, "temporal-reset-latest")
	latest.WorkflowExecutionInfo.FirstRunId = "temporal-start-root"
	fake := &captureTemporalClient{
		startRunID:        "temporal-start-root",
		descriptionSeries: []*workflowservicepb.DescribeWorkflowExecutionResponse{exact, latest},
	}
	starter := &Starter{client: fake, taskQueue: WorkflowTaskQueue, startTimeout: time.Second}
	if _, err := starter.StartToolExecutionWorkflow(context.Background(), input); !errors.Is(err, ErrWorkflowOwnershipUnsafe) {
		t.Fatalf("different latest ownership error = %v, want ErrWorkflowOwnershipUnsafe", err)
	}
}

func TestStarterDescribeRejectsIncompleteSuccessfulResponse(t *testing.T) {
	fake := &captureTemporalClient{description: &workflowservicepb.DescribeWorkflowExecutionResponse{}}
	starter := &Starter{client: fake, startTimeout: time.Second}
	if _, err := starter.DescribeToolExecutionWorkflow(context.Background(), "workflow-id", "temporal-run-id"); err == nil {
		t.Fatal("incomplete Temporal description must return an error")
	}
	if !reflect.DeepEqual(fake.describedRunIDs, []string{"temporal-run-id"}) {
		t.Fatalf("public describe run ids = %#v", fake.describedRunIDs)
	}

	fake.description = nil
	fake.describeErr = errors.New("visibility unavailable")
	if _, err := starter.DescribeToolExecutionWorkflow(context.Background(), "workflow-id", "temporal-run-id"); err == nil {
		t.Fatal("DescribeWorkflow transport errors must be returned")
	}
}

func TestStarterDescribeMapsNotFoundToAbsentWorkflow(t *testing.T) {
	fake := &captureTemporalClient{describeErr: serviceerror.NewNotFound("missing")}
	starter := &Starter{client: fake, startTimeout: time.Second}
	info, err := starter.DescribeToolExecutionWorkflow(context.Background(), "workflow-id", "temporal-run-id")
	if err != nil {
		t.Fatalf("not-found description: %v", err)
	}
	if info.Found {
		t.Fatalf("not-found description = %#v, want absent", info)
	}
}

func TestStarterDescribeRejectsDifferentRequestedTemporalRun(t *testing.T) {
	fake := &captureTemporalClient{
		description: workflowDescriptionWithoutMemoForTest("workflow-id", "temporal-run-actual"),
	}
	starter := &Starter{client: fake, startTimeout: time.Second}
	if _, err := starter.DescribeToolExecutionWorkflow(
		context.Background(),
		"workflow-id",
		"temporal-run-requested",
	); err == nil {
		t.Fatal("DescribeWorkflow accepted a different Temporal run than requested")
	}
}

func TestStarterDescribePreservesTemporalExecutionChainIdentity(t *testing.T) {
	input := starterWorkflowInputForTest("run-chain-identity")
	identity, err := ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	description := workflowDescriptionForTest(t, identity, "temporal-chain-current")
	description.WorkflowExecutionInfo.FirstRunId = "temporal-chain-first"
	fake := &captureTemporalClient{description: description}
	starter := &Starter{client: fake, startTimeout: time.Second}
	info, err := starter.DescribeToolExecutionWorkflow(
		context.Background(),
		input.WorkflowID,
		"temporal-chain-current",
	)
	if err != nil {
		t.Fatal(err)
	}
	if info.FirstRunID != "temporal-chain-first" || info.RunID != "temporal-chain-current" {
		t.Fatalf("described execution chain = %#v", info)
	}
}

func TestStarterDescribePreservesResetStateAndFailsClosedWhenItIsMissing(t *testing.T) {
	input := starterWorkflowInputForTest("run-reset-state")
	identity, err := ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	description := workflowDescriptionForTest(t, identity, "temporal-reset-state")
	resetAt := time.Now().UTC().Truncate(time.Microsecond)
	description.WorkflowExtendedInfo.LastResetTime = timestamppb.New(resetAt)
	description.WorkflowExtendedInfo.ResetRunId = "temporal-reset-successor"
	fake := &captureTemporalClient{description: description}
	starter := &Starter{client: fake, startTimeout: time.Second}
	info, err := starter.DescribeToolExecutionWorkflow(context.Background(), input.WorkflowID, "temporal-reset-state")
	if err != nil {
		t.Fatal(err)
	}
	if !info.ResetStateKnown || !info.LastResetTime.Equal(resetAt) || info.ResetRunID != "temporal-reset-successor" {
		t.Fatalf("described reset state = %#v", info)
	}
	if err := ValidateToolExecutionWorkflowIdentity(info, identity); !errors.Is(err, ErrWorkflowOwnershipUnsafe) {
		t.Fatalf("reset evidence validation error = %v", err)
	}

	description.WorkflowExtendedInfo = nil
	info, err = starter.DescribeToolExecutionWorkflow(context.Background(), input.WorkflowID, "temporal-reset-state")
	if err != nil {
		t.Fatal(err)
	}
	if info.ResetStateKnown {
		t.Fatalf("missing extended info reported known reset state: %#v", info)
	}
	if err := ValidateToolExecutionWorkflowIdentity(info, identity); !errors.Is(err, ErrWorkflowIdentityUnknown) {
		t.Fatalf("missing reset state validation error = %v", err)
	}
}

func TestStarterCancellationTargetsVerifiedTemporalRun(t *testing.T) {
	fake := &captureTemporalClient{}
	starter := &Starter{client: fake, startTimeout: time.Second}
	input := ToolExecutionWorkflowCancelInput{
		RunID:      "run-cancel-exact",
		WorkflowID: "campus-agent.chat.run-cancel-exact",
	}
	if err := starter.CancelToolExecutionWorkflow(context.Background(), input); err == nil {
		t.Fatal("cancellation without a verified Temporal run id was accepted")
	}
	if fake.canceledID != "" || fake.canceledRunID != "" {
		t.Fatalf("unverified cancellation reached Temporal: workflow_id=%q run_id=%q", fake.canceledID, fake.canceledRunID)
	}
	input.TemporalRunID = "temporal-run-cancel-exact"
	if err := starter.CancelToolExecutionWorkflow(context.Background(), input); err != nil {
		t.Fatalf("cancel verified Temporal run: %v", err)
	}
	if fake.canceledID != input.WorkflowID || fake.canceledRunID != input.TemporalRunID {
		t.Fatalf("cancellation target = workflow_id=%q run_id=%q", fake.canceledID, fake.canceledRunID)
	}
}

func TestNewStarterDefersConnectivityToReadiness(t *testing.T) {
	starter, err := NewStarter(context.Background(), StarterOptions{
		Address:   "127.0.0.1:1",
		Namespace: "default",
		TaskQueue: WorkflowTaskQueue,
	})
	if err != nil {
		t.Fatalf("NewStarter returned error: %v", err)
	}
	defer starter.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	readiness := starter.CheckReadiness(ctx)
	if readiness.Healthy {
		t.Fatal("CheckReadiness reported healthy for unavailable Temporal")
	}
}

func starterWorkflowInputForTest(runID string) ToolExecutionWorkflowInput {
	return ToolExecutionWorkflowInput{
		RunID: runID, WorkflowID: "campus-agent.chat." + runID,
		TaskQueue: WorkflowTaskQueue, PayloadSHA256: strings.Repeat("a", 64),
	}
}

func workflowDescriptionForTest(
	t *testing.T,
	identity ToolExecutionWorkflowIdentity,
	temporalRunID string,
) *workflowservicepb.DescribeWorkflowExecutionResponse {
	t.Helper()
	fields := map[string]*commonpb.Payload{}
	for key, value := range map[string]string{
		workflowMemoRunIDKey: identity.RunID, workflowMemoWorkflowIDKey: identity.WorkflowID,
		workflowMemoPayloadSHAKey: identity.PayloadSHA256, workflowMemoInputSHAKey: identity.WorkflowInputSHA256,
	} {
		payload, err := converter.GetDefaultDataConverter().ToPayload(value)
		if err != nil {
			t.Fatal(err)
		}
		fields[key] = payload
	}
	return &workflowservicepb.DescribeWorkflowExecutionResponse{
		WorkflowExecutionInfo: &workflowpb.WorkflowExecutionInfo{
			Execution: &commonpb.WorkflowExecution{
				WorkflowId: identity.WorkflowID,
				RunId:      temporalRunID,
			},
			FirstRunId: temporalRunID,
			Memo:       &commonpb.Memo{Fields: fields},
		},
		WorkflowExtendedInfo: &workflowpb.WorkflowExecutionExtendedInfo{},
	}
}

func workflowDescriptionWithoutMemoForTest(workflowID string, temporalRunID string) *workflowservicepb.DescribeWorkflowExecutionResponse {
	return &workflowservicepb.DescribeWorkflowExecutionResponse{
		WorkflowExecutionInfo: &workflowpb.WorkflowExecutionInfo{
			Execution:  &commonpb.WorkflowExecution{WorkflowId: workflowID, RunId: temporalRunID},
			FirstRunId: temporalRunID,
		},
		WorkflowExtendedInfo: &workflowpb.WorkflowExecutionExtendedInfo{},
	}
}

func TestNormalizeActivityTaskQueuesDeduplicatesWorkloadQueues(t *testing.T) {
	queues := normalizeActivityTaskQueues([]string{
		ActivityTaskQueueCore,
		ActivityTaskQueueCore,
		ActivityTaskQueueAgent,
	})

	want := []string{
		ActivityTaskQueueCore,
		ActivityTaskQueueAgent,
	}
	if len(queues) != len(want) {
		t.Fatalf("queues = %#v, want %#v", queues, want)
	}
	for index := range want {
		if queues[index] != want[index] {
			t.Fatalf("queues = %#v, want %#v", queues, want)
		}
	}
}

func TestWorkerOptionsForProfileRejectsEmptyActivitySlots(t *testing.T) {
	_, err := WorkerOptionsForProfile(WorkerProfile{
		ActivityTaskPollers: 2,
	})
	if err == nil {
		t.Fatal("WorkerOptionsForProfile returned nil error, want activity slot validation failure")
	}
}

func TestWorkerOptionsForProfileMapsActivityConcurrency(t *testing.T) {
	options, err := WorkerOptionsForProfile(WorkerProfile{
		ActivitySlots:                4,
		ActivityTaskPollers:          2,
		TaskQueueActivitiesPerSecond: 8,
		WorkerActivitiesPerSecond:    4,
		WorkflowTaskPollers:          0,
		WorkflowTaskSlots:            0,
	})
	if err != nil {
		t.Fatalf("WorkerOptionsForProfile returned error: %v", err)
	}
	if options.MaxConcurrentActivityExecutionSize != 4 {
		t.Fatalf("activity slots = %d, want 4", options.MaxConcurrentActivityExecutionSize)
	}
	if options.MaxConcurrentActivityTaskPollers != 2 {
		t.Fatalf("activity pollers = %d, want 2", options.MaxConcurrentActivityTaskPollers)
	}
	if options.TaskQueueActivitiesPerSecond != 8 {
		t.Fatalf("task queue rate = %v, want 8", options.TaskQueueActivitiesPerSecond)
	}
	if options.WorkerActivitiesPerSecond != 4 {
		t.Fatalf("worker rate = %v, want 4", options.WorkerActivitiesPerSecond)
	}
}
