package finalization

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
)

func TestNoticeCitationRecoveryAcceptsReleasedAt(t *testing.T) {
	item := citationSearchItem("notice", "a")
	item.ReleasedAt = "2026-10-01T08:00:00Z"
	adapter := &FinalizationService{Writer: &activityprojection.Writer{RunProjectionStore: executionpersistence.NewInMemoryRunProjectionStore()}}
	response, err := adapter.WorkflowFinalizedResponse(t.Context(), execution.DurableRun{RequestID: "notice-recovery"}, map[string]any{
		"final_output": "申请要求 [1]", "tool_results": []map[string]any{citationToolResult([]campussearch.SearchResultItem{item}, 1)},
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateRecoveryResponseFields(encoded); err != nil {
		t.Fatal(err)
	}
	var restored recoveryResponse
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if len(restored.Result.Sources) != 1 || restored.Result.Sources[0].ReleasedAt != item.ReleasedAt {
		t.Fatalf("sources = %#v", restored.Result.Sources)
	}
	sources := WorkflowToolResultMaps(response["result"].(map[string]any)["sources"])
	if sources[0]["released_at"] != item.ReleasedAt {
		t.Fatalf("source = %#v", sources[0])
	}
	sources[0]["unknown_field"] = true
	response["result"].(map[string]any)["sources"] = sources
	encoded, err = json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateRecoveryResponseFields(encoded); err == nil || !strings.Contains(err.Error(), "unknown_field") {
		t.Fatalf("unknown field error = %v", err)
	}
}
