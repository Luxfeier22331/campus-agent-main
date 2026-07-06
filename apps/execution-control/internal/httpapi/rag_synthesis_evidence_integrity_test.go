package httpapi

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestRAGSynthesisFinalizedResponseDoesNotDefaultGroundingVerdict(t *testing.T) {
	run := execution.DurableRun{
		RequestID: "req-rag-finalization",
		RunID:     "run-rag-finalization",
		TraceID:   "trace-rag-finalization",
	}
	packet := ragSynthesisPacket{
		OutputSchemaID: "rag_answer_v2",
		PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
	}
	llmIOFingerprint := mustRAGSynthesisFingerprintForTest(t, run, packet)
	response, err := ragSynthesisFinalizedResponse(
		run,
		packet,
		ragSynthesisResult{
			AnswerText: "学生应按规定办理请假手续。",
			Confidence: "high",
			ProviderSummary: provider.ExecutionSummary{
				ProviderRequestRef: "provider://requests/run-rag-finalization/synthesis",
				ModelName:          "gpt-5-mini",
				ModelProvider:      "openai",
				SchemaVersion:      "provider_execution_summary_v1",
			},
			LLMIOFingerprint:        llmIOFingerprint,
			PromptTrace:             ragSynthesisPromptTrace("openai", "gpt-5-mini"),
			ProviderProfileRevision: "rag_synthesis:provider_profile_rag:4",
			SemanticOutcome:         "answer_from_selected_evidence",
		},
		nil,
	)
	if err != nil {
		t.Fatalf("finalize rag synthesis response: %v", err)
	}

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
	packet := ragSynthesisPacket{
		OutputSchemaID: "rag_answer_v2",
		PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
	}
	run := execution.DurableRun{
		RequestID: "req-rag-finalization",
		RunID:     "run-rag-finalization",
		TraceID:   "trace-rag-finalization",
	}
	llmIOFingerprint := mustRAGSynthesisFingerprintForTest(t, run, packet)
	response, err := ragSynthesisFinalizedResponse(
		run,
		packet,
		ragSynthesisResult{
			AnswerText: "学生应按规定办理请假手续。",
			Confidence: "high",
			ProviderSummary: provider.ExecutionSummary{
				ProviderRequestRef: "provider://requests/run-rag-finalization/synthesis",
				ModelName:          "gpt-5-mini",
				ModelProvider:      "openai",
				ProviderResponseID: "resp-rag-finalization",
				SchemaVersion:      "provider_execution_summary_v1",
			},
			LLMIOFingerprint: llmIOFingerprint,
			PromptTrace:      ragSynthesisPromptTrace("openai", "gpt-5-mini"),
			SemanticOutcome:  "answer_from_selected_evidence",
		},
		nil,
	)
	if err != nil {
		t.Fatalf("finalize rag synthesis response: %v", err)
	}

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
	if _, exists := observability["prompt_trace"].(map[string]any); !exists {
		t.Fatalf("observability.prompt_trace missing: %#v", observability)
	}
	debugTraceRefs, ok := response["debug_trace_refs"].([]any)
	if !ok || len(debugTraceRefs) != 1 {
		t.Fatalf("debug_trace_refs = %#v, want one execution-control projection ref", response["debug_trace_refs"])
	}
	debugTraceRef, ok := debugTraceRefs[0].(map[string]any)
	if !ok ||
		debugTraceRef["sink"] != "execution_control_projection" ||
		debugTraceRef["trace_id"] != "trace-rag-finalization" ||
		debugTraceRef["trace_ref"] != "projection://runs/run-rag-finalization/synthesis/observability" {
		t.Fatalf("debug trace ref = %#v", debugTraceRef)
	}
	if _, exists := observability["llm_io_fingerprint"].(map[string]any); !exists {
		t.Fatalf("observability.llm_io_fingerprint missing: %#v", observability)
	}
	answerFingerprint, ok := observability["answer_eval_fingerprint"].(map[string]any)
	if !ok {
		t.Fatalf("observability.answer_eval_fingerprint missing: %#v", observability)
	}
	if answerFingerprint["schema_version"] != "answer_eval_fingerprint.v1" ||
		answerFingerprint["llm_call_site"] != "rag.synthesis" ||
		answerFingerprint["selected_tool"] != "knowledge_query" ||
		answerFingerprint["terminal_outcome"] != "grounded_answer" {
		t.Fatalf("answer_eval_fingerprint = %#v", answerFingerprint)
	}
	branchIdentity, ok := answerFingerprint["branch_identity"].(map[string]any)
	if !ok {
		t.Fatalf("answer_eval_fingerprint.branch_identity = %#v", answerFingerprint["branch_identity"])
	}
	if branchIdentity["prompt_id"] != ragSynthesisPromptID ||
		branchIdentity["branch_kind"] != "rag_synthesis" ||
		branchIdentity["workflow_mode"] != "single_step" {
		t.Fatalf("branch identity = %#v, want rag synthesis prompt plus rag_synthesis branch", branchIdentity)
	}
	diagnostics, ok := nestedMapValue(response, "result", "diagnostics")
	if !ok {
		t.Fatalf("result.diagnostics missing: %#v", response)
	}
	diagnosticsRecord, ok := diagnostics.(map[string]any)
	if !ok {
		t.Fatalf("result.diagnostics = %#v", diagnostics)
	}
	diagnosticsPromptTrace, ok := diagnosticsRecord["prompt_trace"].(map[string]any)
	if !ok {
		t.Fatalf("result.diagnostics.prompt_trace missing: %#v", diagnosticsRecord)
	}
	if diagnosticsPromptTrace["prompt_id"] != ragSynthesisPromptID ||
		diagnosticsPromptTrace["template_sha256"] == "" {
		t.Fatalf("diagnostics prompt trace = %#v", diagnosticsPromptTrace)
	}
	serialized, err := json.Marshal(observability)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	for _, forbidden := range []string{
		"学生应按规定办理请假手续。",
		"provider_request_body",
		"provider_response_body",
		"raw_prompt",
	} {
		if strings.Contains(string(serialized), forbidden) {
			t.Fatalf("safe observability leaked forbidden value %q: %s", forbidden, serialized)
		}
	}
}

