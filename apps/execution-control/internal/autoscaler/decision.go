package autoscaler

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	TaskQueueKindWorkflow = "workflow"
	TaskQueueKindActivity = "activity"

	SourceMetricObserved    = "observed"
	SourceMetricUnsupported = "unsupported_by_source"

	DecisionScaleUp   = "scale_up"
	DecisionScaleDown = "scale_down"
	DecisionHold      = "hold"

	BudgetWithin       = "within_budget"
	BudgetExhausted    = "budget_exhausted"
	BudgetActuationOff = "actuation_disabled"
)

type SourceMetric struct {
	Count *int   `json:"count,omitempty"`
	MS    *int   `json:"ms,omitempty"`
	State string `json:"state"`
}

type TemporalTaskQueueSnapshot struct {
	Backlog                SourceMetric `json:"backlog"`
	OldestTaskAge          SourceMetric `json:"oldestTaskAge"`
	PollerCount            int          `json:"pollerCount"`
	SampledAt              string       `json:"sampledAt"`
	ScheduleToStartLatency SourceMetric `json:"scheduleToStartLatency"`
	SnapshotID             string       `json:"snapshotId"`
	TaskQueue              string       `json:"taskQueue"`
	TaskQueueKind          string       `json:"taskQueueKind"`
}

type ServicePolicy struct {
	CooldownSeconds             int
	MaxReplicas                 int
	MinReplicas                 int
	ScaleDownConsecutiveWindows int
	ScaleUpBacklogThreshold     int
	ScaleUpConsecutiveWindows   int
	ScaleUpOldestAgeThresholdMS int
	TaskQueue                   string
}

type TemporalRuntimeInput struct {
	Actuations      []Actuation
	Now             time.Time
	ReplicaCounts   map[string]int
	ServicePolicies map[string]ServicePolicy
	Snapshots       []TemporalTaskQueueSnapshot
}

type WorkerAutoscalerDecision struct {
	BudgetState      string         `json:"budgetState"`
	CurrentReplicas  int            `json:"currentReplicas"`
	DecidedAt        string         `json:"decidedAt"`
	Decision         string         `json:"decision"`
	DecisionID       string         `json:"decisionId"`
	DesiredReplicas  int            `json:"desiredReplicas"`
	Evidence         map[string]any `json:"evidence"`
	Reason           string         `json:"reason"`
	SourceSnapshotID string         `json:"sourceSnapshotId"`
	TargetService    string         `json:"targetService"`
	TaskQueue        string         `json:"taskQueue"`
	TaskQueueKind    string         `json:"taskQueueKind"`
}

type Plan struct {
	Decisions []WorkerAutoscalerDecision `json:"decisions"`
}

func PlanFromTemporalRuntime(input TemporalRuntimeInput) (Plan, error) {
	if input.Now.IsZero() {
		return Plan{}, fmt.Errorf("decision timestamp is required")
	}
	if len(input.ServicePolicies) == 0 {
		return Plan{}, fmt.Errorf("service policies are required")
	}
	snapshotsByQueue := map[string][]TemporalTaskQueueSnapshot{}
	for _, snapshot := range input.Snapshots {
		if strings.TrimSpace(snapshot.SnapshotID) == "" {
			return Plan{}, fmt.Errorf("snapshot id is required")
		}
		if strings.TrimSpace(snapshot.TaskQueue) == "" {
			return Plan{}, fmt.Errorf("snapshot task queue is required")
		}
		normalized := normalizeSnapshot(snapshot)
		snapshotsByQueue[normalized.TaskQueue] = append(snapshotsByQueue[normalized.TaskQueue], normalized)
	}
	for taskQueue := range snapshotsByQueue {
		sort.SliceStable(snapshotsByQueue[taskQueue], func(left int, right int) bool {
			return sampledAtAfter(snapshotsByQueue[taskQueue][left], snapshotsByQueue[taskQueue][right])
		})
	}
	actuationsByService, err := latestScaleActuationsByService(input.Actuations)
	if err != nil {
		return Plan{}, err
	}

	decisions := make([]WorkerAutoscalerDecision, 0, len(input.ServicePolicies))
	for service, policy := range input.ServicePolicies {
		service = strings.TrimSpace(service)
		if service == "" {
			return Plan{}, fmt.Errorf("service policy name is required")
		}
		if strings.TrimSpace(policy.TaskQueue) == "" {
			return Plan{}, fmt.Errorf("service policy task queue is required for %s", service)
		}
		current, ok := input.ReplicaCounts[service]
		if !ok {
			return Plan{}, fmt.Errorf("replica state for %s is required", service)
		}
		if current < 0 || policy.MinReplicas < 0 || policy.MaxReplicas < 0 {
			return Plan{}, fmt.Errorf("replicas for %s must be non-negative", service)
		}
		snapshots, ok := snapshotsByQueue[policy.TaskQueue]
		if !ok || len(snapshots) == 0 {
			return Plan{}, fmt.Errorf("snapshot for task queue %s is required", policy.TaskQueue)
		}
		decision := decideFromSnapshots(
			service,
			policy,
			current,
			snapshots,
			actuationsByService[service],
			input.Now.UTC(),
		)
		decisions = append(decisions, decision)
	}
	return Plan{Decisions: decisions}, nil
}

