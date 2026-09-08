package projection

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"go.temporal.io/sdk/activity"
)

func (s *Writer) EnsureTemporalActivityOwnsRootExecution(
	ctx context.Context,
	requestID string,
	allowSuperseded bool,
) error {
	if !activity.IsActivity(ctx) {
		return nil
	}
	if s == nil || s.RunProjectionStore == nil {
		return execution.ErrRunProjectionStoreNotConfigured
	}
	intent, err := s.RunProjectionStore.GetWorkflowStartIntent(ctx, strings.TrimSpace(requestID))
	if err != nil {
		return SanitizedTemporalApplicationError(
			"temporal_execution_binding_unavailable",
			err,
			false,
		)
	}
	info := activity.GetInfo(ctx)
	workflowID := strings.TrimSpace(info.WorkflowExecution.ID)
	temporalRunID := strings.TrimSpace(info.WorkflowExecution.RunID)
	if workflowID == "" || temporalRunID == "" || strings.TrimSpace(intent.WorkflowID) != workflowID {
		return SanitizedTemporalApplicationError(
			"temporal_execution_binding_mismatch",
			errors.New("activity workflow execution does not match its durable workflow identity"),
			true,
		)
	}
	boundRunID := strings.TrimSpace(intent.TemporalRunID)
	if boundRunID == "" {
		return SanitizedTemporalApplicationError(
			"temporal_execution_binding_pending",
			errors.New("durable root Temporal Run ID is not confirmed yet"),
			false,
		)
	}
	if boundRunID != temporalRunID {
		return SanitizedTemporalApplicationError(
			"temporal_execution_binding_mismatch",
			errors.New("activity Temporal Run ID is not the durable root execution"),
			true,
		)
	}
	if intent.State == execution.LifecycleIntentStateSuperseded && !allowSuperseded {
		return SanitizedTemporalApplicationError(
			"temporal_execution_cancellation_pending",
			errors.New("durable workflow execution was superseded by cancellation"),
			false,
		)
	}
	if intent.State != execution.LifecycleIntentStateConfirmed &&
		(!allowSuperseded || intent.State != execution.LifecycleIntentStateSuperseded) {
		return SanitizedTemporalApplicationError(
			"temporal_execution_binding_pending",
			errors.New("durable workflow execution binding is not active"),
			false,
		)
	}
	return nil
}

func TemporalRunTerminal(status execution.DurableRunStatus) bool {
	switch status {
	case execution.DurableRunStatusCompleted,
		execution.DurableRunStatusFailed,
		execution.DurableRunStatusCanceled,
		execution.DurableRunStatusExpired:
		return true
	default:
		return false
	}
}

type TemporalStepFailureProjection struct {
	Tool               string
	FailedAt           time.Time
	FailureKind        string
	CancelOutcome      execution.CancelOutcome
	FailCloseReason    string
	ModelName          string
	ModelProvider      string
	ModelRequestCount  int64
	InputTokens        int64
	OutputTokens       int64
	CachedInputTokens  int64
	UsageObserved      bool
	ProviderResponseID string
	Payload            map[string]any
	ProjectionRef      string
	ResultKind         string
	StepID             string
	StepKind           string
	TaskQueue          string
	TimeoutOutcome     execution.TimeoutOutcome
}

func (s *Writer) ProjectTemporalFailureStep(
	ctx context.Context,
	run execution.DurableRun,
	projection TemporalStepFailureProjection,
	cause error,
) error {
	now := projection.FailedAt.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	projection.FailureKind = BoundedTemporalFailureKind(projection.FailureKind)
	payload := TemporalFailurePayload(projection)
	if err := s.ProjectTemporalStep(ctx, TemporalStepProjection{
		Attempt:            1,
		Tool:               TemporalFailureTool(projection),
		CancelOutcome:      TemporalFailureCancelOutcome(ctx, projection.CancelOutcome),
		FailCloseReason:    TemporalFailureFailCloseReason(projection),
		ModelName:          projection.ModelName,
		ModelProvider:      projection.ModelProvider,
		ModelRequestCount:  projection.ModelRequestCount,
		InputTokens:        projection.InputTokens,
		OutputTokens:       projection.OutputTokens,
		CachedInputTokens:  projection.CachedInputTokens,
		UsageObserved:      projection.UsageObserved,
		ProviderResponseID: projection.ProviderResponseID,
		Run:                run,
		Status:             "failed",
		StepID:             projection.StepID,
		StepKind:           projection.StepKind,
		TaskQueue:          projection.TaskQueue,
		WorkerID:           s.Config.TemporalWorkerIdentity,
		StartedAt:          now,
		CompletedAt:        now,
		UpdatedAt:          now,
		ResultKind:         projection.ResultKind,
		ProjectionRef:      projection.ProjectionRef,
		TimeoutOutcome:     TemporalFailureTimeoutOutcome(ctx, projection.TimeoutOutcome, cause),
		Payload:            payload,
	}); err != nil {
		return err
	}
	return nil
}

func TemporalFailureTool(projection TemporalStepFailureProjection) string {
	if tool := strings.TrimSpace(projection.Tool); tool != "" {
		return tool
	}
	return ""
}

func TemporalFailureFailCloseReason(projection TemporalStepFailureProjection) string {
	if strings.TrimSpace(projection.FailCloseReason) != "" {
		return strings.TrimSpace(projection.FailCloseReason)
	}
	switch strings.TrimSpace(projection.FailureKind) {
	case "current_state_unverifiable",
		"agent_runtime_unauthorized",
		"source_conflict",
		"temporal_scope_ambiguous",
		"not_found":
		return strings.TrimSpace(projection.FailureKind)
	default:
		return ""
	}
}

func TemporalFailureCancelOutcome(
	ctx context.Context,
	configured execution.CancelOutcome,
) execution.CancelOutcome {
	if configured != "" {
		return configured
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return execution.CancelOutcomeActivityContextCanceled
	}
	return execution.CancelOutcomeNotRequested
}

func TemporalFailureTimeoutOutcome(
	ctx context.Context,
	configured execution.TimeoutOutcome,
	cause error,
) execution.TimeoutOutcome {
	if configured != "" {
		return configured
	}
	if errors.Is(cause, context.DeadlineExceeded) {
		return execution.TimeoutOutcomeActivityTimeout
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return execution.TimeoutOutcomeActivityTimeout
	}
	return execution.TimeoutOutcomeNotTimedOut
}

func TemporalProjectionRef(runID string, suffix string) string {
	return "projection://runs/" + strings.TrimSpace(runID) + "/" + strings.TrimSpace(suffix)
}

func (s *Writer) AppendTemporalRunEvent(ctx context.Context, event execution.DurableRunEvent) error {
	if _, err := s.RunProjectionStore.AppendRunEvent(ctx, event); err != nil {
		if !errors.Is(err, execution.ErrInvalidRunEvent) {
			return err
		}
		events, listErr := s.RunProjectionStore.ListRunEvents(ctx, event.RequestID)
		if listErr != nil {
			return err
		}
		for _, existing := range events {
			if existing.EventID != event.EventID {
				continue
			}
			if existing.EventType == event.EventType &&
				existing.ConversationID == event.ConversationID &&
				existing.PayloadSchemaVersion == event.PayloadSchemaVersion &&
				TemporalEventPayloadEquivalent(existing.Payload, event.Payload) {
				return nil
			}
			return err
		}
		return err
	}
	return nil
}

func TemporalEventPayloadEquivalent(left map[string]any, right map[string]any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	if leftErr == nil && rightErr == nil {
		return string(leftJSON) == string(rightJSON)
	}
	return reflect.DeepEqual(left, right)
}
