package httpapi

import (
	"context"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	zep "github.com/getzep/zep-go/v3"
)

func TestZepMemoryRecallUsesAutoGraphSearchAndMapsContextRefs(t *testing.T) {
	client := &fakeZepMemoryClient{
		searchResult: &zep.GraphSearchResults{
			Context: ptrString("用户上下文:\n- 用户主要关注保研材料。"),
			Edges: []*zep.EntityEdge{{
				CreatedAt: "2026-06-01T00:00:00Z",
				Fact:      "用户主要关注保研材料",
				Score:     ptrFloat64(0.91),
				UUID:      "edge-001",
			}},
		},
	}
	executor := zepMemoryExecutor{
		client:   client,
		maxChars: 1200,
	}

	result, err := executor.Recall(context.Background(), memoryruntime.RecallRequest{
		RequestedCapability: "knowledge",
		RunID:               "run-zep-recall",
		TenantID:            "tenant-main",
		UserGoal:            "我如何准备保研材料？",
		UserID:              "user-executor",
	})
	if err != nil {
		t.Fatalf("zep recall: %v", err)
	}
	if client.seenSearch == nil {
		t.Fatal("graph search was not called")
	}
	if client.seenSearch.UserID == nil || *client.seenSearch.UserID != "tenant-main:user-executor" {
		t.Fatalf("search user id = %#v", client.seenSearch.UserID)
	}
	if client.seenSearch.Scope == nil || *client.seenSearch.Scope != zep.GraphSearchScopeAuto {
		t.Fatalf("search scope = %#v, want auto", client.seenSearch.Scope)
	}
	if client.seenSearch.ReturnRawResults == nil || !*client.seenSearch.ReturnRawResults {
		t.Fatalf("return_raw_results = %#v, want true", client.seenSearch.ReturnRawResults)
	}
	if result.ContextBlock != "用户上下文:\n- 用户主要关注保研材料。" {
		t.Fatalf("context block = %q", result.ContextBlock)
	}
	if len(result.Items) != 1 || result.Items[0].MemoryID != "edge-001" || result.Items[0].MemoryType != "edge" {
		t.Fatalf("items = %#v", result.Items)
	}
	if result.MemoryRef != "projection://runs/run-zep-recall/memory/recall" {
		t.Fatalf("memory ref = %q", result.MemoryRef)
	}
}

func TestZepMemoryAppendCompletedTurnUsesThreadMessagesAndIgnoresAssistantForGraph(t *testing.T) {
	client := &fakeZepMemoryClient{}
	executor := zepMemoryExecutor{
		assistantName: "校园助理",
		client:        client,
		projectSalt:   "test-salt",
		userName:      "学生",
	}

	result, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		AssistantMessage:        "好的，我会结合保研材料准备这个目标。",
		IgnoreAssistantForGraph: true,
		RunID:                   "run-zep-append",
		TenantID:                "tenant-main",
		ThreadID:                "conv-zep-append",
		UserID:                  "user-executor",
		UserMessage:             "我之后主要关注保研材料",
	})
	if err != nil {
		t.Fatalf("zep append: %v", err)
	}
	wantUserID := "zep_user_951609b8dfa813820b216c9ef9e76465"
	if client.seenUserID != wantUserID {
		t.Fatalf("ensure user id = %q", client.seenUserID)
	}
	wantThreadID := "zep_thread_b1e9f102bccd7fcba9bef16d6a85e430"
	if client.seenThreadID != wantThreadID || client.seenThreadUserID != wantUserID {
		t.Fatalf("ensure thread = %q user=%q", client.seenThreadID, client.seenThreadUserID)
	}
	if len(client.seenMessages) != 2 {
		t.Fatalf("message count = %d, want 2", len(client.seenMessages))
	}
	if client.seenMessages[0].Role != zep.RoleTypeUserRole ||
		client.seenMessages[0].Content != "我之后主要关注保研材料" {
		t.Fatalf("user message = %#v", client.seenMessages[0])
	}
	if client.seenMessages[1].Role != zep.RoleTypeAssistantRole ||
		client.seenMessages[1].Content != "好的，我会结合保研材料准备这个目标。" {
		t.Fatalf("assistant message = %#v", client.seenMessages[1])
	}
	if len(client.seenIgnoreRoles) != 1 || client.seenIgnoreRoles[0] != zep.RoleTypeAssistantRole {
		t.Fatalf("ignore roles = %#v", client.seenIgnoreRoles)
	}
	if result.AppendedMessageCount != 2 || result.PayloadSHA256 == "" {
		t.Fatalf("append result = %#v", result)
	}
}

