package httpapi

import "testing"

func assertToolArgumentIdentityForTest(t *testing.T, payload map[string]any) {
	t.Helper()
	value, ok := payload["arguments_json_sha256"].(string)
	if !ok || !validSHA256Ref(value) {
		t.Fatalf("arguments_json_sha256 = %#v, want sha256 ref in payload %#v", payload["arguments_json_sha256"], payload)
	}
}
