package temporalruntime

import (
	"context"
	"errors"
	"strings"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

const (
	LangfuseTraceRetentionScheduleID = "campus-agent.langfuse.trace-retention.daily.v1"
	LangfuseTraceRetentionWorkflowID = "campus-agent.langfuse.trace-retention.daily"
	LangfuseTraceRetentionCron       = "0 3 * * *"
)

type ScheduleManager interface {
	Create(context.Context, client.ScheduleOptions) (client.ScheduleHandle, error)
	GetHandle(context.Context, string) client.ScheduleHandle
}

func EnsureLangfuseTraceRetentionSchedule(
	ctx context.Context,
	schedules ScheduleManager,
	taskQueue string,
) error {
	if schedules == nil {
		return errors.New("Temporal schedule client is required")
	}
	taskQueue = strings.TrimSpace(taskQueue)
	if taskQueue == "" {
		taskQueue = WorkflowTaskQueue
	}
	options := langfuseTraceRetentionScheduleOptions(taskQueue)
	_, err := schedules.Create(ctx, options)
	if err == nil {
		return nil
	}
	var alreadyExists *serviceerror.AlreadyExists
	if !errors.As(err, &alreadyExists) {
		return err
	}
	handle := schedules.GetHandle(ctx, LangfuseTraceRetentionScheduleID)
	if handle == nil {
		return errors.New("Temporal schedule handle is required")
	}
	return handle.Update(ctx, client.ScheduleUpdateOptions{
		DoUpdate: func(input client.ScheduleUpdateInput) (*client.ScheduleUpdate, error) {
			return &client.ScheduleUpdate{
				Schedule: &client.Schedule{
					Action: options.Action,
					Spec:   &options.Spec,
					Policy: &client.SchedulePolicies{
						Overlap:       options.Overlap,
						CatchupWindow: options.CatchupWindow,
						PauseOnFailure: options.PauseOnFailure,
					},
					State: input.Description.Schedule.State,
				},
			}, nil
		},
	})
}

func langfuseTraceRetentionScheduleOptions(taskQueue string) client.ScheduleOptions {
	return client.ScheduleOptions{
		ID: LangfuseTraceRetentionScheduleID,
		Spec: client.ScheduleSpec{
			CronExpressions: []string{LangfuseTraceRetentionCron},
			TimeZoneName:    "UTC",
		},
		Action: &client.ScheduleWorkflowAction{
			ID:                 LangfuseTraceRetentionWorkflowID,
			Workflow:           LangfuseTraceRetentionWorkflowType,
			TaskQueue:          taskQueue,
			WorkflowRunTimeout: 6 * time.Hour,
		},
		Overlap:        enumspb.SCHEDULE_OVERLAP_POLICY_SKIP,
		CatchupWindow:  24 * time.Hour,
		PauseOnFailure: false,
		Note:           "Delete runtime and Hindsight Langfuse traces older than seven days.",
	}
}
