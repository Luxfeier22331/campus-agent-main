package ragruntime

import "testing"

func TestValidatePlanProjectionRejectsUnsafeRawPayload(t *testing.T) {
	plan := validPlanProjection()
	plan.UnsafeDebug = map[string]any{
		"source_body": "raw source body must never enter the projection",
	}
	if err := ValidatePlanProjection(plan); err == nil {
		t.Fatal("unsafe raw source payload must fail closed")
	}
}

func TestValidateEvidenceSelectionRequiresBoundedEvidence(t *testing.T) {
	selection := EvidenceSelectionResult{
		CandidateCount: 1,
		CoverageStatus: "supported",
		EvidenceRef:    "projection://runs/run-1/evidence/selection",
		PayloadSHA256:  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		RunID:          "run-1",
		SchemaVersion:  "evidence_selection_result_v1",
		SelectedEvidence: []EvidenceRef{
			{
				ChunkID:   "chunk-1",
				Excerpt:   "学生应按照学校规定办理手续。",
				SourceID:  "doc-1",
				SourceRef: "source://student_rules/doc-1",
				SpanRef:   "span://doc-1/chunk-1#0-20",
				Title:     "学生手册",
			},
		},
		SupportingEvidenceCount: 1,
	}
	if err := ValidateEvidenceSelection(selection); err != nil {
		t.Fatalf("validate evidence selection: %v", err)
	}

	selection.SelectedEvidence[0].Excerpt = longString(1201)
	if err := ValidateEvidenceSelection(selection); err == nil {
		t.Fatal("unbounded evidence excerpt must fail closed")
	}
}

func TestValidateSynthesisPacketRequiresEvidenceSelectionOutput(t *testing.T) {
	packet := SynthesisPacketProjection{
		OutputSchemaID: "rag_answer_v2",
		PayloadSHA256:  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		PromptRefs:     []string{"prompt://rag/rag_answer_v2"},
		QueryIntent:    "policy_answer",
		RequestID:      "req-1",
		RunID:          "run-1",
		SelectedEvidence: []EvidenceRef{
			{
				ChunkID:   "chunk-1",
				Excerpt:   "学生应按照学校规定办理手续。",
				SourceID:  "doc-1",
				SourceRef: "source://student_rules/doc-1",
				SpanRef:   "span://doc-1/chunk-1#0-20",
			},
		},
		StepID: "synthesis",
	}
	if err := ValidateSynthesisPacket(packet); err != nil {
		t.Fatalf("validate synthesis packet: %v", err)
	}

	packet.SelectedEvidence = nil
	if err := ValidateSynthesisPacket(packet); err == nil {
		t.Fatal("synthesis packet without selected evidence must fail closed")
	}
}

func validPlanProjection() PlanProjection {
	return PlanProjection{
		Collection:               "student_rules",
		CollectionAlias:          "student_rules",
		Corpus:                   "regulations",
		NoWideningPolicy:         true,
		PayloadSHA256:            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		QueryMode:                "current",
		QueryText:                "学生请假手续",
		RequestID:                "req-1",
		RequiredEvidenceContract: "answer_bearing_evidence",
		RunID:                    "run-1",
		SchemaVersion:            "rag_plan_projection_v1",
		StepID:                   "rag.plan",
		TopK:                     8,
	}
}

func longString(length int) string {
	bytes := make([]byte, length)
	for index := range bytes {
		bytes[index] = 'x'
	}
	return string(bytes)
}
