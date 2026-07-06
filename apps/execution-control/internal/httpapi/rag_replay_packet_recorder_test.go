package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type memoryReplayObjectWriter struct {
	objectRef string
	body      []byte
}

type memoryReplayPacketIndexPublisher struct {
	payload *ragReplayPacketIndexIngest
}

func (writer *memoryReplayObjectWriter) WriteReplayObject(
	_ context.Context,
	key string,
	body []byte,
) (string, error) {
	writer.objectRef = "s3://llm-replay/" + key
	writer.body = append([]byte{}, body...)
	return writer.objectRef, nil
}

func (publisher *memoryReplayPacketIndexPublisher) PublishReplayPacketIndex(
	_ context.Context,
	payload ragReplayPacketIndexIngest,
) error {
	publisher.payload = &payload
	return nil
}

func TestRAGReplayPacketRecorderSkipsWhenPolicyDoesNotAdmitS3Packet(t *testing.T) {
	writer := &memoryReplayObjectWriter{}
	indexPublisher := &memoryReplayPacketIndexPublisher{}
	recorder := ragReplayPacketRecorder{
		indexPublisher:   indexPublisher,
		writer:           writer,
		encryptionKeyRef: "kms:test",
		runtimeRelease:   "execution-control@test",
		now:              func() time.Time { return time.Date(2026, 7, 5, 8, 0, 0, 0, time.UTC) },
	}

	ref, err := recorder.RecordRAGSynthesisReplayPacket(t.Context(), ragReplayPacketRecordInput{
		debugTraceConfig: llmDebugTraceConfig{
			SchemaVersion: "llm_debug_trace_config.v1",
			Mode:          "off",
			SampleRatio:   1,
		},
		llmIOFingerprint: validReplayFingerprintForTest(),
		packet:           validRAGSynthesisPacketForTest(),
		run:              replayDurableRunForTest(),
		synthesisResult: ragSynthesisResult{
			ProviderSummary: provider.ExecutionSummary{
				ModelName:          "gpt-5-mini",
				ModelProvider:      "openai",
				ProviderRequestRef: "provider://requests/run-rag-provider/synthesis",
				ProviderResponseID: "resp_rag_123",
			},
			ProviderBody: []byte(`{"id":"resp_rag_123","status":"completed"}`),
		},
	})
	if err != nil {
		t.Fatalf("RecordRAGSynthesisReplayPacket returned error: %v", err)
	}
	if ref != nil {
		t.Fatalf("ref = %#v, want nil", ref)
	}
	if len(writer.body) != 0 {
		t.Fatalf("writer body length = %d, want 0", len(writer.body))
	}
	if indexPublisher.payload != nil {
		t.Fatalf("index payload = %#v, want nil", indexPublisher.payload)
	}
}

