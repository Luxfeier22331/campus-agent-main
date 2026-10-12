package answermemory

import (
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	memoryruntime "github.com/MUC-WIKI/campus-agent/packages/memory-api-go"
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
