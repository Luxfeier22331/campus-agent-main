package finalization

import (
	"strings"
	"testing"
)

func TestValidateFinalizationRecoveryResponseRejectsOversizedPayload(t *testing.T) {
	err := validateFinalizationRecoveryResponse(map[string]any{"answer_text": strings.Repeat("x", maxFinalizationRecoveryBytes)})
	if err == nil || !strings.Contains(err.Error(), "finalization_response_too_large") {
		t.Fatalf("error = %v, want finalization_response_too_large", err)
	}
}

func TestValidateFinalizationRecoveryResponseAcceptsBoundedPayload(t *testing.T) {
	if err := validateFinalizationRecoveryResponse(map[string]any{"answer_text": "bounded"}); err != nil {
		t.Fatalf("validate bounded response: %v", err)
	}
}

func TestRecoverySourceRejectsUnknownFields(t *testing.T) {
	if err := validateRecoveryResponseFields([]byte(`{"result":{"sources":[{"kind":"web_page","unavailable_reason":"source_unavailable","private_debug":true}]}}`)); err == nil || !strings.Contains(err.Error(), "private_debug") {
		t.Fatalf("error = %v", err)
	}
}
