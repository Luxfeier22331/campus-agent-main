package httpapi

import "testing"

func expectMetadataMapForTest(t *testing.T, value any, name string) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s = %#v, want map", name, value)
	}
	return record
}

func assertSDKToolArgumentIdentityForTest(t *testing.T, payload map[string]any) {
	t.Helper()
	if payload["arguments_schema_version"] != "tool-function-schemas-v3" {
		t.Fatalf("arguments_schema_version = %#v", payload["arguments_schema_version"])
	}
	for _, field := range []string{"arguments_schema_sha256", "arguments_json_sha256"} {
		value, ok := payload[field].(string)
		if !ok || !validSHA256Ref(value) {
			t.Fatalf("%s = %#v, want sha256 ref in payload %#v", field, payload[field], payload)
		}
	}
}
