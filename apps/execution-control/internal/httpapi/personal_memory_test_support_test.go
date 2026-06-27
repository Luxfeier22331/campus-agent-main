package httpapi

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type fakePersonalMemoryExecutor struct {
	appendErr          error
	appendCount        int
	recallCount        int
	seenAppend         memoryruntime.AppendConversationTurnRequest
	seenOwnerDisable   memoryruntime.DisableProfileMemoryOwnerRequest
	seenProfileDisable memoryruntime.DisableProfileMemoryItemRequest
	seenProfileUpsert  memoryruntime.UpsertProfileMemoryItemRequest
	seenRequest        memoryruntime.RecallRequest
}

func (f *fakePersonalMemoryExecutor) HealthCheck(context.Context) error {
	return nil
}

func (f *fakePersonalMemoryExecutor) Recall(
	_ context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	f.recallCount++
	f.seenRequest = request
	return memoryruntime.RecallResult{
		ContextBlock: "用户记忆:\n相关事实:\n- 用户关注保研和培养方案。",
		Items: []memoryruntime.ContextItem{{
			Tool:        "knowledge_query",
			CompactText: "用户关注保研和培养方案。",
			MemoryID:    "mem-test-1",
			MemoryType:  "preference",
			Score:       0.91,
			UpdatedAt:   "2026-06-01T00:00:00Z",
		}},
		MemoryRef:     "projection://runs/" + request.RunID + "/memory/recall",
		Provider:      "hindsight",
		RetrievalMode: "recall",
		RunID:         request.RunID,
		SchemaVersion: "memory_recall_result_v1",
		ThreadID:      request.ThreadID,
	}, nil
}

func (f *fakePersonalMemoryExecutor) AppendConversationTurn(
	_ context.Context,
	request memoryruntime.AppendConversationTurnRequest,
) (memoryruntime.AppendConversationTurnResult, error) {
	f.appendCount++
	f.seenAppend = request
	if f.appendErr != nil {
		return memoryruntime.AppendConversationTurnResult{}, f.appendErr
	}
	return memoryruntime.FinalizeAppendConversationTurnResult(memoryruntime.AppendConversationTurnResult{
		AppendedMessageCount: 2,
		RunID:                request.RunID,
		SchemaVersion:        "memory_conversation_append_result_v1",
		Status:               "accepted",
		ThreadID:             request.ThreadID,
		UserID:               request.UserID,
	})
}

func (f *fakePersonalMemoryExecutor) UpsertProfileMemoryItem(
	_ context.Context,
	request memoryruntime.UpsertProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	f.seenProfileUpsert = request
	return memoryruntime.FinalizeProfileMemoryItemResult(memoryruntime.ProfileMemoryItemResult{
		EpisodeUUID:   "episode-" + request.MemoryID,
		MemoryID:      request.MemoryID,
		SchemaVersion: "memory_profile_item_result_v1",
		Status:        "active",
		UpdatedAt:     request.UpdatedAt,
		UserID:        request.UserID,
	})
}

func (f *fakePersonalMemoryExecutor) DeleteProfileMemoryItem(
	_ context.Context,
	request memoryruntime.DisableProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	f.seenProfileDisable = request
	return memoryruntime.FinalizeProfileMemoryItemResult(memoryruntime.ProfileMemoryItemResult{
		EpisodeUUID:   request.EpisodeUUID,
		MemoryID:      request.MemoryID,
		SchemaVersion: "memory_profile_item_result_v1",
		Status:        "disabled",
		UpdatedAt:     request.UpdatedAt,
		UserID:        request.UserID,
	})
}

func (f *fakePersonalMemoryExecutor) DeleteProfileMemoryOwner(
	_ context.Context,
	request memoryruntime.DisableProfileMemoryOwnerRequest,
) (memoryruntime.ProfileMemoryOwnerDisableResult, error) {
	f.seenOwnerDisable = request
	return memoryruntime.FinalizeProfileMemoryOwnerDisableResult(memoryruntime.ProfileMemoryOwnerDisableResult{
		SchemaVersion: "memory_profile_owner_disable_result_v1",
		Status:        "disabled",
		UpdatedAt:     request.UpdatedAt,
		UserID:        request.UserID,
	})
}
