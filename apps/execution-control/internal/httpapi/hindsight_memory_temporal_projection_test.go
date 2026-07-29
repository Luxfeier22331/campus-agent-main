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
		OwnerGeneration: 1,
		OwnerSequence:   0,
		QueryTimestamp:  "2026-06-16T10:03:04Z",
		RunID:           "run-hindsight-recall-untimed",
		TenantID:        "tenant-main",
		ThreadID:        "conv-hindsight-recall-untimed",
		UserGoal:        "我应该如何阅读培养方案？",
		UserID:          "user-executor",
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
	if client.ensuredBankID == "" {
		t.Fatal("recall did not ensure the scoped Hindsight bank")
	}
	if !client.ensuredBankConfig.EnableObservations || !client.ensuredBankConfig.EnableAutoConsolidation {
		t.Fatalf("ensured bank config = %#v", client.ensuredBankConfig)
	}
}
