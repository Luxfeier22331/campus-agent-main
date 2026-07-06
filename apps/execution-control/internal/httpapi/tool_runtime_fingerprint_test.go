package httpapi

import (
	"os"
	"path/filepath"
	"testing"
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
	if first.ToolsSchemaVersion != "tool-registry-v4" ||
		first.FunctionSchemaVersion != "tool-function-schemas-v1" ||
		first.WorkflowArtifactSchemaVersion != "workflow-artifact-registry-v2" {
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
	writeRuntimeFingerprintFixture(t, dir, "tools.v4.json", `{
		"schema_version":"tool-registry-v4",
		"registry_version":"2026-01-01",
		"tools":[{
			"name":"knowledge_query",
			"description":"Knowledge query.",
			"exposure":"model_visible",
			"read_only":true,
			"requires_approval":false,
			"payload_schema_ref":"https://muc.wiki/campus-agent/schemas/knowledge-tool-contracts.v1.schema.json#/$defs/KnowledgeQuerySignalPayload",
			"result_schema_ref":"https://muc.wiki/campus-agent/schemas/knowledge-tool-contracts.v1.schema.json#/$defs/KnowledgeQuerySignalResult",
			"handler":{"type":"workflow_signal"},
			"timeout_ms":1000,
			"result_projection_policy":"bounded_json"
		}]
	}`)
	writeRuntimeFingerprintFixture(t, dir, "tool-function-schemas.v1.json", `{
		"schema_version":"tool-function-schemas-v1",
		"tools":[{
			"type":"function",
			"name":"knowledge_query",
			"description":"Knowledge query.",
			"strict":true,
			"parameters":{"type":"object","additionalProperties":false,"properties":{"query_text":{"type":"string"}},"required":["query_text"]}
		}]
	}`)
	writeRuntimeFingerprintFixture(t, dir, "workflow-artifacts.v2.json", `{
		"schema_version":"workflow-artifact-registry-v2",
		"registry_version":"2026-01-01",
		"visibility_values":["tool_private"],
		"support_status_values":["supported_go_runtime"],
		"forbidden_raw_key_tokens":["raw_prompt"],
		"artifacts":[{
			"kind":"evidence_bundle",
			"display_name":"EvidenceBundle",
			"owner_tool_boundary":"knowledge_query",
			"producer_tools":["knowledge_query"],
			"source_truth_owner":"knowledge_query_runtime",
			"visibility":"tool_private",
			"current_projection_support":"supported_go_runtime",
			"answer_eligible":true,
			"requires_grounding":true,
			"freshness_policy":"query_mode_bound",
			"allowed_consumers":["knowledge_query"],
			"forbidden_raw_payload_keys":["raw_prompt"]
		}],
		"bindings":[{
			"binding_id":"knowledge_query.evidence_bundle",
			"owner_tool_boundary":"knowledge_query",
			"tool_name":"knowledge_query",
			"produces":["evidence_bundle"],
			"consumes":[],
			"required_inputs":["request:query_text"],
			"state_changing":false,
			"opening_gate":"open",
			"eval_denominator":["tool_selection"],
			"priority":10
		}]
	}`)

	t.Setenv("EXECUTION_CONTROL_TOOL_REGISTRY_PATH", filepath.Join(dir, "tools.v4.json"))
	t.Setenv("EXECUTION_CONTROL_TOOL_FUNCTION_SCHEMA_PATH", filepath.Join(dir, "tool-function-schemas.v1.json"))
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_ARTIFACT_REGISTRY_PATH", filepath.Join(dir, "workflow-artifacts.v2.json"))

	first, err := buildToolRuntimeFingerprint("")
	if err != nil {
		t.Fatalf("build fixture fingerprint: %v", err)
	}
	writeRuntimeFingerprintFixture(t, dir, "tool-function-schemas.v1.json", `{
		"schema_version":"tool-function-schemas-v1",
		"tools":[{
			"type":"function",
			"name":"knowledge_query",
			"description":"Knowledge query changed.",
			"strict":true,
			"parameters":{"type":"object","additionalProperties":false,"properties":{"query_text":{"type":"string"},"intent":{"type":["string","null"]}},"required":["query_text","intent"]}
		}]
	}`)
	second, err := buildToolRuntimeFingerprint("")
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
	writeRuntimeFingerprintFixture(t, prettyDir, "tools.v4.json", `{
		"schema_version":"tool-registry-v4",
		"registry_version":"2026-01-01",
		"tools":[{
			"name":"knowledge_query",
			"description":"Knowledge query.",
			"exposure":"model_visible",
			"read_only":true,
			"requires_approval":false,
			"payload_schema_ref":"https://muc.wiki/campus-agent/schemas/knowledge-tool-contracts.v1.schema.json#/$defs/KnowledgeQuerySignalPayload",
			"result_schema_ref":"https://muc.wiki/campus-agent/schemas/knowledge-tool-contracts.v1.schema.json#/$defs/KnowledgeQuerySignalResult",
			"handler":{"type":"workflow_signal"},
			"timeout_ms":1000,
			"result_projection_policy":"bounded_json"
		}]
	}`)
	writeRuntimeFingerprintFixture(t, compactDir, "tools.v4.json", `{"tools":[{"timeout_ms":1000,"result_projection_policy":"bounded_json","result_schema_ref":"https://muc.wiki/campus-agent/schemas/knowledge-tool-contracts.v1.schema.json#/$defs/KnowledgeQuerySignalResult","requires_approval":false,"read_only":true,"payload_schema_ref":"https://muc.wiki/campus-agent/schemas/knowledge-tool-contracts.v1.schema.json#/$defs/KnowledgeQuerySignalPayload","name":"knowledge_query","handler":{"type":"workflow_signal"},"exposure":"model_visible","description":"Knowledge query."}],"schema_version":"tool-registry-v4","registry_version":"2026-01-01"}`)
	for _, runtimeDir := range []string{prettyDir, compactDir} {
		writeRuntimeFingerprintFixture(t, runtimeDir, "tool-function-schemas.v1.json", `{
			"schema_version":"tool-function-schemas-v1",
			"tools":[{
				"type":"function",
				"name":"knowledge_query",
				"description":"Knowledge query.",
				"strict":true,
				"parameters":{"type":"object","additionalProperties":false,"properties":{"query_text":{"type":"string"}},"required":["query_text"]}
			}]
		}`)
		writeRuntimeFingerprintFixture(t, runtimeDir, "workflow-artifacts.v2.json", `{
			"schema_version":"workflow-artifact-registry-v2",
			"registry_version":"2026-01-01",
			"visibility_values":["tool_private"],
			"support_status_values":["supported_go_runtime"],
			"forbidden_raw_key_tokens":["raw_prompt"],
			"artifacts":[{
				"kind":"evidence_bundle",
				"display_name":"EvidenceBundle",
				"owner_tool_boundary":"knowledge_query",
				"producer_tools":["knowledge_query"],
				"source_truth_owner":"knowledge_query_runtime",
				"visibility":"tool_private",
				"current_projection_support":"supported_go_runtime",
				"answer_eligible":true,
				"requires_grounding":true,
				"freshness_policy":"query_mode_bound",
				"allowed_consumers":["knowledge_query"],
				"forbidden_raw_payload_keys":["raw_prompt"]
			}],
			"bindings":[{
				"binding_id":"knowledge_query.evidence_bundle",
				"owner_tool_boundary":"knowledge_query",
				"tool_name":"knowledge_query",
				"produces":["evidence_bundle"],
				"consumes":[],
				"required_inputs":["request:query_text"],
				"state_changing":false,
				"opening_gate":"open",
				"eval_denominator":["tool_selection"],
				"priority":10
			}]
		}`)
	}

	t.Setenv("EXECUTION_CONTROL_TOOL_REGISTRY_PATH", filepath.Join(prettyDir, "tools.v4.json"))
	t.Setenv("EXECUTION_CONTROL_TOOL_FUNCTION_SCHEMA_PATH", filepath.Join(prettyDir, "tool-function-schemas.v1.json"))
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_ARTIFACT_REGISTRY_PATH", filepath.Join(prettyDir, "workflow-artifacts.v2.json"))
	pretty, err := buildToolRuntimeFingerprint("execution-control@pretty")
	if err != nil {
		t.Fatalf("build pretty fingerprint: %v", err)
	}
	t.Setenv("EXECUTION_CONTROL_TOOL_REGISTRY_PATH", filepath.Join(compactDir, "tools.v4.json"))
	t.Setenv("EXECUTION_CONTROL_TOOL_FUNCTION_SCHEMA_PATH", filepath.Join(compactDir, "tool-function-schemas.v1.json"))
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_ARTIFACT_REGISTRY_PATH", filepath.Join(compactDir, "workflow-artifacts.v2.json"))
	compact, err := buildToolRuntimeFingerprint("execution-control@compact")
	if err != nil {
		t.Fatalf("build compact fingerprint: %v", err)
	}
	if pretty != compact {
		t.Fatalf("fingerprint changed with formatting: %#v / %#v", pretty, compact)
	}
}

func TestToolRuntimeFingerprintFailsClosedOnMalformedConfig(t *testing.T) {
	dir := t.TempDir()
	writeRuntimeFingerprintFixture(t, dir, "tools.v4.json", `{"schema_version":"wrong","registry_version":"2026-01-01","tools":[]}`)
	writeRuntimeFingerprintFixture(t, dir, "tool-function-schemas.v1.json", `{"schema_version":"tool-function-schemas-v1","tools":[]}`)
	writeRuntimeFingerprintFixture(t, dir, "workflow-artifacts.v2.json", `{"schema_version":"workflow-artifact-registry-v2","registry_version":"2026-01-01","artifacts":[],"bindings":[]}`)

	t.Setenv("EXECUTION_CONTROL_TOOL_REGISTRY_PATH", filepath.Join(dir, "tools.v4.json"))
	t.Setenv("EXECUTION_CONTROL_TOOL_FUNCTION_SCHEMA_PATH", filepath.Join(dir, "tool-function-schemas.v1.json"))
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_ARTIFACT_REGISTRY_PATH", filepath.Join(dir, "workflow-artifacts.v2.json"))

	if _, err := buildToolRuntimeFingerprint(""); err == nil {
		t.Fatal("buildToolRuntimeFingerprint accepted malformed tool registry")
	}
}

func writeRuntimeFingerprintFixture(t *testing.T, dir string, name string, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}