func TestZepMemoryAppendDerivesScopedUserFromTenantAndSalt(t *testing.T) {
	client := &fakeZepMemoryClient{}
	executor := zepMemoryExecutor{
		client:      client,
		projectSalt: "test-salt",
	}

	_, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		AssistantMessage:        "好的，我会记住这个偏好。",
		IgnoreAssistantForGraph: true,
		RunID:                   "run-zep-append-scoped",
		TenantID:                "tenant-main",
		ThreadID:                "conv-zep-append-scoped",
		UserID:                  "user-executor",
		UserMessage:             "我之后主要关注保研材料",
	})
	if err != nil {
		t.Fatalf("zep append: %v", err)
	}
	wantUserID := "zep_user_951609b8dfa813820b216c9ef9e76465"
	if client.seenUserID != wantUserID {
		t.Fatalf("ensure user id = %q, want %q", client.seenUserID, wantUserID)
	}
	if client.seenThreadUserID != wantUserID {
		t.Fatalf("thread user id = %q, want %q", client.seenThreadUserID, wantUserID)
	}
}

func TestZepMemoryAppendDerivesInternalThreadID(t *testing.T) {
	client := &fakeZepMemoryClient{}
	executor := zepMemoryExecutor{
		client:      client,
		projectSalt: "test-salt",
	}

	result, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		AssistantMessage:        "好的，我会记住这个偏好。",
		IgnoreAssistantForGraph: true,
		RunID:                   "run-zep-append-thread",
		TenantID:                "tenant-main",
		ThreadID:                "conv-shared-client-id",
		UserID:                  "user-executor",
		UserMessage:             "我之后主要关注保研材料",
	})
	if err != nil {
		t.Fatalf("zep append: %v", err)
	}
	wantThreadID := "zep_thread_777c7b103c8ea91a1b95a02e9b4a27ab"
	if client.seenThreadID != wantThreadID {
		t.Fatalf("thread id = %q, want %q", client.seenThreadID, wantThreadID)
	}
	if result.ThreadID != "conv-shared-client-id" {
		t.Fatalf("projected thread id = %q, want product conversation id", result.ThreadID)
	}
}

func TestZepMemoryUpsertProfileMemoryItemWritesUserGraphEpisode(t *testing.T) {
	client := &fakeZepMemoryClient{}
	executor := zepMemoryExecutor{client: client}

	result, err := executor.UpsertProfileMemoryItem(context.Background(), memoryruntime.UpsertProfileMemoryItemRequest{
		CanonicalSubject: "answer_style",
		CompactText:      "answer_style: 先给结论",
		MemoryID:         "mem_01HQ",
		TenantID:         "tenant-main",
		UpdatedAt:        "2026-06-16T10:00:00Z",
		UserID:           "user_01HQ",
	})
	if err != nil {
		t.Fatalf("zep profile upsert: %v", err)
	}
	if client.seenGraphData == nil {
		t.Fatal("graph add data was not called")
	}
	if client.seenGraphData.UserID == nil || *client.seenGraphData.UserID != "tenant-main:user_01HQ" {
		t.Fatalf("graph user id = %#v", client.seenGraphData.UserID)
	}
	if client.seenGraphData.Data != "answer_style: 先给结论" ||
		client.seenGraphData.Type != zep.GraphDataTypeText {
		t.Fatalf("graph data = %#v", client.seenGraphData)
	}
	if client.seenGraphData.Metadata["memory_id"] != "mem_01HQ" ||
		client.seenGraphData.Metadata["canonical_subject"] != "answer_style" ||
		client.seenGraphData.Metadata["source"] != "explicit_profile_memory" {
		t.Fatalf("metadata = %#v", client.seenGraphData.Metadata)
	}
	if result.EpisodeUUID != "episode-zep-profile" ||
		result.Status != "active" ||
		result.PayloadSHA256 == "" {
		t.Fatalf("result = %#v", result)
	}
}

