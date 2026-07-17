package temporalruntime

import (
	"context"
	"errors"
	"testing"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

type capturingScheduleCreator struct {
	err     error
	handle  *capturingScheduleHandle
	options []client.ScheduleOptions
}

func (c *capturingScheduleCreator) Create(
	_ context.Context,
	options client.ScheduleOptions,
) (client.ScheduleHandle, error) {
	c.options = append(c.options, options)
	return nil, c.err
}

func (c *capturingScheduleCreator) GetHandle(
	_ context.Context,
	_ string,
) client.ScheduleHandle {
	return c.handle
}

type capturingScheduleHandle struct {
	description client.ScheduleDescription
	updated     *client.ScheduleUpdate
}

func (h *capturingScheduleHandle) GetID() string { return LangfuseTraceRetentionScheduleID }

func (h *capturingScheduleHandle) Delete(context.Context) error { return nil }

func (h *capturingScheduleHandle) Backfill(context.Context, client.ScheduleBackfillOptions) error {
	return nil
}

func (h *capturingScheduleHandle) Update(
	_ context.Context,
	options client.ScheduleUpdateOptions,
) error {
	update, err := options.DoUpdate(client.ScheduleUpdateInput{Description: h.description})
	if err != nil {
		return err
	}
	h.updated = update
	return nil
}

func (h *capturingScheduleHandle) Describe(context.Context) (*client.ScheduleDescription, error) {
	return &h.description, nil
}

func (h *capturingScheduleHandle) Trigger(context.Context, client.ScheduleTriggerOptions) error {
	return nil
}

func (h *capturingScheduleHandle) Pause(context.Context, client.SchedulePauseOptions) error {
	return nil
}

func (h *capturingScheduleHandle) Unpause(context.Context, client.ScheduleUnpauseOptions) error {
	return nil
}

func TestEnsureLangfuseTraceRetentionScheduleUsesFixedDailyPolicy(t *testing.T) {
	creator := &capturingScheduleCreator{}
	if err := EnsureLangfuseTraceRetentionSchedule(context.Background(), creator, "custom.workflow"); err != nil {
		t.Fatal(err)
	}
	if len(creator.options) != 1 {
		t.Fatalf("create calls = %d, want 1", len(creator.options))
	}
	options := creator.options[0]
	if options.ID != LangfuseTraceRetentionScheduleID ||
		len(options.Spec.CronExpressions) != 1 ||
		options.Spec.CronExpressions[0] != LangfuseTraceRetentionCron ||
		options.Spec.TimeZoneName != "UTC" {
		t.Fatalf("schedule identity/spec = %#v", options)
	}
	if options.Overlap != enumspb.SCHEDULE_OVERLAP_POLICY_SKIP ||
		options.CatchupWindow != 24*time.Hour || options.PauseOnFailure {
		t.Fatalf("schedule policy = %#v", options)
	}
	action, ok := options.Action.(*client.ScheduleWorkflowAction)
	if !ok {
		t.Fatalf("schedule action type = %T", options.Action)
	}
	if action.ID != LangfuseTraceRetentionWorkflowID ||
		action.Workflow != LangfuseTraceRetentionWorkflowType ||
		action.TaskQueue != "custom.workflow" ||
		action.WorkflowRunTimeout != 6*time.Hour {
		t.Fatalf("schedule action = %#v", action)
	}
}

func TestEnsureLangfuseTraceRetentionScheduleIsIdempotent(t *testing.T) {
	state := &client.ScheduleState{Paused: true, Note: "incident pause"}
	handle := &capturingScheduleHandle{description: client.ScheduleDescription{
		Schedule: client.Schedule{
			Action: &client.ScheduleWorkflowAction{TaskQueue: "drifted.workflow"},
			Spec:   &client.ScheduleSpec{CronExpressions: []string{"0 1 * * *"}},
			Policy: &client.SchedulePolicies{Overlap: enumspb.SCHEDULE_OVERLAP_POLICY_ALLOW_ALL},
			State:  state,
		},
	}}
	creator := &capturingScheduleCreator{
		err:    serviceerror.NewAlreadyExists("schedule exists"),
		handle: handle,
	}
	if err := EnsureLangfuseTraceRetentionSchedule(context.Background(), creator, ""); err != nil {
		t.Fatalf("already-existing schedule must be accepted: %v", err)
	}
	if len(creator.options) != 1 {
		t.Fatalf("create calls = %d, want 1", len(creator.options))
	}
	action := creator.options[0].Action.(*client.ScheduleWorkflowAction)
	if action.TaskQueue != WorkflowTaskQueue {
		t.Fatalf("default task queue = %q", action.TaskQueue)
	}
	if handle.updated == nil || handle.updated.Schedule == nil {
		t.Fatal("existing schedule was not reconciled")
	}
	reconciled := handle.updated.Schedule
	if reconciled.Spec == nil || len(reconciled.Spec.CronExpressions) != 1 ||
		reconciled.Spec.CronExpressions[0] != LangfuseTraceRetentionCron ||
		reconciled.Policy == nil || reconciled.Policy.Overlap != enumspb.SCHEDULE_OVERLAP_POLICY_SKIP ||
		reconciled.Policy.CatchupWindow != 24*time.Hour {
		t.Fatalf("reconciled schedule = %#v", reconciled)
	}
	reconciledAction, ok := reconciled.Action.(*client.ScheduleWorkflowAction)
	if !ok || reconciledAction.TaskQueue != WorkflowTaskQueue ||
		reconciledAction.WorkflowRunTimeout != 6*time.Hour {
		t.Fatalf("reconciled action = %#v", reconciled.Action)
	}
	if reconciled.State != state || !reconciled.State.Paused || reconciled.State.Note != "incident pause" {
		t.Fatalf("reconciled state = %#v", reconciled.State)
	}
}

func TestEnsureLangfuseTraceRetentionSchedulePropagatesCreateFailure(t *testing.T) {
	want := errors.New("Temporal unavailable")
	creator := &capturingScheduleCreator{err: want}
	if err := EnsureLangfuseTraceRetentionSchedule(context.Background(), creator, ""); !errors.Is(err, want) {
		t.Fatalf("error = %v, want %v", err, want)
	}
}

var _ ScheduleManager = (*capturingScheduleCreator)(nil)
var _ client.ScheduleHandle = (*capturingScheduleHandle)(nil)
