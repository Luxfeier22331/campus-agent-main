package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestRAGSynthesisFinalizedResponseDoesNotDefaultGroundingVerdict(t *testing.T) {
	response := ragSynthesisFinalizedResponse(
		execution.DurableRun{RunID: "run-rag-finalization"},
		ragSynthesisPacket{
			OutputSchemaID: "rag_answer_v2",
			QueryIntent:    "学生请假手续",
			RequestID:      "req-rag-finalization",
			RunID:          "run-rag-finalization",
			SelectedEvidence: []ragruntime.EvidenceRef{
				{
					ChunkID:   "chunk-1",
					Excerpt:   "学生应按规定办理请假手续。",
					SourceID:  "source-1",
					SourceRef: "source://student-rules/chunk-1",
					SpanRef:   "span-1",
					Title:     "学生管理规定",
				},
			},
			StepID: "synthesis",
		},
		ragSynthesisResult{
			AnswerText: "学生应按规定办理请假手续。",
			Confidence: "high",
			ProviderSummary: provider.ExecutionSummary{
				ProviderRequestRef: "provider://requests/run-rag-finalization/synthesis",
				SchemaVersion:      "provider_execution_summary_v1",
			},
			SemanticOutcome: "answer_from_selected_evidence",
		},
	)

	diagnostics, ok := nestedMapValue(response, "result", "diagnostics")
	if !ok {
		t.Fatalf("finalized response missing diagnostics: %#v", response)
	}
	diagnosticRecord, ok := diagnostics.(map[string]any)
	if !ok {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	if diagnosticRecord["grounding_verdict"] == "grounded" {
		t.Fatalf("empty Go RAG grounding verdict must not be promoted to grounded: %#v", diagnosticRecord)
	}
	if diagnosticRecord["verification_kind"] != "evidence_integrity" {
		t.Fatalf("verification_kind = %v, want evidence_integrity", diagnosticRecord["verification_kind"])
	}
}

func TestRAGSynthesisFinalizedResponseProjectsModelExecutionState(t *testing.T) {
	response := ragSynthesisFinalizedResponse(
		execution.DurableRun{RunID: "run-rag-finalization"},
		ragSynthesisPacket{
			OutputSchemaID: "rag_answer_v2",
			QueryIntent:    "学生请假手续",
			RequestID:      "req-rag-finalization",
			RunID:          "run-rag-finalization",
			SelectedEvidence: []ragruntime.EvidenceRef{
				{
					ChunkID:   "chunk-1",
					Excerpt:   "学生应按规定办理请假手续。",
					SourceID:  "source-1",
					SourceRef: "source://student-rules/chunk-1",
					SpanRef:   "span-1",
					Title:     "学生管理规定",
				},
			},
			StepID: "synthesis",
		},
		ragSynthesisResult{
			AnswerText: "学生应按规定办理请假手续。",
			Confidence: "high",
			ProviderSummary: provider.ExecutionSummary{
				ProviderRequestRef: "provider://requests/run-rag-finalization/synthesis",
				SchemaVersion:      "provider_execution_summary_v1",
			},
			SemanticOutcome: "answer_from_selected_evidence",
		},
	)

	observability, ok := response["observability"].(map[string]any)
	if !ok {
		t.Fatalf("finalized response missing observability: %#v", response)
	}
	if observability["model_execution_state"] != "go_provider_synthesis_completed" {
		t.Fatalf(
			"model_execution_state = %v, want go_provider_synthesis_completed",
			observability["model_execution_state"],
		)
	}
	if observability["model_execution_detail"] != "provider_execution_summary_v1" {
		t.Fatalf(
			"model_execution_detail = %v, want provider_execution_summary_v1",
			observability["model_execution_detail"],
		)
	}
}
