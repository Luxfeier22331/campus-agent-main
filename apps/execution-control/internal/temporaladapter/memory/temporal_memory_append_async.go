package memory

import (
	"context"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

func (s *Adapter) AdvanceMemoryAppendActivity(ctx context.Context, input temporalruntime.MemoryAppendWorkflowInput) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	// This Activity belongs to the independent append workflow, including its
	// continued runs, rather than the already-completed answer workflow.
	if activity.IsActivity(ctx) && activity.GetInfo(ctx).WorkflowExecution.ID != "memory.append/"+input.RequestID {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, temporal.NewNonRetryableApplicationError("memory append workflow identity mismatch", "memory_append_identity_invalid", nil)
	}
	run, err := s.completedFinalizationRun(ctx, input.RequestID)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	payload, err := s.LoadExecutionPayload(ctx, run)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	enabled, known := MemoryEnabledFromExecutionPayload(payload)
	if !enabled || !known {
		reason := "memory_disabled"
		if !known {
			reason = "memory_enabled_unknown"
		}
		return s.skipAsyncMemoryAppend(ctx, run, input.StartedAt, reason)
	}
	// A restarted worker missing configuration cannot establish whether a
	// previous submission was accepted. Keep tracking, rather than skip/release.
	if s.PersonalMemoryErr != nil || s.AsyncMemoryExecutor == nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, temporal.NewApplicationError("memory runtime unavailable", "memory_append_runtime_unavailable")
	}
	request, err := MemoryAppendRequestForRun(run, payload)
	if err != nil {
		return s.finishAsyncMemoryAppend(ctx, run, input.StartedAt, "failed", "memory_append_request_invalid")
	}
	if s.PersonalMemoryStateErr != nil || s.PersonalMemoryStateStore == nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, temporal.NewApplicationError("memory state unavailable", "memory_append_state_unavailable")
	}
	ownerHash := memoryruntime.OwnerScopeHash(s.Config.PersonalMemoryOwnerSalt, request.TenantID, request.UserID)
	callID := request.RequestID + ":append"
	// Projection may already have committed before an Activity response was lost.
	// Finish cleanup without opening a new call or resubmitting a remote task.
	steps, err := s.RunProjectionStore.ListRunSteps(ctx, run.RequestID)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	hasRunningStep := false
	for _, step := range steps {
		if step.StepID != "memory.append" {
			continue
		}
		if activityprojection.TemporalStepTerminal(step.Status) {
			// Repair a projection whose step committed before its result/attempt.
			if err := s.projectAsyncAppendStep(ctx, run, step.StartedAt, step.CompletedAt, step.UpdatedAt, step.Status, step.SanitizedPayload); err != nil {
				return temporalruntime.AppendConversationMemoryActivityOutput{}, err
			}
			err := s.PersonalMemoryStateStore.EndCall(ctx, ownerHash, callID)
			return temporalruntime.AppendConversationMemoryActivityOutput{RequestID: run.RequestID, Status: step.Status}, err
		}
		hasRunningStep = step.Status == "running"
	}
	if !input.Submitted {
		if err := s.PersonalMemoryStateStore.BeginCall(ctx, ownerHash, callID, request.OwnerGeneration, "append", 0); err != nil {
			if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
				return s.skipAsyncMemoryAppend(ctx, run, input.StartedAt, "memory_generation_changed")
			}
			return temporalruntime.AppendConversationMemoryActivityOutput{}, err
		}
		if !hasRunningStep {
			if err := s.projectAsyncAppendStep(ctx, run, input.StartedAt, time.Time{}, time.Now().UTC(), "running", map[string]any{"status": "running"}); err != nil {
				return temporalruntime.AppendConversationMemoryActivityOutput{}, err
			}
		}
		if _, err := s.AsyncMemoryExecutor.SubmitConversationTurn(ctx, request); err != nil {
			// The acknowledgement can be lost after acceptance. Query the same
			// deterministic operation before allowing Temporal to retry; this
			// prevents a first submission and its retry from running together.
			if _, statusErr := s.AsyncMemoryExecutor.GetConversationTurnOperation(ctx, request); statusErr == nil {
				return temporalruntime.AppendConversationMemoryActivityOutput{RequestID: run.RequestID, Status: "running"}, nil
			}
			return temporalruntime.AppendConversationMemoryActivityOutput{}, temporal.NewApplicationError("retain submission not confirmed", "memory_append_submit_unconfirmed")
		}
		return temporalruntime.AppendConversationMemoryActivityOutput{RequestID: run.RequestID, Status: "running"}, nil
	}
	operation, err := s.AsyncMemoryExecutor.GetConversationTurnOperation(ctx, request)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, temporal.NewApplicationError("retain status unavailable", "memory_append_status_unavailable")
	}
	switch operation.Status {
	case "completed", "failed", "cancelled":
		status := operation.Status
		if status == "cancelled" {
			status = "failed"
		}
		output, err := s.finishAsyncMemoryAppend(ctx, run, input.StartedAt, status, operation.ErrorCode, operation)
		if err != nil {
			return output, err
		}
		return output, s.PersonalMemoryStateStore.EndCall(ctx, ownerHash, callID)
	default:
		// Missing/unknown remote status is not evidence that processing stopped.
		return temporalruntime.AppendConversationMemoryActivityOutput{RequestID: run.RequestID, Status: "running"}, nil
	}
}

