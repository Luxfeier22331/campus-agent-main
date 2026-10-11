package httpapi

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
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

func (f *fakePersonalMemoryExecutor) Recall(
	_ context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	f.recallCount++
	f.seenRequest = request
	return memoryruntime.RecallResult{
		Facts: []string{"用户记忆:\n相关事实:\n- 用户关注保研和培养方案。"}, ContextCharBudget: 2500,
	}, nil
}
