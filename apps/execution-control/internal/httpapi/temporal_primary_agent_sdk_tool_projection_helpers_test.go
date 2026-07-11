package httpapi

import "testing"

func validTransportScheduleLookupArguments(queryText string) map[string]any {
	return map[string]any{
		"query_text": queryText,
		"intent":     "next_departure",
		"route_selector": map[string]any{
			"route_id":               nil,
			"service_family":         "intercampus",
			"route_variant_query":    nil,
			"origin_campus":          "fengtai",
			"destination_campus":     "haidian",
			"origin_stop_query":      nil,
			"destination_stop_query": nil,
		},
		"snapshot_query": map[string]any{
			"mode":      "current",
			"as_of":     nil,
			"year_hint": nil,
		},
		"service_time_query": map[string]any{
			"date_mode":            "today",
			"service_date":         nil,
			"daypart":              "evening",
			"departure_not_before": "18:00",
			"departure_not_after":  nil,
		},
		"result_limit": 3,
	}
}

func campusServicesToolResultForTest(
	toolName string,
	outcome string,
	projectionRef string,
) map[string]any {
	return map[string]any{
		"outcome": outcome,
		"result_envelope": map[string]any{
			"schema_version": "campus_services_tool_result.v1",
			"tool":           "transport_schedule_lookup",
			"tool_name":      toolName,
			"query_kind":     "transport_schedule",
			"outcome":        outcome,
			"facts": map[string]any{
				"kind": "schedule_facts",
				"result": map[string]any{
					"outcome": outcome,
				},
			},
			"source_refs":           []any{"notice:bus-schedule-2026-04-20"},
			"projection_ref":        projectionRef,
			"content_hash":          "sha256:transport-schedule-test",
			"clarification_options": []any{},
		},
	}
}

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
	if payload["arguments_schema_version"] != "tool-function-schemas-v1" {
		t.Fatalf("arguments_schema_version = %#v", payload["arguments_schema_version"])
	}
	for _, field := range []string{"arguments_schema_sha256", "arguments_json_sha256"} {
		value, ok := payload[field].(string)
		if !ok || !validSHA256Ref(value) {
			t.Fatalf("%s = %#v, want sha256 ref in payload %#v", field, payload[field], payload)
		}
	}
}
