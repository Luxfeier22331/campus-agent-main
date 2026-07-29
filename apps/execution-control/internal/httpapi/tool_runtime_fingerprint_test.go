package httpapi

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestToolRuntimeFingerprintUsesRuntimeConfigContent(t *testing.T) {
	first, err := buildToolRuntimeFingerprint("")
	if err != nil {
		t.Fatalf("build default tool runtime fingerprint: %v", err)
	}
	second, err := buildToolRuntimeFingerprint("")
	if err != nil {
		t.Fatalf("build default tool runtime fingerprint again: %v", err)
	}
	if first.CombinedSHA256 == "" || first.CombinedSHA256 != second.CombinedSHA256 {
		t.Fatalf("combined hash is not stable: %#v / %#v", first, second)
	}
	if first.ToolsSchemaVersion != "tool-registry-v6" ||
		first.FunctionSchemaVersion != "tool-function-schemas-v3" ||
		first.WorkflowArtifactSchemaVersion != "workflow-artifact-registry-v3" {
		t.Fatalf("unexpected runtime fingerprint versions: %#v", first)
	}
	if !validSHA256Ref(first.ToolsSHA256) ||
		!validSHA256Ref(first.FunctionSchemaSHA256) ||
		!validSHA256Ref(first.WorkflowArtifactSHA256) ||
		!validSHA256Ref(first.CombinedSHA256) {
		t.Fatalf("runtime fingerprint hash fields must be sha256 refs: %#v", first)
	}
}

func TestToolRuntimeFingerprintChangesWhenConfigContentChanges(t *testing.T) {
	dir := t.TempDir()
	writeRuntimeFingerprintFixture(t, dir, "tools.v6.json", `{
		"schema_version":"tool-registry-v6",
		"registry_version":"2026-01-01",
		"tools":[{
			"name":"transport_schedule_lookup",
			"description":"Transport schedule lookup.",
			"exposure":"model_visible",
			"read_only":true,
			"requires_approval":false,
			"payload_schema_ref":"https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupPayload",
			"result_schema_ref":"https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupResult",
			"handler":{"type":"execution_control_internal_query","endpoint":"/internal/query/campus-services/transport-schedule"},
			"timeout_ms":1000,
			"result_projection_policy":"bounded_json"
		}]
	}`)
	writeRuntimeFingerprintFixture(t, dir, "tool-function-schemas.v3.json", `{
		"schema_version":"tool-function-schemas-v3",
		"tools":[{
			"type":"function",
			"name":"transport_schedule_lookup",
			"description":"Transport schedule lookup.",
			"strict":true,
			"parameters":{"type":"object","additionalProperties":false,"properties":{"query_text":{"type":"string"}},"required":["query_text"]}
		}]
	}`)
	writeRuntimeFingerprintFixture(t, dir, "workflow-artifacts.v3.json", `{
		"schema_version":"workflow-artifact-registry-v3",
		"registry_version":"2026-01-01",
		"visibility_values":["tool_private"],
		"support_status_values":["supported_go_runtime"],
		"forbidden_raw_key_tokens":["raw_prompt"],
		"artifacts":[{
			"kind":"schedule_baseline",
			"display_name":"ScheduleBaseline",
			"owner_tool_boundary":"transport_schedule_lookup",
			"producer_tools":["transport_schedule_lookup"],
			"source_truth_owner":"campus_services_transport_schedule_read_model",
			"visibility":"tool_private",
			"current_projection_support":"supported_go_runtime",
			"answer_eligible":true,
			"requires_grounding":true,
			"freshness_policy":"query_mode_bound",
			"allowed_consumers":["execution-control-finalizer"],
			"forbidden_raw_payload_keys":["raw_prompt"]
		}],
		"bindings":[{
			"binding_id":"transport_schedule_lookup.schedule_baseline.lookup",
			"owner_tool_boundary":"transport_schedule_lookup",
			"tool_name":"transport_schedule_lookup",
			"produces":["schedule_baseline"],
			"consumes":[],
			"required_inputs":["request:query_text"],
			"state_changing":false,
			"opening_gate":"open",
			"eval_denominator":["tool_selection"],
			"priority":10
		}]
	}`)

	first, err := buildToolRuntimeFingerprintWithPaths(
		"",
		filepath.Join(dir, "tools.v6.json"),
		filepath.Join(dir, "tool-function-schemas.v3.json"),
		filepath.Join(dir, "workflow-artifacts.v3.json"),
	)
	if err != nil {
		t.Fatalf("build fixture fingerprint: %v", err)
	}
	writeRuntimeFingerprintFixture(t, dir, "tool-function-schemas.v3.json", `{
		"schema_version":"tool-function-schemas-v3",
		"tools":[{
			"type":"function",
			"name":"transport_schedule_lookup",
			"description":"Transport schedule lookup changed.",
			"strict":true,
			"parameters":{"type":"object","additionalProperties":false,"properties":{"query_text":{"type":"string"},"intent":{"type":["string","null"]}},"required":["query_text","intent"]}
		}]
	}`)
	second, err := buildToolRuntimeFingerprintWithPaths(
		"",
		filepath.Join(dir, "tools.v6.json"),
		filepath.Join(dir, "tool-function-schemas.v3.json"),
		filepath.Join(dir, "workflow-artifacts.v3.json"),
	)
	if err != nil {
		t.Fatalf("build changed fixture fingerprint: %v", err)
	}
	if first.FunctionSchemaSHA256 == second.FunctionSchemaSHA256 ||
		first.CombinedSHA256 == second.CombinedSHA256 {
		t.Fatalf("function schema change did not affect fingerprint: %#v / %#v", first, second)
	}
}

