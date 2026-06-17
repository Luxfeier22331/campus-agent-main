package temporalmetrics

import (
	"context"
	"testing"
	"time"
)

type fakeTaskQueueClient struct {
	responses map[string]DescribeTaskQueueResult
}

func (f fakeTaskQueueClient) DescribeTaskQueue(
	_ context.Context,
	name string,
	kind string,
) (DescribeTaskQueueResult, error) {
	return f.responses[kind+":"+name], nil
}

func TestSamplerMarksUnsupportedMetricsExplicitly(t *testing.T) {
	sampler := Sampler{
		Client: fakeTaskQueueClient{
			responses: map[string]DescribeTaskQueueResult{
				"workflow:campus-agent.workflow": {
					PollerIdentities: []string{"workflow-worker-1"},
				},
				"activity:campus-agent.activity.knowledge.retrieval": {},
			},
		},
		Namespace: "campus-agent-staging",
		Source:    "execution-control.temporal-task-queue-sampler",
		TaskQueues: []TaskQueueTarget{
			{Name: "campus-agent.workflow", Kind: TaskQueueKindWorkflow},
			{Name: "campus-agent.activity.knowledge.retrieval", Kind: TaskQueueKindActivity},
		},
		Now: func() time.Time {
			return time.Date(2026, 6, 15, 10, 0, 0, 0, time.UTC)
		},
	}

	snapshot, err := sampler.Sample(context.Background())
	if err != nil {
		t.Fatalf("Sample returned error: %v", err)
	}
	if snapshot.SchemaVersion != "temporal_task_queue_metrics_snapshot.v1" {
		t.Fatalf("schema = %q", snapshot.SchemaVersion)
	}
	if len(snapshot.Snapshots) != 2 {
		t.Fatalf("snapshot count = %d", len(snapshot.Snapshots))
	}
	workflow := snapshot.Snapshots[0]
	if workflow.PollerCount != 1 {
		t.Fatalf("workflow poller count = %d", workflow.PollerCount)
	}
	if workflow.Backlog.State != SourceMetricUnsupported || workflow.Backlog.Count != nil {
		t.Fatalf("backlog = %#v, want unsupported by source", workflow.Backlog)
	}
	if workflow.ScheduleToStartLatency.State != SourceMetricUnsupported ||
		workflow.ScheduleToStartLatency.MS != nil {
		t.Fatalf("latency = %#v, want unsupported by source", workflow.ScheduleToStartLatency)
	}
	activity := snapshot.Snapshots[1]
	if activity.PollerCount != 0 {
		t.Fatalf("activity poller count = %d", activity.PollerCount)
	}
	if activity.SnapshotID == workflow.SnapshotID {
		t.Fatalf("snapshot IDs must be unique: %q", activity.SnapshotID)
	}
}

func TestSamplerProjectsObservedTemporalStats(t *testing.T) {
	backlog := 12
	backlogAgeMS := 4500
	sampler := Sampler{
		Client: fakeTaskQueueClient{
			responses: map[string]DescribeTaskQueueResult{
				"activity:campus-agent.activity.knowledge.retrieval": {
					ApproximateBacklogAgeMS: &backlogAgeMS,
					ApproximateBacklogCount: &backlog,
					PollerIdentities:        []string{"knowledge-worker-1"},
				},
			},
		},
		Namespace: "campus-agent-staging",
		TaskQueues: []TaskQueueTarget{
			{Name: "campus-agent.activity.knowledge.retrieval", Kind: TaskQueueKindActivity},
		},
		Now: func() time.Time {
			return time.Date(2026, 6, 15, 10, 0, 0, 0, time.UTC)
		},
	}

	payload, err := sampler.Sample(context.Background())
	if err != nil {
		t.Fatalf("Sample returned error: %v", err)
	}
	snapshot := payload.Snapshots[0]
	if snapshot.Backlog.State != SourceMetricObserved || snapshot.Backlog.Count == nil ||
		*snapshot.Backlog.Count != 12 {
		t.Fatalf("backlog = %#v, want observed count 12", snapshot.Backlog)
	}
	if snapshot.OldestTaskAge.State != SourceMetricObserved ||
		snapshot.OldestTaskAge.MS == nil ||
		*snapshot.OldestTaskAge.MS != 4500 {
		t.Fatalf("oldest task age = %#v, want observed 4500ms", snapshot.OldestTaskAge)
	}
	if snapshot.ScheduleToStartLatency.State != SourceMetricUnsupported {
		t.Fatalf("schedule-to-start = %#v, want unsupported", snapshot.ScheduleToStartLatency)
	}
}
