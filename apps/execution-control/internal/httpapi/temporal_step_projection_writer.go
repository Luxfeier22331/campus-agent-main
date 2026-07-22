package httpapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/activity"
)

type temporalStepProjection struct {
	ActivityAttempt       int
	ActivityID            string
	ActivityType          string
	Attempt               int
	Tool                  string
	CancelOutcome         execution.CancelOutcome
	CompletedAt           time.Time
	DurationMS            int64
	FailCloseReason       string
	InputTokens           int64
	LateCompletionOutcome execution.LateCompletionOutcome
	ModelName             string
	ModelProvider         string
	OutputTokens          int64
	CachedInputTokens     int64
	Payload               map[string]any
	ProjectionRef         string
	ProviderRequestRef    string
	ProviderResponseID    string
	ResultKind            string
	Run                   execution.DurableRun
	ScheduledAt           time.Time
	ScheduleToStartMS     int64
	StartedAt             time.Time
	Status                string
	StepID                string
	StepKind              string
	TaskQueue             string
	TemporalRunID         string
	TerminalReason        string
	TimeoutOutcome        execution.TimeoutOutcome
	UpdatedAt             time.Time
	WorkerID              string
	WorkflowID            string
}

func (s *Server) projectTemporalStep(ctx context.Context, projection temporalStepProjection) error {
	if s == nil || s.runProjectionStore == nil {
		return execution.ErrRunProjectionStoreNotConfigured
	}
	attempt := projection.Attempt
	if attempt <= 0 {
		attempt = 1
	}
	projection = s.withTemporalActivityEvidence(ctx, projection, attempt)
	attempt = projection.Attempt
	if attempt <= 0 {
		attempt = 1
	}
	var completionErr error
	if strings.TrimSpace(projection.Status) == "completed" &&
		strings.TrimSpace(projection.StepID) != "finalization.write" {
		if !temporalPostFinalizationStepAllowed(projection.StepID) {
			completionErr = s.ensureTemporalStepCompletionAllowed(ctx, &projection)
		}
	}
	updatedAt := projection.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	if completionErr == nil {
		if _, err := s.runProjectionStore.UpsertRunStep(ctx, execution.RunStepProjection{
			StepID:               projection.StepID,
			RunID:                projection.Run.RunID,
			ConversationID:       projection.Run.ConversationID,
			StepKind:             projection.StepKind,
			Tool:                 projection.Tool,
			Status:               projection.Status,
			TaskQueue:            projection.TaskQueue,
			WorkerID:             projection.WorkerID,
			StartedAt:            projection.StartedAt,
			CompletedAt:          projection.CompletedAt,
			UpdatedAt:            updatedAt,
			PayloadSchemaVersion: "run-step-projection-v1",
			SanitizedPayload:     projection.Payload,
		}); err != nil {
			return err
		}
	}
	attemptID := temporalStepAttemptID(projection.Run.RunID, projection.StepID, attempt)
	if _, err := s.runProjectionStore.UpsertStepAttempt(ctx, execution.StepAttemptProjection{
		AttemptID:             attemptID,
		StepID:                projection.StepID,
		RunID:                 projection.Run.RunID,
		Attempt:               attempt,
		Status:                projection.Status,
		TaskQueue:             projection.TaskQueue,
		WorkerID:              projection.WorkerID,
		WorkflowID:            projection.WorkflowID,
		TemporalRunID:         projection.TemporalRunID,
		ActivityID:            projection.ActivityID,
		ActivityType:          projection.ActivityType,
		ActivityAttempt:       projection.ActivityAttempt,
		ScheduledAt:           projection.ScheduledAt,
		StartedAt:             projection.StartedAt,
		CompletedAt:           projection.CompletedAt,
		ScheduleToStartMS:     projection.ScheduleToStartMS,
		DurationMS:            projection.DurationMS,
		ProviderRequestRef:    projection.ProviderRequestRef,
		ProviderResponseID:    projection.ProviderResponseID,
		ModelProvider:         projection.ModelProvider,
		ModelName:             projection.ModelName,
		InputTokens:           projection.InputTokens,
		OutputTokens:          projection.OutputTokens,
		CachedInputTokens:     projection.CachedInputTokens,
		CancelOutcome:         projection.CancelOutcome,
		TimeoutOutcome:        projection.TimeoutOutcome,
		LateCompletionOutcome: projection.LateCompletionOutcome,
		FailCloseReason:       projection.FailCloseReason,
		TerminalReason:        projection.TerminalReason,
		UpdatedAt:             updatedAt,
		PayloadSchemaVersion:  "step-attempt-projection-v1",
		SanitizedPayload:      projection.Payload,
	}); err != nil {
		return err
	}
	if completionErr == nil && strings.TrimSpace(projection.ResultKind) != "" {
		if _, err := s.runProjectionStore.UpsertStepResult(ctx, execution.StepResultProjection{
			ResultID:             temporalStepResultID(projection.Run.RunID, projection.StepID, attempt),
			StepID:               projection.StepID,
			RunID:                projection.Run.RunID,
			AttemptID:            attemptID,
			Status:               projection.Status,
			ResultKind:           projection.ResultKind,
			ProjectionRef:        projection.ProjectionRef,
			CreatedAt:            updatedAt,
			PayloadSchemaVersion: "step-result-projection-v1",
			SanitizedPayload:     projection.Payload,
		}); err != nil {
			return err
		}
	}
	if err := s.emitTemporalStepObservation(ctx, projection); err != nil {
		return err
	}
	if completionErr != nil {
		return completionErr
	}
	return nil
}

