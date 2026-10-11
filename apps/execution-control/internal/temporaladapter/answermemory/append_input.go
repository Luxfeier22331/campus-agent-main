package answermemory

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	projectionapp "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/activitysupport"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

func MemoryAppendRequestForRun(
	run execution.DurableRun,
	payload map[string]any,
) (memoryruntime.AppendConversationTurnRequest, error) {
	userMessage := strings.TrimSpace(execution.OptionalStringFromAny(payload["user_goal"]))
	if userMessage == "" {
		return memoryruntime.AppendConversationTurnRequest{}, fmt.Errorf("memory append user_goal is required")
	}
	userMessageCreatedAt := strings.TrimSpace(execution.OptionalStringFromAny(
		execution.NestedAny(payload, "context", "conversation", "current_user_message", "created_at"),
	))
	userMessageID := strings.TrimSpace(execution.OptionalStringFromAny(
		execution.NestedAny(payload, "context", "conversation", "user_message_id"),
	))
	userID := execution.FirstNonEmptyText(
		execution.NestedAny(payload, "actor", "user_id"),
		execution.NestedAny(payload, "context", "actor", "user_id"),
		run.OwnerUserID,
	)
	tenantID := execution.FirstNonEmptyText(payload["tenant_id"], execution.NestedAny(payload, "context", "tenant_id"))
	ownerGeneration, err := MemoryOwnerGenerationFromPayload(payload)
	if err != nil {
		return memoryruntime.AppendConversationTurnRequest{}, err
	}
	request := memoryruntime.AppendConversationTurnRequest{
		OwnerGeneration:      ownerGeneration,
		RequestID:            run.RequestID,
		TenantID:             tenantID,
		ThreadID:             run.ConversationID,
		UserID:               userID,
		UserMessage:          userMessage,
		UserMessageCreatedAt: userMessageCreatedAt,
		UserMessageID:        userMessageID,
	}
	if err := memoryruntime.ValidateAppendConversationTurnRequest(request); err != nil {
		return memoryruntime.AppendConversationTurnRequest{}, err
	}
	return request, nil
}

func MemoryEnabledFromExecutionPayload(payload map[string]any) (bool, bool) {
	value := execution.NestedAny(payload, "context", "memory", "append_enabled")
	enabled, ok := value.(bool)
	return enabled, ok
}

func (s *Bridge) completedFinalizationRun(ctx context.Context, requestID string) (execution.DurableRun, error) {
	if s == nil || s.RunProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.RunProjectionStore.GetRun(ctx, strings.TrimSpace(requestID))
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status != execution.DurableRunStatusCompleted {
		if projectionapp.RunTerminal(run.Status) {
			return execution.DurableRun{}, activitysupport.SanitizedTemporalApplicationError(
				"post_finalization_activity_terminal_conflict",
				fmt.Errorf("post-finalization activity is not allowed for run status %s", run.Status),
				true,
			)
		}
		return execution.DurableRun{}, errors.New("post-finalization activity cannot run before completed projection")
	}
	results, err := s.RunProjectionStore.ListStepResults(ctx, run.RequestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	for _, result := range results {
		if result.StepID == "finalization.write" && result.Status == "completed" &&
			strings.TrimSpace(result.ProjectionRef) == strings.TrimSpace(run.FinalResponseRef) {
			return run, nil
		}
	}
	return execution.DurableRun{}, activitysupport.SanitizedTemporalApplicationError(
		"post_finalization_activity_identity_invalid",
		errors.New("completed run is not bound to a completed finalization projection"),
		true,
	)
}
