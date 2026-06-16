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

func TestZepCEHTTPClientUsesApiKeyAuthorization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/healthz" {
			t.Fatalf("path = %q, want /healthz", request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Api-Key ce-secret" {
			t.Fatalf("authorization = %q", got)
		}
		response.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := newZepCEHTTPClient(zepCEClientOptions{
		apiSecret: "ce-secret",
		baseURL:   server.URL,
	})
	if err := client.HealthCheck(context.Background()); err != nil {
		t.Fatalf("health check: %v", err)
	}
}

func TestZepCEAppendCompletedTurnCreatesUserSessionAndWritesMemory(t *testing.T) {
	client := &fakeZepCEClient{}
	executor := zepCEExecutor{
		client:       client,
		ownerSalt:    "test-salt",
		recallLimit:  8,
		recallMaxLen: 2500,
	}

	result, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		AssistantMessage:        "好的，我会结合保研材料准备这个目标。",
		IgnoreAssistantForGraph: true,
		RunID:                   "run-zep-ce-append",
		TenantID:                "tenant-main",
		ThreadID:                "conv-zep-ce-append",
		UserID:                  "user-executor",
		UserMessage:             "我之后主要关注保研材料",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	wantUserID := "zep_user_951609b8dfa813820b216c9ef9e76465"
	if client.createdUserID != wantUserID {
		t.Fatalf("created user id = %q, want %q", client.createdUserID, wantUserID)
	}
	wantSessionID := "zep_thread_f4bbec979b1e91073111303717dd4ce4"
	if client.createdSessionID != wantSessionID || client.createdSessionUserID != wantUserID {
		t.Fatalf("created session = %q user=%q", client.createdSessionID, client.createdSessionUserID)
	}
	if client.memorySessionID != wantSessionID {
		t.Fatalf("memory session id = %q, want %q", client.memorySessionID, wantSessionID)
	}
	if len(client.memoryMessages) != 1 {
		t.Fatalf("message count = %d, want only user message when assistant is ignored", len(client.memoryMessages))
	}
	if client.memoryMessages[0].RoleType != "user" || client.memoryMessages[0].Content != "我之后主要关注保研材料" {
		t.Fatalf("message = %#v", client.memoryMessages[0])
	}
	if result.AppendedMessageCount != 1 || result.ThreadID != "conv-zep-ce-append" || result.PayloadSHA256 == "" {
		t.Fatalf("append result = %#v", result)
	}
}

func TestZepCEAppendCompletedTurnWritesAssistantWhenNotIgnored(t *testing.T) {
	client := &fakeZepCEClient{}
	executor := zepCEExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		AssistantMessage: "好的，我会记住。",
		RunID:            "run-zep-ce-append-all",
		TenantID:         "tenant-main",
		ThreadID:         "conv-zep-ce-append-all",
		UserID:           "user-executor",
		UserMessage:      "我喜欢先看结论",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if len(client.memoryMessages) != 2 {
		t.Fatalf("message count = %d, want user and assistant", len(client.memoryMessages))
	}
	if client.memoryMessages[1].RoleType != "assistant" || client.memoryMessages[1].Content != "好的，我会记住。" {
		t.Fatalf("assistant message = %#v", client.memoryMessages[1])
	}
	if result.AppendedMessageCount != 2 {
		t.Fatalf("appended count = %d, want 2", result.AppendedMessageCount)
	}
}

