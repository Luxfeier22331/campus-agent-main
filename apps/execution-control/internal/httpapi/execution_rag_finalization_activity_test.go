package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestWriteFinalizationActivityFailsClosedWhenGroundingIsUnsupported(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:          "run-rag-unsupported-grounding",
		ConversationID: "conv-rag-unsupported-grounding",
		TurnID:         "turn-run-rag-unsupported-grounding",
		RequestID:      "req-rag-unsupported-grounding",
		TraceID:        "trace-rag-unsupported-grounding",
		OwnerUserID:    "user-rag",
		Surface:        "public-chat-web",
		Lane:           execution.DurableLaneRAG,
		Status:         execution.DurableRunStatusRunning,
		CreatedAt:      now,
		QueuedAt:       now,
		AdmittedAt:     now,
		StartedAt:      now,
		UpdatedAt:      now,
		Metadata: map[string]any{
			"temporal_rag": map[string]any{
				"finalized_response": map[string]any{
					"answer_text": "学生应按学校规定办理请假手续。",
					"error":       nil,
					"trace_id":    "trace-rag-unsupported-grounding",
				},
				"grounding_ref": "projection://runs/run-rag-unsupported-grounding/grounding/verify",
				"grounding_verification": map[string]any{
					"grounding_ref":      "projection://runs/run-rag-unsupported-grounding/grounding/verify",
					"run_id":             "run-rag-unsupported-grounding",
					"schema_version":     "grounding_verification_result_v1",
					"source_refs":        []any{"source://regulations/student_rules/student_rules"},
					"unsupported_fields": []any{"answer_text"},
					"verdict":            "unsupported",
					"verification_kind":  "evidence_integrity",
				},
				"synthesis_ref": "projection://runs/run-rag-unsupported-grounding/synthesis/provider",
			},
		},
	}); err != nil {
		t.Fatalf("create run: %v", err)
	}

	_, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			GroundingRef: "projection://runs/run-rag-unsupported-grounding/grounding/verify",
			RunID:        "run-rag-unsupported-grounding",
			SynthesisRef: "projection://runs/run-rag-unsupported-grounding/synthesis/provider",
			TraceID:      "trace-rag-unsupported-grounding",
		},
	)
	if err == nil {
		t.Fatal("unsupported grounding verdict must fail finalization")
	}
	if !strings.Contains(err.Error(), "supported") {
		t.Fatalf("error = %v, want supported verdict diagnostic", err)
	}
	run, getErr := store.GetRun(context.Background(), "run-rag-unsupported-grounding")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
	if run.FinalResponseRef != "" {
		t.Fatalf("final response ref = %q, want empty after failed finalization", run.FinalResponseRef)
	}
}