func (s *Adapter) skipAsyncMemoryAppend(ctx context.Context, run execution.DurableRun, startedAt time.Time, reason string) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	output := SkippedMemoryAppendOutput(run.RequestID, reason)
	now := time.Now().UTC()
	payload := map[string]any{
		"status": output.Status, "schema_version": output.SchemaVersion,
		"skip_reasons": output.SkipReasons, "skipped_count": output.SkippedCount,
		"appended_message_count": 0, "thread_id": run.ConversationID,
	}
	return output, s.projectAsyncAppendStep(ctx, run, startedAt, now, now, output.Status, payload)
}

func (s *Adapter) finishAsyncMemoryAppend(ctx context.Context, run execution.DurableRun, startedAt time.Time, status, failureKind string, operation ...memoryruntime.AppendOperation) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	output := temporalruntime.AppendConversationMemoryActivityOutput{
		RequestID: run.RequestID, Status: status, ThreadID: run.ConversationID,
		SchemaVersion: "memory_conversation_append_result_v3",
	}
	if status == "completed" {
		output.AppendedMessageCount = 1
	}
	now := time.Now().UTC()
	payload := map[string]any{"status": status, "appended_message_count": output.AppendedMessageCount, "schema_version": output.SchemaVersion, "thread_id": run.ConversationID}
	if status == "failed" {
		failure := map[string]any{"code": failureKind, "operation": "memory.append", "detail": "Hindsight retain operation reached a terminal failure."}
		if len(operation) > 0 {
			if operation[0].ErrorDetail != "" {
				failure["detail"] = operation[0].ErrorDetail
			}
			if operation[0].HTTPStatus != 0 {
				failure["http_status"] = operation[0].HTTPStatus
			}
		}
		payload["failure"] = failure
	}
	return output, s.projectAsyncAppendStep(ctx, run, startedAt, now, now, status, payload)
}

func (s *Adapter) projectAsyncAppendStep(ctx context.Context, run execution.DurableRun, startedAt, completedAt, updatedAt time.Time, status string, payload map[string]any) error {
	// This is one remote business operation across many HTTP Activities. Their
	// retry counters reset independently and must not regress the step version.
	return s.ProjectTemporalStep(ctx, activityprojection.TemporalStepProjection{
		Run: run, StepID: "memory.append", StepKind: "memory", Tool: "memory",
		Status: status, StartedAt: startedAt, CompletedAt: completedAt, UpdatedAt: updatedAt,
		Attempt: 1, ActivityAttempt: 1, PreserveAttempt: true,
		WorkflowID:    "memory.append/" + run.RequestID,
		ActivityType:  temporalruntime.AdvanceMemoryAppendActivityName,
		ResultKind:    "memory_conversation_append_result",
		ProjectionRef: activityprojection.TemporalProjectionRef(run.RequestID, "memory/append"),
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		Payload:       payload,
	})
}