func TestZepCERecallSearchesUserSessionsAndMapsFacts(t *testing.T) {
	client := &fakeZepCEClient{
		searchResults: []zepCESessionSearchResult{{
			Fact: &zepCEFact{
				CreatedAt: "2026-06-16T10:00:00Z",
				Fact:      "用户主要关注保研材料",
				Rating:    ptrFloat64(0.91),
				UUID:      "fact-001",
			},
		}},
	}
	executor := zepCEExecutor{
		client:       client,
		ownerSalt:    "test-salt",
		recallLimit:  5,
		recallMaxLen: 2500,
	}

	result, err := executor.Recall(context.Background(), memoryruntime.RecallRequest{
		RequestedCapability: "knowledge",
		RunID:               "run-zep-ce-recall",
		TenantID:            "tenant-main",
		UserGoal:            "我如何准备保研材料？",
		UserID:              "user-executor",
	})
	if err != nil {
		t.Fatalf("recall: %v", err)
	}
	wantUserID := "zep_user_951609b8dfa813820b216c9ef9e76465"
	if client.searchQuery.UserID != wantUserID || client.searchQuery.Text != "我如何准备保研材料？" {
		t.Fatalf("search query = %#v", client.searchQuery)
	}
	if client.searchLimit != 5 {
		t.Fatalf("search limit = %d, want 5", client.searchLimit)
	}
	if len(result.Items) != 1 || result.Items[0].MemoryID != "fact-001" || result.Items[0].MemoryType != "fact" {
		t.Fatalf("items = %#v", result.Items)
	}
	if !strings.Contains(result.ContextBlock, "用户主要关注保研材料") {
		t.Fatalf("context block = %q", result.ContextBlock)
	}
	if result.MemoryRef != "projection://runs/run-zep-ce-recall/memory/recall" {
		t.Fatalf("memory ref = %q", result.MemoryRef)
	}
}

func TestZepCEContextBlockRespectsRuneBudget(t *testing.T) {
	items := []memoryruntime.ContextItem{{
		CompactText: "保研材料",
		MemoryID:    "fact-001",
		MemoryType:  "fact",
		UpdatedAt:   "2026-06-16T10:00:00Z",
	}}

	block := zepCEContextBlock(items, 15)
	if block != "个人记忆:\n- 保研材料" {
		t.Fatalf("context block = %q, want Chinese memory within rune budget", block)
	}
}

func TestZepCEUpsertProfileMemoryItemUsesReservedSession(t *testing.T) {
	client := &fakeZepCEClient{}
	executor := zepCEExecutor{client: client, ownerSalt: "test-salt"}

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
	wantUserID := "zep_user_69d871a105ee9ae68b68093cedf42613"
	wantSessionID := "profile:" + wantUserID + ":mem_01HQ"
	if client.createdSessionID != wantSessionID || client.createdSessionUserID != wantUserID {
		t.Fatalf("reserved session = %q user=%q", client.createdSessionID, client.createdSessionUserID)
	}
	if len(client.memoryMessages) != 1 || client.memoryMessages[0].Content != "answer_style: 先给结论" {
		t.Fatalf("profile memory messages = %#v", client.memoryMessages)
	}
	if result.EpisodeUUID != wantSessionID || result.Status != "active" || result.PayloadSHA256 == "" {
		t.Fatalf("result = %#v", result)
	}
}

func TestZepCEDeleteProfileMemoryItemDeletesReservedSessionMemory(t *testing.T) {
	client := &fakeZepCEClient{}
	executor := zepCEExecutor{client: client}

	result, err := executor.DeleteProfileMemoryItem(context.Background(), memoryruntime.DisableProfileMemoryItemRequest{
		EpisodeUUID: "profile:zep_user_01:mem_01HQ",
		MemoryID:    "mem_01HQ",
		UpdatedAt:   "2026-06-16T11:00:00Z",
		UserID:      "user_01HQ",
	})
	if err != nil {
		t.Fatalf("profile delete: %v", err)
	}
	if client.deletedMemorySessionID != "profile:zep_user_01:mem_01HQ" {
		t.Fatalf("deleted memory session = %q", client.deletedMemorySessionID)
	}
	if result.Status != "disabled" || result.EpisodeUUID != "profile:zep_user_01:mem_01HQ" {
		t.Fatalf("result = %#v", result)
	}
}