func TestToolRuntimeFingerprintUsesCanonicalJSONContent(t *testing.T) {
	dir := t.TempDir()
	prettyDir := filepath.Join(dir, "pretty")
	compactDir := filepath.Join(dir, "compact")
	if err := os.Mkdir(prettyDir, 0o700); err != nil {
		t.Fatalf("mkdir pretty: %v", err)
	}
	if err := os.Mkdir(compactDir, 0o700); err != nil {
		t.Fatalf("mkdir compact: %v", err)
	}
	writeRuntimeFingerprintFixture(t, prettyDir, "tools.v6.json", `{
		"schema_version":"tool-registry-v6",
		"registry_version":"2026-01-01",
		"tools":[{
			"name":"transport_schedule_lookup",
			"description":"Transport schedule lookup.",
			"exposure":"model_visible",
			"read_only":true,
			"requires_approval":false,
			"payload_schema_ref":"https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupPayload",
			"result_schema_ref":"https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupResult",
			"handler":{"type":"execution_control_internal_query","endpoint":"/internal/query/campus-services/transport-schedule"},
			"timeout_ms":1000,
			"result_projection_policy":"bounded_json"
		}]
	}`)
	writeRuntimeFingerprintFixture(t, compactDir, "tools.v6.json", `{"tools":[{"timeout_ms":1000,"result_projection_policy":"bounded_json","result_schema_ref":"https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupResult","requires_approval":false,"read_only":true,"payload_schema_ref":"https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupPayload","name":"transport_schedule_lookup","handler":{"type":"execution_control_internal_query","endpoint":"/internal/query/campus-services/transport-schedule"},"exposure":"model_visible","description":"Transport schedule lookup."}],"schema_version":"tool-registry-v6","registry_version":"2026-01-01"}`)
	for _, runtimeDir := range []string{prettyDir, compactDir} {
		writeRuntimeFingerprintFixture(t, runtimeDir, "tool-function-schemas.v3.json", `{
			"schema_version":"tool-function-schemas-v3",
			"tools":[{
				"type":"function",
				"name":"transport_schedule_lookup",
				"description":"Transport schedule lookup.",
				"strict":true,
				"parameters":{"type":"object","additionalProperties":false,"properties":{"query_text":{"type":"string"}},"required":["query_text"]}
			}]
		}`)
		writeRuntimeFingerprintFixture(t, runtimeDir, "workflow-artifacts.v3.json", `{
			"schema_version":"workflow-artifact-registry-v3",
			"registry_version":"2026-01-01",
			"visibility_values":["tool_private"],
			"support_status_values":["supported_go_runtime"],
			"forbidden_raw_key_tokens":["raw_prompt"],
			"artifacts":[{
				"kind":"schedule_baseline",
				"display_name":"ScheduleBaseline",
				"owner_tool_boundary":"transport_schedule_lookup",
				"producer_tools":["transport_schedule_lookup"],
				"source_truth_owner":"campus_services_transport_schedule_read_model",
				"visibility":"tool_private",
				"current_projection_support":"supported_go_runtime",
				"answer_eligible":true,
				"requires_grounding":true,
				"freshness_policy":"query_mode_bound",
				"allowed_consumers":["execution-control-finalizer"],
				"forbidden_raw_payload_keys":["raw_prompt"]
			}],
			"bindings":[{
				"binding_id":"transport_schedule_lookup.schedule_baseline.lookup",
				"owner_tool_boundary":"transport_schedule_lookup",
				"tool_name":"transport_schedule_lookup",
				"produces":["schedule_baseline"],
				"consumes":[],
				"required_inputs":["request:query_text"],
				"state_changing":false,
				"opening_gate":"open",
				"eval_denominator":["tool_selection"],
				"priority":10
			}]
		}`)
	}

	pretty, err := buildToolRuntimeFingerprintWithPaths(
		"execution-control@pretty",
		filepath.Join(prettyDir, "tools.v6.json"),
		filepath.Join(prettyDir, "tool-function-schemas.v3.json"),
		filepath.Join(prettyDir, "workflow-artifacts.v3.json"),
	)
	if err != nil {
		t.Fatalf("build pretty fingerprint: %v", err)
	}
	compact, err := buildToolRuntimeFingerprintWithPaths(
		"execution-control@pretty",
		filepath.Join(compactDir, "tools.v6.json"),
		filepath.Join(compactDir, "tool-function-schemas.v3.json"),
		filepath.Join(compactDir, "workflow-artifacts.v3.json"),
	)
	if err != nil {
		t.Fatalf("build compact fingerprint: %v", err)
	}
	if pretty != compact {
		t.Fatalf("fingerprint changed with formatting: %#v / %#v", pretty, compact)
	}
	otherRelease, err := buildToolRuntimeFingerprintWithPaths(
		"execution-control@next",
		filepath.Join(compactDir, "tools.v6.json"),
		filepath.Join(compactDir, "tool-function-schemas.v3.json"),
		filepath.Join(compactDir, "workflow-artifacts.v3.json"),
	)
	if err != nil {
		t.Fatalf("build other release fingerprint: %v", err)
	}
	if otherRelease.CombinedSHA256 == compact.CombinedSHA256 {
		t.Fatalf("runtime release change did not affect fingerprint: %#v / %#v", compact, otherRelease)
	}
}

