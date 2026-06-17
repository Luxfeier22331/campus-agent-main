package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func TestHindsightHTTPClientUsesBearerAuthorizationAndHealthEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/health" {
			t.Fatalf("path = %q, want /health", request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer hindsight-secret" {
			t.Fatalf("authorization = %q", got)
		}
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{
		apiSecret: "hindsight-secret",
		baseURL:   server.URL,
	})
	if err := client.HealthCheck(context.Background()); err != nil {
		t.Fatalf("health check: %v", err)
	}
}

func TestHindsightAppendCompletedTurnRetainsConversationDocument(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{
		client:       client,
		ownerSalt:    "test-salt",
		recallLimit:  8,
		recallMaxLen: 2500,
	}

	result, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		AssistantMessage:        "好的，我会结合保研材料准备这个目标。",
		IgnoreAssistantForGraph: true,
		RunID:                   "run-hindsight-append",
		TenantID:                "tenant-main",
		ThreadID:                "conv-hindsight-append",
		UserID:                  "user-executor",
		UserMessage:             "我之后主要关注保研材料",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
	if client.retainedBankID != wantBankID {
		t.Fatalf("bank id = %q, want %q", client.retainedBankID, wantBankID)
	}
	wantDocumentID := "conversation:1bc60525b25178205e174cdc146d0e59"
	if len(client.retainedItems) != 1 {
		t.Fatalf("retained item count = %d, want 1", len(client.retainedItems))
	}
	item := client.retainedItems[0]
	if item.DocumentID != wantDocumentID {
		t.Fatalf("document id = %q, want %q", item.DocumentID, wantDocumentID)
	}
	if !client.retainedAsync {
		t.Fatal("append retain async = false, want true")
	}
	if item.Context != "campus assistant completed conversation turn" {
		t.Fatalf("context = %q", item.Context)
	}
	if item.Metadata["run_id"] != "run-hindsight-append" ||
		item.Metadata["thread_id"] != "conv-hindsight-append" ||
		item.Metadata["source"] != "completed_turn" {
		t.Fatalf("metadata = %#v", item.Metadata)
	}
	if !strings.Contains(item.Content, `"role":"user"`) ||
		!strings.Contains(item.Content, `"role":"assistant"`) ||
		!strings.Contains(item.Content, "我之后主要关注保研材料") ||
		!strings.Contains(item.Content, "好的，我会结合保研材料准备这个目标。") {
		t.Fatalf("content = %q", item.Content)
	}
	for _, wantTag := range []string{
		"scope:private",
		"type:conversation",
		"tenant:tenant-main",
		"user:" + wantBankID,
		"session:" + wantDocumentID,
	} {
		if !containsString(item.Tags, wantTag) {
			t.Fatalf("tags = %#v, want %q", item.Tags, wantTag)
		}
	}
	if result.AppendedMessageCount != 2 ||
		result.ThreadID != "conv-hindsight-append" ||
		result.UserID != wantBankID ||
		result.PayloadSHA256 == "" {
		t.Fatalf("append result = %#v", result)
	}
}

func TestHindsightRecallUsesBankRecallAndProjectsBoundedFactsOnly(t *testing.T) {
	client := &fakeHindsightClient{
		recallResponse: hindsightRecallResponse{
			Results: []hindsightRecallResult{{
				ID:          "fact-001",
				Text:        "用户主要关注保研材料",
				Type:        "experience",
				OccurredEnd: "2026-06-16T10:00:00Z",
			}},
		},
	}
	executor := hindsightExecutor{
		client:       client,
		ownerSalt:    "test-salt",
		recallLimit:  5,
		recallMaxLen: 2500,
	}

	result, err := executor.Recall(context.Background(), memoryruntime.RecallRequest{
		RequestedCapability: "knowledge",
		RunID:               "run-hindsight-recall",
		TenantID:            "tenant-main",
		ThreadID:            "conv-hindsight-recall",
		UserGoal:            "我如何准备保研材料？",
		UserID:              "user-executor",
	})
	if err != nil {
		t.Fatalf("recall: %v", err)
	}
	wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
	if client.recallBankID != wantBankID {
		t.Fatalf("recall bank id = %q, want %q", client.recallBankID, wantBankID)
	}
	if client.recallRequest.Query != "我如何准备保研材料？" ||
		client.recallRequest.Budget != "mid" ||
		client.recallRequest.MaxTokens != 2500 ||
		client.recallRequest.Trace {
		t.Fatalf("recall request = %#v", client.recallRequest)
	}
	if client.recallRequest.TagsMatch != "all_strict" ||
		!containsString(client.recallRequest.Tags, "scope:private") {
		t.Fatalf("recall tag filter = %#v match=%q", client.recallRequest.Tags, client.recallRequest.TagsMatch)
	}
	if len(result.Items) != 1 ||
		result.Items[0].MemoryID != "fact-001" ||
		result.Items[0].MemoryType != "experience" ||
		result.Items[0].UpdatedAt != "2026-06-16T10:00:00Z" {
		t.Fatalf("items = %#v", result.Items)
	}
	if len(result.RecentMessages) != 0 {
		t.Fatalf("recent messages = %#v, want none in sanitized projection", result.RecentMessages)
	}
	if !strings.Contains(result.ContextBlock, "用户主要关注保研材料") ||
		strings.Contains(result.ContextBlock, "最近对话") {
		t.Fatalf("context block = %q", result.ContextBlock)
	}
	if result.Provider != "hindsight" || result.RetrievalMode != "recall" {
		t.Fatalf("runtime source = provider %q mode %q", result.Provider, result.RetrievalMode)
	}
	if result.UserID != wantBankID {
		t.Fatalf("result user id = %q, want bank id", result.UserID)
	}
}

