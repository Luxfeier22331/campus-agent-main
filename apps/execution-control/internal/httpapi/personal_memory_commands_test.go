package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

type memoryCommandStarterStub struct {
	inputs []memoryapplication.PersonalMemoryCommandInput
	err    error
}

func (s *memoryCommandStarterStub) StartPersonalMemoryCommandWorkflow(_ context.Context, input memoryapplication.PersonalMemoryCommandInput) error {
	s.inputs = append(s.inputs, input)
	return s.err
}

func TestMemoryCommandAdmissionUsesManagementBoundary(t *testing.T) {
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID: " command-1 ", CommandKind: "owner_transition", LifecycleState: "paused",
		OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt: "2026-10-10T00:00:00Z", SupersessionScope: "owner:lifecycle", TenantID: "tenant-main", UserID: "user",
	}
	body, err := json.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name                string
		unavailable, failed bool
		code                int
		errorCode           string
	}{
		{name: "accepted without run or memory store", code: 202},
		{name: "starter unavailable", unavailable: true, code: 503, errorCode: "temporal_not_ready"},
		{name: "admission failed", failed: true, code: 503, errorCode: "temporal_admission_failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			starter := &memoryCommandStarterStub{}
			options := memoryapplication.MemoryManagementOptions{Starter: starter}
			if tc.unavailable {
				options.StarterError = errors.New("not ready")
			}
			if tc.failed {
				starter.err = errors.New("start failed")
			}
			server := NewServerWithOptions(config.Config{AppAPIExecutionSharedSecret: "secret"}, ServerOptions{MemoryManagement: memoryapplication.NewMemoryManagementService(options)})
			request := newTestRequest(http.MethodPost, "/internal/memory/personal/commands", bytes.NewReader(body))
			request.Header.Set("x-worker-origin-auth", "secret")
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if tc.errorCode != "" {
				assertError(t, response, tc.code, tc.errorCode)
			} else if response.Code != tc.code {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if tc.unavailable {
				if len(starter.inputs) != 0 {
					t.Fatalf("unexpected start: %v", starter.inputs)
				}
				return
			}
			if len(starter.inputs) != 1 || starter.inputs[0].WorkflowID != "campus-agent.memory.command.command-1" || starter.inputs[0].Command != command {
				t.Fatalf("workflow input=%v", starter.inputs)
			}
		})
	}
}
