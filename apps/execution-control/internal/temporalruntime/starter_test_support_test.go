package temporalruntime

import (
	"context"
	"strings"
	"testing"

	commonpb "go.temporal.io/api/common/v1"
	workflowpb "go.temporal.io/api/workflow/v1"
	workflowservicepb "go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/converter"
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

func starterWorkflowInputForTest(runID string) ToolExecutionWorkflowInput {
	return ToolExecutionWorkflowInput{
		RequestID: runID, WorkflowID: "campus-agent.chat." + runID,
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
		workflowMemoRequestIDKey: identity.RequestID, workflowMemoWorkflowIDKey: identity.WorkflowID,
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
