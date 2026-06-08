package ragpacket

import "testing"

func TestValidateSynthesisPacketAcceptsBoundedProjection(t *testing.T) {
	packet := SynthesisPacketProjection{
		RunID:          "run-123",
		StepID:         "synthesis",
		RequestID:      "req-123",
		QueryIntent:    "policy_answer",
		OutputSchemaID: "rag_answer_v1",
		PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		PromptRefs: []string{
			"prompt://rag/rag_answer_v1",
			"template://rag/rag_answer_v1@2026-06-08",
		},
		SelectedEvidence: []EvidenceRef{
			{
				SourceID:  "doc-1",
				ChunkID:   "chunk-1",
				SpanRef:   "span://doc-1/chunk-1#0-80",
				Title:     "学生手册",
				Excerpt:   "学生应当按照学校规定办理相关手续。",
				SourceRef: "source://regulations/student_rules/doc-1",
			},
		},
	}

	if err := ValidateSynthesisPacket(packet); err != nil {
		t.Fatalf("validate packet: %v", err)
	}
}

func TestValidateSynthesisPacketRejectsUnboundedOrUnsafeProjection(t *testing.T) {
	base := SynthesisPacketProjection{
		RunID:          "run-123",
		StepID:         "synthesis",
		RequestID:      "req-123",
		QueryIntent:    "policy_answer",
		OutputSchemaID: "rag_answer_v1",
		PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		PromptRefs:     []string{"prompt://rag/rag_answer_v1"},
		SelectedEvidence: []EvidenceRef{{
			SourceID:  "doc-1",
			ChunkID:   "chunk-1",
			SpanRef:   "span://doc-1/chunk-1#0-80",
			Excerpt:   "学生应当按照学校规定办理相关手续。",
			SourceRef: "source://regulations/student_rules/doc-1",
		}},
	}
	cases := map[string]SynthesisPacketProjection{
		"raw prompt": func() SynthesisPacketProjection {
			packet := base
			packet.UnsafeDebug = map[string]any{"raw_prompt": "hello"}
			return packet
		}(),
		"provider trace": func() SynthesisPacketProjection {
			packet := base
			packet.UnsafeDebug = map[string]any{"provider_trace": map[string]any{"id": "trace"}}
			return packet
		}(),
		"auth material": func() SynthesisPacketProjection {
			packet := base
			packet.UnsafeDebug = map[string]any{"authorization": "Bearer secret"}
			return packet
		}(),
		"unbounded excerpt": func() SynthesisPacketProjection {
			packet := base
			packet.SelectedEvidence[0].Excerpt = longString(1201)
			return packet
		}(),
		"missing payload hash": func() SynthesisPacketProjection {
			packet := base
			packet.PayloadSHA256 = ""
			return packet
		}(),
	}

	for name, packet := range cases {
		t.Run(name, func(t *testing.T) {
			if err := ValidateSynthesisPacket(packet); err == nil {
				t.Fatal("unsafe synthesis packet must fail closed")
			}
		})
	}
}

func longString(length int) string {
	bytes := make([]byte, length)
	for index := range bytes {
		bytes[index] = 'x'
	}
	return string(bytes)
}
