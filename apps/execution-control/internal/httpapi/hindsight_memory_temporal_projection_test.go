package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func TestHindsightRecallKeepsFactsWithoutTemporalFields(t *testing.T) {
	client := &fakeHindsightClient{
		recallResponse: hindsightRecallResponse{
			Results: []hindsightRecallResult{{
				ID:   "fact-untimed-001",
				Text: "用户偏好先看结论",
				Type: "observation",
			}},
		},
	}
	executor := hindsightExecutor{
		client:            client,
		ownerSalt:         "test-salt",
		recallLimit:       5,
		recallMaxTokens:   2500,
		contextCharBudget: 2500,
	}

	result, err := executor.Recall(context.Background(), memoryruntime.RecallRequest{
		QueryTimestamp: "2026-06-16T10:03:04Z",
		RequestedTool:  "knowledge_query",
		RunID:          "run-hindsight-recall-untimed",
		TenantID:       "tenant-main",
		ThreadID:       "conv-hindsight-recall-untimed",
		UserGoal:       "我应该如何阅读培养方案？",
		UserID:         "user-executor",
	})
	if err != nil {
		t.Fatalf("recall: %v", err)
	}
	if len(result.Items) != 1 ||
		result.Items[0].MemoryID != "fact-untimed-001" ||
		result.Items[0].UpdatedAt != "" {
		t.Fatalf("items = %#v, want untimed fact retained with empty updated_at", result.Items)
	}
	if !strings.Contains(result.ContextBlock, "用户偏好先看结论") {
		t.Fatalf("context block = %q", result.ContextBlock)
	}
}

func TestHindsightReflectKeepsBasedOnFactsWithoutTemporalFields(t *testing.T) {
	client := &fakeHindsightClient{
		reflectResponse: hindsightReflectResponse{
			BasedOnMemories: []hindsightReflectFact{{
				ID:   "fact-reflect-untimed-001",
				Text: "用户希望回答直接引用校内原文",
				Type: "observation",
			}},
			Text: "用户偏好有校内原文依据。",
		},
	}
	executor := hindsightExecutor{
		client:            client,
		ownerSalt:         "test-salt",
		recallMaxTokens:   2500,
		contextCharBudget: 2500,
	}

	result, err := executor.Reflect(context.Background(), memoryruntime.ReflectRequest{
		IncludeBasedOn: true,
		Query:          "总结用户引用偏好",
		RunID:          "run-hindsight-reflect-untimed",
		TenantID:       "tenant-main",
		ThreadID:       "conv-hindsight-reflect-untimed",
		UserID:         "user-executor",
	})
	if err != nil {
		t.Fatalf("reflect: %v", err)
	}
	if len(result.BasedOnMemoryItems) != 1 ||
		result.BasedOnMemoryItems[0].MemoryID != "fact-reflect-untimed-001" ||
		result.BasedOnMemoryItems[0].UpdatedAt != "" {
		t.Fatalf("based on items = %#v, want untimed fact retained", result.BasedOnMemoryItems)
	}
}