func TestRAGReplayPacketRecorderWritesOnlyPolicyAllowedRawFields(t *testing.T) {
	writer := &memoryReplayObjectWriter{}
	indexPublisher := &memoryReplayPacketIndexPublisher{}
	now := time.Date(2026, 7, 5, 8, 0, 0, 0, time.UTC)
	recorder := ragReplayPacketRecorder{
		indexPublisher:   indexPublisher,
		writer:           writer,
		encryptionKeyRef: "kms:test",
		runtimeRelease:   "execution-control@test",
		now:              func() time.Time { return now },
	}
	fingerprint := validReplayFingerprintForTest()

	ref, err := recorder.RecordRAGSynthesisReplayPacket(t.Context(), ragReplayPacketRecordInput{
		debugTraceConfig: llmDebugTraceConfig{
			SchemaVersion:  "llm_debug_trace_config.v1",
			Mode:           "off",
			SampleRatio:    1,
			IncludeModelIO: false,
			RawCapturePolicy: &rawCapturePolicy{
				SchemaVersion:             "raw_capture_policy.v1",
				Mode:                      "manual_run_capture",
				CaptureReason:             "operator approved rag badcase",
				TTLDays:                   7,
				AllowedSinks:              []string{"s3_replay_packet"},
				AllowedRawFields:          []string{"rendered_messages", "provider_response_body", "selected_evidence_packet"},
				OperatorPrincipal:         ptrString("operator:test"),
				ApprovalRef:               ptrString("approval:test"),
				RequestID:                 ptrString("req-rag-provider"),
				RunID:                     ptrString("run-rag-provider"),
				TraceID:                   ptrString("trace-rag-provider"),
				AuditRequired:             true,
				DSARDeleteLinkageRequired: true,
			},
		},
		llmIOFingerprint: fingerprint,
		packet:           validRAGSynthesisPacketForTest(),
		run:              replayDurableRunForTest(),
		synthesisResult: ragSynthesisResult{
			ProviderSummary: provider.ExecutionSummary{
				ModelName:          "gpt-5-mini",
				ModelProvider:      "openai",
				ProviderRequestRef: "provider://requests/run-rag-provider/synthesis",
				ProviderResponseID: "resp_rag_123",
			},
			ProviderBody: []byte(`{"id":"resp_rag_123","status":"completed"}`),
		},
	})
	if err != nil {
		t.Fatalf("RecordRAGSynthesisReplayPacket returned error: %v", err)
	}
	if ref == nil {
		t.Fatal("ref missing")
	}
	if ref.SchemaVersion != "llm_replay_packet_index_ref.v1" ||
		ref.ObjectRef != writer.objectRef ||
		ref.EncryptionKeyRef != "kms:test" ||
		ref.ObjectChecksumSHA256 == "" ||
		ref.ExpiresAt != now.AddDate(0, 0, 7).Format(time.RFC3339) {
		t.Fatalf("unexpected ref = %#v", ref)
	}

	var packet map[string]any
	if err := json.Unmarshal(writer.body, &packet); err != nil {
		t.Fatalf("decode replay packet: %v", err)
	}
	for _, field := range []string{
		"provider_request_body",
		"selected_memory_context",
		"tool_calls",
		"tool_results",
		"provider_stream_deltas",
		"output_schema",
	} {
		if _, exists := packet[field]; exists {
			t.Fatalf("packet contains disallowed raw field %s: %s", field, string(writer.body))
		}
	}
	for _, field := range []string{"rendered_messages", "provider_response_body", "selected_evidence_packet"} {
		if _, exists := packet[field]; !exists {
			t.Fatalf("packet missing allowed raw field %s: %s", field, string(writer.body))
		}
	}
	serialized := string(writer.body)
	if strings.Contains(serialized, "provider_request_body") {
		t.Fatalf("packet leaked disallowed provider request body: %s", serialized)
	}
	if packet["object_checksum_sha256"] != ref.ObjectChecksumSHA256 {
		t.Fatalf("packet checksum = %v, ref checksum = %v", packet["object_checksum_sha256"], ref.ObjectChecksumSHA256)
	}
	for _, field := range []string{"retention", "access_audit", "evidence_replay_index"} {
		if _, exists := packet[field]; !exists {
			t.Fatalf("packet missing %s: %s", field, string(writer.body))
		}
	}
	if indexPublisher.payload == nil {
		t.Fatal("index payload missing")
	}
	if indexPublisher.payload.SchemaVersion != "llm_replay_packet_index.v1" ||
		indexPublisher.payload.PacketID != ref.PacketID ||
		indexPublisher.payload.ObjectRef != ref.ObjectRef ||
		indexPublisher.payload.ObjectChecksumSHA256 != ref.ObjectChecksumSHA256 ||
		indexPublisher.payload.EncryptionKeyRef != "kms:test" {
		t.Fatalf("unexpected index payload = %#v", indexPublisher.payload)
	}
	if indexPublisher.payload.AnswerEvalFingerprint == nil {
		t.Fatalf("index payload missing answer_eval_fingerprint: %#v", indexPublisher.payload)
	}
	if indexPublisher.payload.AnswerEvalFingerprint["schema_version"] != "answer_eval_fingerprint.v1" ||
		indexPublisher.payload.AnswerEvalFingerprint["llm_call_site"] != "rag.synthesis" ||
		indexPublisher.payload.AnswerEvalFingerprint["selected_tool"] != "knowledge_query" ||
		indexPublisher.payload.AnswerEvalFingerprint["terminal_outcome"] != "grounded_answer" {
		t.Fatalf("index answer_eval_fingerprint = %#v", indexPublisher.payload.AnswerEvalFingerprint)
	}
	if _, exists := indexPublisher.payload.AnswerEvalFingerprint["replay_packet_ref"]; exists {
		t.Fatalf(
			"answer_eval_fingerprint must not bind raw replay packet ref: %#v",
			indexPublisher.payload.AnswerEvalFingerprint,
		)
	}
	if indexPublisher.payload.AnswerEvalFingerprint["evidence_replay_index_sha256"] !=
		sha256JSONRef(indexPublisher.payload.EvidenceReplayIndex) {
		t.Fatalf(
			"answer_eval_fingerprint evidence replay hash = %v, want %s",
			indexPublisher.payload.AnswerEvalFingerprint["evidence_replay_index_sha256"],
			sha256JSONRef(indexPublisher.payload.EvidenceReplayIndex),
		)
	}
	if indexPublisher.payload.SinkIdentityProjection == nil {
		t.Fatalf("index payload missing sink_identity_projection: %#v", indexPublisher.payload)
	}
	if indexPublisher.payload.SinkIdentityProjection["schema_version"] != "sink_identity_projection.v1" ||
		!strings.HasPrefix(stringValue(indexPublisher.payload.SinkIdentityProjection["subject_ref"]), "subject:") ||
		!strings.HasPrefix(stringValue(indexPublisher.payload.SinkIdentityProjection["run_ref"]), "run:") ||
		!strings.HasPrefix(stringValue(indexPublisher.payload.SinkIdentityProjection["request_ref"]), "request:") ||
		!strings.HasPrefix(stringValue(indexPublisher.payload.SinkIdentityProjection["trace_ref"]), "trace:") {
		t.Fatalf("index sink_identity_projection = %#v", indexPublisher.payload.SinkIdentityProjection)
	}
	var indexPayload map[string]any
	mustRoundTripJSONForTest(t, indexPublisher.payload, &indexPayload)
	for _, field := range []string{"retention", "access_audit", "evidence_replay_index"} {
		if !jsonEqualForTest(packet[field], indexPayload[field]) {
			t.Fatalf("packet/index %s mismatch: packet=%#v index=%#v", field, packet[field], indexPayload[field])
		}
	}
	serializedIndex, err := json.Marshal(indexPayload)
	if err != nil {
		t.Fatalf("encode index payload: %v", err)
	}
	for _, forbidden := range []string{"Excerpt", "excerpt", "memory_context", "raw_prompt"} {
		if strings.Contains(string(serializedIndex), forbidden) {
			t.Fatalf("index payload leaked raw field %q: %s", forbidden, string(serializedIndex))
		}
	}
	for _, forbiddenKey := range []string{"provider_response_body", "rendered_messages", "selected_evidence_packet"} {
		if replayPacketIndexHasKeyForTest(indexPayload, forbiddenKey) {
			t.Fatalf("index payload leaked raw key %q: %s", forbiddenKey, string(serializedIndex))
		}
	}
}

