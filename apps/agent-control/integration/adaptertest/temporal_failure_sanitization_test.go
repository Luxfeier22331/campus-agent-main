package adaptertest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/agentruntimeprotocol"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	finalizationactivities "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/finalization"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	applicationcontract "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/activitysupport"
	"go.temporal.io/sdk/temporal"
	"google.golang.org/protobuf/encoding/protojson"
)

const temporalFailureSentinel = "postgres://user:secret@internal-db/runtime?token=sentinel"

func assertTemporalFailureSanitized(
	t *testing.T,
	err error,
	wantType string,
	wantNonRetryable bool,
) {
	t.Helper()
	var applicationError interface {
		error
		Type() string
		NonRetryable() bool
		HasDetails() bool
	}
	if !errors.As(err, &applicationError) {
		t.Fatalf("error = %T %v, want Temporal ApplicationError", err, err)
	}
	if applicationError.Type() != wantType || applicationError.NonRetryable() != wantNonRetryable {
		t.Fatalf(
			"application error type=%q non_retryable=%t, want %q/%t",
			applicationError.Type(),
			applicationError.NonRetryable(),
			wantType,
			wantNonRetryable,
		)
	}
	if applicationError.HasDetails() {
		t.Fatal("application error must not carry diagnostic details")
	}
	failure := temporal.GetDefaultFailureConverter().ErrorToFailure(err)
	encoded, marshalErr := protojson.Marshal(failure)
	if marshalErr != nil {
		t.Fatalf("marshal Temporal failure: %v", marshalErr)
	}
	if strings.Contains(string(encoded), temporalFailureSentinel) {
		t.Fatalf("Temporal failure leaked sentinel: %s", encoded)
	}
	if failure.GetCause() != nil {
		t.Fatalf("Temporal failure cause = %#v, want nil", failure.GetCause())
	}
}

func TestTemporalApplicationErrorPersistsOnlyBoundedFailureEvidence(t *testing.T) {
	err := activitysupport.SanitizedTemporalApplicationError(
		"provider_unavailable",
		errors.New(temporalFailureSentinel),
		false,
	)
	assertTemporalFailureSanitized(t, err, "provider_unavailable", false)
}

func TestWorkflowFailureProjectionKeepsBoundedRuntimeEvidence(t *testing.T) {
	payload := map[string]any{
		"failure": map[string]any{"code": "provider_http_failed", "operation": "solve"},
	}
	executionactivities.AddWorkflowFailureEvidence(payload, executionapplication.AgentRuntimeFailure{
		HTTPStatus:   http.StatusBadGateway,
		Detail:       "provider returned HTTP 502",
		InvocationID: "req:solve.initial",
	})
	failure := payload["failure"].(map[string]any)
	if failure["detail"] != "provider returned HTTP 502" || failure["http_status"] != http.StatusBadGateway || failure["invocation_id"] != "req:solve.initial" {
		t.Fatalf("failure evidence = %#v", failure)
	}
}

func TestWorkflowRuntimeTimeoutKeepsItsRuntimeFailureKind(t *testing.T) {
	if got := executionactivities.WorkflowRuntimeFailureKind(context.DeadlineExceeded); got != "agent_runtime_timeout" {
		t.Fatalf("runtime timeout failure kind = %q, want agent_runtime_timeout", got)
	}
}

func TestRuntimeDeadlineSurvivesRealHTTPTransport(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%t", stream), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				failure := `{"code":"agent_deadline_exceeded","operation":"workflow.solve","detail":"agent deadline signal was aborted"}`
				if stream {
					w.Header().Set("content-type", "text/event-stream")
					_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", failure)
				} else {
					w.Header().Set("content-type", "application/json")
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = fmt.Fprintf(w, `{"error":%s}`, failure)
				}
			}))
			defer server.Close()
			adapter := executionactivities.OperationService{AgentRuntimeClient: outboundadapter.NewAgentRuntimeClient(config.Config{
				AgentRuntimeBaseURL: server.URL, AgentRuntimeSharedSecret: "secret",
			})}
			_, err := adapter.CallWorkflowOperationRuntime(t.Context(), execution.DurableRun{RequestID: "deadline", CreatedAt: time.Now()}, applicationcontract.WorkflowOperationSolve, "", executionapplication.AgentRuntimeRequest{}, 6000, stream)
			if got := executionactivities.WorkflowRuntimeFailureKind(err); got != "agent_deadline_exceeded" {
				t.Fatalf("failure=%v kind=%s", err, got)
			}
			payload := map[string]any{"failure": map[string]any{"code": "agent_deadline_exceeded", "operation": "solve"}}
			executionactivities.AddWorkflowFailureEvidence(payload, err)
			failure := payload["failure"].(map[string]any)
			if failure["operation"] != "workflow.solve" || failure["detail"] != "agent deadline signal was aborted" {
				t.Fatalf("failure evidence=%#v", failure)
			}
		})
	}
}

