package temporalmetrics

import (
	"context"
	"fmt"
	"sort"
	"strings"

	enumspb "go.temporal.io/api/enums/v1"
	taskqueuepb "go.temporal.io/api/taskqueue/v1"
	workflowservice "go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
)

type SDKTaskQueueClient struct {
	Client    client.Client
	Namespace string
}

func (c SDKTaskQueueClient) DescribeTaskQueue(
	ctx context.Context,
	name string,
	kind string,
) (DescribeTaskQueueResult, error) {
	queueType := enumspb.TASK_QUEUE_TYPE_ACTIVITY
	if kind == TaskQueueKindWorkflow {
		queueType = enumspb.TASK_QUEUE_TYPE_WORKFLOW
	}
	namespace := strings.TrimSpace(c.Namespace)
	if namespace == "" {
		return DescribeTaskQueueResult{}, fmt.Errorf("temporal namespace is required")
	}
	response, err := c.Client.WorkflowService().DescribeTaskQueue(ctx, &workflowservice.DescribeTaskQueueRequest{
		Namespace: namespace,
		TaskQueue: &taskqueuepb.TaskQueue{
			Kind: enumspb.TASK_QUEUE_KIND_NORMAL,
			Name: name,
		},
		TaskQueueType: queueType,
		ReportStats:   true,
	})
	if err != nil {
		return DescribeTaskQueueResult{}, err
	}
	stats := response.GetStats()
	var backlogPtr *int
	var backlogAgePtr *int
	if stats != nil {
		backlog := int(stats.GetApproximateBacklogCount())
		backlogPtr = &backlog
		if age := stats.GetApproximateBacklogAge(); age != nil {
			ageMS := int(age.AsDuration().Milliseconds())
			backlogAgePtr = &ageMS
		}
	}
	identities := make([]string, 0, len(response.GetPollers()))
	for _, poller := range response.GetPollers() {
		if poller.GetIdentity() != "" {
			identities = append(identities, poller.GetIdentity())
		}
	}
	sort.Strings(identities)
	return DescribeTaskQueueResult{
		ApproximateBacklogAgeMS: backlogAgePtr,
		ApproximateBacklogCount: backlogPtr,
		PollerIdentities:        identities,
	}, nil
}
