package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
)

func TestDurableRunFromCreateBodyPersistsOnlyV5InputReferenceMetadata(t *testing.T) {
	body, err := json.Marshal(map[string]any{
		"conversation_id":                "conversation-v3-metadata-001",
		"request_id":                     "request-v3-metadata-001",
		"owner_user_id":                  "user-v3-metadata-001",
		"personal_memory_recall_allowed": false,
		"surface":                        "campus-web",
		"metadata": map[string]any{
			"execution_contract_version": contracts.ExecutionContractVersion,
			"execution_input_ref":        "app-api://execution-inputs/request-v3-metadata-001",
			"execution_input_sha256":     strings.Repeat("a", 64),
		},
	})
	if err != nil {
		t.Fatalf("marshal create request: %v", err)
	}

	run, _, err := durableRunFromCreateBody(body, time.Now().UTC(), "campus-agent.workflow.v3")
	if err != nil {
		t.Fatalf("durableRunFromCreateBody returned error: %v", err)
	}
	if len(run.Metadata) != 3 {
		t.Fatalf("metadata fields = %#v, want exactly three v4 reference fields", run.Metadata)
	}
	want := map[string]any{
		"execution_contract_version": contracts.ExecutionContractVersion,
		"execution_input_ref":        "app-api://execution-inputs/request-v3-metadata-001",
		"execution_input_sha256":     strings.Repeat("a", 64),
	}
	for key, value := range want {
		if run.Metadata[key] != value {
			t.Fatalf("metadata[%q] = %#v, want %#v", key, run.Metadata[key], value)
		}
	}
	if _, exists := run.Metadata["execution_payload"]; exists {
		t.Fatalf("metadata must not contain raw execution payload: %#v", run.Metadata)
	}
}
