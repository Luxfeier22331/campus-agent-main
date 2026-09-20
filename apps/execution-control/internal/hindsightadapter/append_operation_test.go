package hindsightadapter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/stretchr/testify/require"
)

func asyncAppendRequest() memoryruntime.AppendConversationTurnRequest {
	return memoryruntime.AppendConversationTurnRequest{
		RequestID: "req-async", TenantID: "tenant", UserID: "user", OwnerGeneration: 1,
		ThreadID: "conversation", UserMessageID: "message", UserMessage: "我偏好简短回答",
		UserMessageCreatedAt: "2026-09-19T00:00:00Z",
	}
}

func TestAsyncRetainLostAcknowledgementReusesTaskAndQueriesWithoutPayload(t *testing.T) {
	var mu sync.Mutex
	tasks := map[string]bool{}
	submits, queries := 0, 0
	bankID := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/profile") {
			_ = json.NewEncoder(w).Encode(map[string]any{"bank_id": bankID, "name": "test", "disposition": map[string]any{"skepticism": 3, "literalism": 3, "empathy": 3}, "mission": ""})
			return
		}
		if r.Method == http.MethodPost {
			var payload struct {
				Async       bool                  `json:"async"`
				OperationID string                `json:"operation_id"`
				Items       []hindsightMemoryItem `json:"items"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
			require.True(t, payload.Async)
			require.NotEmpty(t, payload.OperationID)
			require.Len(t, payload.Items, 1)
			require.Equal(t, "replace", payload.Items[0].UpdateMode)
			require.Equal(t, [][]string{{"scope:private"}}, payload.Items[0].ObservationScopes)
			tasks[payload.OperationID] = true
			submits++
			if submits == 1 {
				// Accepted, but the HTTP acknowledgement never reaches the caller.
				connection, _, err := w.(http.Hijacker).Hijack()
				require.NoError(t, err)
				_ = connection.Close()
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "bank_id": bankID, "items_count": 1, "async": true, "operation_id": payload.OperationID})
			return
		}
		require.Equal(t, "false", r.URL.Query().Get("include_payload"))
		parts := strings.Split(r.URL.Path, "/")
		id := parts[len(parts)-1]
		require.True(t, tasks[id])
		queries++
		_ = json.NewEncoder(w).Encode(map[string]any{"operation_id": id, "status": "completed"})
	}))
	defer server.Close()
	executor := hindsightExecutor{client: newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test", timeout: time.Second}), ownerSalt: "salt"}
	request := asyncAppendRequest()
	bankID = executor.scopedBankIDForGeneration(request.TenantID, request.UserID, request.OwnerGeneration)
	_, err := executor.SubmitConversationTurn(context.Background(), request)
	require.Error(t, err)
	result, err := executor.SubmitConversationTurn(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, "pending", result.Status)
	result, err = executor.GetConversationTurnOperation(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, "completed", result.Status)
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, tasks, 1)
	require.Equal(t, 2, submits)
	require.Equal(t, 1, queries)
}

func TestAsyncRetainIdentityFollowsMessageAndGeneration(t *testing.T) {
	executor := hindsightExecutor{ownerSalt: "salt"}
	request := asyncAppendRequest()
	id := executor.appendOperationID(request)
	request.RequestID = "transport-retry"
	require.Equal(t, id, executor.appendOperationID(request))
	request.OwnerGeneration++
	require.NotEqual(t, id, executor.appendOperationID(request))
}

func TestOperationFailureDiagnostics(t *testing.T) {
	for _, test := range []struct {
		message string
		detail  string
		status  int
	}{
		{"Error code: 503 upstream unavailable", "Hindsight reported an upstream HTTP failure during retain processing.", 503},
		{"Connection timed out", "Hindsight reported a timeout during retain processing.", 0},
		{"", "Hindsight retain operation failed.", 0},
	} {
		t.Run(test.message, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"operation_id": "operation", "status": "failed", "error_message": test.message})
			}))
			defer server.Close()
			client := newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test"})
			result, err := client.GetOperation(t.Context(), "bank", "operation")
			require.NoError(t, err)
			require.Equal(t, "hindsight_append_failed", result.ErrorCode)
			require.Equal(t, test.detail, result.ErrorDetail)
			require.Equal(t, test.status, result.HTTPStatus)
		})
	}
}

func TestOperationWaitsForActiveChildrenAndPreservesUnknown(t *testing.T) {
	for _, test := range []struct{ status, child, want string }{
		{"failed", "processing", "processing"},
		{"completed", "completed", "completed"},
		{"failed", "failed", "failed"},
		{"not_found", "", "not_found"},
	} {
		t.Run(test.status+"-"+test.child, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				children := []map[string]any{}
				if test.child != "" {
					children = append(children, map[string]any{"operation_id": "child", "status": test.child})
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"operation_id": "operation", "status": test.status, "child_operations": children})
			}))
			defer server.Close()
			client := newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test"})
			result, err := client.GetOperation(context.Background(), "bank", "operation")
			require.NoError(t, err)
			require.Equal(t, test.want, result.Status)
		})
	}
}
