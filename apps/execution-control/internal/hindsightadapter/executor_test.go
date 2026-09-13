package hindsightadapter

import (
	"context"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func TestHindsightAppendRetainsOneSynchronousUserMessageDocument(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt", recallLimit: 8, recallMaxTokens: 2500, contextCharBudget: 2500}
	result, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		OwnerGeneration: 1, RequestID: "req-hindsight-append", TenantID: "tenant-main",
		ThreadID: "conv-hindsight-append", UserID: "user-executor", UserMessage: "我之后主要关注保研材料",
		UserMessageCreatedAt: "2026-06-16T10:03:04Z", UserMessageID: "msg-user-hindsight-append",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if client.retainedAsync || len(client.retainedItems) != 1 {
		t.Fatalf("retain async=%t items=%d", client.retainedAsync, len(client.retainedItems))
	}
	item := client.retainedItems[0]
	if item.DocumentID != "conversation:0cfca32bf83f4dee5ee82ead69e1108c:message:21f2430743389844b7275d25c8e09ba7" || item.UpdateMode != "replace" {
		t.Fatalf("item = %#v", item)
	}
	if item.Content != "我之后主要关注保研材料" || item.Metadata["source_message_id"] != "msg-user-hindsight-append" {
		t.Fatalf("item content/metadata = %#v", item)
	}
	if result.AppendedMessageCount != 1 {
		t.Fatalf("result = %#v", result)
	}
	if client.bankExistsCalls != 1 || client.ensureBankCalls != 1 {
		t.Fatalf("bank exists calls=%d ensure calls=%d, want 1/1", client.bankExistsCalls, client.ensureBankCalls)
	}
}

func TestHindsightAppendUsesExistingBankWithoutReconfiguringIt(t *testing.T) {
	client := &fakeHindsightClient{bankExists: true}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	_, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		OwnerGeneration: 1, RequestID: "req-hindsight-append-existing", TenantID: "tenant-main",
		ThreadID: "conv-hindsight-append-existing", UserID: "user-executor", UserMessage: "我偏好先看结论",
		UserMessageCreatedAt: "2026-06-16T10:03:04Z", UserMessageID: "msg-user-hindsight-append-existing",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if client.bankExistsCalls != 1 || client.ensureBankCalls != 0 {
		t.Fatalf("bank exists calls=%d ensure calls=%d, want 1/0", client.bankExistsCalls, client.ensureBankCalls)
	}
}

func TestHindsightMemoryUpdateUsesNativeCuration(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}
	result, err := executor.ExecuteCommand(context.Background(), memoryruntime.PersonalMemoryCommandRequest{
		CommandID: "curate", CommandKind: "memory_update", OwnerGeneration: 1, OwnerSequence: 1,
		SubjectID: "fact-1", Item: &memoryruntime.PersonalMemoryCommandItem{State: "inactive"},
		SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion, SupersessionScope: "memory:fact-1",
		SourceUpdatedAt: "2026-07-16T00:00:00Z", TenantID: "tenant-main", UserID: "user-executor",
	})
	if err != nil || result.Status != "succeeded" || client.updatedMemoryID != "fact-1" || client.updatedMemory.State != "inactive" {
		t.Fatalf("result=%#v client=%#v err=%v", result, client, err)
	}
}

type fakeHindsightClient struct {
	bankExists        bool
	bankExistsCalls   int
	deletedBankID     string
	updatedMemoryID   string
	updatedMemory     memoryruntime.PersonalMemoryCommandItem
	ensuredBankConfig hindsightBankConfig
	ensuredBankID     string
	ensureBankCalls   int
	recallCalls       int
	recallResponse    hindsightRecallResponse
	retainedAsync     bool
	retainedBankID    string
	retainedItems     []hindsightMemoryItem
}

func (f *fakeHindsightClient) BankExists(context.Context, string) (bool, error) {
	f.bankExistsCalls++
	return f.bankExists, nil
}
func (f *fakeHindsightClient) EnsureBank(_ context.Context, bankID string, cfg hindsightBankConfig) error {
	f.ensureBankCalls++
	f.ensuredBankID, f.ensuredBankConfig = bankID, cfg
	return nil
}
func (f *fakeHindsightClient) RetainMemories(_ context.Context, bankID string, request hindsightRetainRequest) (hindsightRetainResponse, error) {
	f.retainedBankID = bankID
	if request.Async != nil {
		f.retainedAsync = *request.Async
	}
	f.retainedItems = append([]hindsightMemoryItem{}, request.Items...)
	return hindsightRetainResponse{Async: f.retainedAsync, BankID: bankID, ItemsCount: len(request.Items), Success: true}, nil
}
func (f *fakeHindsightClient) RecallMemories(_ context.Context, _ string, _ hindsightRecallRequest) (hindsightRecallResponse, error) {
	f.recallCalls++
	return f.recallResponse, nil
}
func (f *fakeHindsightClient) DeleteBank(_ context.Context, bankID string) error {
	f.deletedBankID = bankID
	return nil
}

func boolPtr(value bool) *bool { return &value }

func (f *fakeHindsightClient) ListMemories(context.Context, string, memoryruntime.MemoryQuery) (memoryruntime.MemoryPage, error) {
	return memoryruntime.MemoryPage{Items: []memoryruntime.MemoryRecord{}}, nil
}
func (f *fakeHindsightClient) GetMemory(context.Context, string, string) (memoryruntime.MemoryRecord, error) {
	return memoryruntime.MemoryRecord{}, memoryruntime.ErrMemoryNotFound
}
func (f *fakeHindsightClient) UpdateMemory(_ context.Context, _ string, id string, edit memoryruntime.PersonalMemoryCommandItem) error {
	f.updatedMemoryID = id
	f.updatedMemory = edit
	return nil
}