func TestRAGReplayPacketRecorderRejectsForbiddenRawProviderKeys(t *testing.T) {
	writer := &memoryReplayObjectWriter{}
	indexPublisher := &memoryReplayPacketIndexPublisher{}
	recorder := ragReplayPacketRecorder{
		indexPublisher:   indexPublisher,
		writer:           writer,
		encryptionKeyRef: "kms:test",
		runtimeRelease:   "execution-control@test",
		now:              func() time.Time { return time.Date(2026, 7, 5, 8, 0, 0, 0, time.UTC) },
	}

	_, err := recorder.RecordRAGSynthesisReplayPacket(t.Context(), ragReplayPacketRecordInput{
		debugTraceConfig: llmDebugTraceConfig{
			SchemaVersion:  "llm_debug_trace_config.v1",
			Mode:           "off",
			SampleRatio:    1,
			IncludeModelIO: false,
			RawCapturePolicy: &rawCapturePolicy{
				SchemaVersion:             "raw_capture_policy.v1",
				Mode:                      "manual_run_capture",
				CaptureReason:             "operator approved rag badcase",
				TTLDays:                   7,
				AllowedSinks:              []string{"s3_replay_packet"},
				AllowedRawFields:          []string{"provider_response_body"},
				OperatorPrincipal:         ptrString("operator:test"),
				ApprovalRef:               ptrString("approval:test"),
				RequestID:                 ptrString("req-rag-provider"),
				RunID:                     ptrString("run-rag-provider"),
				TraceID:                   ptrString("trace-rag-provider"),
				AuditRequired:             true,
				DSARDeleteLinkageRequired: true,
			},
		},
		llmIOFingerprint: validReplayFingerprintForTest(),
		packet:           validRAGSynthesisPacketForTest(),
		run:              replayDurableRunForTest(),
		synthesisResult: ragSynthesisResult{
			ProviderSummary: provider.ExecutionSummary{
				ModelName:          "gpt-5-mini",
				ModelProvider:      "openai",
				ProviderRequestRef: "provider://requests/run-rag-provider/synthesis",
				ProviderResponseID: "resp_rag_123",
			},
			ProviderBody: []byte(`{"id":"resp_rag_123","secret_should_not_exist":false}`),
		},
	})
	if err == nil || !strings.Contains(err.Error(), "forbidden") {
		t.Fatalf("error = %v, want forbidden raw provider key", err)
	}
	if len(writer.body) != 0 {
		t.Fatalf("writer body length = %d, want 0 after forbidden raw key", len(writer.body))
	}
	if indexPublisher.payload != nil {
		t.Fatalf("index payload = %#v, want nil after forbidden raw key", indexPublisher.payload)
	}
}

