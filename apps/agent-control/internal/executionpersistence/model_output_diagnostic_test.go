package executionpersistence

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"testing"
	"time"
)

func TestModelOutputDiagnosticDoesNotChangeImmutableResult(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Now().UTC()
	const id = "model-output-diagnostic"
	createRunProjectionForTest(t, store, id, "conv-model-output", now)
	result := stepResultProjectionForImmutabilityTest(id, now)
	if _, err := store.UpsertStepResult(t.Context(), result); err != nil {
		t.Fatal(err)
	}
	diagnostic := execution.ModelOutputDiagnostic{SchemaVersion: 1, Text: "bad", OriginalUTF8Bytes: 3, ValidationStage: "json_parse", OutputSchema: "executor_output"}
	if err := store.RecordModelOutputDiagnostic(t.Context(), id, result.ResultID, diagnostic); err != nil {
		t.Fatal(err)
	}
	key := execution.StepResultKey(id, result.ResultID)
	if store.modelOutputDiagnostics[key].Text != "bad" {
		t.Fatal("diagnostic missing")
	}
	diagnostic.Text = "new"
	if err := store.RecordModelOutputDiagnostic(t.Context(), id, result.ResultID, diagnostic); err != nil {
		t.Fatal(err)
	}
	if store.modelOutputDiagnostics[key].Text != "bad" {
		t.Fatal("diagnostic overwritten")
	}
	if _, err := store.UpsertStepResult(t.Context(), result); err != nil {
		t.Fatalf("diagnostics changed replay: %v", err)
	}
	if err := store.RecordModelOutputDiagnostic(t.Context(), id, "deleted-result", diagnostic); err != nil {
		t.Fatal(err)
	}
	if len(store.modelOutputDiagnostics) != 1 {
		t.Fatal("diagnostic recreated missing result")
	}
}
