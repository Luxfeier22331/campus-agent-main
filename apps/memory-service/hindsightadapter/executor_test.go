package hindsightadapter

import (
	"context"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"
)

func TestHindsightAppendRetainsOneAsyncUserMessageDocument(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt", recallLimit: 8, recallMaxTokens: 2500, contextCharBudget: 2500}
	result, err := executor.SubmitConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		OwnerGeneration: 1, RequestID: "req-hindsight-append", TenantID: "tenant-main",
		ThreadID: "conv-hindsight-append", UserID: "user-executor", UserMessage: "我之后主要关注保研材料",
		UserMessageCreatedAt: "2026-06-16T10:03:04Z", UserMessageID: "msg-user-hindsight-append",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if !client.retainedAsync || len(client.retainedItems) != 1 {
		t.Fatalf("retain async=%t items=%d", client.retainedAsync, len(client.retainedItems))
	}
	item := client.retainedItems[0]
	if item.DocumentID != "conversation:0cfca32bf83f4dee5ee82ead69e1108c:message:21f2430743389844b7275d25c8e09ba7" || item.UpdateMode != "replace" {
		t.Fatalf("item = %#v", item)
	}
	if item.Content != "我之后主要关注保研材料" || item.Metadata["source_message_id"] != "msg-user-hindsight-append" {
		t.Fatalf("item content/metadata = %#v", item)
	}
	if result.OperationID == "" {
		t.Fatalf("result = %#v", result)
	}
	if client.bankExistsCalls != 1 || client.ensureBankCalls != 1 {
		t.Fatalf("bank exists calls=%d ensure calls=%d, want 1/1", client.bankExistsCalls, client.ensureBankCalls)
	}
}

func TestHindsightAppendUsesExistingBankWithoutReconfiguringIt(t *testing.T) {
	client := &fakeHindsightClient{bankExists: true}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	_, err := executor.SubmitConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
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

func TestDefaultHindsightBankConfigIncludesRetainMission(t *testing.T) {
	cfg := defaultHindsightBankConfig()
	if cfg.RetainMission == "" {
		t.Fatal("RetainMission is empty, want conservative extraction constraint")
	}
	if !strings.Contains(cfg.RetainMission, "单次咨询") || !strings.Contains(cfg.RetainMission, "不提取") {
		t.Fatalf("RetainMission = %q, want constraint against single-turn consultation extraction", cfg.RetainMission)
	}
}

func TestHindsightEnsureBankConfigCarriesRetainMission(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}
	if err := executor.ensureBankForWrite(context.Background(), "bank-test-retain-mission"); err != nil {
		t.Fatalf("ensure bank for write: %v", err)
	}
	if client.ensureBankCalls != 1 {
		t.Fatalf("ensure bank calls=%d, want 1", client.ensureBankCalls)
	}
	if client.ensuredBankConfig.RetainMission == "" {
		t.Fatal("ensured bank config RetainMission is empty")
	}
}

type fakeHindsightClient struct {
	bankExists        bool
	bankExistsCalls   int
	deletedBankID     string
	ensuredBankConfig hindsightBankConfig
	ensuredBankID     string
	ensureBankCalls   int
	recallCalls       int
	recallResponse    hindsightRecallResponse
	retainedAsync     bool
	retainedBankID    string
	retainedItems     []hindsightMemoryItem
	retainCalls       int

	mentalModel            hindsightProfileModelSnapshot
	mentalModelFound       bool
	getMentalModelCalls    int
	createdMentalModelBank string
	createdMentalModelReq  hindsight.CreateMentalModelRequest
	createMentalModelCalls int
	operationNotFound      bool
	retainErr              error
}

func (c *fakeHindsightClient) GetOperation(_ context.Context, _, operationID string) (memoryruntime.AppendOperation, error) {
	if c.operationNotFound {
		return memoryruntime.AppendOperation{}, ErrOperationNotFound
	}
	return memoryruntime.AppendOperation{OperationID: operationID, Status: "completed"}, nil
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
	f.retainCalls++
	if f.retainErr != nil {
		return hindsightRetainResponse{}, f.retainErr
	}
	f.retainedBankID = bankID
	if request.Async != nil {
		f.retainedAsync = *request.Async
	}
	f.retainedItems = append([]hindsightMemoryItem{}, request.Items...)
	f.operationNotFound = false
	return hindsightRetainResponse{Async: f.retainedAsync, BankID: bankID, ItemsCount: len(request.Items), OperationID: request.OperationID, Success: true}, nil
}

func TestExecuteMemoryAddFailsOnlyOnDefinitiveRetainRejection(t *testing.T) {
	client := &fakeHindsightClient{bankExists: true, operationNotFound: true, retainErr: ErrHindsightRetainRejected}
	executor := hindsightExecutor{client: client, ownerSalt: "salt"}
	request := memoryruntime.PersonalMemoryCommandRequest{
		CommandID: "command-rejected", CommandKind: "memory_add", TenantID: "tenant", UserID: "user",
		OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion,
		SubjectID: "subject", SupersessionScope: "memory:subject", SourceUpdatedAt: "2026-10-10T00:00:00Z",
		Item: &memoryruntime.PersonalMemoryCommandItem{Text: "喜欢图书馆"},
	}
	result, err := executor.ExecuteCommand(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "failed" || result.ErrorCode != "personal_memory_command_failed" {
		t.Fatalf("result = %+v, want terminal rejection", result)
	}
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

func TestExecuteMemoryAddUsesStableAsyncOperation(t *testing.T) {
	client := &fakeHindsightClient{bankExists: true, operationNotFound: true}
	executor := hindsightExecutor{client: client, ownerSalt: "salt"}
	request := memoryruntime.PersonalMemoryCommandRequest{
		CommandID: "command-1", CommandKind: "memory_add", TenantID: "tenant", UserID: "user",
		OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion,
		SubjectID: "subject", SupersessionScope: "memory:subject", SourceUpdatedAt: "2026-10-10T00:00:00Z",
		Item: &memoryruntime.PersonalMemoryCommandItem{Text: "喜欢图书馆"},
	}
	result, err := executor.ExecuteCommand(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "succeeded" || !client.retainedAsync || client.retainedItems[0].Metadata["command_id"] != request.CommandID {
		t.Fatalf("result=%+v async=%t items=%+v", result, client.retainedAsync, client.retainedItems)
	}
	if _, err := executor.ExecuteCommand(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if client.retainCalls != 1 {
		t.Fatalf("retain calls=%d, want stable operation lookup without duplicate submit", client.retainCalls)
	}
}

func (f *fakeHindsightClient) GetMentalModel(_ context.Context, _ string, _ string) (hindsightProfileModelSnapshot, bool, error) {
	f.getMentalModelCalls++
	return f.mentalModel, f.mentalModelFound, nil
}

func (f *fakeHindsightClient) CreateMentalModel(_ context.Context, bankID string, request hindsight.CreateMentalModelRequest) error {
	f.createMentalModelCalls++
	f.createdMentalModelBank = bankID
	f.createdMentalModelReq = request
	return nil
}