func TestRAGReplayPacketRecorderFailsWhenAdmittedWithoutIndexPublisher(t *testing.T) {
	recorder := ragReplayPacketRecorder{
		writer:           &memoryReplayObjectWriter{},
		encryptionKeyRef: "kms:test",
		runtimeRelease:   "execution-control@test",
		now:              func() time.Time { return time.Date(2026, 7, 5, 8, 0, 0, 0, time.UTC) },
	}

	_, err := recorder.RecordRAGSynthesisReplayPacket(t.Context(), ragReplayPacketRecordInput{
		debugTraceConfig: llmDebugTraceConfig{
			SchemaVersion:  "llm_debug_trace_config.v1",
			Mode:           "off",
			SampleRatio:    1,
			IncludeModelIO: false,
			RawCapturePolicy: &rawCapturePolicy{
				SchemaVersion:             "raw_capture_policy.v1",
				Mode:                      "manual_run_capture",
				CaptureReason:             "operator approved rag badcase",
				TTLDays:                   7,
				AllowedSinks:              []string{"s3_replay_packet"},
				AllowedRawFields:          []string{"rendered_messages"},
				OperatorPrincipal:         ptrString("operator:test"),
				ApprovalRef:               ptrString("approval:test"),
				RequestID:                 ptrString("req-rag-provider"),
				RunID:                     ptrString("run-rag-provider"),
				TraceID:                   ptrString("trace-rag-provider"),
				AuditRequired:             true,
				DSARDeleteLinkageRequired: true,
			},
		},
		llmIOFingerprint: validReplayFingerprintForTest(),
		packet:           validRAGSynthesisPacketForTest(),
		run:              replayDurableRunForTest(),
	})
	if err == nil || !strings.Contains(err.Error(), "app-api replay packet index ingest is required") {
		t.Fatalf("error = %v, want missing app-api replay packet index ingest", err)
	}
}

