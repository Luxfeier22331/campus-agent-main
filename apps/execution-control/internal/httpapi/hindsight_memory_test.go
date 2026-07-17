package httpapi

import (
	"context"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func TestHindsightAppendRetainsOneSynchronousUserMessageDocument(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt", recallLimit: 8, recallMaxTokens: 2500, contextCharBudget: 2500}
	result, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		OwnerGeneration: 1, OwnerSequence: 0, RunID: "run-hindsight-append", TenantID: "tenant-main",
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
	if result.Status != "completed" || result.SchemaVersion != "memory_conversation_append_result_v2" || result.AppendedMessageCount != 1 {
		t.Fatalf("result = %#v", result)
	}
}

func TestHindsightConversationPruneDeletesDeterministicSourceDocuments(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}
	result, err := executor.ExecuteCommand(context.Background(), memoryruntime.PersonalMemoryCommandRequest{
		CommandID: "cmd-prune", CommandKind: "conversation_prune", OwnerGeneration: 1, OwnerSequence: 1,
		SubjectID: "conv-hindsight-append", SourceMessageIDs: []string{"msg-user-hindsight-append", "msg-user-second"},
		SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion, SupersessionScope: "source_batch:cmd-prune",
		SourceUpdatedAt: "2026-07-16T00:00:00Z",
		TenantID:        "tenant-main", UserID: "user-executor",
	})
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if result.Status != "succeeded" || len(client.deletedDocumentIDs) != 2 {
		t.Fatalf("result=%#v deleted=%#v", result, client.deletedDocumentIDs)
	}
	if client.deletedDocumentIDs[0] != "conversation:0cfca32bf83f4dee5ee82ead69e1108c:message:21f2430743389844b7275d25c8e09ba7" {
		t.Fatalf("deleted documents = %#v", client.deletedDocumentIDs)
	}
}

type fakeHindsightClient struct {
	deletedBankID      string
	deletedDocumentIDs []string
	ensuredBankConfig  hindsightBankConfig
	ensuredBankID      string
	recallResponse     hindsightRecallResponse
	reflectResponse    hindsightReflectResponse
	retainedAsync      bool
	retainedBankID     string
	retainedItems      []hindsightMemoryItem
}

func (f *fakeHindsightClient) BankExists(context.Context, string) (bool, error) { return false, nil }
func (f *fakeHindsightClient) EnsureBank(_ context.Context, bankID string, cfg hindsightBankConfig) error {
	f.ensuredBankID, f.ensuredBankConfig = bankID, cfg
	return nil
}
func (f *fakeHindsightClient) HealthCheck(context.Context) error { return nil }
func (f *fakeHindsightClient) RetainMemories(_ context.Context, bankID string, request hindsightRetainRequest) (hindsightRetainResponse, error) {
	f.retainedBankID = bankID
	if request.Async != nil {
		f.retainedAsync = *request.Async
	}
	f.retainedItems = append([]hindsightMemoryItem{}, request.Items...)
	return hindsightRetainResponse{Async: f.retainedAsync, BankID: bankID, ItemsCount: len(request.Items), Success: true}, nil
}
func (f *fakeHindsightClient) RecallMemories(_ context.Context, _ string, _ hindsightRecallRequest) (hindsightRecallResponse, error) {
	return f.recallResponse, nil
}
func (f *fakeHindsightClient) Reflect(_ context.Context, _ string, _ hindsightReflectRequest) (hindsightReflectResponse, error) {
	return f.reflectResponse, nil
}
func (f *fakeHindsightClient) DeleteDocument(_ context.Context, _ string, documentID string) error {
	f.deletedDocumentIDs = append(f.deletedDocumentIDs, documentID)
	return nil
}
func (f *fakeHindsightClient) DeleteBank(_ context.Context, bankID string) error {
	f.deletedBankID = bankID
	return nil
}

func boolPtr(value bool) *bool { return &value }
