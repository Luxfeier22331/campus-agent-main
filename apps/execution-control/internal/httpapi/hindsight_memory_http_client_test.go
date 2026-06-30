package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
			payload.Items[0].Timestamp != "2026-06-16T10:03:04Z" ||
			payload.Items[0].Metadata["source"] != "test" {
			t.Fatalf("item = %#v", payload.Items[0])
		}
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte(`{"success":true,"bank_id":"bank-01","items_count":1,"async":true,"operation_id":"op-retain-http"}`))
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{
		apiSecret: "hindsight-secret",
		baseURL:   server.URL,
	})
	result, err := client.RetainMemories(context.Background(), "bank-01", hindsightRetainRequest{
		Async: boolPtr(true),
		Items: []hindsightMemoryItem{{
			Content:    "hello",
			DocumentID: "conversation:doc-01",
			Metadata:   map[string]string{"source": "test"},
			Timestamp:  "2026-06-16T10:03:04Z",
		}},
	})
	if err != nil {
		t.Fatalf("retain: %v", err)
	}
	if !result.Async || result.OperationID != "op-retain-http" {
		t.Fatalf("retain result = %#v", result)
	}
}

func TestHindsightHTTPClientEnsureBankCreatesConfiguresAndVerifiesMemoryDefense(t *testing.T) {
	seen := make([]string, 0, 3)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		seen = append(seen, request.Method+" "+request.URL.Path)
		if request.Header.Get("Authorization") != "Bearer hindsight-secret" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		response.Header().Set("Content-Type", "application/json")
		switch request.Method + " " + request.URL.Path {
		case "PUT /v1/default/banks/bank-01":
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode create bank: %v", err)
			}
			if payload["name"] != "campus-agent personal memory" {
				t.Fatalf("create payload = %#v", payload)
			}
			response.WriteHeader(http.StatusOK)
			_, _ = response.Write([]byte(`{"bank_id":"bank-01","name":"campus-agent personal memory","disposition":{"skepticism":3,"literalism":3,"empathy":3},"mission":"memory"}`))
		case "PATCH /v1/default/banks/bank-01/config":
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode config update: %v", err)
			}
			updates, ok := payload["updates"].(map[string]any)
			if !ok {
				t.Fatalf("updates = %#v", payload["updates"])
			}
			assertMemoryDefensePayload(t, updates)
			response.WriteHeader(http.StatusOK)
			_, _ = response.Write([]byte(`{
				"bank_id":"bank-01",
				"config":{"memory_defense":{"enabled":true,"rules":[{"on":"sensitive_data","action":"redact"}]}},
				"overrides":{"memory_defense":{"enabled":true,"rules":[{"on":"sensitive_data","action":"redact"}]}}
			}`))
		case "GET /v1/default/banks/bank-01/config":
			response.WriteHeader(http.StatusOK)
			_, _ = response.Write([]byte(`{
				"bank_id":"bank-01",
				"config":{"memory_defense":{"enabled":true,"rules":[{"on":"sensitive_data","action":"redact"}]}},
				"overrides":{"memory_defense":{"enabled":true,"rules":[{"on":"sensitive_data","action":"redact"}]}}
			}`))
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{
		apiSecret: "hindsight-secret",
		baseURL:   server.URL,
	})
	if err := client.EnsureBank(context.Background(), "bank-01", defaultHindsightBankConfig()); err != nil {
		t.Fatalf("ensure bank: %v", err)
	}
	want := []string{
		"PUT /v1/default/banks/bank-01",
		"PATCH /v1/default/banks/bank-01/config",
		"GET /v1/default/banks/bank-01/config",
	}
	if strings.Join(seen, "|") != strings.Join(want, "|") {
		t.Fatalf("requests = %#v, want %#v", seen, want)
	}
}

func TestHindsightHTTPClientRecallPayloadIncludesQueryTimestamp(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/default/banks/bank-01/memories/recall" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		var payload hindsightRecallRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload.Query != "保研材料" ||
			payload.QueryTimestamp != "2026-06-16T10:03:04Z" ||
			payload.TagsMatch != "all_strict" {
			t.Fatalf("recall payload = %#v", payload)
		}
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte(`{"results":[]}`))
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{
		apiSecret: "hindsight-secret",
		baseURL:   server.URL,
	})
	if _, err := client.RecallMemories(context.Background(), "bank-01", hindsightRecallRequest{
		Query:          "保研材料",
		QueryTimestamp: "2026-06-16T10:03:04Z",
		TagsMatch:      "all_strict",
	}); err != nil {
		t.Fatalf("recall: %v", err)
	}
}