func TestAppAPIReplayPacketIndexPublisherPostsSafeIndex(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/internal/observability/replay-packet-index" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.Header.Get("x-app-internal-auth") != "shared-secret" {
			t.Fatalf("x-app-internal-auth = %q", request.Header.Get("x-app-internal-auth"))
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode index payload: %v", err)
		}
		_, _ = response.Write([]byte(`{"accepted":1,"packetId":"llm_replay_packet_rag_01"}`))
	}))
	defer server.Close()

	publisher := appAPIReplayPacketIndexPublisher{
		baseURL:      server.URL,
		httpClient:   server.Client(),
		sharedSecret: "shared-secret",
		timeout:      time.Second,
	}
	err := publisher.PublishReplayPacketIndex(t.Context(), ragReplayPacketIndexIngest{
		SchemaVersion:             "llm_replay_packet_index.v1",
		PacketID:                  "llm_replay_packet_rag_01",
		RunID:                     "run_rag_01",
		RequestID:                 "req_rag_01",
		TraceID:                   "trace_rag_01",
		ObjectRef:                 "s3://llm-replay/llm-replay-packets/2026/07/05/llm_replay_packet_rag_01.json",
		ObjectChecksumSHA256:      "sha256:4444444444444444444444444444444444444444444444444444444444444444",
		SensitivityClassification: "restricted_llm_io_with_evidence",
		CapturePolicy: rawCapturePolicy{
			SchemaVersion:             "raw_capture_policy.v1",
			Mode:                      "manual_run_capture",
			CaptureReason:             "operator approved rag badcase",
			TTLDays:                   7,
			AllowedSinks:              []string{"s3_replay_packet"},
			AllowedRawFields:          []string{"rendered_messages"},
			OperatorPrincipal:         ptrString("operator:user_01"),
			ApprovalRef:               ptrString("approval_rag_01"),
			RequestID:                 ptrString("req_rag_01"),
			RunID:                     ptrString("run_rag_01"),
			TraceID:                   ptrString("trace_rag_01"),
			AuditRequired:             true,
			DSARDeleteLinkageRequired: true,
		},
		LLMIOFingerprint: validReplayFingerprintForTest(),
		DeletionLinkage: map[string]any{
			"subject_ref":     "user_rag_01",
			"conversation_id": "conv_rag_01",
			"request_id":      "req_rag_01",
			"trace_id":        "trace_rag_01",
		},
		EncryptionKeyRef: "kms:local-dev-replay",
		Retention: map[string]any{
			"schema_version":               "replay_retention.v1",
			"retention_class":              "safe_replay_packet_index",
			"ttl_days":                     7,
			"created_at":                   "2026-07-05T00:00:00Z",
			"expires_at":                   "2026-07-12T00:00:00Z",
			"dsar_delete_linkage_required": true,
			"deletion_linkage_ref":         "deletion_linkage:llm_replay_packet_rag_01",
		},
		AccessAudit: map[string]any{
			"schema_version":    "replay_access_audit.v1",
			"audit_required":    true,
			"audit_log_ref":     "audit://replay/llm_replay_packet_rag_01",
			"access_policy_ref": "rbac://replay/restricted-operator-eval",
			"last_accessed_at":  nil,
		},
		EvidenceReplayIndex: map[string]any{
			"schema_version":         "evidence_replay_index.v1",
			"evidence_packet_sha256": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
			"evidence_profile_ref":   "rag_evidence_profile.v1",
			"evidence_ref_count":     0,
			"evidence_refs":          []map[string]any{},
		},
		CreatedAt: "2026-07-05T00:00:00Z",
		ExpiresAt: "2026-07-12T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("PublishReplayPacketIndex returned error: %v", err)
	}
	if captured["schema_version"] != "llm_replay_packet_index.v1" ||
		captured["packet_id"] != "llm_replay_packet_rag_01" ||
		captured["object_ref"] == "" {
		t.Fatalf("captured payload = %#v", captured)
	}
}

