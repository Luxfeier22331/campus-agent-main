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
			"user_message":"我主要关注丰台校区培养方案",
			"user_message_created_at":"2026-06-16T10:03:04Z"
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
		executor.seenAppend.UserMessageCreatedAt != "2026-06-16T10:03:04Z" ||
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
			"query_timestamp":"2026-06-16T10:03:04Z",
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

func TestProfileMemoryOperationStatusEndpointChecksHindsightOperation(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/operations:status",
		strings.NewReader(`{
			"operation_id":"op-retain-001",
			"run_id":"run-hindsight-live-status",
			"tenant_id":"tenant-main",
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
	if body["schema_version"] != "memory_operation_status_result_v1" ||
		body["status"] != "completed" ||
		body["operation_id"] != "op-retain-001" ||
		body["operation_ref"] != "projection://runs/run-hindsight-live-status/memory/operations/op-retain-001" {
		t.Fatalf("body = %#v", body)
	}
	if executor.seenOperationStatus.TenantID != "tenant-main" ||
		executor.seenOperationStatus.UserID != "user_01HQ" ||
		executor.seenOperationStatus.OperationID != "op-retain-001" {
		t.Fatalf("seen operation status = %#v", executor.seenOperationStatus)
	}
}

func TestProfileMemoryOperationListEndpointListsSanitizedHindsightOperations(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/operations:list",
		strings.NewReader(`{
			"exclude_parents":true,
			"limit":20,
			"operation_type":"retain",
			"run_id":"run-hindsight-live-list",
			"status":"failed",
			"tenant_id":"tenant-main",
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
	if body["schema_version"] != "memory_operation_list_result_v1" ||
		body["total"] != float64(1) ||
		body["payload_sha256"] == "" {
		t.Fatalf("body = %#v", body)
	}
	operations, ok := body["operations"].([]any)
	if !ok || len(operations) != 1 {
		t.Fatalf("operations = %#v", body["operations"])
	}
	first, ok := operations[0].(map[string]any)
	if !ok ||
		first["operation_id"] != "op-retain-001" ||
		first["operation_ref"] != "projection://runs/run-hindsight-live-list/memory/operations/op-retain-001" ||
		first["operation_type"] != "retain" ||
		first["status"] != "failed" {
		t.Fatalf("operation = %#v", operations[0])
	}
	if _, exists := first["bank_id"]; exists {
		t.Fatalf("operation leaks bank_id: %#v", first)
	}
	if executor.seenOperationList.TenantID != "tenant-main" ||
		executor.seenOperationList.UserID != "user_01HQ" ||
		executor.seenOperationList.RunID != "run-hindsight-live-list" ||
		executor.seenOperationList.Status != "failed" ||
		executor.seenOperationList.OperationType != "retain" ||
		!executor.seenOperationList.ExcludeParents {
		t.Fatalf("seen operation list = %#v", executor.seenOperationList)
	}
}

func TestProfileMemoryOperationCancelEndpointCancelsHindsightOperation(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/operations:cancel",
		strings.NewReader(`{
			"operation_id":"op-retain-001",
			"run_id":"run-hindsight-live-cancel",
			"tenant_id":"tenant-main",
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
	if body["schema_version"] != "memory_operation_action_result_v1" ||
		body["action"] != "cancel" ||
		body["operation_id"] != "op-retain-001" ||
		body["operation_ref"] != "projection://runs/run-hindsight-live-cancel/memory/operations/op-retain-001" ||
		body["success"] != true {
		t.Fatalf("body = %#v", body)
	}
	if executor.seenOperationCancel.TenantID != "tenant-main" ||
		executor.seenOperationCancel.UserID != "user_01HQ" ||
		executor.seenOperationCancel.OperationID != "op-retain-001" {
		t.Fatalf("seen operation cancel = %#v", executor.seenOperationCancel)
	}
}

func TestProfileMemoryOperationRetryEndpointRetriesHindsightOperation(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/operations:retry",
		strings.NewReader(`{
			"operation_id":"op-retain-001",
			"run_id":"run-hindsight-live-retry",
			"tenant_id":"tenant-main",
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
	if body["schema_version"] != "memory_operation_action_result_v1" ||
		body["action"] != "retry" ||
		body["operation_id"] != "op-retain-001" ||
		body["operation_ref"] != "projection://runs/run-hindsight-live-retry/memory/operations/op-retain-001" ||
		body["success"] != true {
		t.Fatalf("body = %#v", body)
	}
	if executor.seenOperationRetry.TenantID != "tenant-main" ||
		executor.seenOperationRetry.UserID != "user_01HQ" ||
		executor.seenOperationRetry.OperationID != "op-retain-001" {
		t.Fatalf("seen operation retry = %#v", executor.seenOperationRetry)
	}
}

func TestProfileMemoryReflectEndpointReadsHindsightMemoryGraph(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := newWorkerAuthServerForTest()
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/graph:reflect",
		strings.NewReader(`{
			"context":"本轮用户在问培养方案检索。",
			"include_based_on":true,
			"query":"总结用户长期偏好",
			"run_id":"run-hindsight-live-reflect",
			"tenant_id":"tenant-main",
			"thread_id":"conv-hindsight-live-reflect",
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
	if body["schema_version"] != "memory_reflect_result_v1" ||
		body["status"] != "completed" ||
		body["reflect_ref"] != "projection://runs/run-hindsight-live-reflect/memory/reflect" ||
		body["text"] != "用户偏好先给结论。" {
		t.Fatalf("body = %#v", body)
	}
	if executor.seenReflect.TenantID != "tenant-main" ||
		executor.seenReflect.ThreadID != "conv-hindsight-live-reflect" ||
		executor.seenReflect.UserID != "user_01HQ" ||
		executor.seenReflect.Query != "总结用户长期偏好" ||
		!executor.seenReflect.IncludeBasedOn {
		t.Fatalf("seen reflect = %#v", executor.seenReflect)
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
