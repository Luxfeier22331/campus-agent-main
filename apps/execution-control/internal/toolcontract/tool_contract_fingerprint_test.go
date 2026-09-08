package toolcontract

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
)

func TestToolContractFingerprintUsesRuntimeConfigContent(t *testing.T) {
	first, err := buildToolContractFingerprint("", "")
	if err != nil {
		t.Fatalf("build default tool contract fingerprint: %v", err)
	}
	second, err := buildToolContractFingerprint("", "")
	if err != nil {
		t.Fatalf("build default tool contract fingerprint again: %v", err)
	}
	if first != second {
		t.Fatalf("tool contract fingerprint is not stable: %#v / %#v", first, second)
	}
	if first.SchemaVersion != execution.ToolContractFingerprintSchemaVersion ||
		!execution.ValidSHA256Ref(first.ToolsSHA256) ||
		!execution.ValidSHA256Ref(first.FunctionSchemaSHA256) {
		t.Fatalf("tool contract fingerprint is invalid: %#v", first)
	}
}

func TestToolContractFingerprintChangesWhenConfigContentChanges(t *testing.T) {
	dir := t.TempDir()
	writeToolContractFingerprintFixture(t, dir, "tools.v7.json", `{
		"schema_version":"tool-registry-v7",
		"registry_version":"2026-01-01",
		"tools":[{
			"name":"personal_memory_recall",
			"description":"Transport schedule lookup.",
			"exposure":"model_visible",
			"read_only":true,
			"requires_approval":false,
			"payload_schema_ref":"https://muc.wiki/campus-agent/schemas/personal-memory-tool-contracts.v1.schema.json#/$defs/PersonalMemoryRecallPayload",
			"result_schema_ref":"https://muc.wiki/campus-agent/schemas/personal-memory-tool-contracts.v1.schema.json#/$defs/PersonalMemoryRecallResult",
			"handler":{"type":"execution_control_internal_query","endpoint":"/internal/memory/personal/recall"},
			"timeout_ms":1000,
			"result_projection_policy":"bounded_json"
		}]
	}`)
	writeToolContractFingerprintFixture(t, dir, "tool-function-schemas.v4.json", `{
		"schema_version":"tool-function-schemas-v4",
		"tools":[{
			"type":"function",
			"name":"personal_memory_recall",
			"description":"Transport schedule lookup.",
			"strict":true,
			"parameters":{"type":"object","additionalProperties":false,"properties":{"query_text":{"type":"string"}},"required":["query_text"]}
		}]
	}`)
	first, err := buildToolContractFingerprint(
		filepath.Join(dir, "tools.v7.json"),
		filepath.Join(dir, "tool-function-schemas.v4.json"),
	)
	if err != nil {
		t.Fatalf("build fixture fingerprint: %v", err)
	}
	writeToolContractFingerprintFixture(t, dir, "tool-function-schemas.v4.json", `{
		"schema_version":"tool-function-schemas-v4",
		"tools":[{
			"type":"function",
			"name":"personal_memory_recall",
			"description":"Transport schedule lookup changed.",
			"strict":true,
			"parameters":{"type":"object","additionalProperties":false,"properties":{"query_text":{"type":"string"},"intent":{"type":["string","null"]}},"required":["query_text","intent"]}
		}]
	}`)
	second, err := buildToolContractFingerprint(
		filepath.Join(dir, "tools.v7.json"),
		filepath.Join(dir, "tool-function-schemas.v4.json"),
	)
	if err != nil {
		t.Fatalf("build changed fixture fingerprint: %v", err)
	}
	if first.FunctionSchemaSHA256 == second.FunctionSchemaSHA256 {
		t.Fatalf("function schema change did not affect fingerprint: %#v / %#v", first, second)
	}
}

