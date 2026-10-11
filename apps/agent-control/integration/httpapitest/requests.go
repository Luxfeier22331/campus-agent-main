package httpapitest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
)

func ExecutionCreateRequest(ctx context.Context, runID, conversationID, secret string) *http.Request {
	body, _ := json.Marshal(map[string]any{
		"conversation_id":                conversationID,
		"request_id":                     runID,
		"owner_user_id":                  "user-integration",
		"surface":                        "campus-web",
		"personal_memory_recall_allowed": false,
		"runtime_versions":               map[string]any{"contract": "durable-agent-runtime-contract-v1"},
		"metadata": map[string]any{
			"execution_contract_version": "tool_execution_v7",
			"execution_input_ref":        "app-api://execution-inputs/" + runID,
			"execution_input_sha256":     strings.Repeat("a", 64),
		},
	})
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/internal/execution/requests", strings.NewReader(string(body)))
	req.Header.Set("x-worker-origin-auth", secret)
	return req
}
