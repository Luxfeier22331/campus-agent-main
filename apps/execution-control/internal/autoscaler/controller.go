package autoscaler

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"
)

const (
	ModeDryRun = "dry-run"
	ModeApply  = "apply"
)

type Controller struct {
	Actuator         Actuator
	ActuationSource  ActuationSource
	Mode             string
	Now              func() time.Time
	ReplicaSource    ReplicaSource
	RuntimePublisher RuntimePublisher
	ServicePolicies  map[string]ServicePolicy
	SnapshotLimit    int
	SnapshotSource   SnapshotSource
}

type Result struct {
	Actuations []Actuation
	Decisions  []WorkerAutoscalerDecision
}

func (c Controller) Run(ctx context.Context) (Result, error) {
	if c.SnapshotSource == nil {
		return Result{}, fmt.Errorf("snapshot source is required")
	}
	if c.ActuationSource == nil {
		return Result{}, fmt.Errorf("actuation source is required")
	}
	if c.ReplicaSource == nil {
		return Result{}, fmt.Errorf("replica source is required")
	}
	if c.RuntimePublisher == nil {
		return Result{}, fmt.Errorf("runtime publisher is required")
	}
	mode := c.Mode
	if mode == "" {
		mode = ModeDryRun
	}
	if mode != ModeDryRun && mode != ModeApply {
		return Result{}, fmt.Errorf("mode must be dry-run or apply")
	}
	if mode == ModeApply && c.Actuator == nil {
		return Result{}, fmt.Errorf("actuator is required in apply mode")
	}
	limit := c.SnapshotLimit
	if limit <= 0 {
		limit = 32
	}
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	serviceNames := sortedServiceNames(c.ServicePolicies)
	replicaCounts, err := c.ReplicaSource.ReplicaCounts(ctx, serviceNames)
	if err != nil {
		return Result{}, err
	}
	snapshots, err := c.SnapshotSource.FetchTemporalTaskQueueSnapshots(ctx, limit)
	if err != nil {
		return Result{}, err
	}
	recentActuations, err := c.ActuationSource.FetchWorkerAutoscalerActuations(ctx, 64)
	if err != nil {
		return Result{}, err
	}
	input := TemporalRuntimeInput{
		Actuations:      recentActuations,
		Now:             now,
		ReplicaCounts:   replicaCounts,
		ServicePolicies: c.ServicePolicies,
		Snapshots:       snapshots,
	}
	plan, err := PlanFromTemporalRuntime(input)
	if err != nil {
		return Result{}, err
	}
	actuations := []Actuation(nil)
	var applyErr error
	if mode == ModeApply {
		actuations, applyErr = c.Actuator.Apply(ctx, plan.Decisions)
	}
	payload := BuildAppAPIRuntimePayloadWithActuations(input, plan, actuations)
	if err := c.RuntimePublisher.PublishRuntimePayload(ctx, payload); err != nil {
		if applyErr != nil {
			return Result{Actuations: actuations, Decisions: plan.Decisions}, errors.Join(applyErr, err)
		}
		return Result{}, err
	}
	if applyErr != nil {
		return Result{
			Actuations: actuations,
			Decisions:  plan.Decisions,
		}, applyErr
	}
	return Result{
		Actuations: actuations,
		Decisions:  plan.Decisions,
	}, nil
}

func sortedServiceNames(policies map[string]ServicePolicy) []string {
	names := make([]string, 0, len(policies))
	for name := range policies {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