func TestPrimaryAgentSafeLLMIOFingerprintRejectsNestedUnknownAndForbiddenKeys(t *testing.T) {
	for name, mutate := range map[string]func(map[string]any){
		"top level forbidden": func(fingerprint map[string]any) {
			fingerprint["raw_prompt"] = "do not project"
		},
		"top level unknown": func(fingerprint map[string]any) {
			fingerprint["unexpected_projection"] = "do not project"
		},
		"nested unknown": func(fingerprint map[string]any) {
			nested := cloneAnyMapFromMetadata(fingerprint["model_params_projection"])
			nested["unexpected_projection"] = map[string]any{"id": "resp_123"}
			fingerprint["model_params_projection"] = nested
		},
		"deep forbidden": func(fingerprint map[string]any) {
			modelParams := cloneAnyMapFromMetadata(fingerprint["model_params_projection"])
			projected := cloneAnyMapFromMetadata(modelParams["projected_params"])
			projected["nested"] = map[string]any{"tool_arguments": map[string]any{"query": "secret"}}
			modelParams["projected_params"] = projected
			fingerprint["model_params_projection"] = modelParams
		},
	} {
		t.Run(name, func(t *testing.T) {
			fingerprint := validReplayFingerprintForTest()
			mutate(fingerprint)
			if got, ok := primaryAgentSafeLLMIOFingerprint(map[string]any{"llm_io_fingerprint": fingerprint}); ok {
				t.Fatalf("primaryAgentSafeLLMIOFingerprint accepted unsafe fingerprint: %#v", got)
			}
		})
	}
}

func TestPrimaryAgentSafeLLMIOFingerprintRejectsSchemaEnumAndAttestationMismatch(t *testing.T) {
	for name, mutate := range map[string]func(map[string]any){
		"llm call site enum": func(fingerprint map[string]any) {
			fingerprint["llm_call_site"] = "agent.raw"
		},
		"model params schema": func(fingerprint map[string]any) {
			nested := cloneAnyMapFromMetadata(fingerprint["model_params_projection"])
			nested["schema_version"] = "model_params_projection.v2"
			fingerprint["model_params_projection"] = nested
		},
		"provider request schema": func(fingerprint map[string]any) {
			nested := cloneAnyMapFromMetadata(fingerprint["provider_request_safe_hash"])
			nested["redaction_policy"] = "raw"
			fingerprint["provider_request_safe_hash"] = nested
		},
		"primary attestation kind": func(fingerprint map[string]any) {
			nested := cloneAnyMapFromMetadata(fingerprint["primary_attestation"])
			nested["attestation_kind"] = "raw_capture"
			fingerprint["primary_attestation"] = nested
		},
		"model params hash mismatch": func(fingerprint map[string]any) {
			fingerprint["model_params_hash"] = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		},
		"tool attestation hash mismatch": func(fingerprint map[string]any) {
			nested := cloneAnyMapFromMetadata(fingerprint["tool_runtime_attestation"])
			nested["combined_sha256"] = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
			fingerprint["tool_runtime_attestation"] = nested
		},
		"tool attestation registry mismatch": func(fingerprint map[string]any) {
			nested := cloneAnyMapFromMetadata(fingerprint["tool_runtime_attestation"])
			nested["tools_registry_version"] = "2026-07-05"
			fingerprint["tool_runtime_attestation"] = nested
		},
		"tool attestation config refs": func(fingerprint map[string]any) {
			nested := cloneAnyMapFromMetadata(fingerprint["tool_runtime_attestation"])
			nested["config_refs"] = []any{"configs/runtime/tools.v4.json"}
			fingerprint["tool_runtime_attestation"] = nested
		},
	} {
		t.Run(name, func(t *testing.T) {
			fingerprint := validReplayFingerprintForTest()
			mutate(fingerprint)
			if got, ok := primaryAgentSafeLLMIOFingerprint(map[string]any{"llm_io_fingerprint": fingerprint}); ok {
				t.Fatalf("primaryAgentSafeLLMIOFingerprint accepted invalid fingerprint: %#v", got)
			}
		})
	}
}

