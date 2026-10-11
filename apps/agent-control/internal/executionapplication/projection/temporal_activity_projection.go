package projection

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
)

func RunTerminal(status execution.DurableRunStatus) bool {
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

type StepFailureProjection struct {
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

func (s *Writer) ProjectFailureStep(
	ctx context.Context,
	run execution.DurableRun,
	projection StepFailureProjection,
	cause error,
) error {
	now := projection.FailedAt.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	projection.FailureKind = executionfailure.BoundedKind(projection.FailureKind)
	payload := FailurePayload(projection)
	if err := s.ProjectStep(ctx, StepProjection{
		Attempt:            1,
		Tool:               FailureTool(projection),
		CancelOutcome:      FailureCancelOutcome(ctx, projection.CancelOutcome),
		FailCloseReason:    FailureFailCloseReason(projection),
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
		WorkerID:           s.WorkerID,
		StartedAt:          now,
		CompletedAt:        now,
		UpdatedAt:          now,
		ResultKind:         projection.ResultKind,
		ProjectionRef:      projection.ProjectionRef,
		TimeoutOutcome:     FailureTimeoutOutcome(ctx, projection.TimeoutOutcome, cause),
		Payload:            payload,
	}); err != nil {
		return err
	}
	return nil
}

func FailureTool(projection StepFailureProjection) string {
	if tool := strings.TrimSpace(projection.Tool); tool != "" {
		return tool
	}
	return ""
}

func FailureFailCloseReason(projection StepFailureProjection) string {
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

func FailureCancelOutcome(
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

func FailureTimeoutOutcome(
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

func ProjectionRef(runID string, suffix string) string {
	return "projection://runs/" + strings.TrimSpace(runID) + "/" + strings.TrimSpace(suffix)
}

func (s *Writer) AppendRunEvent(ctx context.Context, event execution.DurableRunEvent) error {
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
				EventPayloadEquivalent(existing.Payload, event.Payload) {
				return nil
			}
			return err
		}
		return err
	}
	return nil
}

func EventPayloadEquivalent(left map[string]any, right map[string]any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	if leftErr == nil && rightErr == nil {
		return string(leftJSON) == string(rightJSON)
	}
	return reflect.DeepEqual(left, right)
}
