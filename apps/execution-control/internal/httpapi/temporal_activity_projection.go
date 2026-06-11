package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) temporalActivityRun(
	ctx context.Context,
	runID string,
	traceID string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, runID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.TraceID != traceID {
		return execution.DurableRun{}, fmt.Errorf(
			"activity trace_id %s does not match run trace_id %s",
			traceID,
			run.TraceID,
		)
	}
	if temporalRunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("run %s is already terminal: %s", run.RunID, run.Status)
	}
	return run, nil
}

func (s *Server) temporalActivityRunAllowCompletedFinalization(
	ctx context.Context,
	runID string,
	traceID string,
	synthesisRef string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, runID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.TraceID != traceID {
		return execution.DurableRun{}, fmt.Errorf(
			"activity trace_id %s does not match run trace_id %s",
			traceID,
			run.TraceID,
		)
	}
	if run.Status == execution.DurableRunStatusCompleted {
		if _, err := temporalFinalizedResponseFromRun(run, synthesisRef); err != nil {
			return execution.DurableRun{}, err
		}
		return run, nil
	}
	if temporalRunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("run %s is already terminal: %s", run.RunID, run.Status)
	}
	return run, nil
}

func (s *Server) temporalActivityRunAllowCompletedToolFinalization(
	ctx context.Context,
	runID string,
	traceID string,
	toolResultRef string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, runID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.TraceID != traceID {
		return execution.DurableRun{}, fmt.Errorf(
			"activity trace_id %s does not match run trace_id %s",
			traceID,
			run.TraceID,
		)
	}
	if run.Status == execution.DurableRunStatusCompleted {
		if _, err := temporalToolResultFromRun(run, toolResultRef, ""); err != nil {
			return execution.DurableRun{}, err
		}
		return run, nil
	}
	if temporalRunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("run %s is already terminal: %s", run.RunID, run.Status)
	}
	return run, nil
}

func temporalRunTerminal(status execution.DurableRunStatus) bool {
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

func (s *Server) failTemporalPlanning(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.PlanRouteActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "plan/route"),
		ResultKind:    "activity_failure",
		StepID:        "plan.route",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueContext,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.PlanRouteActivityOutput{}, err
}

func (s *Server) failRAGPlanActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.PlanRAGActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "rag/plan"),
		ResultKind:    "activity_failure",
		StepID:        "rag.plan",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.PlanRAGActivityOutput{}, err
}

func (s *Server) failRetrieveIndexedLookupActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.RetrieveIndexedLookupActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "retrieval/indexed-lookup"),
		ResultKind:    "activity_failure",
		StepID:        "retrieval.indexed_lookup",
		StepKind:      "retrieval",
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.RetrieveIndexedLookupActivityOutput{}, err
}

func (s *Server) failExpandOrRescueRetrievalActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.ExpandOrRescueRetrievalActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "retrieval/expand-or-rescue"),
		ResultKind:    "activity_failure",
		StepID:        "retrieval.expand_or_rescue",
		StepKind:      "retrieval",
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.ExpandOrRescueRetrievalActivityOutput{}, err
}

func (s *Server) failSelectEvidenceActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.SelectEvidenceActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "evidence/selection"),
		ResultKind:    "activity_failure",
		StepID:        "evidence.selection",
		StepKind:      "selection",
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.SelectEvidenceActivityOutput{}, err
}

func (s *Server) failVerifyGroundingActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.VerifyGroundingActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "grounding/verify"),
		ResultKind:    "activity_failure",
		StepID:        "grounding.verify",
		StepKind:      "grounding",
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.VerifyGroundingActivityOutput{}, err
}

func (s *Server) failFinalizationActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "finalization/write"),
		ResultKind:    "activity_failure",
		StepID:        "finalization.write",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueFinalization,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.WriteFinalizationActivityOutput{}, err
}

type temporalStepFailureProjection struct {
	FailureKind     string
	CancelOutcome   execution.CancelOutcome
	FailCloseReason string
	Payload         map[string]any
	ProjectionRef   string
	ProviderSummary *provider.ExecutionSummary
	ResultKind      string
	StepID          string
	StepKind        string
	TaskQueue       string
	TimeoutOutcome  execution.TimeoutOutcome
}

func (s *Server) failTemporalRunStep(
	ctx context.Context,
	run execution.DurableRun,
	projection temporalStepFailureProjection,
	cause error,
) (execution.DurableRun, error) {
	now := time.Now().UTC()
	payload := projection.Payload
	if payload == nil {
		payload = map[string]any{
			"failure_kind": projection.FailureKind,
			"message":      cause.Error(),
		}
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:         1,
		Capability:      "knowledge",
		CancelOutcome:   temporalFailureCancelOutcome(ctx, projection.CancelOutcome),
		FailCloseReason: temporalFailureFailCloseReason(projection),
		Run:             run,
		Status:          "failed",
		StepID:          projection.StepID,
		StepKind:        projection.StepKind,
		TaskQueue:       projection.TaskQueue,
		WorkerID:        s.config.TemporalWorkerIdentity,
		StartedAt:       now,
		CompletedAt:     now,
		UpdatedAt:       now,
		ResultKind:      projection.ResultKind,
		ProjectionRef:   projection.ProjectionRef,
		ProviderSummary: projection.ProviderSummary,
		TimeoutOutcome:  temporalFailureTimeoutOutcome(ctx, projection.TimeoutOutcome, cause),
		Payload:         payload,
	}); err != nil {
		return execution.DurableRun{}, err
	}
	return s.failTemporalRun(ctx, run, projection.FailureKind, cause)
}