func TestRAGSynthesisFailsBeforeProviderWhenDebugTraceProjectionMissing(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.observabilityConfigResolver = nil
	server.observabilityConfigErr = errObservabilityConfigResolverNotConfigured
	called := false
	server.ragSynthesisExecutor = &fakeRAGSynthesisExecutor{
		onExecute: func(context.Context) {
			called = true
		},
	}
	server.ragSynthesisErr = nil
	run := replayDurableRunForTest()
	run.Status = execution.DurableRunStatusRunning
	run.TurnID = "turn-rag-provider"
	run.Surface = "campus-web"
	run.SelectedTool = "knowledge_query"
	run.TaskQueue = "campus-agent.workflow"
	run.CreatedAt = time.Date(2026, 7, 5, 8, 0, 0, 0, time.UTC)
	run.UpdatedAt = run.CreatedAt
	planRef := temporalProjectionRef(run.RunID, "plan/rag")
	evidenceRef := temporalProjectionRef(run.RunID, "evidence/selection")
	run.Metadata = map[string]any{
		"temporal_rag": map[string]any{
			"plan_ref":           planRef,
			"evidence_ref":       evidenceRef,
			"plan":               validRAGPlanForReplayTest(t, run),
			"evidence_selection": validRAGEvidenceSelectionForReplayTest(t, run, evidenceRef),
		},
	}
	if _, err := store.CreateRun(context.Background(), run); err != nil {
		t.Fatalf("create run: %v", err)
	}

	_, err := server.SynthesizeRAGAnswerActivity(
		context.Background(),
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			EvidenceRef: evidenceRef,
			RAGPlanRef:  planRef,
			RunID:       "run-rag-provider",
			TraceID:     "trace-rag-provider",
		},
	)
	if err == nil || !errors.Is(err, errObservabilityConfigResolverNotConfigured) {
		t.Fatalf("error = %v, want missing observability config", err)
	}
	if called {
		t.Fatal("rag synthesis provider must not be called without debug trace config")
	}
}

func replayDurableRunForTest() execution.DurableRun {
	return execution.DurableRun{
		RunID:          "run-rag-provider",
		ConversationID: "conv-rag-provider",
		RequestID:      "req-rag-provider",
		TraceID:        "trace-rag-provider",
		OwnerUserID:    "user-rag-provider",
	}
}

func validRAGPlanForReplayTest(t *testing.T, run execution.DurableRun) ragruntime.PlanProjection {
	t.Helper()
	plan := ragruntime.PlanProjection{
		Collection:               "student_rules",
		CollectionAlias:          "regulations__student_rules__current",
		Corpus:                   "regulations",
		NoWideningPolicy:         true,
		PlanID:                   "rag:regulations:student_rules:current",
		QueryMode:                "current",
		QueryText:                "学生请假手续",
		RequestID:                run.RequestID,
		RequiredEvidenceContract: "answer_bearing_evidence",
		RetrievalAccess: ragruntime.RetrievalAccessProjection{
			PolicyProjectionVersion: "phase1-authorization-projection-v1",
			VisibilityLevel:         "public",
		},
		RunID:         run.RunID,
		SchemaVersion: "rag_plan_projection_v1",
		StepID:        "rag.plan",
		TopK:          4,
	}
	hash, err := ragruntime.HashProjection(plan)
	if err != nil {
		t.Fatalf("hash plan: %v", err)
	}
	plan.PayloadSHA256 = hash
	if err := ragruntime.ValidatePlanProjection(plan); err != nil {
		t.Fatalf("validate plan: %v", err)
	}
	return plan
}

