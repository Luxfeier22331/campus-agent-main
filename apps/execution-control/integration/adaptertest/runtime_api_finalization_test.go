package adaptertest

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeapi"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type runtimeTestPayloads struct {
	mu   sync.Mutex
	rows map[string]json.RawMessage
}

func (s *runtimeTestPayloads) PutRuntimePayload(_ context.Context, id, ref string, p json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rows[id+":"+ref] = append(json.RawMessage{}, p...)
	return nil
}
func (s *runtimeTestPayloads) GetRuntimePayload(_ context.Context, id, ref string) (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.rows[id+":"+ref]
	if !ok {
		return nil, pgx.ErrNoRows
	}
	return p, nil
}
func runtimePost(t *testing.T, s *runtimeapi.Server, action string, v any) *httptest.ResponseRecorder {
	t.Helper()
	data, e := json.Marshal(v)
	require.NoError(t, e)
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/internal/agent-runtime/"+action, strings.NewReader(string(data)))
	r.Header.Set("x-agent-runtime-auth", "test")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestRuntimeAPICitationFailureIsPermanent(t *testing.T) {
	store, a, in := workflowFinalizationFixture(t, "review-citation")
	in.WorkflowResult.FinalOutput = "请参见资料 [99]"
	p := &runtimeTestPayloads{rows: map[string]json.RawMessage{}}
	data, e := json.Marshal(in.WorkflowResult)
	require.NoError(t, e)
	require.NoError(t, p.PutRuntimePayload(t.Context(), in.RequestID, "answer", data))
	server := &runtimeapi.Server{SharedSecret: "test", Finalization: a.FinalizationAdapter, Store: p}
	req := map[string]any{"request_id": in.RequestID, "ref": "answer", "operation_request": map[string]any{"admission_snapshot": in.AdmissionSnapshot}}
	w := runtimePost(t, server, "finalize", req)
	require.Equal(t, 422, w.Code, w.Body.String())
	require.JSONEq(t, `{"code":"citation_validation_failed","retryable":false}`, w.Body.String())
	run, e := store.GetRun(t.Context(), in.RequestID)
	require.NoError(t, e)
	require.Equal(t, execution.DurableRunStatusRunning, run.Status)
	steps, e := store.ListRunSteps(t.Context(), in.RequestID)
	require.NoError(t, e)
	var failure map[string]any
	for _, s := range steps {
		if s.StepID == "finalization.write" {
			failure = s.SanitizedPayload
			require.Equal(t, "failed", s.Status)
		}
	}
	require.Contains(t, fmt.Sprint(failure), "citation_validation_failed")

	w = runtimePost(t, server, "terminal", map[string]any{"request_id": in.RequestID, "payload": map[string]any{"code": "citation_validation_failed", "stage": "finalization.write"}})
	require.Equal(t, 200, w.Code, w.Body.String())
	run, e = store.GetRun(t.Context(), in.RequestID)
	require.NoError(t, e)
	require.Equal(t, execution.DurableRunStatusFailed, run.Status)

}

func TestFinalizationMemoryStepOwnership(t *testing.T) {
	for _, external := range []bool{false, true} {
		t.Run(fmt.Sprintf("external=%t", external), func(t *testing.T) {
			store, a, in := workflowFinalizationFixture(t, fmt.Sprintf("memory-owner-%t", external))
			prepared := false
			if external {
				a.PrepareMemoryDelivery = func(context.Context, execution.DurableRun) error { prepared = true; return nil }
			}
			out, err := a.FinalizationAdapter.WriteWorkflowFinalization(t.Context(), in)
			require.NoError(t, err)
			require.Equal(t, "completed", out.Status)
			require.Equal(t, external, prepared)
			steps, err := store.ListRunSteps(t.Context(), in.RequestID)
			require.NoError(t, err)
			found := false
			for _, step := range steps {
				if step.StepID == "memory.append" {
					found = true
					require.Equal(t, "pending", step.Status)
				}
			}
			require.Equal(t, !external, found)
		})
	}
}