func TestHindsightContextBlockRespectsRuneBudget(t *testing.T) {
	items := []memoryruntime.ContextItem{{
		Capability:  "knowledge",
		CompactText: "保研材料",
		MemoryID:    "fact-001",
		MemoryType:  "experience",
		UpdatedAt:   "2026-06-16T10:00:00Z",
	}}

	block := hindsightContextBlock(items, 18)
	if block != "用户记忆:\n相关事实:" {
		t.Fatalf("context block = %q, want Chinese memory within rune budget", block)
	}
}

func TestHindsightUpsertProfileMemoryItemRetainsProfileDocument(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.UpsertProfileMemoryItem(context.Background(), memoryruntime.UpsertProfileMemoryItemRequest{
		CanonicalSubject: "answer_style",
		CompactText:      "answer_style: 先给结论",
		MemoryID:         "mem_01HQ",
		TenantID:         "tenant-main",
		UpdatedAt:        "2026-06-16T10:00:00Z",
		UserID:           "user_01HQ",
	})
	if err != nil {
		t.Fatalf("profile upsert: %v", err)
	}
	wantBankID := "hindsight_bank_69d871a105ee9ae68b68093cedf42613"
	wantDocumentID := "profile:mem_01HQ"
	if client.retainedBankID != wantBankID {
		t.Fatalf("bank id = %q, want %q", client.retainedBankID, wantBankID)
	}
	if len(client.retainedItems) != 1 {
		t.Fatalf("retained item count = %d, want 1", len(client.retainedItems))
	}
	item := client.retainedItems[0]
	if item.DocumentID != wantDocumentID ||
		item.Content != "answer_style: 先给结论" ||
		item.Context != "explicit profile memory" ||
		item.Metadata["canonical_subject"] != "answer_style" ||
		item.Metadata["memory_id"] != "mem_01HQ" {
		t.Fatalf("profile item = %#v", item)
	}
	if client.retainedAsync {
		t.Fatal("profile upsert async = true, want sync confirmation")
	}
	for _, wantTag := range []string{"scope:private", "type:profile", "tenant:tenant-main", "user:" + wantBankID} {
		if !containsString(item.Tags, wantTag) {
			t.Fatalf("tags = %#v, want %q", item.Tags, wantTag)
		}
	}
	if result.EpisodeUUID != wantDocumentID || result.Status != "active" || result.PayloadSHA256 == "" {
		t.Fatalf("result = %#v", result)
	}
}

func TestHindsightDeleteProfileMemoryItemDeletesProfileDocument(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.DeleteProfileMemoryItem(context.Background(), memoryruntime.DisableProfileMemoryItemRequest{
		EpisodeUUID: "profile:mem_01HQ",
		MemoryID:    "mem_01HQ",
		TenantID:    "tenant-main",
		UpdatedAt:   "2026-06-16T11:00:00Z",
		UserID:      "user_01HQ",
	})
	if err != nil {
		t.Fatalf("profile delete: %v", err)
	}
	wantBankID := "hindsight_bank_69d871a105ee9ae68b68093cedf42613"
	if client.deletedDocumentBankID != wantBankID || client.deletedDocumentID != "profile:mem_01HQ" {
		t.Fatalf("deleted document bank=%q doc=%q", client.deletedDocumentBankID, client.deletedDocumentID)
	}
	if result.Status != "disabled" || result.EpisodeUUID != "profile:mem_01HQ" {
		t.Fatalf("result = %#v", result)
	}
}

