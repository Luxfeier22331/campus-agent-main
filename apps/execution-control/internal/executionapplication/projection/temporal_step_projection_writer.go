package projection

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
)

type StepProjection struct {
	// RunStepStatus keeps a retryable attempt failure from closing the whole step.
	RunStepStatus         string
	ActivityAttempt       int
	ActivityID            string
	ActivityType          string
	Attempt               int
	Tool                  string
	CancelOutcome         execution.CancelOutcome
	CompletedAt           time.Time
	AttemptCompletedAt    time.Time
	DurationMS            int64
	FailCloseReason       string
	ModelRequestCount     int64
	InputTokens           int64
	LateCompletionOutcome execution.LateCompletionOutcome
	ModelName             string
	ModelProvider         string
	OutputTokens          int64
	CachedInputTokens     int64
	UsageObserved         bool
	ParentStepID          string
	Payload               map[string]any
	PreserveAttempt       bool
	ProjectionRef         string
	ProviderRequestRef    string
	ProviderResponseID    string
	ResultKind            string
	Run                   execution.DurableRun
	ScheduledAt           time.Time
	ScheduleToStartMS     int64
	StartedAt             time.Time
	AttemptStartedAt      time.Time
	Status                string
	StepID                string
	StepKind              string
	TaskQueue             string
	TemporalRunID         string
	TerminalReason        string
	TimeoutOutcome        execution.TimeoutOutcome
	UpdatedAt             time.Time
	AttemptUpdatedAt      time.Time
	WorkerID              string
	WorkflowID            string
}