func TestRuntimeBlackholeRemainsTransportTimeout(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%t", stream), func(t *testing.T) {
			finish := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if stream {
					w.Header().Set("content-type", "text/event-stream")
					w.(http.Flusher).Flush()
				}
				select {
				case <-r.Context().Done():
				case <-finish:
				}
			}))
			defer server.Close()
			defer close(finish)
			adapter := executionactivities.OperationService{AgentRuntimeClient: outboundadapter.NewAgentRuntimeClient(config.Config{
				AgentRuntimeBaseURL: server.URL, AgentRuntimeSharedSecret: "secret",
			})}
			_, err := adapter.CallWorkflowOperationRuntime(t.Context(), execution.DurableRun{RequestID: "blackhole", CreatedAt: time.Now()}, applicationcontract.WorkflowOperationSolve, "", executionapplication.AgentRuntimeRequest{}, 4100, stream)
			if got := executionactivities.WorkflowRuntimeFailureKind(err); got != "agent_runtime_timeout" {
				t.Fatalf("failure=%v kind=%s", err, got)
			}
		})
	}
}

func TestWorkflowFailureProjectionPreservesSourceStatusAndOperation(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusBadGateway} {
		for _, cause := range []error{
			outboundadapter.AgentRuntimeFailureFromResponse(http.StatusInternalServerError, agentruntimeprotocol.AgentRuntimeResponse{
				Error: agentruntimeprotocol.AgentRuntimeError{
					Code: "run_failed", Operation: "workflow.execute_step", HTTPStatus: status, Detail: "provider rejection",
				},
			}),
			executionapplication.AgentRuntimeFailure{
				Code: "run_failed", Operation: "workflow.execute_step", HTTPStatus: status, Detail: "provider rejection",
			},
		} {
			payload := map[string]any{"failure": map[string]any{"code": "run_failed", "operation": "execute_step"}}
			executionactivities.AddWorkflowFailureEvidence(payload, cause)
			failure := payload["failure"].(map[string]any)
			if failure["http_status"] != status || failure["operation"] != "workflow.execute_step" || failure["detail"] != "provider rejection" {
				t.Fatalf("%T failure evidence = %#v", cause, failure)
			}
		}
	}
}

func TestTemporalFailureTerminalReasonDistinguishesRuntimeAndProviderTimeouts(t *testing.T) {
	if got := finalizationactivities.TemporalFailureTerminalReason(
		activityprojection.StepFailureProjection{},
		"agent_runtime_timeout",
	); got != execution.DurableTerminalReasonRunTimeout {
		t.Fatalf("runtime timeout terminal reason = %q, want run_timeout", got)
	}
	if got := finalizationactivities.TemporalFailureTerminalReason(
		activityprojection.StepFailureProjection{},
		"provider_timeout",
	); got != execution.DurableTerminalReasonProviderUnavailable {
		t.Fatalf("provider timeout terminal reason = %q, want provider_unavailable", got)
	}
}

func TestProductCallbackRejectionDoesNotPersistResponseBody(t *testing.T) {
	callback := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusConflict)
		_, _ = response.Write([]byte(temporalFailureSentinel))
	}))
	defer callback.Close()
	server := newAdapterForTest(config.Config{
		ProductCallbackBaseURL:      callback.URL,
		AppAPIExecutionSharedSecret: "callback-secret",
		ProductCallbackTimeoutMS:    1_000,
	})

	chatErr := server.WriteChatProductFinalization(
		context.Background(),
		execution.DurableRun{RequestID: "run-callback-sanitized"},
		time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC),
		map[string]any{"status": "error"},
	)
	assertTemporalFailureSanitized(t, chatErr, "product_callback_rejected", true)
}