func TestHindsightDeleteProfileMemoryOwnerDeletesUserBank(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.DeleteProfileMemoryOwner(context.Background(), memoryruntime.DisableProfileMemoryOwnerRequest{
		TenantID:  "tenant-main",
		UpdatedAt: "2026-06-16T12:00:00Z",
		UserID:    "user-executor",
	})
	if err != nil {
		t.Fatalf("owner delete: %v", err)
	}
	wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
	if client.deletedBankID != wantBankID {
		t.Fatalf("deleted bank id = %q, want %q", client.deletedBankID, wantBankID)
	}
	if result.Status != "disabled" || result.UserID != "user-executor" {
		t.Fatalf("result = %#v", result)
	}
}

func TestNewPersonalMemoryExecutorCreatesHindsightExecutor(t *testing.T) {
	executor, err := newPersonalMemoryExecutor(config.Config{
		PersonalMemoryAPISecret:      "hindsight-secret",
		PersonalMemoryBaseURL:        "http://hindsight-api:8000",
		PersonalMemoryOwnerSalt:      "owner-salt",
		PersonalMemoryRecallLimit:    8,
		PersonalMemoryRecallMaxChars: 2500,
		PersonalMemoryRuntime:        "hindsight",
		PersonalMemoryTimeoutSeconds: 10,
	}, nil)
	if err != nil {
		t.Fatalf("new personal memory executor: %v", err)
	}
	if _, ok := executor.(hindsightExecutor); !ok {
		t.Fatalf("executor type = %T, want hindsightExecutor", executor)
	}
}

func TestNewPersonalMemoryExecutorRejectsRetiredPredecessorRuntime(t *testing.T) {
	_, err := newPersonalMemoryExecutor(config.Config{
		PersonalMemoryAPISecret:      "zep-secret",
		PersonalMemoryBaseURL:        "http://zep-ce-api:8000",
		PersonalMemoryOwnerSalt:      "owner-salt",
		PersonalMemoryRecallLimit:    8,
		PersonalMemoryRecallMaxChars: 2500,
		PersonalMemoryRuntime:        "zep_ce",
		PersonalMemoryTimeoutSeconds: 10,
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "unsupported personal memory runtime") {
		t.Fatalf("error = %v, want retired runtime rejection", err)
	}
}

func TestHindsightHTTPClientRetainPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/default/banks/bank-01/memories" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		var payload hindsightRetainRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload.Async == nil || !*payload.Async || len(payload.Items) != 1 {
			t.Fatalf("payload = %#v", payload)
		}
		if payload.Items[0].DocumentID != "conversation:doc-01" ||
			payload.Items[0].Content != "hello" ||
			payload.Items[0].Metadata["source"] != "test" {
			t.Fatalf("item = %#v", payload.Items[0])
		}
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte(`{"success":true,"bank_id":"bank-01","items_count":1,"async":true}`))
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{
		apiSecret: "hindsight-secret",
		baseURL:   server.URL,
	})
	err := client.RetainMemories(context.Background(), "bank-01", hindsightRetainRequest{
		Async: boolPtr(true),
		Items: []hindsightMemoryItem{{
			Content:    "hello",
			DocumentID: "conversation:doc-01",
			Metadata:   map[string]string{"source": "test"},
		}},
	})
	if err != nil {
		t.Fatalf("retain: %v", err)
	}
}

type fakeHindsightClient struct {
	deletedBankID         string
	deletedDocumentBankID string
	deletedDocumentID     string
	recallBankID          string
	recallRequest         hindsightRecallRequest
	recallResponse        hindsightRecallResponse
	retainedAsync         bool
	retainedBankID        string
	retainedItems         []hindsightMemoryItem
}

func (f *fakeHindsightClient) HealthCheck(context.Context) error {
	return nil
}

func (f *fakeHindsightClient) RetainMemories(
	_ context.Context,
	bankID string,
	request hindsightRetainRequest,
) error {
	f.retainedBankID = bankID
	if request.Async != nil {
		f.retainedAsync = *request.Async
	}
	f.retainedItems = append([]hindsightMemoryItem{}, request.Items...)
	return nil
}

func (f *fakeHindsightClient) RecallMemories(
	_ context.Context,
	bankID string,
	request hindsightRecallRequest,
) (hindsightRecallResponse, error) {
	f.recallBankID = bankID
	f.recallRequest = request
	return f.recallResponse, nil
}

func (f *fakeHindsightClient) DeleteDocument(_ context.Context, bankID string, documentID string) error {
	f.deletedDocumentBankID = bankID
	f.deletedDocumentID = documentID
	return nil
}

func (f *fakeHindsightClient) DeleteBank(_ context.Context, bankID string) error {
	f.deletedBankID = bankID
	return nil
}

func boolPtr(value bool) *bool {
	return &value
}