func (s *Server) emitTemporalStepObservation(ctx context.Context, projection temporalStepProjection) error {
	if s == nil || s.telemetry == nil {
		return nil
	}
	if err := s.telemetry.Emit(ctx, s.temporalStepObservationEvent(projection)); err != nil {
		return fmt.Errorf("temporal step observation telemetry delivery failed: %w", err)
	}
	return nil
}

func (s *Server) temporalStepObservationEvent(projection temporalStepProjection) telemetry.Event {
	event := temporalStepObservationEvent(projection)
	if strings.TrimSpace(event.Release) == "" {
		event.Release = strings.TrimSpace(s.config.DeploymentRelease)
	}
	if strings.TrimSpace(event.DeploymentEnvironment) == "" {
		event.DeploymentEnvironment = strings.TrimSpace(s.config.DeploymentEnvironment)
	}
	return event
}

func temporalStepObservationEvent(projection temporalStepProjection) telemetry.Event {
	return telemetry.Event{
		ActivityAttempt:       projection.ActivityAttempt,
		ActivityType:          strings.TrimSpace(projection.ActivityType),
		CachedInputTokens:     projection.CachedInputTokens,
		ConversationID:        strings.TrimSpace(projection.Run.ConversationID),
		DeploymentEnvironment: "",
		Duration:              time.Duration(projection.DurationMS) * time.Millisecond,
		FailCloseReason:       strings.TrimSpace(projection.FailCloseReason),
		FailureKind:           firstNonEmptyText(projection.Payload["failure_kind"]),
		InputTokens:           projection.InputTokens,
		ModelName:             strings.TrimSpace(projection.ModelName),
		ModelProvider:         strings.TrimSpace(projection.ModelProvider),
		Name:                  "temporal.step_observation",
		OutputTokens:          projection.OutputTokens,
		ProjectionRef:         strings.TrimSpace(projection.ProjectionRef),
		RequestID:             strings.TrimSpace(projection.Run.RequestID),
		RunID:                 strings.TrimSpace(projection.Run.RunID),
		ScheduleToStart:       time.Duration(projection.ScheduleToStartMS) * time.Millisecond,
		SelectedTool:          temporalStepSelectedTool(projection),
		Status:                strings.TrimSpace(projection.Status),
		StepID:                strings.TrimSpace(projection.StepID),
		StepKind:              strings.TrimSpace(projection.StepKind),
		TaskQueue:             strings.TrimSpace(projection.TaskQueue),
		TraceID:               strings.TrimSpace(projection.Run.TraceID),
		UserID:                strings.TrimSpace(projection.Run.OwnerUserID),
		WorkflowID:            strings.TrimSpace(projection.WorkflowID),
	}
}

