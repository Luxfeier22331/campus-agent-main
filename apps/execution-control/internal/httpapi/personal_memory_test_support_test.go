package httpapi

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type fakePersonalMemoryExecutor struct {
	seenDisable memoryruntime.DisableRequest
	seenRequest memoryruntime.RecallRequest
	seenUpsert  memoryruntime.UpsertRequest
}

func (f *fakePersonalMemoryExecutor) HealthCheck(context.Context) error {
	return nil
}

func (f *fakePersonalMemoryExecutor) Recall(
	_ context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	f.seenRequest = request
	return memoryruntime.RecallResult{
		Items: []memoryruntime.ContextItem{{
			Capability:  "knowledge",
			CompactText: "用户关注保研和培养方案。",
			MemoryID:    "mem-test-1",
			MemoryType:  "preference",
			Score:       0.91,
			UpdatedAt:   "2026-06-01T00:00:00Z",
		}},
		MemoryRef:           "projection://runs/" + request.RunID + "/memory/recall",
		RunID:               request.RunID,
		SchemaVersion:       "memory_recall_result_v1",
		SelectedMemoryChars: len([]rune("用户关注保研和培养方案。")),
		SelectedMemoryCount: 1,
	}, nil
}

func (f *fakePersonalMemoryExecutor) Upsert(
	_ context.Context,
	request memoryruntime.UpsertRequest,
) (memoryruntime.UpsertResult, error) {
	f.seenUpsert = request
	return memoryruntime.NormalizeUpsertResult(request), nil
}

func (f *fakePersonalMemoryExecutor) Disable(
	_ context.Context,
	request memoryruntime.DisableRequest,
) (memoryruntime.UpsertResult, error) {
	f.seenDisable = request
	return memoryruntime.UpsertResult{
		MemoryID:      request.MemoryID,
		PointID:       memoryruntime.PointID(request.UserID, request.MemoryID),
		SchemaVersion: "personal_memory_upsert_result_v1",
		Status:        "disabled",
		UpdatedAt:     request.UpdatedAt,
	}, nil
}