func (s *Writer) ProjectStep(ctx context.Context, projection StepProjection) error {
	if s == nil || s.RunProjectionStore == nil {
		return execution.ErrRunProjectionStoreNotConfigured
	}
	attempt := projection.Attempt
	if attempt <= 0 {
		attempt = 1
	}
	projection = s.WithInvocationEvidence(ctx, projection, attempt)
	attempt = projection.Attempt
	if attempt <= 0 {
		attempt = 1
	}
	// Activity evidence (attempt, workflow/activity identity and timing) is
	// filled by withTemporalActivityEvidence. Build the sanitized payload only
	// afterwards so the persisted contract carries the same evidence.
	projection.Payload = StepProjectionPayload(projection)
	var completionErr error
	if strings.TrimSpace(projection.Status) == "completed" &&
		strings.TrimSpace(projection.StepID) != "finalization.write" {
		if !PostFinalizationStepAllowed(projection.StepID) {
			completionErr = s.EnsureStepCompletionAllowed(ctx, &projection)
		}
	}
	updatedAt := projection.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	attemptStartedAt := projection.AttemptStartedAt
	if attemptStartedAt.IsZero() {
		attemptStartedAt = projection.StartedAt
	}
	attemptCompletedAt := projection.AttemptCompletedAt
	if attemptCompletedAt.IsZero() {
		attemptCompletedAt = projection.CompletedAt
	}
	attemptUpdatedAt := projection.AttemptUpdatedAt
	if attemptUpdatedAt.IsZero() {
		attemptUpdatedAt = updatedAt
	}
	stepStatus, stepCompletedAt, stepPayload := projection.Status, projection.CompletedAt, projection.Payload
	if projection.RunStepStatus != "" {
		stepStatus = projection.RunStepStatus
		stepCompletedAt = time.Time{}
		stepPayload = execution.CloneAnyMapFromValue(projection.Payload)
		stepPayload["status"] = stepStatus
		if failure, ok := stepPayload["failure"]; ok {
			stepPayload["last_attempt_failure"] = failure
			delete(stepPayload, "failure")
		}
	}
	if completionErr == nil {
		if _, err := s.RunProjectionStore.UpsertRunStep(ctx, execution.RunStepProjection{
			StepID:               projection.StepID,
			RequestID:            projection.Run.RequestID,
			ConversationID:       projection.Run.ConversationID,
			StepKind:             projection.StepKind,
			Tool:                 projection.Tool,
			ParentStepID:         projection.ParentStepID,
			Status:               stepStatus,
			ActivityAttempt:      projection.ActivityAttempt,
			TaskQueue:            projection.TaskQueue,
			WorkerID:             projection.WorkerID,
			StartedAt:            projection.StartedAt,
			CompletedAt:          stepCompletedAt,
			UpdatedAt:            updatedAt,
			PayloadSchemaVersion: "run-step-projection-v1",
			SanitizedPayload:     stepPayload,
		}); err != nil {
			if !errors.Is(err, execution.ErrStaleRunStepProjection) {
				return err
			}
			if StepTerminal(projection.Status) {
				MarkLateCompletionIgnored(
					&projection,
					execution.LateCompletionOutcomeIgnoredAfterTerminalProjection,
					"stale_activity_attempt",
				)
				completionErr = fmt.Errorf("stale activity attempt completion: %w", err)
			}
		}
	}
	attemptID := StepAttemptID(projection.Run.RequestID, projection.StepID, attempt)
	if _, err := s.RunProjectionStore.UpsertStepAttempt(ctx, execution.StepAttemptProjection{
		AttemptID:             attemptID,
		StepID:                projection.StepID,
		RequestID:             projection.Run.RequestID,
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
		StartedAt:             attemptStartedAt,
		CompletedAt:           attemptCompletedAt,
		ScheduleToStartMS:     projection.ScheduleToStartMS,
		DurationMS:            projection.DurationMS,
		ProviderRequestRef:    projection.ProviderRequestRef,
		ProviderResponseID:    projection.ProviderResponseID,
		ModelProvider:         projection.ModelProvider,
		ModelName:             projection.ModelName,
		ModelRequestCount:     projection.ModelRequestCount,
		InputTokens:           projection.InputTokens,
		OutputTokens:          projection.OutputTokens,
		CachedInputTokens:     projection.CachedInputTokens,
		UsageObserved:         projection.UsageObserved,
		CancelOutcome:         projection.CancelOutcome,
		TimeoutOutcome:        projection.TimeoutOutcome,
		LateCompletionOutcome: projection.LateCompletionOutcome,
		FailCloseReason:       projection.FailCloseReason,
		TerminalReason:        projection.TerminalReason,
		UpdatedAt:             attemptUpdatedAt,
		PayloadSchemaVersion:  "step-attempt-projection-v1",
		SanitizedPayload:      projection.Payload,
	}); err != nil {
		if !errors.Is(err, execution.ErrStaleStepAttemptProjection) {
			return err
		}
		if !StepTerminal(projection.Status) {
			return err
		}
		if completionErr == nil {
			MarkLateCompletionIgnored(
				&projection,
				execution.LateCompletionOutcomeIgnoredAfterTerminalProjection,
				"stale_step_attempt",
			)
			completionErr = fmt.Errorf("stale terminal step attempt projection: %w", err)
		}
	}
	if completionErr == nil && strings.TrimSpace(projection.ResultKind) != "" && StepTerminal(projection.Status) {
		if _, err := s.RunProjectionStore.UpsertStepResult(ctx, execution.StepResultProjection{
			ResultID:             StepResultID(projection.Run.RequestID, projection.StepID, attempt),
			StepID:               projection.StepID,
			RequestID:            projection.Run.RequestID,
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
	if completionErr != nil {
		return completionErr
	}
	return nil
}

func StepProjectionPayload(projection StepProjection) map[string]any {
	payload := execution.CloneAnyMapFromValue(projection.Payload)
	if projection.ActivityAttempt > 0 {
		payload["activity_attempt"] = projection.ActivityAttempt
	}
	return payload
}

func PostFinalizationStepAllowed(stepID string) bool {
	switch strings.TrimSpace(stepID) {
	case "memory.append":
		return true
	default:
		return false
	}
}

func (s *Writer) EnsureStepCompletionAllowed(
	ctx context.Context,
	projection *StepProjection,
) error {
	latest, err := s.RunProjectionStore.GetRun(ctx, projection.Run.RequestID)
	if err != nil {
		return err
	}
	if !RunTerminal(latest.Status) {
		return s.EnsureStepNotTerminal(ctx, projection)
	}
	MarkLateCompletionIgnored(
		projection,
		LateCompletionOutcomeForTerminalRun(latest.Status),
		string(latest.Status),
	)
	return fmt.Errorf(
		"run %s is already terminal before %s completion projection: %s",
		latest.RequestID,
		projection.StepID,
		latest.Status,
	)
}

func (s *Writer) EnsureStepNotTerminal(
	ctx context.Context,
	projection *StepProjection,
) error {
	steps, err := s.RunProjectionStore.ListRunSteps(ctx, projection.Run.RequestID)
	if err != nil {
		return err
	}
	for _, step := range steps {
		if step.StepID != projection.StepID || !StepTerminal(step.Status) {
			continue
		}
		if strings.TrimSpace(step.Status) == strings.TrimSpace(projection.Status) &&
			step.ActivityAttempt > 0 &&
			step.ActivityAttempt == projection.ActivityAttempt {
			return nil
		}
		attempts, err := s.RunProjectionStore.ListStepAttempts(ctx, projection.Run.RequestID)
		if err != nil {
			return err
		}
		latestAttempt := 0
		for _, attempt := range attempts {
			if attempt.StepID == projection.StepID && execution.ProjectionActivityAttempt(attempt) > latestAttempt {
				latestAttempt = execution.ProjectionActivityAttempt(attempt)
			}
		}
		if projection.ActivityAttempt > latestAttempt && latestAttempt > 0 {
			return nil
		}
		MarkLateCompletionIgnored(
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

func StepTerminal(status string) bool {
	switch strings.TrimSpace(status) {
	case "completed", "failed", "blocked", "canceled", "expired", "skipped":
		return true
	default:
		return false
	}
}

func MarkLateCompletionIgnored(
	projection *StepProjection,
	outcome execution.LateCompletionOutcome,
	terminalStatus string,
) {
	projection.Status = "blocked"
	projection.CompletedAt = time.Time{}
	projection.AttemptCompletedAt = time.Time{}
	projection.AttemptUpdatedAt = time.Time{}
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

func LateCompletionOutcomeForTerminalRun(status execution.DurableRunStatus) execution.LateCompletionOutcome {
	switch status {
	case execution.DurableRunStatusCanceled:
		return execution.LateCompletionOutcomeIgnoredAfterCancel
	case execution.DurableRunStatusExpired:
		return execution.LateCompletionOutcomeIgnoredAfterTimeout
	default:
		return execution.LateCompletionOutcomeIgnoredAfterTerminalProjection
	}
}

func (s *Writer) WithInvocationEvidence(
	ctx context.Context,
	projection StepProjection,
	attempt int,
) StepProjection {
	separateAttemptTiming := strings.TrimSpace(projection.StepID) == execution.FinalizationStepID
	if projection.CancelOutcome == "" {
		projection.CancelOutcome = execution.CancelOutcomeNotRequested
	}
	if projection.TimeoutOutcome == "" {
		projection.TimeoutOutcome = execution.TimeoutOutcomeNotTimedOut
	}
	if projection.LateCompletionOutcome == "" {
		projection.LateCompletionOutcome = execution.LateCompletionOutcomeNotLate
	}
	// A receipt replay must use the exact evidence captured by the original
	// Activity attempt. Mixing in the current retry's identity or timestamps
	// makes an otherwise equivalent repair conflict with its durable rows.
	if s.Evidence.Present && !projection.PreserveAttempt {
		info := s.Evidence
		if projection.WorkflowID == "" {
			projection.WorkflowID = info.WorkflowID
		}
		if projection.TemporalRunID == "" {
			projection.TemporalRunID = info.RunID
		}
		if projection.ActivityID == "" {
			projection.ActivityID = info.ActivityID
		}
		if projection.ActivityType == "" {
			projection.ActivityType = info.ActivityType
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
		if separateAttemptTiming && projection.AttemptStartedAt.IsZero() {
			projection.AttemptStartedAt = info.StartedTime
		}
		if projection.StartedAt.IsZero() {
			projection.StartedAt = info.StartedTime
		}
		if projection.TaskQueue == "" {
			projection.TaskQueue = info.TaskQueue
		}
	}
	if projection.WorkflowID == "" {
		projection.WorkflowID = "campus-agent.chat." + projection.Run.RequestID
	}
	if projection.ActivityAttempt <= 0 {
		projection.ActivityAttempt = attempt
	}
	if projection.Attempt <= 0 {
		projection.Attempt = projection.ActivityAttempt
	}
	if projection.ActivityType == "" {
		projection.ActivityType = ActivityTypeForStep(projection.StepID)
	}
	if separateAttemptTiming {
		if projection.AttemptStartedAt.IsZero() {
			projection.AttemptStartedAt = projection.StartedAt
		}
		if projection.AttemptCompletedAt.IsZero() {
			projection.AttemptCompletedAt = projection.CompletedAt
		}
		if projection.AttemptUpdatedAt.IsZero() {
			projection.AttemptUpdatedAt = projection.UpdatedAt
		}
	}
	startedAt := projection.StartedAt
	completedAt := projection.CompletedAt
	if separateAttemptTiming {
		startedAt = projection.AttemptStartedAt
		completedAt = projection.AttemptCompletedAt
	}
	if projection.ScheduleToStartMS <= 0 &&
		!projection.ScheduledAt.IsZero() &&
		!startedAt.IsZero() &&
		!startedAt.Before(projection.ScheduledAt) {
		projection.ScheduleToStartMS = startedAt.Sub(projection.ScheduledAt).Milliseconds()
	}
	if projection.DurationMS <= 0 &&
		!startedAt.IsZero() &&
		!completedAt.IsZero() &&
		!completedAt.Before(startedAt) {
		projection.DurationMS = completedAt.Sub(startedAt).Milliseconds()
	}
	return projection
}

func (s *Writer) InvocationAttempt(ctx context.Context) int {
	if s.Evidence.Present {
		if attempt := int(s.Evidence.Attempt); attempt > 0 {
			return attempt
		}
	}
	return 1
}

func ActivityTypeForStep(stepID string) string {
	normalized := strings.TrimSpace(stepID)
	switch normalized {
	case "memory.append":
		return executioncontract.AdvanceMemoryAppendActivityName
	case "solve.initial":
		return executioncontract.SolveTaskActivityName
	case "answer.synthesize":
		return executioncontract.SynthesizeAnswerActivityName
	case "finalization.write":
		return executioncontract.WriteWorkflowFinalizationActivityName
	default:
		if strings.HasPrefix(normalized, "solve.replan.") {
			return executioncontract.ReplanTaskActivityName
		}
		if strings.HasPrefix(normalized, "step.") {
			return executioncontract.ExecuteTaskStepActivityName
		}
		return ""
	}
}

func StepAttemptID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":attempt-" + fmt.Sprint(attempt)
}

func StepResultID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":result-" + fmt.Sprint(attempt)
}