func TestHindsightHTTPClientOperationLifecyclePayloads(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer hindsight-secret" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		response.Header().Set("Content-Type", "application/json")
		switch request.Method + " " + request.URL.Path {
		case "GET /v1/default/banks/bank-01/operations/op-retain-001":
			if request.URL.Query().Get("include_payload") != "false" {
				t.Fatalf("operation status query = %s", request.URL.RawQuery)
			}
			response.WriteHeader(http.StatusOK)
			_, _ = response.Write([]byte(`{
				"operation_id":"op-retain-001",
				"operation_type":"retain",
				"created_at":"2026-06-16T10:00:00Z",
				"updated_at":"2026-06-16T10:02:00Z",
				"status":"completed",
				"retry_count":0
			}`))
		case "GET /v1/default/banks/bank-01/operations":
			if request.URL.Query().Get("status") != "failed" ||
				request.URL.Query().Get("type") != "retain" ||
				request.URL.Query().Get("limit") != "10" ||
				request.URL.Query().Get("offset") != "5" ||
				request.URL.Query().Get("exclude_parents") != "true" {
				t.Fatalf("query = %s", request.URL.RawQuery)
			}
			response.WriteHeader(http.StatusOK)
			_, _ = response.Write([]byte(`{
				"bank_id":"bank-01",
				"total":1,
				"limit":10,
				"offset":5,
				"operations":[{
					"id":"op-retain-001",
					"task_type":"retain",
					"items_count":2,
					"created_at":"2026-06-16T10:00:00Z",
					"updated_at":"2026-06-16T10:02:00Z",
					"status":"failed",
					"error_message":"provider timeout",
					"retry_count":1
				}]
			}`))
		case "DELETE /v1/default/banks/bank-01/operations/op-retain-001":
			response.WriteHeader(http.StatusOK)
			_, _ = response.Write([]byte(`{"success":true,"message":"cancelled","operation_id":"op-retain-001"}`))
		case "POST /v1/default/banks/bank-01/operations/op-retain-001/retry":
			response.WriteHeader(http.StatusOK)
			_, _ = response.Write([]byte(`{"success":true,"message":"requeued","operation_id":"op-retain-001"}`))
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
		}
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{
		apiSecret: "hindsight-secret",
		baseURL:   server.URL,
	})
	list, err := client.ListOperations(context.Background(), "bank-01", hindsightOperationListRequest{
		ExcludeParents: true,
		Limit:          10,
		Offset:         5,
		OperationType:  "retain",
		Status:         "failed",
	})
	if err != nil {
		t.Fatalf("list operations: %v", err)
	}
	if list.Total != 1 ||
		list.Limit != 10 ||
		list.Offset != 5 ||
		len(list.Operations) != 1 ||
		list.Operations[0].OperationID != "op-retain-001" ||
		list.Operations[0].OperationType != "retain" ||
		list.Operations[0].RetryCount != 1 {
		t.Fatalf("list = %#v", list)
	}
	status, err := client.OperationStatus(context.Background(), "bank-01", "op-retain-001")
	if err != nil {
		t.Fatalf("operation status: %v", err)
	}
	if status.OperationID != "op-retain-001" || status.Status != "completed" {
		t.Fatalf("status = %#v", status)
	}
	cancelled, err := client.CancelOperation(context.Background(), "bank-01", "op-retain-001")
	if err != nil {
		t.Fatalf("cancel operation: %v", err)
	}
	if !cancelled.Success || cancelled.OperationID != "op-retain-001" || cancelled.Message != "cancelled" {
		t.Fatalf("cancelled = %#v", cancelled)
	}
	retried, err := client.RetryOperation(context.Background(), "bank-01", "op-retain-001")
	if err != nil {
		t.Fatalf("retry operation: %v", err)
	}
	if !retried.Success || retried.OperationID != "op-retain-001" || retried.Message != "requeued" {
		t.Fatalf("retried = %#v", retried)
	}
}

func assertMemoryDefensePayload(t *testing.T, updates map[string]any) {
	t.Helper()
	rawDefense, ok := updates["memory_defense"].(map[string]any)
	if !ok {
		t.Fatalf("memory_defense = %#v", updates["memory_defense"])
	}
	if rawDefense["enabled"] != true {
		t.Fatalf("memory_defense.enabled = %#v", rawDefense["enabled"])
	}
	rules, ok := rawDefense["rules"].([]any)
	if !ok || len(rules) != 1 {
		t.Fatalf("memory_defense.rules = %#v", rawDefense["rules"])
	}
	rule, ok := rules[0].(map[string]any)
	if !ok ||
		rule["on"] != "sensitive_data" ||
		rule["action"] != "redact" {
		t.Fatalf("memory_defense rule = %#v", rules[0])
	}
}
