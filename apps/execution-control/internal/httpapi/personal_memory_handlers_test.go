package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProfileMemoryUpsertEndpointWritesHindsightDocument(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/items:upsert",
		strings.NewReader(`{
			"memory_id":"mem_01HQ",
			"canonical_subject":"answer_style",
			"compact_text":"answer_style: 先给结论",
			"tenant_id":"tenant-main",
			"updated_at":"2026-06-16T10:00:00Z",
			"user_id":"user_01HQ"
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s, want 202", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["schema_version"] != "memory_profile_item_result_v1" ||
		body["status"] != "active" ||
		body["memory_id"] != "mem_01HQ" ||
		body["episode_uuid"] != "episode-mem_01HQ" {
		t.Fatalf("body = %#v", body)
	}
	if executor.seenProfileUpsert.UserID != "user_01HQ" ||
		executor.seenProfileUpsert.TenantID != "tenant-main" ||
		executor.seenProfileUpsert.CompactText != "answer_style: 先给结论" {
		t.Fatalf("seen upsert = %#v", executor.seenProfileUpsert)
	}
}

func TestProfileMemoryDisableEndpointDeletesHindsightDocument(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/items:disable",
		strings.NewReader(`{
			"episode_uuid":"episode-mem_01HQ",
			"memory_id":"mem_01HQ",
			"updated_at":"2026-06-16T11:00:00Z",
			"user_id":"user_01HQ"
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s, want 202", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["schema_version"] != "memory_profile_item_result_v1" ||
		body["status"] != "disabled" ||
		body["episode_uuid"] != "episode-mem_01HQ" {
		t.Fatalf("body = %#v", body)
	}
	if executor.seenProfileDisable.EpisodeUUID != "episode-mem_01HQ" {
		t.Fatalf("seen disable = %#v", executor.seenProfileDisable)
	}
}

func TestProfileMemoryOwnerDisableEndpointDeletesHindsightBank(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/owner:disable",
		strings.NewReader(`{
			"tenant_id":"tenant-main",
			"updated_at":"2026-06-16T12:00:00Z",
			"user_id":"user_01HQ"
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s, want 202", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["schema_version"] != "memory_profile_owner_disable_result_v1" ||
		body["status"] != "disabled" ||
		body["user_id"] != "user_01HQ" {
		t.Fatalf("body = %#v", body)
	}
	if executor.seenOwnerDisable.UserID != "user_01HQ" ||
		executor.seenOwnerDisable.TenantID != "tenant-main" {
		t.Fatalf("seen owner disable = %#v", executor.seenOwnerDisable)
	}
}

func TestProfileMemoryAppendEndpointAddsCompletedTurn(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/turns:append",
		strings.NewReader(`{
			"assistant_message":"可以，我会优先结合丰台校区培养方案回答。",
			"ignore_assistant_for_graph":true,
			"run_id":"run-hindsight-live-smoke",
			"tenant_id":"tenant-main",
			"thread_id":"conv-hindsight-live-smoke",
			"user_id":"user_01HQ",
			"user_message":"我主要关注丰台校区培养方案"
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s, want 202", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["schema_version"] != "memory_conversation_append_result_v1" ||
		body["status"] != "accepted" ||
		body["thread_id"] != "conv-hindsight-live-smoke" {
		t.Fatalf("body = %#v", body)
	}
	if executor.seenAppend.TenantID != "tenant-main" ||
		executor.seenAppend.UserID != "user_01HQ" ||
		executor.seenAppend.ThreadID != "conv-hindsight-live-smoke" ||
		!executor.seenAppend.IgnoreAssistantForGraph {
		t.Fatalf("seen append = %#v", executor.seenAppend)
	}
}

func TestProfileMemoryRecallEndpointRecallsHindsightMemory(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/graph:recall",
		strings.NewReader(`{
			"requested_tool":"knowledge_query",
			"run_id":"run-hindsight-live-recall",
			"tenant_id":"tenant-main",
			"thread_id":"conv-hindsight-live-recall",
			"user_goal":"丰台校区培养方案怎么查？",
			"user_id":"user_01HQ"
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s, want 202", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["schema_version"] != "memory_recall_result_v1" ||
		body["memory_ref"] != "projection://runs/run-hindsight-live-recall/memory/recall" {
		t.Fatalf("body = %#v", body)
	}
	if executor.seenRequest.TenantID != "tenant-main" ||
		executor.seenRequest.ThreadID != "conv-hindsight-live-recall" ||
		executor.seenRequest.UserID != "user_01HQ" ||
		executor.seenRequest.UserGoal != "丰台校区培养方案怎么查？" {
		t.Fatalf("seen recall = %#v", executor.seenRequest)
	}
}

func TestProfileMemoryEndpointRequiresWorkerAuth(t *testing.T) {
	server := newWorkerAuthServerForTest()
	response := httptest.NewRecorder()

	server.ServeHTTP(
		response,
		newTestRequest(http.MethodPost, "/internal/memory/personal/items:upsert", strings.NewReader(`{}`)),
	)

	assertError(t, response, http.StatusUnauthorized, "unauthorized")
}
