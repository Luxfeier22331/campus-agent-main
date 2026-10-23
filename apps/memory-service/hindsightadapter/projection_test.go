package hindsightadapter

import (
	"context"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

func TestHindsightRecallUsesExistingBankWithoutReconfiguringIt(t *testing.T) {
	client := &fakeHindsightClient{
		bankExists: true,
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

		QueryTimestamp: "2026-06-16T10:03:04Z",
		RequestID:      "req-hindsight-recall-untimed",
		TenantID:       "tenant-main",
		ThreadID:       "conv-hindsight-recall-untimed",
		UserGoal:       "我应该如何阅读培养方案？",
		UserID:         "user-executor",
	})
	if err != nil {
		t.Fatalf("recall: %v", err)
	}
	if len(result.Facts) != 1 || result.Facts[0] != "用户偏好先看结论" || result.ContextCharBudget != 2500 {
		t.Fatalf("recall result = %+v", result)
	}
	if client.bankExistsCalls != 1 || client.recallCalls != 1 {
		t.Fatalf("bank exists calls=%d recall calls=%d, want 1/1", client.bankExistsCalls, client.recallCalls)
	}
	if client.ensureBankCalls != 0 {
		t.Fatalf("ensure bank calls=%d, want 0 for existing bank", client.ensureBankCalls)
	}
}

func TestHindsightRecallReturnsNoMatchWhenBankDoesNotExist(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{
		client:            client,
		ownerSalt:         "test-salt",
		recallLimit:       5,
		recallMaxTokens:   2500,
		contextCharBudget: 2500,
	}

	result, err := executor.Recall(context.Background(), memoryruntime.RecallRequest{
		OwnerGeneration: 1,

		QueryTimestamp: "2026-06-16T10:03:04Z",
		RequestID:      "req-hindsight-recall-missing",
		TenantID:       "tenant-main",
		ThreadID:       "conv-hindsight-recall-missing",
		UserGoal:       "我应该如何阅读培养方案？",
		UserID:         "user-executor",
	})
	if err != nil {
		t.Fatalf("recall: %v", err)
	}
	if len(result.Facts) != 0 || result.ContextCharBudget != 2500 {
		t.Fatalf("recall result = %+v, want empty facts with configured budget", result)
	}
	if client.recallCalls != 0 || client.ensureBankCalls != 0 {
		t.Fatalf("recall calls=%d ensure calls=%d, want 0/0", client.recallCalls, client.ensureBankCalls)
	}
}
