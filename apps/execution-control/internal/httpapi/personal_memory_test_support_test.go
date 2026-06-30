package httpapi

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type fakePersonalMemoryExecutor struct {
	appendErr            error
	appendCount          int
	operationCancelCount int
	operationListCount   int
	operationRetryCount  int
	operationStatusCount int
	recallCount          int
	reflectCount         int
	seenAppend           memoryruntime.AppendConversationTurnRequest
	seenOperationCancel  memoryruntime.OperationActionRequest
	seenOperationList    memoryruntime.OperationListRequest
	seenOperationRetry   memoryruntime.OperationActionRequest
	seenOperationStatus  memoryruntime.OperationStatusRequest
	seenOwnerDisable     memoryruntime.DisableProfileMemoryOwnerRequest
	seenProfileDisable   memoryruntime.DisableProfileMemoryItemRequest
	seenProfileUpsert    memoryruntime.UpsertProfileMemoryItemRequest
	seenRequest          memoryruntime.RecallRequest
	seenReflect          memoryruntime.ReflectRequest
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

func (f *fakePersonalMemoryExecutor) OperationStatus(
	_ context.Context,
	request memoryruntime.OperationStatusRequest,
) (memoryruntime.OperationStatusResult, error) {
	f.operationStatusCount++
	f.seenOperationStatus = request
	return memoryruntime.FinalizeOperationStatusResult(memoryruntime.OperationStatusResult{
		OperationID:   request.OperationID,
		OperationRef:  "projection://runs/" + request.RunID + "/memory/operations/" + request.OperationID,
		OperationType: "retain",
		RunID:         request.RunID,
		SchemaVersion: "memory_operation_status_result_v1",
		Status:        "completed",
		UserID:        request.UserID,
	})
}

func (f *fakePersonalMemoryExecutor) ListOperations(
	_ context.Context,
	request memoryruntime.OperationListRequest,
) (memoryruntime.OperationListResult, error) {
	f.operationListCount++
	f.seenOperationList = request
	return memoryruntime.FinalizeOperationListResult(memoryruntime.OperationListResult{
		Items: []memoryruntime.OperationListItem{{
			CreatedAt:     "2026-06-16T10:00:00Z",
			ItemsCount:    1,
			OperationID:   "op-retain-001",
			OperationRef:  "projection://runs/" + request.RunID + "/memory/operations/op-retain-001",
			OperationType: "retain",
			Status:        "failed",
			UpdatedAt:     "2026-06-16T10:02:00Z",
		}},
		Limit:         20,
		Offset:        0,
		RunID:         request.RunID,
		SchemaVersion: "memory_operation_list_result_v1",
		Total:         1,
		UserID:        request.UserID,
	})
}

func (f *fakePersonalMemoryExecutor) CancelOperation(
	_ context.Context,
	request memoryruntime.OperationActionRequest,
) (memoryruntime.OperationActionResult, error) {
	f.operationCancelCount++
	f.seenOperationCancel = request
	return memoryruntime.FinalizeOperationActionResult(memoryruntime.OperationActionResult{
		Action:        "cancel",
		OperationID:   request.OperationID,
		OperationRef:  "projection://runs/" + request.RunID + "/memory/operations/" + request.OperationID,
		RunID:         request.RunID,
		SchemaVersion: "memory_operation_action_result_v1",
		Status:        "accepted",
		Success:       true,
		UserID:        request.UserID,
	})
}

func (f *fakePersonalMemoryExecutor) RetryOperation(
	_ context.Context,
	request memoryruntime.OperationActionRequest,
) (memoryruntime.OperationActionResult, error) {
	f.operationRetryCount++
	f.seenOperationRetry = request
	return memoryruntime.FinalizeOperationActionResult(memoryruntime.OperationActionResult{
		Action:        "retry",
		OperationID:   request.OperationID,
		OperationRef:  "projection://runs/" + request.RunID + "/memory/operations/" + request.OperationID,
		RunID:         request.RunID,
		SchemaVersion: "memory_operation_action_result_v1",
		Status:        "accepted",
		Success:       true,
		UserID:        request.UserID,
	})
}

func (f *fakePersonalMemoryExecutor) Reflect(
	_ context.Context,
	request memoryruntime.ReflectRequest,
) (memoryruntime.ReflectResult, error) {
	f.reflectCount++
	f.seenReflect = request
	return memoryruntime.FinalizeReflectResult(memoryruntime.ReflectResult{
		Provider:      "hindsight",
		ReflectRef:    "projection://runs/" + request.RunID + "/memory/reflect",
		RunID:         request.RunID,
		SchemaVersion: "memory_reflect_result_v1",
		Status:        "completed",
		Text:          "用户偏好先给结论。",
		ThreadID:      request.ThreadID,
		UserID:        request.UserID,
	})
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
		AppendedMessageCount: appendedHindsightConversationTurnCount(request),
		OperationID:          "op-" + request.RunID,
		OperationStatusRef:   "projection://runs/" + request.RunID + "/memory/operations/op-" + request.RunID,
		RuntimeDocumentRef:   "projection://runs/" + request.RunID + "/memory/documents/conversation%3A" + request.RunID + "%3Aturn",
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