func TestZepCEDeleteProfileMemoryOwnerDeletesScopedUser(t *testing.T) {
	client := &fakeZepCEClient{}
	executor := zepCEExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.DeleteProfileMemoryOwner(context.Background(), memoryruntime.DisableProfileMemoryOwnerRequest{
		TenantID:  "tenant-main",
		UpdatedAt: "2026-06-16T12:00:00Z",
		UserID:    "user-executor",
	})
	if err != nil {
		t.Fatalf("owner delete: %v", err)
	}
	wantUserID := "zep_user_951609b8dfa813820b216c9ef9e76465"
	if client.deletedUserID != wantUserID {
		t.Fatalf("deleted user id = %q, want %q", client.deletedUserID, wantUserID)
	}
	if result.Status != "disabled" || result.UserID != "user-executor" {
		t.Fatalf("result = %#v", result)
	}
}

func TestNewPersonalMemoryExecutorCreatesZepCEExecutor(t *testing.T) {
	executor, err := newPersonalMemoryExecutor(config.Config{
		PersonalMemoryAPISecret:      "ce-secret",
		PersonalMemoryBaseURL:        "http://zep-ce-api:8000",
		PersonalMemoryOwnerSalt:      "owner-salt",
		PersonalMemoryRecallLimit:    8,
		PersonalMemoryRecallMaxChars: 2500,
		PersonalMemoryRuntime:        "zep_ce",
		PersonalMemoryTimeoutSeconds: 10,
	}, nil)
	if err != nil {
		t.Fatalf("new personal memory executor: %v", err)
	}
	if _, ok := executor.(zepCEExecutor); !ok {
		t.Fatalf("executor type = %T, want zepCEExecutor", executor)
	}
}

func TestZepCEHTTPClientCreatesSessionPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v2/sessions" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		var payload zepCECreateSessionRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload.SessionID != "session-01" || payload.UserID == nil || *payload.UserID != "user-01" {
			t.Fatalf("payload = %#v", payload)
		}
		response.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	client := newZepCEHTTPClient(zepCEClientOptions{
		apiSecret: "ce-secret",
		baseURL:   server.URL,
	})
	if err := client.CreateSession(context.Background(), "session-01", "user-01"); err != nil {
		t.Fatalf("create session: %v", err)
	}
}

type fakeZepCEClient struct {
	createdSessionID       string
	createdSessionUserID   string
	createdUserID          string
	deletedMemorySessionID string
	deletedUserID          string
	memoryMessages         []zepCEMessage
	memorySessionID        string
	searchLimit            int
	searchQuery            zepCESessionSearchQuery
	searchResults          []zepCESessionSearchResult
}

func (f *fakeZepCEClient) HealthCheck(context.Context) error {
	return nil
}

func (f *fakeZepCEClient) GetUser(context.Context, string) error {
	return errZepCENotFound
}

func (f *fakeZepCEClient) CreateUser(_ context.Context, userID string) error {
	f.createdUserID = userID
	return nil
}

func (f *fakeZepCEClient) DeleteUser(_ context.Context, userID string) error {
	f.deletedUserID = userID
	return nil
}

func (f *fakeZepCEClient) GetSession(context.Context, string) error {
	return errZepCENotFound
}

func (f *fakeZepCEClient) CreateSession(_ context.Context, sessionID string, userID string) error {
	f.createdSessionID = sessionID
	f.createdSessionUserID = userID
	return nil
}

func (f *fakeZepCEClient) AddSessionMemory(_ context.Context, sessionID string, messages []zepCEMessage) error {
	f.memorySessionID = sessionID
	f.memoryMessages = append([]zepCEMessage{}, messages...)
	return nil
}

func (f *fakeZepCEClient) DeleteSessionMemory(_ context.Context, sessionID string) error {
	f.deletedMemorySessionID = sessionID
	return nil
}

func (f *fakeZepCEClient) SearchSessions(
	_ context.Context,
	query zepCESessionSearchQuery,
	limit int,
) ([]zepCESessionSearchResult, error) {
	f.searchQuery = query
	f.searchLimit = limit
	return f.searchResults, nil
}

func ptrFloat64(value float64) *float64 {
	return &value
}
