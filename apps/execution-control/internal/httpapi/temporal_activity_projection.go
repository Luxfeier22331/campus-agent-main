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
	bridgeRef string,
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
		if _, err := temporalFinalizedResponseFromRun(run, bridgeRef); err != nil {
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
) (temporalruntime.PlanChatAnswerActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "plan"),
		ResultKind:    "activity_failure",
		StepID:        "planning",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.PlanChatAnswerActivityOutput{}, err
}

func (s *Server) failSemanticWorkerActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.InvokeSemanticWorkerActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "semantic/rag"),
		ResultKind:    "activity_failure",
		StepID:        "semantic.rag",
		StepKind:      "typed_activity",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.InvokeSemanticWorkerActivityOutput{}, err
}

func (s *Server) failFinalizationActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.FinalizeChatAnswerActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "finalization"),
		ResultKind:    "activity_failure",
		StepID:        "finalization",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueFinalization,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.FinalizeChatAnswerActivityOutput{}, err
}

type temporalStepFailureProjection struct {
	FailureKind   string
	Payload       map[string]any
	ProjectionRef string
	ResultKind    string
	StepID        string
	StepKind      string
	TaskQueue     string
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
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "failed",
		StepID:        projection.StepID,
		StepKind:      projection.StepKind,
		TaskQueue:     projection.TaskQueue,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		CompletedAt:   now,
		UpdatedAt:     now,
		ResultKind:    projection.ResultKind,
		ProjectionRef: projection.ProjectionRef,
		Payload:       payload,
	}); err != nil {
		return execution.DurableRun{}, err
	}
	return s.failTemporalRun(ctx, run, projection.FailureKind, cause)
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
	bridgeRef string,
) (map[string]any, error) {
	raw, ok := run.Metadata["temporal_semantic_bridge"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("run metadata.temporal_semantic_bridge is required")
	}
	if strings.TrimSpace(fmt.Sprint(raw["bridge_ref"])) != bridgeRef {
		return nil, fmt.Errorf("semantic bridge ref drift")
	}
	response, ok := raw["finalized_response"].(map[string]any)
	if ok {
		return response, nil
	}
	encoded, err := json.Marshal(raw["finalized_response"])
	if err != nil {
		return nil, fmt.Errorf("encode finalized response projection: %w", err)
	}
	decoded := map[string]any{}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return nil, fmt.Errorf("decode finalized response projection: %w", err)
	}
	return decoded, nil
}

func temporalSemanticBridgeRefFromRun(run execution.DurableRun, planRef string) (string, bool) {
	raw, ok := run.Metadata["temporal_semantic_bridge"].(map[string]any)
	if !ok {
		return "", false
	}
	if strings.TrimSpace(fmt.Sprint(raw["plan_ref"])) != strings.TrimSpace(planRef) {
		return "", false
	}
	bridgeRef := strings.TrimSpace(fmt.Sprint(raw["bridge_ref"]))
	if bridgeRef == "" {
		return "", false
	}
	if _, err := temporalFinalizedResponseFromRun(run, bridgeRef); err != nil {
		return "", false
	}
	return bridgeRef, true
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

type temporalStepProjection struct {
	Attempt       int
	Capability    string
	Run           execution.DurableRun
	Status        string
	StepID        string
	StepKind      string
	TaskQueue     string
	WorkerID      string
	StartedAt     time.Time
	CompletedAt   time.Time
	UpdatedAt     time.Time
	ResultKind    string
	ProjectionRef string
	Payload       map[string]any
}

func (s *Server) projectTemporalStep(ctx context.Context, projection temporalStepProjection) error {
	if s == nil || s.runProjectionStore == nil {
		return execution.ErrRunProjectionStoreNotConfigured
	}
	attempt := projection.Attempt
	if attempt <= 0 {
		attempt = 1
	}
	updatedAt := projection.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	if _, err := s.runProjectionStore.UpsertRunStep(ctx, execution.RunStepProjection{
		StepID:               projection.StepID,
		RunID:                projection.Run.RunID,
		ConversationID:       projection.Run.ConversationID,
		StepKind:             projection.StepKind,
		Capability:           projection.Capability,
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
	attemptID := temporalStepAttemptID(projection.Run.RunID, projection.StepID, attempt)
	if _, err := s.runProjectionStore.UpsertStepAttempt(ctx, execution.StepAttemptProjection{
		AttemptID:            attemptID,
		StepID:               projection.StepID,
		RunID:                projection.Run.RunID,
		Attempt:              attempt,
		Status:               projection.Status,
		TaskQueue:            projection.TaskQueue,
		WorkerID:             projection.WorkerID,
		StartedAt:            projection.StartedAt,
		CompletedAt:          projection.CompletedAt,
		UpdatedAt:            updatedAt,
		PayloadSchemaVersion: "step-attempt-projection-v1",
		SanitizedPayload:     projection.Payload,
	}); err != nil {
		return err
	}
	if strings.TrimSpace(projection.ResultKind) == "" {
		return nil
	}
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
	return nil
}

func temporalStepAttemptID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":attempt-" + fmt.Sprint(attempt)
}

func temporalStepResultID(runID string, stepID string, attempt int) string {
	return strings.TrimSpace(runID) + ":" + strings.TrimSpace(stepID) + ":result-" + fmt.Sprint(attempt)
}