func temporalFailureFailCloseReason(projection temporalStepFailureProjection) string {
	if strings.TrimSpace(projection.FailCloseReason) != "" {
		return strings.TrimSpace(projection.FailCloseReason)
	}
	if projection.Payload != nil {
		if value := strings.TrimSpace(stringValue(projection.Payload["fail_close_reason"])); value != "" {
			return value
		}
	}
	switch strings.TrimSpace(projection.FailureKind) {
	case "current_state_unverifiable",
		"source_conflict",
		"temporal_scope_ambiguous",
		"clarification_required",
		"not_found":
		return strings.TrimSpace(projection.FailureKind)
	default:
		return ""
	}
}

func temporalFailureCancelOutcome(
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

func temporalFailureTimeoutOutcome(
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

func (s *Server) failTemporalRun(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (execution.DurableRun, error) {
	failedAt := time.Now().UTC()
	_, _ = s.runProjectionStore.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":activity-failed:" + failureKind,
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeActivityFailed,
		OccurredAt:           failedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	})
	failedRun, transitionErr := s.runProjectionStore.TransitionRun(
		ctx,
		run.RunID,
		execution.DurableRunStatusFailed,
		execution.DurableTerminalReasonWorkerUnavailable,
		failedAt,
	)
	if transitionErr != nil {
		return execution.DurableRun{}, transitionErr
	}
	_, _ = s.runProjectionStore.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":run-failed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunFailed,
		OccurredAt:           failedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"failure_kind":    failureKind,
			"status":          string(execution.DurableRunStatusFailed),
			"terminal_reason": string(execution.DurableTerminalReasonWorkerUnavailable),
		},
	})
	return failedRun, cause
}

func temporalFinalizedResponseFromRun(
	run execution.DurableRun,
	synthesisRef string,
) (map[string]any, error) {
	raw, ok := run.Metadata["temporal_rag"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("run metadata.temporal_rag is required")
	}
	if strings.TrimSpace(fmt.Sprint(raw["synthesis_ref"])) != synthesisRef {
		return nil, fmt.Errorf("rag synthesis ref drift")
	}
	rawResponse, exists := raw["finalized_response"]
	if !exists {
		return nil, fmt.Errorf("run metadata.temporal_rag.finalized_response is required")
	}
	response, ok := rawResponse.(map[string]any)
	if ok {
		return response, nil
	}
	encoded, err := json.Marshal(rawResponse)
	if err != nil {
		return nil, fmt.Errorf("encode finalized response projection: %w", err)
	}
	decoded := map[string]any{}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return nil, fmt.Errorf("decode finalized response projection: %w", err)
	}
	if decoded == nil {
		return nil, fmt.Errorf("run metadata.temporal_rag.finalized_response must be an object")
	}
	return decoded, nil
}

func temporalProjectionRef(runID string, suffix string) string {
	return "projection://runs/" + strings.TrimSpace(runID) + "/" + strings.TrimSpace(suffix)
}

func (s *Server) appendTemporalRunEvent(ctx context.Context, event execution.DurableRunEvent) error {
	if _, err := s.runProjectionStore.AppendRunEvent(ctx, event); err != nil {
		if !errors.Is(err, execution.ErrInvalidRunEvent) {
			return err
		}
		events, listErr := s.runProjectionStore.ListRunEvents(ctx, event.RunID)
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
				temporalEventPayloadEquivalent(existing.Payload, event.Payload) {
				return nil
			}
			return err
		}
		return err
	}
	return nil
}

func temporalEventPayloadEquivalent(left map[string]any, right map[string]any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	if leftErr == nil && rightErr == nil {
		return string(leftJSON) == string(rightJSON)
	}
	return reflect.DeepEqual(left, right)
}

func cloneTemporalMetadata(metadata map[string]any) map[string]any {
	cloned := make(map[string]any, len(metadata)+1)
	for key, value := range metadata {
		cloned[key] = value
	}
	return cloned
}

func cloneAnyMapFromMetadata(value any) map[string]any {
	source, ok := value.(map[string]any)
	if !ok || source == nil {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(source)+1)
	for key, item := range source {
		cloned[key] = item
	}
	return cloned
}

func (s *Server) replaceTemporalRAGMetadata(
	ctx context.Context,
	run execution.DurableRun,
	mutate func(map[string]any),
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	metadata := cloneTemporalMetadata(latest.Metadata)
	ragMetadata := cloneAnyMapFromMetadata(metadata["temporal_rag"])
	mutate(ragMetadata)
	metadata["temporal_rag"] = ragMetadata
	return s.runProjectionStore.ReplaceRunMetadata(ctx, latest.RunID, metadata)
}