func validRAGEvidenceSelectionForReplayTest(
	t *testing.T,
	run execution.DurableRun,
	evidenceRef string,
) ragruntime.EvidenceSelectionResult {
	t.Helper()
	selection := ragruntime.EvidenceSelectionResult{
		CandidateCount: 1,
		CoverageStatus: "sufficient",
		EvidenceRef:    evidenceRef,
		RunID:          run.RunID,
		SchemaVersion:  "evidence_selection_result_v1",
		SelectedEvidence: []ragruntime.EvidenceRef{{
			ChunkID:         "chunk-1",
			Excerpt:         "学生应当按照学校规定办理请假手续。",
			IsAnswerBearing: true,
			Score:           0.99,
			SourceID:        "student_rules",
			SourceRef:       "source://student_rules",
			SpanRef:         "span://student_rules/chunk-1#0-24",
			Title:           "学生手册",
		}},
		SupportingEvidenceCount: 1,
	}
	hash, err := ragruntime.HashProjection(selection)
	if err != nil {
		t.Fatalf("hash evidence selection: %v", err)
	}
	selection.PayloadSHA256 = hash
	if err := ragruntime.ValidateEvidenceSelection(selection); err != nil {
		t.Fatalf("validate evidence selection: %v", err)
	}
	return selection
}

func validReplayFingerprintForTest() map[string]any {
	toolRuntime := testToolRuntimeFingerprintMap()
	modelParams := modelParamsProjection(map[string]any{"model": "gpt-5-mini", "provider": "openai"})
	return map[string]any{
		"schema_version":                  "llm_io_fingerprint.v1",
		"run_id":                          "run-rag-provider",
		"request_id":                      "req-rag-provider",
		"trace_id":                        "trace-rag-provider",
		"runtime_release":                 "execution-control@test",
		"llm_call_site":                   "rag.synthesis",
		"provider_profile_revision":       "rag_synthesis:provider_profile_rag:4",
		"provider":                        "openai",
		"model":                           "gpt-5-mini",
		"model_params_hash":               modelParams["params_sha256"],
		"model_params_projection":         modelParams,
		"prompt_id":                       ragSynthesisPromptID,
		"prompt_registry_attestation":     promptRegistryAttestation(ragSynthesisPromptID, "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ragSynthesisPromptVariablesSchemaVersion, "rag_answer_v2"),
		"prompt_template_sha256":          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"prompt_variables_schema_version": ragSynthesisPromptVariablesSchemaVersion,
		"rendered_prompt_sha256":          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		"provider_request_safe_hash":      providerRequestSafeHash(map[string]any{"request": "test"}),
		"tool_catalog_sha256":             "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		"tool_schema_sha256":              "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		"tool_runtime_fingerprint":        testToolRuntimeFingerprintMap(),
		"tool_runtime_attestation":        toolRuntimeAttestation("apps/execution-control", toolRuntime),
		"workflow_artifact_sha256":        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		"context_envelope_sha256":         "sha256:1111111111111111111111111111111111111111111111111111111111111111",
		"memory_selection_sha256":         "sha256:2222222222222222222222222222222222222222222222222222222222222222",
		"evidence_packet_sha256":          "sha256:3333333333333333333333333333333333333333333333333333333333333333",
		"output_schema_id":                "rag_answer_v2",
		"primary_attestation":             primaryAttestation("primary_admitted_rag_synthesis", "apps/execution-control", map[string]any{"test": true}),
	}
}

func mustRoundTripJSONForTest(t *testing.T, source any, target any) {
	t.Helper()
	body, err := json.Marshal(source)
	if err != nil {
		t.Fatalf("encode JSON: %v", err)
	}
	if err := json.Unmarshal(body, target); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
}

func jsonEqualForTest(left any, right any) bool {
	leftBody, err := json.Marshal(left)
	if err != nil {
		return false
	}
	rightBody, err := json.Marshal(right)
	if err != nil {
		return false
	}
	return string(leftBody) == string(rightBody)
}

func replayPacketIndexHasKeyForTest(value any, key string) bool {
	switch typed := value.(type) {
	case map[string]any:
		for itemKey, child := range typed {
			if itemKey == key {
				return true
			}
			if replayPacketIndexHasKeyForTest(child, key) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if replayPacketIndexHasKeyForTest(child, key) {
				return true
			}
		}
	}
	return false
}
