package temporalruntime

import (
	"context"
	"errors"
	"strings"
	"testing"

	"go.temporal.io/sdk/temporal"
)

func TestSanitizeActivityFailureReplacesPlainError(t *testing.T) {
	err := sanitizeActivityFailure(errors.New("provider secret response"))
	var applicationError *temporal.ApplicationError
	if !errors.As(err, &applicationError) {
		t.Fatalf("error = %T, want ApplicationError", err)
	}
	if applicationError.Message() != sanitizedActivityFailureMessage {
		t.Fatalf("message = %q", applicationError.Message())
	}
	if applicationError.Type() != sanitizedActivityFailureType {
		t.Fatalf("type = %q", applicationError.Type())
	}
	if strings.Contains(err.Error(), "provider secret response") {
		t.Fatalf("sanitized error leaked original text: %v", err)
	}
	var hash string
	if detailErr := applicationError.Details(&hash); detailErr != nil || !validFailureHash(hash) {
		t.Fatalf("detail = %q, err = %v", hash, detailErr)
	}
}

func TestSanitizeActivityFailurePreservesApplicationErrorContract(t *testing.T) {
	original := temporal.NewNonRetryableApplicationError(
		"private provider response",
		"provider_unavailable",
		nil,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	)
	err := sanitizeActivityFailure(original)
	var applicationError *temporal.ApplicationError
	if !errors.As(err, &applicationError) {
		t.Fatalf("error = %T, want ApplicationError", err)
	}
	if !applicationError.NonRetryable() || applicationError.Type() != "provider_unavailable" {
		t.Fatalf("application error contract changed: %#v", applicationError)
	}
	if applicationError.Message() == "private provider response" {
		t.Fatal("application error message was not sanitized")
	}
	if strings.Contains(err.Error(), "private provider response") {
		t.Fatalf("application error leaked original text: %v", err)
	}
}

func TestSanitizeActivityFailurePreservesCancellation(t *testing.T) {
	if got := sanitizeActivityFailure(temporal.NewCanceledError("user_requested")); !temporal.IsCanceledError(got) {
		t.Fatalf("cancellation = %T, want canceled error", got)
	}
	if got := sanitizeActivityFailure(context.Canceled); !errors.Is(got, context.Canceled) {
		t.Fatalf("context cancellation = %v, want context.Canceled", got)
	}
}
