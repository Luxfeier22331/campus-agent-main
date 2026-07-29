package httpapi

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type fakePersonalMemoryExecutor struct {
	appendErr     error
	appendCount   int
	commandCount  int
	commandErr    error
	commandResult memoryruntime.PersonalMemoryCommandResult
	recallCount   int
	seenAppend    memoryruntime.AppendConversationTurnRequest
	seenRequest   memoryruntime.RecallRequest
}

func (f *fakePersonalMemoryExecutor) ExecuteCommand(
	_ context.Context,
	request memoryruntime.PersonalMemoryCommandRequest,
) (memoryruntime.PersonalMemoryCommandResult, error) {
	f.commandCount++
	if f.commandErr != nil {
		return memoryruntime.PersonalMemoryCommandResult{}, f.commandErr
	}
	if f.commandResult.Status != "" {
		result := f.commandResult
		if result.CommandID == "" {
			result.CommandID = request.CommandID
		}
		return result, nil
	}
	return memoryruntime.PersonalMemoryCommandResult{CommandID: request.CommandID, Status: "succeeded"}, nil
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
	return memoryruntime.FinalizeRecallResult(memoryruntime.RecallResult{
		ContextBlock: "用户记忆:\n相关事实:\n- 用户关注保研和培养方案。",
		Items: []memoryruntime.ContextItem{{
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
		AppendedMessageCount: 1,
		RunID:                request.RunID,
		SchemaVersion:        "memory_conversation_append_result_v2",
		Status:               "completed",
		ThreadID:             request.ThreadID,
		UserID:               request.UserID,
	})
}