func TestZepMemoryDeleteProfileMemoryItemDeletesEpisode(t *testing.T) {
	client := &fakeZepMemoryClient{}
	executor := zepMemoryExecutor{client: client}

	result, err := executor.DeleteProfileMemoryItem(context.Background(), memoryruntime.DisableProfileMemoryItemRequest{
		EpisodeUUID: "episode-zep-profile",
		MemoryID:    "mem_01HQ",
		UpdatedAt:   "2026-06-16T11:00:00Z",
		UserID:      "user_01HQ",
	})
	if err != nil {
		t.Fatalf("zep profile delete: %v", err)
	}
	if client.seenDeletedEpisodeUUID != "episode-zep-profile" {
		t.Fatalf("deleted episode = %q", client.seenDeletedEpisodeUUID)
	}
	if result.Status != "disabled" || result.EpisodeUUID != "episode-zep-profile" {
		t.Fatalf("result = %#v", result)
	}
}

func TestNewZepMemoryExecutorRequiresConfigInDeployedContextRole(t *testing.T) {
	_, err := newZepMemoryExecutor(config.Config{
		RuntimeProfile: "staging",
	})
	if err == nil {
		t.Fatal("expected missing Zep config error")
	}
}

type fakeZepMemoryClient struct {
	searchResult           *zep.GraphSearchResults
	seenDeletedEpisodeUUID string
	seenDeletedUserID      string
	seenGraphData          *zep.AddDataRequest
	seenIgnoreRoles        []zep.RoleType
	seenMessages           []*zep.Message
	seenSearch             *zep.GraphSearchQuery
	seenThreadID           string
	seenThreadUserID       string
	seenUserID             string
}

func (f *fakeZepMemoryClient) HealthCheck(context.Context) error {
	return nil
}

func (f *fakeZepMemoryClient) EnsureUser(_ context.Context, userID string) error {
	f.seenUserID = userID
	return nil
}

func (f *fakeZepMemoryClient) EnsureThread(_ context.Context, threadID string, userID string) error {
	f.seenThreadID = threadID
	f.seenThreadUserID = userID
	return nil
}

func (f *fakeZepMemoryClient) SearchGraph(
	_ context.Context,
	query *zep.GraphSearchQuery,
) (*zep.GraphSearchResults, error) {
	f.seenSearch = query
	return f.searchResult, nil
}

func (f *fakeZepMemoryClient) AddThreadMessages(
	_ context.Context,
	threadID string,
	request *zep.AddThreadMessagesRequest,
) (*zep.AddThreadMessagesResponse, error) {
	f.seenThreadID = threadID
	f.seenIgnoreRoles = append([]zep.RoleType{}, request.IgnoreRoles...)
	f.seenMessages = append([]*zep.Message{}, request.Messages...)
	return &zep.AddThreadMessagesResponse{MessageUUIDs: []string{"msg-user", "msg-assistant"}}, nil
}

func (f *fakeZepMemoryClient) AddGraphData(
	_ context.Context,
	request *zep.AddDataRequest,
) (*zep.Episode, error) {
	f.seenGraphData = request
	return &zep.Episode{UUID: "episode-zep-profile"}, nil
}

func (f *fakeZepMemoryClient) DeleteEpisode(_ context.Context, episodeUUID string) error {
	f.seenDeletedEpisodeUUID = episodeUUID
	return nil
}

func (f *fakeZepMemoryClient) DeleteUser(_ context.Context, userID string) error {
	f.seenDeletedUserID = userID
	return nil
}

func ptrString(value string) *string {
	return &value
}

func ptrFloat64(value float64) *float64 {
	return &value
}
