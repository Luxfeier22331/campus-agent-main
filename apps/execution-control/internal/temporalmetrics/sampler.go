package temporalmetrics

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const (
	SchemaVersion             = "temporal_task_queue_metrics_snapshot.v1"
	TaskQueueKindWorkflow     = "workflow"
	TaskQueueKindActivity     = "activity"
	SourceMetricObserved      = "observed"
	SourceMetricUnsupported   = "unsupported_by_source"
	DefaultSamplerSource      = "execution-control.temporal-task-queue-sampler"
	defaultSnapshotIDTimeForm = "20060102T150405Z"
)

type TaskQueueKind = string

type TaskQueueTarget struct {
	Name string
	Kind TaskQueueKind
}

type DescribeTaskQueueResult struct {
	ApproximateBacklogAgeMS *int
	ApproximateBacklogCount *int
	PollerIdentities        []string
}

type TaskQueueClient interface {
	DescribeTaskQueue(context.Context, string, string) (DescribeTaskQueueResult, error)
}

type SourceCountMetric struct {
	Count *int   `json:"count,omitempty"`
	State string `json:"state"`
}

type SourceDurationMetric struct {
	MS    *int   `json:"ms,omitempty"`
	State string `json:"state"`
}

type TaskQueueSnapshot struct {
	Backlog                SourceCountMetric    `json:"backlog"`
	Namespace              string               `json:"namespace"`
	OldestTaskAge          SourceDurationMetric `json:"oldestTaskAge"`
	PollerCount            int                  `json:"pollerCount"`
	PollerIdentities       []string             `json:"pollerIdentities"`
	SampledAt              string               `json:"sampledAt"`
	ScheduleToStartLatency SourceDurationMetric `json:"scheduleToStartLatency"`
	SnapshotID             string               `json:"snapshotId"`
	Source                 string               `json:"source"`
	TaskQueue              string               `json:"taskQueue"`
	TaskQueueKind          TaskQueueKind        `json:"taskQueueKind"`
}

type SnapshotPayload struct {
	SchemaVersion string              `json:"schemaVersion"`
	Snapshots     []TaskQueueSnapshot `json:"snapshots"`
}

type Sampler struct {
	Client     TaskQueueClient
	Namespace  string
	Now        func() time.Time
	Source     string
	TaskQueues []TaskQueueTarget
}

func (s Sampler) Sample(ctx context.Context) (SnapshotPayload, error) {
	if s.Client == nil {
		return SnapshotPayload{}, fmt.Errorf("temporal task queue client is required")
	}
	namespace := strings.TrimSpace(s.Namespace)
	if namespace == "" {
		return SnapshotPayload{}, fmt.Errorf("temporal namespace is required")
	}
	if len(s.TaskQueues) == 0 {
		return SnapshotPayload{}, fmt.Errorf("at least one temporal task queue target is required")
	}
	now := time.Now().UTC()
	if s.Now != nil {
		now = s.Now().UTC()
	}
	source := strings.TrimSpace(s.Source)
	if source == "" {
		source = DefaultSamplerSource
	}
	sampledAt := now.Format(time.RFC3339Nano)
	snapshots := make([]TaskQueueSnapshot, 0, len(s.TaskQueues))
	for index, target := range s.TaskQueues {
		name := strings.TrimSpace(target.Name)
		kind := strings.TrimSpace(target.Kind)
		if name == "" {
			return SnapshotPayload{}, fmt.Errorf("taskQueues[%d].name is required", index)
		}
		if kind != TaskQueueKindWorkflow && kind != TaskQueueKindActivity {
			return SnapshotPayload{}, fmt.Errorf("taskQueues[%d].kind must be workflow or activity", index)
		}
		result, err := s.Client.DescribeTaskQueue(ctx, name, kind)
		if err != nil {
			return SnapshotPayload{}, err
		}
		identities := append([]string(nil), result.PollerIdentities...)
		backlog := SourceCountMetric{State: SourceMetricUnsupported}
		if result.ApproximateBacklogCount != nil {
			backlog = SourceCountMetric{Count: result.ApproximateBacklogCount, State: SourceMetricObserved}
		}
		oldestTaskAge := SourceDurationMetric{State: SourceMetricUnsupported}
		if result.ApproximateBacklogAgeMS != nil {
			oldestTaskAge = SourceDurationMetric{MS: result.ApproximateBacklogAgeMS, State: SourceMetricObserved}
		}
		snapshots = append(snapshots, TaskQueueSnapshot{
			Backlog:                backlog,
			Namespace:              namespace,
			OldestTaskAge:          oldestTaskAge,
			PollerCount:            len(identities),
			PollerIdentities:       identities,
			SampledAt:              sampledAt,
			ScheduleToStartLatency: SourceDurationMetric{State: SourceMetricUnsupported},
			SnapshotID:             snapshotID(now, namespace, name, kind),
			Source:                 source,
			TaskQueue:              name,
			TaskQueueKind:          kind,
		})
	}
	return SnapshotPayload{
		SchemaVersion: SchemaVersion,
		Snapshots:     snapshots,
	}, nil
}

func snapshotID(now time.Time, namespace string, taskQueue string, kind string) string {
	hash := sha256.Sum256([]byte(namespace + "\x00" + taskQueue + "\x00" + kind))
	return fmt.Sprintf(
		"temporal-snapshot-%s-%s",
		now.UTC().Format(defaultSnapshotIDTimeForm),
		hex.EncodeToString(hash[:])[:12],
	)
}