func TestRAGSynthesisFinalizedResponseFailsClosedWithoutPromptTrace(t *testing.T) {
	run := execution.DurableRun{
		RequestID: "req-rag-finalization",
		RunID:     "run-rag-finalization",
		TraceID:   "trace-rag-finalization",
	}
	packet := ragSynthesisPacket{
		OutputSchemaID: "rag_answer_v2",
		PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		QueryIntent:    "学生请假手续",
		RequestID:      "req-rag-finalization",
		RunID:          "run-rag-finalization",
		StepID:         "synthesis",
	}
	_, err := ragSynthesisFinalizedResponse(
		run,
		packet,
		ragSynthesisResult{
			AnswerText:       "学生应按规定办理请假手续。",
			Confidence:       "high",
			LLMIOFingerprint: mustRAGSynthesisFingerprintForTest(t, run, packet),
			ProviderSummary: provider.ExecutionSummary{
				ModelName:     "gpt-5-mini",
				ModelProvider: "openai",
				SchemaVersion: "provider_execution_summary_v1",
			},
			SemanticOutcome: "answer_from_selected_evidence",
		},
		nil,
	)
	if err == nil || !strings.Contains(err.Error(), "prompt_trace") {
		t.Fatalf("error = %v, want prompt_trace fail closed", err)
	}
}

func TestRAGSynthesisFinalizedResponseFailsClosedWithoutLLMIOFingerprint(t *testing.T) {
	run := execution.DurableRun{
		RequestID: "req-rag-finalization",
		RunID:     "run-rag-finalization",
		TraceID:   "trace-rag-finalization",
	}
	packet := ragSynthesisPacket{
		OutputSchemaID: "rag_answer_v2",
		PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		QueryIntent:    "学生请假手续",
		RequestID:      "req-rag-finalization",
		RunID:          "run-rag-finalization",
		StepID:         "synthesis",
	}
	_, err := ragSynthesisFinalizedResponse(
		run,
		packet,
		ragSynthesisResult{
			AnswerText: "学生应按规定办理请假手续。",
			Confidence: "high",
			PromptTrace: ragSynthesisPromptTrace(
				"openai",
				"gpt-5-mini",
			),
			ProviderSummary: provider.ExecutionSummary{
				ModelName:     "gpt-5-mini",
				ModelProvider: "openai",
				SchemaVersion: "provider_execution_summary_v1",
			},
			SemanticOutcome: "answer_from_selected_evidence",
		},
		nil,
	)
	if err == nil || !strings.Contains(err.Error(), "llm_io_fingerprint") {
		t.Fatalf("error = %v, want llm_io_fingerprint fail closed", err)
	}
}

func mustRAGSynthesisFingerprintForTest(
	t *testing.T,
	run execution.DurableRun,
	packet ragSynthesisPacket,
) map[string]any {
	t.Helper()
	fingerprint, err := ragSynthesisLLMIOFingerprint(ragSynthesisFingerprintInput{
		modelName:     "gpt-5-mini",
		modelProvider: "openai",
		packet:        packet,
		providerProfileRevision: providerProfileRevisionFingerprint(providerConfigSnapshot{
			Role:      string(providerConfigRoleRAGSynthesis),
			ProfileID: "rag-default",
			Revision:  3,
		}),
		renderedInput: ragProviderInput(packet),
		requestID:     run.RequestID,
		run:           run,
	})
	if err != nil {
		t.Fatalf("build rag synthesis fingerprint: %v", err)
	}
	return fingerprint
}