func temporalStepSelectedTool(projection temporalStepProjection) string {
	if projection.Payload == nil {
		return ""
	}
	tool, ok := projection.Payload["selected_tool"].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(tool)
}

func temporalPostFinalizationStepAllowed(stepID string) bool {
	switch strings.TrimSpace(stepID) {
	case "memory.append", "memory.reflect":
		return true
	default:
		return false
	}
}

func (s *Server) ensureTemporalStepCompletionAllowed(
	ctx context.Context,
	projection *temporalStepProjection,
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, projection.Run.RunID)
	if err != nil {
		return err
	}
	if !temporalRunTerminal(latest.Status) {
		return s.ensureTemporalStepNotTerminal(ctx, projection)
	}
	markLateCompletionIgnored(
		projection,
		lateCompletionOutcomeForTerminalRun(latest.Status),
		string(latest.Status),
	)
	return fmt.Errorf(
		"run %s is already terminal before %s completion projection: %s",
		latest.RunID,
		projection.StepID,
		latest.Status,
	)
}

func (s *Server) ensureTemporalStepNotTerminal(
	ctx context.Context,
	projection *temporalStepProjection,
) error {
	steps, err := s.runProjectionStore.ListRunSteps(ctx, projection.Run.RunID)
	if err != nil {
		return err
	}
	for _, step := range steps {
		if step.StepID != projection.StepID || !temporalStepTerminal(step.Status) {
			continue
		}
		attempts, err := s.runProjectionStore.ListStepAttempts(ctx, projection.Run.RunID)
		if err != nil {
			return err
		}
		latestAttempt := 0
		for _, attempt := range attempts {
			if attempt.StepID == projection.StepID && projectionActivityAttempt(attempt) > latestAttempt {
				latestAttempt = projectionActivityAttempt(attempt)
			}
		}
		if projection.ActivityAttempt > latestAttempt && latestAttempt > 0 {
			return nil
		}
		markLateCompletionIgnored(
			projection,
			execution.LateCompletionOutcomeIgnoredAfterTerminalProjection,
			step.Status,
		)
		return fmt.Errorf(
			"step %s is already terminal before %s completion projection: %s",
			step.StepID,
			projection.StepID,
			step.Status,
		)
	}
	return nil
}

func temporalStepTerminal(status string) bool {
	switch strings.TrimSpace(status) {
	case "completed", "failed", "blocked", "canceled", "expired":
		return true
	default:
		return false
	}
}

func markLateCompletionIgnored(
	projection *temporalStepProjection,
	outcome execution.LateCompletionOutcome,
	terminalStatus string,
) {
	projection.Status = "blocked"
	projection.CompletedAt = time.Time{}
	projection.LateCompletionOutcome = outcome
	projection.TerminalReason = "late_completion_ignored"
	projection.ProjectionRef = ""
	projection.ResultKind = ""
	if projection.Payload == nil {
		projection.Payload = map[string]any{}
	}
	projection.Payload["late_completion_outcome"] = string(projection.LateCompletionOutcome)
	projection.Payload["terminal_status"] = terminalStatus
}

func lateCompletionOutcomeForTerminalRun(status execution.DurableRunStatus) execution.LateCompletionOutcome {
	switch status {
	case execution.DurableRunStatusCanceled:
		return execution.LateCompletionOutcomeIgnoredAfterCancel
	case execution.DurableRunStatusExpired:
		return execution.LateCompletionOutcomeIgnoredAfterTimeout
	default:
		return execution.LateCompletionOutcomeIgnoredAfterTerminalProjection
	}
}