func TestToolRuntimeFingerprintFailsClosedOnMalformedConfig(t *testing.T) {
	dir := t.TempDir()
	writeRuntimeFingerprintFixture(t, dir, "tools.v6.json", `{"schema_version":"wrong","registry_version":"2026-01-01","tools":[]}`)
	writeRuntimeFingerprintFixture(t, dir, "tool-function-schemas.v3.json", `{"schema_version":"tool-function-schemas-v3","tools":[]}`)
	writeRuntimeFingerprintFixture(t, dir, "workflow-artifacts.v3.json", `{"schema_version":"workflow-artifact-registry-v3","registry_version":"2026-01-01","artifacts":[],"bindings":[]}`)

	if _, err := buildToolRuntimeFingerprintWithPaths(
		"",
		filepath.Join(dir, "tools.v6.json"),
		filepath.Join(dir, "tool-function-schemas.v3.json"),
		filepath.Join(dir, "workflow-artifacts.v3.json"),
	); err == nil {
		t.Fatal("buildToolRuntimeFingerprint accepted malformed tool registry")
	}
}

func TestExecutionControlLocalToolRuntimeFingerprintRejectsReleaseDrift(t *testing.T) {
	admitted, err := buildToolRuntimeFingerprint("admitted-release")
	if err != nil {
		t.Fatalf("build admitted fingerprint: %v", err)
	}
	server := NewServer(config.Config{DeploymentRelease: "worker-release"})
	if err := server.validateLocalToolRuntimeFingerprintMap(admitted.toMap()); err == nil {
		t.Fatal("local execution-control release drift was accepted")
	}
}

func writeRuntimeFingerprintFixture(t *testing.T, dir string, name string, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}
