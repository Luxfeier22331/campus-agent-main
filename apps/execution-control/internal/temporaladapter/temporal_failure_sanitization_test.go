package temporaladapter

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
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
	var applicationError *temporal.ApplicationError
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
	err := sanitizedTemporalApplicationError(
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
	addWorkflowFailureEvidence(payload, agentRuntimeHTTPError{
		StatusCode:   http.StatusBadGateway,
		Detail:       "provider returned HTTP 502",
		InvocationID: "req:solve.initial",
	})
	failure := payload["failure"].(map[string]any)
	if failure["detail"] != "provider returned HTTP 502" || failure["http_status"] != http.StatusBadGateway || failure["invocation_id"] != "req:solve.initial" {
		t.Fatalf("failure evidence = %#v", failure)
	}
}

func TestWorkflowRuntimeTimeoutKeepsItsRuntimeFailureKind(t *testing.T) {
	if got := workflowRuntimeFailureKind(context.DeadlineExceeded); got != "agent_runtime_timeout" {
		t.Fatalf("runtime timeout failure kind = %q, want agent_runtime_timeout", got)
	}
}

func TestTemporalFailureTerminalReasonDistinguishesRuntimeAndProviderTimeouts(t *testing.T) {
	if got := temporalFailureTerminalReason(
		temporalStepFailureProjection{},
		"agent_runtime_timeout",
	); got != execution.DurableTerminalReasonRunTimeout {
		t.Fatalf("runtime timeout terminal reason = %q, want run_timeout", got)
	}
	if got := temporalFailureTerminalReason(
		temporalStepFailureProjection{},
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

	personalErr := server.WritePersonalMemoryCommandResult(
		context.Background(),
		temporalruntime.PersonalMemoryCommandActivityOutput{
			CommandID: "memory-command-sanitized",
			Status:    "succeeded",
		},
	)
	assertTemporalFailureSanitized(t, personalErr, "product_callback_rejected", true)

	chatErr := server.writeChatProductFinalization(
		context.Background(),
		execution.DurableRun{RequestID: "run-callback-sanitized"},
		time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC),
		map[string]any{"status": "error"},
	)
	assertTemporalFailureSanitized(t, chatErr, "product_callback_rejected", true)
}