func sampledAtAfter(left TemporalTaskQueueSnapshot, right TemporalTaskQueueSnapshot) bool {
	leftTime, leftErr := time.Parse(time.RFC3339Nano, strings.TrimSpace(left.SampledAt))
	rightTime, rightErr := time.Parse(time.RFC3339Nano, strings.TrimSpace(right.SampledAt))
	if leftErr == nil && rightErr == nil && !leftTime.Equal(rightTime) {
		return leftTime.After(rightTime)
	}
	if leftErr == nil && rightErr != nil {
		return true
	}
	if leftErr != nil && rightErr == nil {
		return false
	}
	return left.SnapshotID > right.SnapshotID
}

func normalizeSnapshot(snapshot TemporalTaskQueueSnapshot) TemporalTaskQueueSnapshot {
	if snapshot.Backlog.State == "" {
		snapshot.Backlog.State = SourceMetricUnsupported
	}
	if snapshot.OldestTaskAge.State == "" {
		snapshot.OldestTaskAge.State = SourceMetricUnsupported
	}
	if snapshot.ScheduleToStartLatency.State == "" {
		snapshot.ScheduleToStartLatency.State = SourceMetricUnsupported
	}
	return snapshot
}

func decideFromSnapshots(
	service string,
	policy ServicePolicy,
	current int,
	snapshots []TemporalTaskQueueSnapshot,
	lastActuation *Actuation,
	now time.Time,
) WorkerAutoscalerDecision {
	latest := snapshots[0]
	desired := current
	reason := "within_target"
	if latest.PollerCount <= 0 {
		desired = maxInt(current+1, policy.MinReplicas)
		reason = "pollers_missing"
	} else if scaleUpBacklogExceeded(policy, snapshots) {
		desired = current + 1
		reason = "backlog_threshold_exceeded"
	} else if scaleUpOldestAgeExceeded(policy, snapshots) {
		desired = current + 1
		reason = "oldest_task_age_threshold_exceeded"
	} else if scaleDownIdleWindow(policy, snapshots) && current > policy.MinReplicas {
		desired = current - 1
		reason = "stable_idle_window"
	} else if loadMetricsUnsupported(latest) {
		reason = "metrics_unsupported"
	}
	if policy.MaxReplicas > 0 && desired > policy.MaxReplicas {
		desired = policy.MaxReplicas
	}
	if desired < policy.MinReplicas {
		desired = policy.MinReplicas
	}
	evidence := evidenceFromSnapshot(latest)
	if desired != current {
		cooldown := activeCooldown(policy, lastActuation, now)
		if cooldown.Active {
			desired = current
			reason = "cooldown_active"
			evidence["cooldownUntil"] = cooldown.Until.Format(time.RFC3339Nano)
			evidence["lastActuationId"] = cooldown.Actuation.ActuationID
			evidence["lastActuationStatus"] = cooldown.Actuation.Status
		}
	}
	budget := BudgetWithin
	if desired == current && reason == "pollers_missing" {
		budget = BudgetExhausted
	}
	decision := DecisionHold
	if desired > current {
		decision = DecisionScaleUp
	} else if desired < current {
		decision = DecisionScaleDown
	}
	return WorkerAutoscalerDecision{
		BudgetState:      budget,
		CurrentReplicas:  current,
		DecidedAt:        now.Format(time.RFC3339Nano),
		Decision:         decision,
		DecisionID:       fmt.Sprintf("autoscaler-%s-%s", now.Format("20060102T150405Z"), service),
		DesiredReplicas:  desired,
		Evidence:         evidence,
		Reason:           reason,
		SourceSnapshotID: latest.SnapshotID,
		TargetService:    service,
		TaskQueue:        latest.TaskQueue,
		TaskQueueKind:    latest.TaskQueueKind,
	}
}

