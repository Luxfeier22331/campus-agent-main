package operation

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

func (s *OperationService) BeginWorkflowRun(
	ctx context.Context,
	run execution.DurableRun,
	startedAt time.Time,
) (execution.DurableRun, error) {
	switch run.Status {
	case execution.DurableRunStatusQueued:
		admitted, err := s.StateWriter.TransitionRun(
			ctx,
			run.RequestID,
			execution.DurableRunStatusAdmitted,
			"",
			startedAt,
		)
		if err != nil {
			return execution.DurableRun{}, err
		}
		if err := s.AppendRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RequestID + ":run-admitted",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunAdmitted,
			OccurredAt:           startedAt,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": string(execution.DurableRunStatusAdmitted)},
		}); err != nil {
			return execution.DurableRun{}, err
		}
		run = admitted
	case execution.DurableRunStatusAdmitted,
		execution.DurableRunStatusRunning,
		execution.DurableRunStatusStreaming:
	default:
		return execution.DurableRun{}, fmt.Errorf(
			"request %s status %s cannot execute workflow operation",
			run.RequestID,
			run.Status,
		)
	}
	if run.Status == execution.DurableRunStatusAdmitted {
		running, err := s.StateWriter.TransitionRun(
			ctx,
			run.RequestID,
			execution.DurableRunStatusRunning,
			"",
			startedAt,
		)
		if err != nil {
			return execution.DurableRun{}, err
		}
		if err := s.AppendRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RequestID + ":run-started",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunStarted,
			OccurredAt:           startedAt,
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": string(execution.DurableRunStatusRunning)},
		}); err != nil {
			return execution.DurableRun{}, err
		}
		run = running
	}
	if err := s.AppendTemporalRunProgress(
		ctx,
		run,
		execution.DurableRunProgressPhaseGenerating,
		startedAt,
	); err != nil {
		return execution.DurableRun{}, err
	}
	return run, nil
}

type WorkflowProjectionIdentity struct {
	ActivityAttempt   int
	ActivityID        string
	ActivityType      string
	Attempt           int
	PreserveAttempt   bool
	ScheduledAt       time.Time
	ScheduleToStartMS int64
	StartedAt         time.Time
	TemporalRunID     string
	WorkerID          string
	WorkflowID        string
}

func (identity WorkflowProjectionIdentity) Apply(
	projection activityprojection.StepProjection,
) activityprojection.StepProjection {
	projection.PreserveAttempt = identity.PreserveAttempt
	if identity.ActivityAttempt > 0 {
		projection.ActivityAttempt = identity.ActivityAttempt
	}
	if identity.Attempt > 0 {
		projection.Attempt = identity.Attempt
	}
	if identity.ActivityID != "" {
		projection.ActivityID = identity.ActivityID
	}
	if identity.ActivityType != "" {
		projection.ActivityType = identity.ActivityType
	}
	if !identity.ScheduledAt.IsZero() {
		projection.ScheduledAt = identity.ScheduledAt
	}
	if identity.ScheduleToStartMS > 0 {
		projection.ScheduleToStartMS = identity.ScheduleToStartMS
	}
	if !identity.StartedAt.IsZero() {
		projection.StartedAt = identity.StartedAt
	}
	if identity.TemporalRunID != "" {
		projection.TemporalRunID = identity.TemporalRunID
	}
	if identity.WorkerID != "" {
		projection.WorkerID = identity.WorkerID
	}
	if identity.WorkflowID != "" {
		projection.WorkflowID = identity.WorkflowID
	}
	return projection
}

func ProjectionClassForToolName(toolName string) string {
	toolName = strings.TrimSpace(toolName)
	registry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if ok {
		tool, registered := registry.ToolByName(toolName)
		if registered && tool.ReadOnly {
			return toolName
		}
	}
	return "tool"
}

func ToolStepStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "completed":
		return "completed"
	default:
		return "failed"
	}
}

func ToolResultKind(status string) string {
	switch strings.TrimSpace(status) {
	case "completed":
		return "typed_tool_result"
	default:
		return "activity_failure"
	}
}
