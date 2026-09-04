package temporaladapter

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func assertToolArgumentIdentityForTest(t *testing.T, payload map[string]any) {
	t.Helper()
	value, ok := payload["arguments_json_sha256"].(string)
	if !ok || !execution.ValidSHA256Ref(value) {
		t.Fatalf("arguments_json_sha256 = %#v, want sha256 ref in payload %#v", payload["arguments_json_sha256"], payload)
	}
}
