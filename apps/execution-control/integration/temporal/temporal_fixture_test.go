//go:build temporal_integration

package temporal_test

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeassembly"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
)

func historyContains(history *historypb.History, eventType enumspb.EventType) bool {
	for _, event := range history.GetEvents() {
		if event.GetEventType() == eventType {
			return true
		}
	}
	return false
}

func historyContainsCompletedActivity(history *historypb.History, activityName string) bool {
	for _, event := range history.GetEvents() {
		if event.GetEventType() != enumspb.EVENT_TYPE_ACTIVITY_TASK_COMPLETED {
			continue
		}
		attributes := event.GetActivityTaskCompletedEventAttributes()
		if attributes == nil {
			continue
		}
		scheduledID := attributes.GetScheduledEventId()
		for _, scheduledEvent := range history.GetEvents() {
			if scheduledEvent.GetEventId() != scheduledID {
				continue
			}
			scheduledAttributes := scheduledEvent.GetActivityTaskScheduledEventAttributes()
			if scheduledAttributes == nil || scheduledAttributes.GetActivityType() == nil {
				continue
			}
			if scheduledAttributes.GetActivityType().GetName() == activityName {
				return true
			}
		}
	}
	return false
}

func newStarter(t *testing.T, ctx context.Context) *temporalruntime.Starter {
	t.Helper()
	starter, err := runtimeassembly.NewStarter(ctx, temporalruntime.StarterOptions{
		Address:      packageHarness.Address,
		Namespace:    packageHarness.Namespace,
		TaskQueue:    temporalruntime.WorkflowTaskQueue,
		StartTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("create starter: %v", err)
	}
	t.Cleanup(starter.Close)
	return starter
}