func (s *Server) withTemporalActivityEvidence(
	ctx context.Context,
	projection temporalStepProjection,
	attempt int,
) temporalStepProjection {
	if projection.CancelOutcome == "" {
		projection.CancelOutcome = execution.CancelOutcomeNotRequested
	}
	if projection.TimeoutOutcome == "" {
		projection.TimeoutOutcome = execution.TimeoutOutcomeNotTimedOut
	}
	if projection.LateCompletionOutcome == "" {
		projection.LateCompletionOutcome = execution.LateCompletionOutcomeNotLate
	}
	if activity.IsActivity(ctx) {
		info := activity.GetInfo(ctx)
		if projection.WorkflowID == "" {
			projection.WorkflowID = info.WorkflowExecution.ID
		}
		if projection.TemporalRunID == "" {
			projection.TemporalRunID = info.WorkflowExecution.RunID
		}
		if projection.ActivityID == "" {
			projection.ActivityID = info.ActivityID
		}
		if projection.ActivityType == "" {
			projection.ActivityType = info.ActivityType.Name
		}
		if projection.ActivityAttempt <= 0 {
			projection.ActivityAttempt = int(info.Attempt)
		}
		if info.Attempt > 0 {
			projection.Attempt = int(info.Attempt)
		}
		if projection.ScheduledAt.IsZero() {
			projection.ScheduledAt = info.ScheduledTime
		}
		if projection.StartedAt.IsZero() {
			projection.StartedAt = info.StartedTime
		}
		if projection.TaskQueue == "" {
			projection.TaskQueue = info.TaskQueue
		}
	}
	if projection.WorkflowID == "" {
		projection.WorkflowID = "campus-agent.chat." + projection.Run.RunID
	}
	if projection.ActivityAttempt <= 0 {
		projection.ActivityAttempt = attempt
	}
	if projection.Attempt <= 0 {
		projection.Attempt = projection.ActivityAttempt
	}
	if projection.ActivityType == "" {
		projection.ActivityType = temporalActivityTypeForStep(projection.StepID)
	}
	if projection.ScheduleToStartMS <= 0 &&
		!projection.ScheduledAt.IsZero() &&
		!projection.StartedAt.IsZero() &&
		!projection.StartedAt.Before(projection.ScheduledAt) {
		projection.ScheduleToStartMS = projection.StartedAt.Sub(projection.ScheduledAt).Milliseconds()
	}
	if projection.DurationMS <= 0 &&
		!projection.StartedAt.IsZero() &&
		!projection.CompletedAt.IsZero() &&
		!projection.CompletedAt.Before(projection.StartedAt) {
		projection.DurationMS = projection.CompletedAt.Sub(projection.StartedAt).Milliseconds()
	}
	return projection
}

func temporalActivityAttempt(ctx context.Context) int {
	if activity.IsActivity(ctx) {
		if attempt := int(activity.GetInfo(ctx).Attempt); attempt > 0 {
			return attempt
		}
	}
	return 1
}

func temporalActivityTypeForStep(stepID string) string {
	normalized := strings.TrimSpace(stepID)
	switch normalized {
	case "memory.recall":
		return temporalruntime.MemoryRecallActivityName
	case "memory.append":
		return temporalruntime.AppendConversationMemoryActivityName
	case "memory.reflect":
		return temporalruntime.MemoryReflectActivityName
	case "agent.primary":
		return temporalruntime.ExecutePrimaryAgentActivityName
	case "finalization.write":
		return temporalruntime.WriteFinalizationActivityName
	default:
		if strings.HasPrefix(normalized, "knowledge.search.") ||
			strings.HasPrefix(normalized, "sdk_tool.execute.") {
			return temporalruntime.ExecutePrimaryAgentActivityName
		}
		return ""
	}
}

func temporalStepAttemptID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":attempt-" + fmt.Sprint(attempt)
}

func temporalStepResultID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":result-" + fmt.Sprint(attempt)
}