func TestToolContractFingerprintUsesCanonicalJSONContent(t *testing.T) {
	dir := t.TempDir()
	prettyDir := filepath.Join(dir, "pretty")
	compactDir := filepath.Join(dir, "compact")
	if err := os.Mkdir(prettyDir, 0o700); err != nil {
		t.Fatalf("mkdir pretty: %v", err)
	}
	if err := os.Mkdir(compactDir, 0o700); err != nil {
		t.Fatalf("mkdir compact: %v", err)
	}
	writeToolContractFingerprintFixture(t, prettyDir, "tools.v7.json", `{
		"schema_version":"tool-registry-v7",
		"registry_version":"2026-01-01",
		"tools":[{
			"name":"personal_memory_recall",
			"description":"Transport schedule lookup.",
			"exposure":"model_visible",
			"read_only":true,
			"requires_approval":false,
			"payload_schema_ref":"https://muc.wiki/campus-agent/schemas/personal-memory-tool-contracts.v1.schema.json#/$defs/PersonalMemoryRecallPayload",
			"result_schema_ref":"https://muc.wiki/campus-agent/schemas/personal-memory-tool-contracts.v1.schema.json#/$defs/PersonalMemoryRecallResult",
			"handler":{"type":"execution_control_internal_query","endpoint":"/internal/memory/personal/recall"},
			"timeout_ms":1000,
			"result_projection_policy":"bounded_json"
		}]
	}`)
	writeToolContractFingerprintFixture(t, compactDir, "tools.v7.json", `{"tools":[{"timeout_ms":1000,"result_projection_policy":"bounded_json","result_schema_ref":"https://muc.wiki/campus-agent/schemas/personal-memory-tool-contracts.v1.schema.json#/$defs/PersonalMemoryRecallResult","requires_approval":false,"read_only":true,"payload_schema_ref":"https://muc.wiki/campus-agent/schemas/personal-memory-tool-contracts.v1.schema.json#/$defs/PersonalMemoryRecallPayload","name":"personal_memory_recall","handler":{"type":"execution_control_internal_query","endpoint":"/internal/memory/personal/recall"},"exposure":"model_visible","description":"Transport schedule lookup."}],"schema_version":"tool-registry-v7","registry_version":"2026-01-01"}`)
	for _, runtimeDir := range []string{prettyDir, compactDir} {
		writeToolContractFingerprintFixture(t, runtimeDir, "tool-function-schemas.v4.json", `{
			"schema_version":"tool-function-schemas-v4",
			"tools":[{
				"type":"function",
				"name":"personal_memory_recall",
				"description":"Transport schedule lookup.",
				"strict":true,
				"parameters":{"type":"object","additionalProperties":false,"properties":{"query_text":{"type":"string"}},"required":["query_text"]}
			}]
		}`)
	}

	pretty, err := buildToolContractFingerprint(
		filepath.Join(prettyDir, "tools.v7.json"),
		filepath.Join(prettyDir, "tool-function-schemas.v4.json"),
	)
	if err != nil {
		t.Fatalf("build pretty fingerprint: %v", err)
	}
	compact, err := buildToolContractFingerprint(
		filepath.Join(compactDir, "tools.v7.json"),
		filepath.Join(compactDir, "tool-function-schemas.v4.json"),
	)
	if err != nil {
		t.Fatalf("build compact fingerprint: %v", err)
	}
	if pretty != compact {
		t.Fatalf("fingerprint changed with formatting: %#v / %#v", pretty, compact)
	}
}

func TestCanonicalJSONFileSHA256RefUsesCrossRuntimeJSONStringEscaping(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fixture.json")
	if err := os.WriteFile(path, []byte(`{"text":"<>&\u2028\u2029"}`), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	got, err := canonicalJSONFileSHA256Ref(path)
	if err != nil {
		t.Fatalf("hash fixture: %v", err)
	}
	if got != "sha256:f76b184a282afc49a59a9e49f5c2a688997c9919f2fc342e7c8bc4aca61c9bc2" {
		t.Fatalf("cross-runtime JSON string hash = %q", got)
	}
}

func TestToolContractFingerprintRejectsMalformedConfig(t *testing.T) {
	dir := t.TempDir()
	writeToolContractFingerprintFixture(t, dir, "tools.v7.json", `{"schema_version":"wrong","registry_version":"2026-01-01","tools":[]}`)
	writeToolContractFingerprintFixture(t, dir, "tool-function-schemas.v4.json", `{"schema_version":"tool-function-schemas-v4","tools":[]}`)
	if _, err := buildToolContractFingerprint(
		filepath.Join(dir, "tools.v7.json"),
		filepath.Join(dir, "tool-function-schemas.v4.json"),
	); err == nil {
		t.Fatal("buildToolContractFingerprint accepted malformed tool registry")
	}
}

func TestExecutionControlToolContractIgnoresDeploymentRelease(t *testing.T) {
	admitted, err := buildToolContractFingerprint("", "")
	if err != nil {
		t.Fatalf("build admitted tool contract: %v", err)
	}
	for _, release := range []string{"execution-control@first", "execution-control@next"} {
		service := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
			ToolContract: Files{},
		})
		if err := service.ValidateLocalToolContractFingerprintMap(
			execution.ToolContractFingerprintSnapshotMap(admitted),
		); err != nil {
			t.Fatalf("deployment release %q changed tool compatibility: %v", release, err)
		}
	}
}

func writeToolContractFingerprintFixture(t *testing.T, dir string, name string, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}
