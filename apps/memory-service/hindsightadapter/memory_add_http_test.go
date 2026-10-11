package hindsightadapter

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"github.com/stretchr/testify/require"
)

func memoryAddHTTPRequest() memoryruntime.PersonalMemoryCommandRequest {
	return memoryruntime.PersonalMemoryCommandRequest{
		CommandID: "command-http", CommandKind: "memory_add", TenantID: "tenant", UserID: "user",
		OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion,
		SubjectID: "subject", SupersessionScope: "memory:subject", SourceUpdatedAt: "2026-10-10T00:00:00Z",
		Item: &memoryruntime.PersonalMemoryCommandItem{Text: "喜欢简洁、直接的回答"},
	}
}

func TestMemoryAddHTTPNotFoundSubmitsStableOperation(t *testing.T) {
	for _, missingStatus := range []int{http.StatusOK, http.StatusNotFound} {
		t.Run(http.StatusText(missingStatus), func(t *testing.T) {
			request := memoryAddHTTPRequest()
			executor := hindsightExecutor{ownerSalt: "salt"}
			bankID := executor.scopedBankIDForGeneration(request.TenantID, request.UserID, request.OwnerGeneration)
			operationID := executor.memoryAddOperationID(request)
			basePath := "/v1/default/banks/" + bankID
			status, submits := "not_found", 0
			var mu sync.Mutex
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				switch r.Method + " " + r.URL.Path {
				case "GET " + basePath + "/operations/" + operationID:
					require.Equal(t, "false", r.URL.Query().Get("include_payload"))
					if status == "not_found" {
						w.WriteHeader(missingStatus)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"operation_id": operationID, "status": status})
				case "GET " + basePath + "/profile":
					_ = json.NewEncoder(w).Encode(map[string]any{"bank_id": bankID, "name": "test", "disposition": map[string]any{"skepticism": 3, "literalism": 3, "empathy": 3}, "mission": ""})
				case "POST " + basePath + "/memories":
					var payload struct {
						OperationID string                `json:"operation_id"`
						Async       *bool                 `json:"async"`
						Items       []hindsightMemoryItem `json:"items"`
					}
					require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
					require.Equal(t, operationID, payload.OperationID)
					require.Equal(t, boolPointer(true), payload.Async)
					require.Len(t, payload.Items, 1)
					require.Equal(t, request.Item.Text, payload.Items[0].Content)
					submits++
					status = "processing"
					_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "bank_id": bankID, "items_count": 1, "async": true, "operation_id": operationID})
				default:
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
					w.WriteHeader(http.StatusBadRequest)
				}
			}))
			defer server.Close()
			executor.client = newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test"})

			for _, want := range []string{"processing", "processing", "succeeded", "succeeded"} {
				if want == "succeeded" {
					mu.Lock()
					status = "completed"
					mu.Unlock()
				}
				result, err := executor.ExecuteCommand(t.Context(), request)
				require.NoError(t, err)
				require.Equal(t, want, result.Status)
				mu.Lock()
				count := submits
				mu.Unlock()
				require.Equal(t, 1, count)
			}
		})
	}
}

func TestMemoryAddHTTPQueryFailureDoesNotSubmit(t *testing.T) {
	for _, status := range []int{http.StatusGatewayTimeout, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, http.MethodGet, r.Method)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"detail":"unavailable"}`))
			}))
			defer server.Close()
			executor := hindsightExecutor{ownerSalt: "salt", client: newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test"})}
			result, err := executor.ExecuteCommand(t.Context(), memoryAddHTTPRequest())
			require.NoError(t, err)
			require.Equal(t, "unknown", result.Status)
		})
	}
}
