package autoscaler

import (
	"testing"
	"time"
)

func TestPlanFromTemporalSnapshotsScalesMissingPollersAndRespectsBudget(t *testing.T) {
	plan, err := PlanFromTemporalRuntime(TemporalRuntimeInput{
		Now: time.Date(2026, 6, 15, 10, 0, 5, 0, time.UTC),
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-agent": {
				MaxReplicas: 3,
				MinReplicas: 1,
				TaskQueue:   "campus-agent.activity.agent",
			},
		},
		Snapshots: []TemporalTaskQueueSnapshot{
			{
				SnapshotID:    "temporal-snapshot-agent",
				TaskQueue:     "campus-agent.activity.agent",
				TaskQueueKind: TaskQueueKindActivity,
				PollerCount:   0,
			},
		},
		ReplicaCounts: map[string]int{
			"activity-worker-agent": 1,
		},
	})
	if err != nil {
		t.Fatalf("PlanFromTemporalRuntime returned error: %v", err)
	}
	if len(plan.Decisions) != 1 {
		t.Fatalf("decision count = %d", len(plan.Decisions))
	}
	decision := plan.Decisions[0]
	if decision.Decision != DecisionScaleUp {
		t.Fatalf("decision = %q", decision.Decision)
	}
	if decision.DesiredReplicas != 2 {
		t.Fatalf("desired replicas = %d", decision.DesiredReplicas)
	}
	if decision.BudgetState != BudgetWithin {
		t.Fatalf("budget = %q", decision.BudgetState)
	}
	if decision.SourceSnapshotID != "temporal-snapshot-agent" {
		t.Fatalf("source snapshot = %q", decision.SourceSnapshotID)
	}
	if decision.Evidence["backlog"].(SourceMetric).State != SourceMetricUnsupported {
		t.Fatalf("backlog evidence = %#v", decision.Evidence["backlog"])
	}
}

func TestPlanFromTemporalSnapshotsFailsClosedOnMissingReplicaState(t *testing.T) {
	_, err := PlanFromTemporalRuntime(TemporalRuntimeInput{
		Now: time.Date(2026, 6, 15, 10, 0, 5, 0, time.UTC),
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-agent": {
				MaxReplicas: 3,
				MinReplicas: 1,
				TaskQueue:   "campus-agent.activity.agent",
			},
		},
		Snapshots: []TemporalTaskQueueSnapshot{{
			SnapshotID:    "temporal-snapshot-agent",
			TaskQueue:     "campus-agent.activity.agent",
			TaskQueueKind: TaskQueueKindActivity,
			PollerCount:   0,
		}},
	})
	if err == nil {
		t.Fatal("missing replica state must fail closed")
	}
}

func TestPlanFromTemporalRuntimeUsesLatestSnapshotPerTaskQueue(t *testing.T) {
	latestBacklog := 9
	olderBacklog := 0
	plan, err := PlanFromTemporalRuntime(TemporalRuntimeInput{
		Now: time.Date(2026, 6, 15, 10, 1, 0, 0, time.UTC),
		ReplicaCounts: map[string]int{
			"activity-worker-agent": 1,
		},
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-agent": {
				MaxReplicas:               3,
				MinReplicas:               1,
				ScaleUpBacklogThreshold:   5,
				ScaleUpConsecutiveWindows: 1,
				TaskQueue:                 "campus-agent.activity.agent",
			},
		},
		Snapshots: []TemporalTaskQueueSnapshot{
			{
				Backlog:     SourceMetric{Count: &latestBacklog, State: SourceMetricObserved},
				SampledAt:   "2026-06-15T10:00:30Z",
				SnapshotID:  "snapshot-latest",
				TaskQueue:   "campus-agent.activity.agent",
				PollerCount: 1,
			},
			{
				Backlog:     SourceMetric{Count: &olderBacklog, State: SourceMetricObserved},
				SampledAt:   "2026-06-15T10:00:00Z",
				SnapshotID:  "snapshot-older",
				TaskQueue:   "campus-agent.activity.agent",
				PollerCount: 1,
			},
		},
	})
	if err != nil {
		t.Fatalf("PlanFromTemporalRuntime returned error: %v", err)
	}
	decision := plan.Decisions[0]
	if decision.SourceSnapshotID != "snapshot-latest" {
		t.Fatalf("source snapshot = %q, want latest", decision.SourceSnapshotID)
	}
	if decision.Decision != DecisionScaleUp || decision.Reason != "backlog_threshold_exceeded" {
		t.Fatalf("decision = %#v, want backlog scale up", decision)
	}
}

