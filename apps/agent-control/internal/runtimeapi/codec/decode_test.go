package codec

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"strings"
	"testing"
)

func TestDecodeResultProjectionBoundary(t *testing.T) {
	for _, payload := range []string{`{"unknown":true}`, `{} {}`, `{"status":`, strings.Repeat(" ", execution.MaxAgentOperationPayloadBytes+1)} {
		if _, err := DecodeResult([]byte(payload)); err == nil {
			t.Fatal("invalid projection accepted")
		}
	}
	result, err := DecodeResult([]byte(`{"operation":"synthesize","status":"completed","evidence":[{"source":"campus_search","id":"source","title":"title","excerpt":"text"}],"source_attempts":[{"source":"campus_search","status":"matched"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Operation != "synthesize" || len(result.Evidence) != 1 || len(result.SourceAttempts) != 1 {
		t.Fatalf("projection materials lost: %#v", result)
	}
}
