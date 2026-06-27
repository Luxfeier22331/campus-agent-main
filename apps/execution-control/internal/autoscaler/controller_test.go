package autoscaler

import (
	"context"
	"errors"
	"testing"
	"time"
)

func fixedAutoscalerTime() time.Time {
	return time.Date(2026, 6, 15, 10, 0, 5, 0, time.UTC)
}

type fakeSnapshotSource struct {
	snapshots []TemporalTaskQueueSnapshot
}

func (f fakeSnapshotSource) FetchTemporalTaskQueueSnapshots(
	context.Context,
	int,
) ([]TemporalTaskQueueSnapshot, error) {
	return f.snapshots, nil
}

type fakeActuationSource struct {
	actuations []Actuation
}

func (f fakeActuationSource) FetchWorkerAutoscalerActuations(
	context.Context,
	int,
) ([]Actuation, error) {
	return f.actuations, nil
}

type fakeReplicaSource struct {
	replicas map[string]int
}

func (f fakeReplicaSource) ReplicaCounts(
	context.Context,
	[]string,
) (map[string]int, error) {
	return f.replicas, nil
}

type fakeRuntimePublisher struct {
	payloads []AppAPIRuntimePayload
}

func (f *fakeRuntimePublisher) PublishRuntimePayload(
	_ context.Context,
	payload AppAPIRuntimePayload,
) error {
	f.payloads = append(f.payloads, payload)
	return nil
}

type fakeActuator struct {
	actuations []Actuation
	err        error
}

func (f fakeActuator) Apply(context.Context, []WorkerAutoscalerDecision) ([]Actuation, error) {
	return f.actuations, f.err
}

func TestControllerDryRunPublishesDecisionsWithoutActuation(t *testing.T) {
	publisher := &fakeRuntimePublisher{}
	controller := Controller{
		ActuationSource:  fakeActuationSource{},
		Mode:             ModeDryRun,
		Now:              fixedAutoscalerTime,
		ReplicaSource:    fakeReplicaSource{replicas: map[string]int{"activity-worker-knowledge": 1}},
		RuntimePublisher: publisher,
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-knowledge": {
				MaxReplicas: 3,
				MinReplicas: 1,
				TaskQueue:   "campus-agent.activity.knowledge",
			},
		},
		SnapshotLimit: 8,
		SnapshotSource: fakeSnapshotSource{snapshots: []TemporalTaskQueueSnapshot{{
			Backlog:       SourceMetric{State: SourceMetricUnsupported},
			SnapshotID:    "temporal-snapshot-knowledge",
			TaskQueue:     "campus-agent.activity.knowledge",
			TaskQueueKind: TaskQueueKindActivity,
		}}},
	}

	result, err := controller.Run(t.Context())
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if len(result.Decisions) != 1 || result.Decisions[0].Decision != DecisionScaleUp {
		t.Fatalf("decisions = %#v", result.Decisions)
	}
	if len(result.Actuations) != 0 {
		t.Fatalf("dry-run actuations = %#v", result.Actuations)
	}
	if len(publisher.payloads) != 1 {
		t.Fatalf("published payload count = %d", len(publisher.payloads))
	}
	if len(publisher.payloads[0].Decisions) != 1 || len(publisher.payloads[0].Actuations) != 0 {
		t.Fatalf("published payload = %#v", publisher.payloads[0])
	}
}

func TestControllerApplyPublishesActuations(t *testing.T) {
	publisher := &fakeRuntimePublisher{}
	controller := Controller{
		Actuator: fakeActuator{actuations: []Actuation{{
			ActedAt:       "2026-06-15T10:00:06Z",
			Action:        "scale",
			ActuationID:   "actuation-knowledge",
			ActuatorKind:  ActuatorKindDockerCompose,
			DecisionID:    "autoscaler-20260615T100005Z-activity-worker-knowledge",
			FromReplicas:  1,
			Status:        ActuationStatusApplied,
			TargetService: "activity-worker-knowledge",
			ToReplicas:    2,
		}}},
		ActuationSource:  fakeActuationSource{},
		Mode:             ModeApply,
		Now:              fixedAutoscalerTime,
		ReplicaSource:    fakeReplicaSource{replicas: map[string]int{"activity-worker-knowledge": 1}},
		RuntimePublisher: publisher,
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-knowledge": {
				MaxReplicas: 3,
				MinReplicas: 1,
				TaskQueue:   "campus-agent.activity.knowledge",
			},
		},
		SnapshotSource: fakeSnapshotSource{snapshots: []TemporalTaskQueueSnapshot{{
			SnapshotID:    "temporal-snapshot-knowledge",
			TaskQueue:     "campus-agent.activity.knowledge",
			TaskQueueKind: TaskQueueKindActivity,
		}}},
	}

	result, err := controller.Run(t.Context())
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if len(result.Actuations) != 1 {
		t.Fatalf("actuations = %#v", result.Actuations)
	}
	if len(publisher.payloads) != 1 {
		t.Fatalf("published payload count = %d", len(publisher.payloads))
	}
	if len(publisher.payloads[0].Actuations) != 1 {
		t.Fatalf("published payload = %#v", publisher.payloads[0])
	}
}

