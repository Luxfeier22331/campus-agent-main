package outboundadapter

import (
	"errors"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
)

func TestRuntimeFailureMappingPreservesClassificationAndSafeMessages(t *testing.T) {
	for _, tc := range []struct {
		name, code, kind, message string
		status                    int
	}{
		{"provider", "provider_timeout", "provider_timeout", "The answer provider is temporarily unavailable.", 502},
		{"tool", "tool_execution_failed", "tool_execution_failed", "A runtime tool could not complete.", 400},
		{"unknown", "unexpected", "agent_runtime_request_failed", "agent runtime returned HTTP 503", 503},
		{"unauthorized", "unexpected", "agent_runtime_unauthorized", "The agent runtime request was rejected.", 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := `{"error":{"code":"` + tc.code + `","message":"private provider response","http_status":429},"runtime_release":"release"}`
			_, err := DecodeAgentRuntimeResponse(tc.status, strings.NewReader(body), false, nil)
			var failure executionapplication.AgentRuntimeFailure
			if !errors.As(err, &failure) || failure.Kind != tc.kind || err.Error() != tc.message {
				t.Fatalf("failure=%#v err=%v", failure, err)
			}
			if tc.status != 401 && (failure.HTTPStatus != 429 || failure.RuntimeRelease != "release") {
				t.Fatalf("lost diagnostics: %#v", failure)
			}
		})
	}
	var event executionapplication.AgentRuntimeEvent
	err := ReadRuntimeEvents(strings.NewReader("event: error\ndata: {\"code\":\"provider_timeout\",\"http_status\":504,\"detail\":\"bounded diagnostic\"}\n\n"), func(e executionapplication.AgentRuntimeEvent) error { event = e; return nil })
	if err != nil || event.Failure.Kind != "provider_timeout" || event.Failure.HTTPStatus != 504 || event.Failure.Error() != "The answer provider is temporarily unavailable." {
		t.Fatalf("event=%#v err=%v", event, err)
	}
}

func TestRuntimeWireValidationPrecedesInternalEventDelivery(t *testing.T) {
	for _, data := range []string{
		`{"schema_version":"unknown","delta":"text"}`,
		`{"schema_version":"workflow_runtime_answer_delta.v2","delta":"text","provisional":false}`,
	} {
		delivered := false
		err := ReadRuntimeEvents(strings.NewReader("event: answer_delta\ndata: "+data+"\n\n"), func(executionapplication.AgentRuntimeEvent) error { delivered = true; return nil })
		if err == nil || delivered {
			t.Fatalf("invalid wire delivered=%v err=%v", delivered, err)
		}
	}
}