func TestPlanFromTemporalRuntimeScalesDownAfterStableIdleWindow(t *testing.T) {
	backlog := 0
	ageMS := 0
	plan, err := PlanFromTemporalRuntime(TemporalRuntimeInput{
		Now: time.Date(2026, 6, 15, 10, 6, 0, 0, time.UTC),
		ReplicaCounts: map[string]int{
			"activity-worker-agent": 3,
		},
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-agent": {
				MinReplicas:                 1,
				MaxReplicas:                 5,
				ScaleDownConsecutiveWindows: 2,
				TaskQueue:                   "campus-agent.activity.agent",
			},
		},
		Snapshots: []TemporalTaskQueueSnapshot{
			{
				Backlog:       SourceMetric{Count: &backlog, State: SourceMetricObserved},
				OldestTaskAge: SourceMetric{MS: &ageMS, State: SourceMetricObserved},
				PollerCount:   2,
				SampledAt:     "2026-06-15T10:05:30Z",
				SnapshotID:    "snapshot-new",
				TaskQueue:     "campus-agent.activity.agent",
			},
			{
				Backlog:       SourceMetric{Count: &backlog, State: SourceMetricObserved},
				OldestTaskAge: SourceMetric{MS: &ageMS, State: SourceMetricObserved},
				PollerCount:   2,
				SampledAt:     "2026-06-15T10:05:00Z",
				SnapshotID:    "snapshot-old",
				TaskQueue:     "campus-agent.activity.agent",
			},
		},
	})
	if err != nil {
		t.Fatalf("PlanFromTemporalRuntime returned error: %v", err)
	}
	decision := plan.Decisions[0]
	if decision.Decision != DecisionScaleDown || decision.DesiredReplicas != 2 ||
		decision.Reason != "stable_idle_window" {
		t.Fatalf("decision = %#v, want scale down to 2", decision)
	}
}

func TestPlanFromTemporalRuntimeDoesNotLoadScaleOnUnsupportedMetrics(t *testing.T) {
	plan, err := PlanFromTemporalRuntime(TemporalRuntimeInput{
		Now: time.Date(2026, 6, 15, 10, 0, 5, 0, time.UTC),
		ReplicaCounts: map[string]int{
			"activity-worker-agent": 2,
		},
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-agent": {
				MaxReplicas:               5,
				MinReplicas:               1,
				ScaleUpBacklogThreshold:   5,
				ScaleUpConsecutiveWindows: 1,
				TaskQueue:                 "campus-agent.activity.agent",
			},
		},
		Snapshots: []TemporalTaskQueueSnapshot{{
			Backlog:       SourceMetric{State: SourceMetricUnsupported},
			OldestTaskAge: SourceMetric{State: SourceMetricUnsupported},
			PollerCount:   2,
			SampledAt:     "2026-06-15T10:00:00Z",
			SnapshotID:    "snapshot-unsupported",
			TaskQueue:     "campus-agent.activity.agent",
		}},
	})
	if err != nil {
		t.Fatalf("PlanFromTemporalRuntime returned error: %v", err)
	}
	decision := plan.Decisions[0]
	if decision.Decision != DecisionHold || decision.Reason != "metrics_unsupported" {
		t.Fatalf("decision = %#v, want metrics unsupported hold", decision)
	}
}

func TestPlanFromTemporalRuntimeHoldsDuringCooldown(t *testing.T) {
	backlog := 9
	plan, err := PlanFromTemporalRuntime(TemporalRuntimeInput{
		Actuations: []Actuation{{
			ActedAt:       "2026-06-15T10:00:30Z",
			Action:        "scale",
			ActuationID:   "actuation-agent",
			Status:        ActuationStatusApplied,
			TargetService: "activity-worker-agent",
			ToReplicas:    2,
		}},
		Now: time.Date(2026, 6, 15, 10, 1, 0, 0, time.UTC),
		ReplicaCounts: map[string]int{
			"activity-worker-agent": 1,
		},
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-agent": {
				CooldownSeconds:           180,
				MaxReplicas:               3,
				MinReplicas:               1,
				ScaleUpBacklogThreshold:   5,
				ScaleUpConsecutiveWindows: 1,
				TaskQueue:                 "campus-agent.activity.agent",
			},
		},
		Snapshots: []TemporalTaskQueueSnapshot{{
			Backlog:     SourceMetric{Count: &backlog, State: SourceMetricObserved},
			PollerCount: 1,
			SampledAt:   "2026-06-15T10:00:50Z",
			SnapshotID:  "snapshot-hot",
			TaskQueue:   "campus-agent.activity.agent",
		}},
	})
	if err != nil {
		t.Fatalf("PlanFromTemporalRuntime returned error: %v", err)
	}
	decision := plan.Decisions[0]
	if decision.Decision != DecisionHold ||
		decision.DesiredReplicas != 1 ||
		decision.Reason != "cooldown_active" {
		t.Fatalf("decision = %#v, want cooldown hold", decision)
	}
	if decision.Evidence["lastActuationId"] != "actuation-agent" ||
		decision.Evidence["cooldownUntil"] != "2026-06-15T10:03:30Z" {
		t.Fatalf("evidence = %#v, want cooldown evidence", decision.Evidence)
	}
}