func TestControllerApplyPublishesFailedActuationBeforeReturningError(t *testing.T) {
	publisher := &fakeRuntimePublisher{}
	controller := Controller{
		Actuator: fakeActuator{
			actuations: []Actuation{{
				ActedAt:       "2026-06-15T10:00:06Z",
				Action:        "scale",
				ActuationID:   "actuation-knowledge",
				ActuatorKind:  ActuatorKindDockerCompose,
				DecisionID:    "autoscaler-20260615T100005Z-activity-worker-knowledge",
				ErrorCode:     "docker_compose_scale_failed",
				FromReplicas:  1,
				Status:        ActuationStatusFailed,
				TargetService: "activity-worker-knowledge",
				ToReplicas:    2,
			}},
			err: errors.New("compose failed"),
		},
		ActuationSource:  fakeActuationSource{},
		Mode:             ModeApply,
		Now:              fixedAutoscalerTime,
		ReplicaSource:    fakeReplicaSource{replicas: map[string]int{"activity-worker-knowledge": 1}},
		RuntimePublisher: publisher,
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-knowledge": {
				MaxReplicas: 3,
				MinReplicas: 1,
				TaskQueue:   "campus-agent.activity.knowledge",
			},
		},
		SnapshotSource: fakeSnapshotSource{snapshots: []TemporalTaskQueueSnapshot{{
			SnapshotID:    "temporal-snapshot-knowledge",
			TaskQueue:     "campus-agent.activity.knowledge",
			TaskQueueKind: TaskQueueKindActivity,
		}}},
	}

	result, err := controller.Run(t.Context())
	if err == nil {
		t.Fatal("Run must return the actuation error")
	}
	if len(result.Actuations) != 1 {
		t.Fatalf("actuations = %#v", result.Actuations)
	}
	if len(publisher.payloads) != 1 {
		t.Fatalf("published payload count = %d", len(publisher.payloads))
	}
	if len(publisher.payloads[0].Actuations) != 1 ||
		publisher.payloads[0].Actuations[0].Status != ActuationStatusFailed {
		t.Fatalf("published payload = %#v", publisher.payloads[0])
	}
}

func TestControllerReadsRecentActuationsForCooldownDecisions(t *testing.T) {
	publisher := &fakeRuntimePublisher{}
	controller := Controller{
		ActuationSource: fakeActuationSource{actuations: []Actuation{{
			ActedAt:       "2026-06-15T10:00:30Z",
			Action:        "scale",
			ActuationID:   "actuation-knowledge",
			Status:        ActuationStatusApplied,
			TargetService: "activity-worker-knowledge",
			ToReplicas:    2,
		}}},
		Mode:             ModeDryRun,
		Now:              func() time.Time { return time.Date(2026, 6, 15, 10, 1, 0, 0, time.UTC) },
		ReplicaSource:    fakeReplicaSource{replicas: map[string]int{"activity-worker-knowledge": 1}},
		RuntimePublisher: publisher,
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-knowledge": {
				CooldownSeconds:           180,
				MaxReplicas:               3,
				MinReplicas:               1,
				ScaleUpBacklogThreshold:   1,
				ScaleUpConsecutiveWindows: 1,
				TaskQueue:                 "campus-agent.activity.knowledge",
			},
		},
		SnapshotSource: fakeSnapshotSource{snapshots: []TemporalTaskQueueSnapshot{{
			Backlog: SourceMetric{
				Count: intPtr(9),
				State: SourceMetricObserved,
			},
			PollerCount:   1,
			SnapshotID:    "temporal-snapshot-knowledge",
			TaskQueue:     "campus-agent.activity.knowledge",
			TaskQueueKind: TaskQueueKindActivity,
		}}},
	}

	result, err := controller.Run(t.Context())
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if len(result.Decisions) != 1 || result.Decisions[0].Reason != "cooldown_active" {
		t.Fatalf("decisions = %#v", result.Decisions)
	}
	if len(publisher.payloads) != 1 ||
		publisher.payloads[0].Decisions[0].Reason != "cooldown_active" {
		t.Fatalf("published payload = %#v", publisher.payloads)
	}
}

func intPtr(value int) *int {
	return &value
}