func scaleUpBacklogExceeded(policy ServicePolicy, snapshots []TemporalTaskQueueSnapshot) bool {
	if policy.ScaleUpBacklogThreshold <= 0 {
		return false
	}
	windows := positiveOrDefault(policy.ScaleUpConsecutiveWindows, 2)
	if len(snapshots) < windows {
		return false
	}
	for _, snapshot := range snapshots[:windows] {
		if snapshot.Backlog.State != SourceMetricObserved ||
			snapshot.Backlog.Count == nil ||
			*snapshot.Backlog.Count < policy.ScaleUpBacklogThreshold {
			return false
		}
	}
	return true
}

func scaleUpOldestAgeExceeded(policy ServicePolicy, snapshots []TemporalTaskQueueSnapshot) bool {
	if policy.ScaleUpOldestAgeThresholdMS <= 0 {
		return false
	}
	windows := positiveOrDefault(policy.ScaleUpConsecutiveWindows, 2)
	if len(snapshots) < windows {
		return false
	}
	for _, snapshot := range snapshots[:windows] {
		if snapshot.OldestTaskAge.State != SourceMetricObserved ||
			snapshot.OldestTaskAge.MS == nil ||
			*snapshot.OldestTaskAge.MS < policy.ScaleUpOldestAgeThresholdMS {
			return false
		}
	}
	return true
}

func scaleDownIdleWindow(policy ServicePolicy, snapshots []TemporalTaskQueueSnapshot) bool {
	windows := positiveOrDefault(policy.ScaleDownConsecutiveWindows, 6)
	if len(snapshots) < windows {
		return false
	}
	for _, snapshot := range snapshots[:windows] {
		if snapshot.Backlog.State != SourceMetricObserved ||
			snapshot.Backlog.Count == nil ||
			*snapshot.Backlog.Count != 0 {
			return false
		}
		if snapshot.OldestTaskAge.State == SourceMetricObserved &&
			snapshot.OldestTaskAge.MS != nil &&
			*snapshot.OldestTaskAge.MS != 0 {
			return false
		}
	}
	return true
}

func loadMetricsUnsupported(snapshot TemporalTaskQueueSnapshot) bool {
	return snapshot.Backlog.State != SourceMetricObserved &&
		snapshot.OldestTaskAge.State != SourceMetricObserved
}

type cooldownDecision struct {
	Active    bool
	Actuation Actuation
	Until     time.Time
}

func activeCooldown(policy ServicePolicy, lastActuation *Actuation, now time.Time) cooldownDecision {
	if policy.CooldownSeconds <= 0 || lastActuation == nil {
		return cooldownDecision{}
	}
	actedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(lastActuation.ActedAt))
	if err != nil {
		return cooldownDecision{}
	}
	until := actedAt.Add(time.Duration(policy.CooldownSeconds) * time.Second)
	if !now.Before(until) {
		return cooldownDecision{}
	}
	return cooldownDecision{
		Active:    true,
		Actuation: *lastActuation,
		Until:     until,
	}
}

func latestScaleActuationsByService(actuations []Actuation) (map[string]*Actuation, error) {
	latest := map[string]*Actuation{}
	for _, actuation := range actuations {
		targetService := strings.TrimSpace(actuation.TargetService)
		if targetService == "" {
			return nil, fmt.Errorf("actuation target service is required")
		}
		if strings.TrimSpace(actuation.ActuationID) == "" {
			return nil, fmt.Errorf("actuation id is required")
		}
		actedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(actuation.ActedAt))
		if err != nil {
			return nil, fmt.Errorf("actuation actedAt for %s is invalid: %w", actuation.ActuationID, err)
		}
		if actuation.Action != "scale" {
			continue
		}
		if actuation.Status != ActuationStatusApplied && actuation.Status != ActuationStatusFailed {
			continue
		}
		current := latest[targetService]
		if current == nil {
			copy := actuation
			latest[targetService] = &copy
			continue
		}
		currentActedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(current.ActedAt))
		if err != nil {
			return nil, fmt.Errorf("actuation actedAt for %s is invalid: %w", current.ActuationID, err)
		}
		if actedAt.After(currentActedAt) ||
			(actedAt.Equal(currentActedAt) && actuation.ActuationID > current.ActuationID) {
			copy := actuation
			latest[targetService] = &copy
		}
	}
	return latest, nil
}

func evidenceFromSnapshot(snapshot TemporalTaskQueueSnapshot) map[string]any {
	return map[string]any{
		"backlog":                snapshot.Backlog,
		"oldestTaskAge":          snapshot.OldestTaskAge,
		"pollerCount":            snapshot.PollerCount,
		"scheduleToStartLatency": snapshot.ScheduleToStartLatency,
	}
}

func positiveOrDefault(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
