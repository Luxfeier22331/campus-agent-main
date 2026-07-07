package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const ragReplayPacketSchemaVersion = "llm_replay_packet.v1"

type replayObjectWriter interface {
	WriteReplayObject(context.Context, string, []byte) (string, error)
}

type replayPacketIndexPublisher interface {
	PublishReplayPacketIndex(context.Context, ragReplayPacketIndexIngest) error
}

type ragReplayPacketRecorder struct {
	indexPublisher   replayPacketIndexPublisher
	writer           replayObjectWriter
	encryptionKeyRef string
	runtimeRelease   string
	now              func() time.Time
}

type ragReplayPacketRecordInput struct {
	debugTraceConfig llmDebugTraceConfig
	llmIOFingerprint map[string]any
	packet           ragSynthesisPacket
	run              execution.DurableRun
	synthesisResult  ragSynthesisResult
}

type ragReplayPacketIndexRef struct {
	SchemaVersion             string `json:"schema_version"`
	PacketID                  string `json:"packet_id"`
	ObjectRef                 string `json:"object_ref"`
	ObjectChecksumSHA256      string `json:"object_checksum_sha256"`
	SensitivityClassification string `json:"sensitivity_classification"`
	EncryptionKeyRef          string `json:"encryption_key_ref"`
	CreatedAt                 string `json:"created_at"`
	ExpiresAt                 string `json:"expires_at"`
	ApprovalRef               string `json:"approval_ref,omitempty"`
	OperatorPrincipal         string `json:"operator_principal,omitempty"`
}

func (ref ragReplayPacketIndexRef) ToMap() map[string]any {
	payload := map[string]any{
		"schema_version":             ref.SchemaVersion,
		"packet_id":                  ref.PacketID,
		"object_ref":                 ref.ObjectRef,
		"object_checksum_sha256":     ref.ObjectChecksumSHA256,
		"sensitivity_classification": ref.SensitivityClassification,
		"encryption_key_ref":         ref.EncryptionKeyRef,
		"created_at":                 ref.CreatedAt,
		"expires_at":                 ref.ExpiresAt,
	}
	if strings.TrimSpace(ref.ApprovalRef) != "" {
		payload["approval_ref"] = strings.TrimSpace(ref.ApprovalRef)
	}
	if strings.TrimSpace(ref.OperatorPrincipal) != "" {
		payload["operator_principal"] = strings.TrimSpace(ref.OperatorPrincipal)
	}
	return payload
}

type s3ReplayObjectWriter struct {
	bucket string
	client *s3.Client
	prefix string
}

type ragReplayPacketIndexIngest struct {
	SchemaVersion             string           `json:"schema_version"`
	PacketID                  string           `json:"packet_id"`
	RunID                     string           `json:"run_id"`
	RequestID                 string           `json:"request_id"`
	TraceID                   string           `json:"trace_id"`
	ObjectRef                 string           `json:"object_ref"`
	ObjectChecksumSHA256      string           `json:"object_checksum_sha256"`
	SensitivityClassification string           `json:"sensitivity_classification"`
	CapturePolicy             rawCapturePolicy `json:"capture_policy"`
	LLMIOFingerprint          map[string]any   `json:"llm_io_fingerprint"`
	AnswerEvalFingerprint     map[string]any   `json:"answer_eval_fingerprint,omitempty"`
	DeletionLinkage           map[string]any   `json:"deletion_linkage"`
	EncryptionKeyRef          string           `json:"encryption_key_ref"`
	Retention                 map[string]any   `json:"retention"`
	AccessAudit               map[string]any   `json:"access_audit"`
	EvidenceReplayIndex       map[string]any   `json:"evidence_replay_index"`
	SinkIdentityProjection    map[string]any   `json:"sink_identity_projection,omitempty"`
	ApprovalRef               string           `json:"approval_ref,omitempty"`
	OperatorPrincipal         string           `json:"operator_principal,omitempty"`
	CreatedAt                 string           `json:"created_at"`
	ExpiresAt                 string           `json:"expires_at"`
}

type appAPIReplayPacketIndexPublisher struct {
	baseURL      string
	httpClient   *http.Client
	sharedSecret string
	timeout      time.Duration
}

func newRAGReplayPacketRecorder(cfg config.Config) ragReplayPacketRecorder {
	return ragReplayPacketRecorder{
		indexPublisher: newAppAPIReplayPacketIndexPublisher(appAPIReplayPacketIndexPublisherOptions{
			BaseURL:      cfg.AppAPIInternalBaseURL,
			SharedSecret: cfg.AppAPIInternalSharedSecret,
			TimeoutMS:    cfg.AppAPIInternalTimeoutMS,
		}),
		writer: newS3ReplayObjectWriter(s3ReplayObjectStoreOptions{
			Endpoint:  cfg.ReplayObjectStoreEndpoint,
			AccessKey: cfg.ReplayObjectStoreAccessKey,
			SecretKey: cfg.ReplayObjectStoreSecretKey,
			Region:    cfg.ReplayObjectStoreRegion,
			Bucket:    cfg.ReplayObjectStoreBucket,
			Prefix:    cfg.ReplayObjectStorePrefix,
		}),
		encryptionKeyRef: strings.TrimSpace(cfg.ReplayObjectStoreEncryptionKeyRef),
		runtimeRelease:   strings.TrimSpace(cfg.RuntimeRelease),
		now:              time.Now,
	}
}

type appAPIReplayPacketIndexPublisherOptions struct {
	BaseURL      string
	SharedSecret string
	TimeoutMS    int
}

func newAppAPIReplayPacketIndexPublisher(
	options appAPIReplayPacketIndexPublisherOptions,
) replayPacketIndexPublisher {
	baseURL := strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	sharedSecret := strings.TrimSpace(options.SharedSecret)
	if baseURL == "" || sharedSecret == "" {
		return nil
	}
	timeout := time.Duration(options.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return appAPIReplayPacketIndexPublisher{
		baseURL:      baseURL,
		httpClient:   &http.Client{Timeout: timeout},
		sharedSecret: sharedSecret,
		timeout:      timeout,
	}
}

type s3ReplayObjectStoreOptions struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Region    string
	Bucket    string
	Prefix    string
}

func newS3ReplayObjectWriter(options s3ReplayObjectStoreOptions) replayObjectWriter {
	endpoint := strings.TrimSpace(options.Endpoint)
	accessKey := strings.TrimSpace(options.AccessKey)
	secretKey := strings.TrimSpace(options.SecretKey)
	bucket := strings.TrimSpace(options.Bucket)
	if endpoint == "" || accessKey == "" || secretKey == "" || bucket == "" {
		return nil
	}
	region := defaultString(strings.TrimSpace(options.Region), "us-east-1")
	client := s3.New(s3.Options{
		BaseEndpoint: aws.String(endpoint),
		Credentials: aws.NewCredentialsCache(
			credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		),
		Region:       region,
		UsePathStyle: true,
	})
	return &s3ReplayObjectWriter{
		bucket: bucket,
		client: client,
		prefix: strings.Trim(strings.TrimSpace(options.Prefix), "/"),
	}
}

func (writer *s3ReplayObjectWriter) WriteReplayObject(
	ctx context.Context,
	key string,
	body []byte,
) (string, error) {
	if writer == nil || writer.client == nil || strings.TrimSpace(writer.bucket) == "" {
		return "", errors.New("replay object store is not configured")
	}
	objectKey := strings.Trim(strings.TrimSpace(key), "/")
	if strings.TrimSpace(writer.prefix) != "" {
		objectKey = path.Join(writer.prefix, objectKey)
	}
	_, err := writer.client.PutObject(ctx, &s3.PutObjectInput{
		Body:                 bytes.NewReader(body),
		Bucket:               aws.String(writer.bucket),
		ContentType:          aws.String("application/json"),
		Key:                  aws.String(objectKey),
		ServerSideEncryption: types.ServerSideEncryptionAes256,
	})
	if err != nil {
		return "", fmt.Errorf("write replay packet object: %w", err)
	}
	return "s3://" + writer.bucket + "/" + objectKey, nil
}

func (publisher appAPIReplayPacketIndexPublisher) PublishReplayPacketIndex(
	ctx context.Context,
	payload ragReplayPacketIndexIngest,
) error {
	baseURL := strings.TrimRight(strings.TrimSpace(publisher.baseURL), "/")
	if baseURL == "" {
		return errors.New("app-api internal base URL is required for replay packet index ingest")
	}
	sharedSecret := strings.TrimSpace(publisher.sharedSecret)
	if sharedSecret == "" {
		return errors.New("app-api internal shared secret is required for replay packet index ingest")
	}
	endpoint, err := url.JoinPath(baseURL, "/api/internal/observability/replay-packet-index")
	if err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	timeout := publisher.timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(
		requestCtx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-app-internal-auth", sharedSecret)
	client := publisher.httpClient
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		limited, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("app-api replay packet index ingest returned %d: %s", response.StatusCode, strings.TrimSpace(string(limited)))
	}
	return nil
}

func (recorder ragReplayPacketRecorder) RecordRAGSynthesisReplayPacket(
	ctx context.Context,
	input ragReplayPacketRecordInput,
) (*ragReplayPacketIndexRef, error) {
	policy := input.debugTraceConfig.RawCapturePolicy
	if policy == nil || strings.TrimSpace(policy.Mode) == "off" || !stringSliceContains(policy.AllowedSinks, "s3_replay_packet") {
		return nil, nil
	}
	if recorder.writer == nil {
		return nil, errors.New("replay object store is required when raw_capture_policy allows s3_replay_packet")
	}
	if strings.TrimSpace(recorder.encryptionKeyRef) == "" {
		return nil, errors.New("replay object store encryption key ref is required when raw capture is admitted")
	}
	if recorder.indexPublisher == nil {
		return nil, errors.New("app-api replay packet index ingest is required when raw capture is admitted")
	}
	if err := validateRawCapturePolicy(*policy); err != nil {
		return nil, err
	}
	if err := validateRawCapturePolicyScope(*policy, rawCapturePolicyScope{
		RequestID: defaultString(strings.TrimSpace(input.run.RequestID), strings.TrimSpace(input.packet.RequestID)),
		RunID:     input.run.RunID,
		TraceID:   input.run.TraceID,
	}); err != nil {
		return nil, err
	}
	createdAt := recorder.createdAt()
	expiresAt := createdAt.AddDate(0, 0, policy.TTLDays)
	fingerprint := cloneAnyMapFromMetadata(input.llmIOFingerprint)
	if strings.TrimSpace(recorder.runtimeRelease) != "" {
		fingerprint["runtime_release"] = strings.TrimSpace(recorder.runtimeRelease)
	}
	safeFingerprint, ok := primaryAgentSafeLLMIOFingerprint(map[string]any{"llm_io_fingerprint": fingerprint})
	if !ok {
		return nil, errors.New("rag replay packet requires valid llm_io_fingerprint")
	}
	fingerprint = safeFingerprint
	packetID := ragReplayPacketID(input.run, input.packet, fingerprint)
	retention := ragReplayPacketRetention(*policy, packetID, createdAt, expiresAt)
	accessAudit := ragReplayPacketAccessAudit(*policy, packetID)
	evidenceReplayIndex := ragReplayPacketEvidenceReplayIndex(input.packet, fingerprint)
	answerEvalFingerprint := answerEvalFingerprint(answerEvalFingerprintInput{
		BranchKind:                "rag_synthesis",
		EvidenceReplayIndexSHA256: sha256JSONRef(evidenceReplayIndex),
		LLMIOFingerprint:          fingerprint,
		RunID:                     input.run.RunID,
		SelectedTool:              "knowledge_query",
		SelectedTools:             []string{"knowledge_query"},
		StageTiming:               ragSynthesisAnswerEvalStageProfile(input.packet),
		TerminalOutcome:           ragSynthesisAnswerTerminalOutcome(input.synthesisResult.SemanticOutcome),
		WorkflowMode:              "single_step",
	})
	sinkIdentityProjection, err := ragReplayPacketSinkIdentityProjection(input.run, input.packet)
	if err != nil {
		return nil, err
	}
	deletionLinkage := ragReplayPacketDeletionLinkage(input.run, input.packet)
	payload := map[string]any{
		"schema_version":             ragReplayPacketSchemaVersion,
		"packet_id":                  packetID,
		"run_id":                     strings.TrimSpace(input.run.RunID),
		"request_id":                 defaultString(strings.TrimSpace(input.run.RequestID), strings.TrimSpace(input.packet.RequestID)),
		"trace_id":                   strings.TrimSpace(input.run.TraceID),
		"created_at":                 createdAt.Format(time.RFC3339),
		"expires_at":                 expiresAt.Format(time.RFC3339),
		"capture_policy":             *policy,
		"llm_io_fingerprint":         fingerprint,
		"sensitivity_classification": ragReplayPacketSensitivity(*policy),
		"encryption_key_ref":         strings.TrimSpace(recorder.encryptionKeyRef),
		"deletion_linkage":           deletionLinkage,
		"retention":                  retention,
		"access_audit":               accessAudit,
		"evidence_replay_index":      evidenceReplayIndex,
		"answer_eval_fingerprint":    answerEvalFingerprint,
		"sink_identity_projection":   sinkIdentityProjection,
	}
	addRAGReplayAllowedRawSections(payload, *policy, input)
	if err := validateReplayPacketRawKeySafety(payload); err != nil {
		return nil, err
	}
	checksum := sha256JSONRef(payload)
	payload["object_checksum_sha256"] = checksum
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode rag replay packet: %w", err)
	}
	objectRef, err := recorder.writer.WriteReplayObject(ctx, ragReplayPacketObjectKey(createdAt, packetID), body)
	if err != nil {
		return nil, err
	}
	indexIngest := ragReplayPacketIndexIngest{
		SchemaVersion:             "llm_replay_packet_index.v1",
		PacketID:                  packetID,
		RunID:                     strings.TrimSpace(input.run.RunID),
		RequestID:                 defaultString(strings.TrimSpace(input.run.RequestID), strings.TrimSpace(input.packet.RequestID)),
		TraceID:                   strings.TrimSpace(input.run.TraceID),
		ObjectRef:                 objectRef,
		ObjectChecksumSHA256:      checksum,
		SensitivityClassification: stringValue(payload["sensitivity_classification"]),
		CapturePolicy:             *policy,
		LLMIOFingerprint:          fingerprint,
		AnswerEvalFingerprint:     answerEvalFingerprint,
		DeletionLinkage:           deletionLinkage,
		EncryptionKeyRef:          strings.TrimSpace(recorder.encryptionKeyRef),
		Retention:                 retention,
		AccessAudit:               accessAudit,
		EvidenceReplayIndex:       evidenceReplayIndex,
		SinkIdentityProjection:    sinkIdentityProjection,
		ApprovalRef:               ptrStringValue(policy.ApprovalRef),
		OperatorPrincipal:         ptrStringValue(policy.OperatorPrincipal),
		CreatedAt:                 createdAt.Format(time.RFC3339),
		ExpiresAt:                 expiresAt.Format(time.RFC3339),
	}
	if err := recorder.indexPublisher.PublishReplayPacketIndex(ctx, indexIngest); err != nil {
		return nil, err
	}
	return &ragReplayPacketIndexRef{
		SchemaVersion:             "llm_replay_packet_index_ref.v1",
		PacketID:                  packetID,
		ObjectRef:                 objectRef,
		ObjectChecksumSHA256:      checksum,
		SensitivityClassification: stringValue(payload["sensitivity_classification"]),
		EncryptionKeyRef:          strings.TrimSpace(recorder.encryptionKeyRef),
		CreatedAt:                 createdAt.Format(time.RFC3339),
		ExpiresAt:                 expiresAt.Format(time.RFC3339),
		ApprovalRef:               ptrStringValue(policy.ApprovalRef),
		OperatorPrincipal:         ptrStringValue(policy.OperatorPrincipal),
	}, nil
}

func ragReplayPacketSinkIdentityProjection(
	run execution.DurableRun,
	packet ragSynthesisPacket,
) (map[string]any, error) {
	requestID := defaultString(strings.TrimSpace(run.RequestID), strings.TrimSpace(packet.RequestID))
	refs := map[string]string{
		"subject_ref": pseudonymousReplaySinkRef("subject", strings.TrimSpace(run.OwnerUserID)),
		"run_ref":     pseudonymousReplaySinkRef("run", strings.TrimSpace(run.RunID)),
		"request_ref": pseudonymousReplaySinkRef("request", requestID),
		"trace_ref":   pseudonymousReplaySinkRef("trace", strings.TrimSpace(run.TraceID)),
	}
	for field, value := range refs {
		if strings.TrimSpace(value) == "" {
			return nil, fmt.Errorf("replay sink identity projection requires %s source", field)
		}
	}
	projection := map[string]any{
		"schema_version":          "sink_identity_projection.v1",
		"subject_ref":             refs["subject_ref"],
		"run_ref":                 refs["run_ref"],
		"request_ref":             refs["request_ref"],
		"trace_ref":               refs["trace_ref"],
		"pseudonymization_policy": "pseudonymous_refs_v1",
	}
	projection["projection_sha256"] = sha256JSONRef(projection)
	return projection, nil
}

func pseudonymousReplaySinkRef(prefix string, value string) string {
	normalizedPrefix := strings.TrimSpace(prefix)
	normalizedValue := strings.TrimSpace(value)
	if normalizedPrefix == "" || normalizedValue == "" {
		return ""
	}
	return normalizedPrefix + ":" + strings.TrimPrefix(sha256TextRef(normalizedValue), "sha256:")
}

func (recorder ragReplayPacketRecorder) createdAt() time.Time {
	if recorder.now != nil {
		return recorder.now().UTC()
	}
	return time.Now().UTC()
}

func (s *Server) recordRAGSynthesisReplayPacket(
	ctx context.Context,
	debugTraceConfig llmDebugTraceConfig,
	run execution.DurableRun,
	packet ragSynthesisPacket,
	result ragSynthesisResult,
	llmIOFingerprint map[string]any,
) (*ragReplayPacketIndexRef, error) {
	_ = ctx
	return s.ragReplayPacketRecorder.RecordRAGSynthesisReplayPacket(ctx, ragReplayPacketRecordInput{
		debugTraceConfig: debugTraceConfig,
		llmIOFingerprint: llmIOFingerprint,
		packet:           packet,
		run:              run,
		synthesisResult:  result,
	})
}

func addRAGReplayAllowedRawSections(
	payload map[string]any,
	policy rawCapturePolicy,
	input ragReplayPacketRecordInput,
) {
	for _, field := range policy.AllowedRawFields {
		switch strings.TrimSpace(field) {
		case "rendered_messages":
			payload["rendered_messages"] = ragProviderInput(input.packet)
		case "provider_request_body":
			payload["provider_request_body"] = cloneAnyMapFromMetadata(input.synthesisResult.ProviderRequestBody)
		case "provider_response_body":
			payload["provider_response_body"] = decodeJSONValueOrString(input.synthesisResult.ProviderBody)
		case "selected_evidence_packet":
			payload["selected_evidence_packet"] = map[string]any{
				"payload_sha256":            strings.TrimSpace(input.packet.PayloadSHA256),
				"previous_evidence_context": input.packet.PreviousEvidenceContext,
				"selected_evidence":         input.packet.SelectedEvidence,
			}
		case "selected_memory_context":
			payload["selected_memory_context"] = map[string]any{
				"memory_context":       input.packet.MemoryContext,
				"memory_context_block": strings.TrimSpace(input.packet.MemoryContextBlock),
				"memory_ref":           strings.TrimSpace(input.packet.MemoryRef),
			}
		case "output_schema":
			payload["output_schema"] = ragProviderTextSchema(input.packet)
		case "provider_stream_deltas", "tool_calls", "tool_results":
			// RAG synthesis is a non-streaming provider call and does not execute tools.
		}
	}
}

func decodeJSONValueOrString(body []byte) any {
	if len(body) == 0 {
		return map[string]any{}
	}
	var decoded any
	if err := json.Unmarshal(body, &decoded); err == nil {
		return decoded
	}
	return string(body)
}

var replayPacketForbiddenRawKeys = map[string]bool{
	"api_key":                true,
	"auth":                   true,
	"authorization":          true,
	"bearer":                 true,
	"cookie":                 true,
	"jwt":                    true,
	"object_locator":         true,
	"object_store_key":       true,
	"ocr_dump":               true,
	"password":               true,
	"provider_raw_response":  true,
	"provider_trace":         true,
	"raw_html":               true,
	"raw_ocr_dump":           true,
	"raw_prompt":             true,
	"raw_response":           true,
	"raw_source":             true,
	"raw_sql":                true,
	"raw_tool_result":        true,
	"raw_transcript":         true,
	"retrieval_backend_dump": true,
	"secret":                 true,
	"source_html":            true,
	"sql_rows":               true,
}

func validateReplayPacketRawKeySafety(value any) error {
	return validateReplayPacketRawKeySafetyAt("$", value)
}

func validateReplayPacketRawKeySafetyAt(path string, value any) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			normalized := strings.ToLower(strings.TrimSpace(key))
			if isForbiddenReplayPacketRawKey(normalized) {
				return fmt.Errorf("replay packet raw key %s.%s is forbidden", path, key)
			}
			if err := validateReplayPacketRawKeySafetyAt(path+"."+key, child); err != nil {
				return err
			}
		}
	case []any:
		for index, child := range typed {
			if err := validateReplayPacketRawKeySafetyAt(fmt.Sprintf("%s[%d]", path, index), child); err != nil {
				return err
			}
		}
	}
	return nil
}

func isForbiddenReplayPacketRawKey(normalized string) bool {
	if replayPacketForbiddenRawKeys[normalized] {
		return true
	}
	for _, suffix := range []string{"_api_key", "_auth", "_authorization", "_cookie", "_jwt", "_password", "_secret"} {
		if strings.HasSuffix(normalized, suffix) {
			return true
		}
	}
	for _, tokenKey := range []string{"access_token", "bearer_token", "id_token", "refresh_token", "session_token"} {
		if normalized == tokenKey || strings.HasSuffix(normalized, "_"+tokenKey) {
			return true
		}
	}
	return strings.HasPrefix(normalized, "secret_")
}

func ragReplayPacketDeletionLinkage(run execution.DurableRun, packet ragSynthesisPacket) map[string]any {
	return map[string]any{
		"subject_ref":        defaultString(strings.TrimSpace(run.OwnerUserID), "unknown-subject"),
		"conversation_id":    strings.TrimSpace(run.ConversationID),
		"request_id":         defaultString(strings.TrimSpace(run.RequestID), strings.TrimSpace(packet.RequestID)),
		"trace_id":           strings.TrimSpace(run.TraceID),
		"memory_ref_count":   len(packet.MemoryContext),
		"evidence_ref_count": len(packet.SelectedEvidence),
	}
}

func ragReplayPacketRetention(
	policy rawCapturePolicy,
	packetID string,
	createdAt time.Time,
	expiresAt time.Time,
) map[string]any {
	return map[string]any{
		"schema_version":               "replay_retention.v1",
		"retention_class":              "safe_replay_packet_index",
		"ttl_days":                     policy.TTLDays,
		"created_at":                   createdAt.Format(time.RFC3339),
		"expires_at":                   expiresAt.Format(time.RFC3339),
		"dsar_delete_linkage_required": policy.DSARDeleteLinkageRequired,
		"deletion_linkage_ref":         "deletion_linkage:" + strings.TrimSpace(packetID),
	}
}

func ragReplayPacketAccessAudit(policy rawCapturePolicy, packetID string) map[string]any {
	return map[string]any{
		"schema_version":    "replay_access_audit.v1",
		"audit_required":    policy.AuditRequired,
		"audit_log_ref":     "audit://replay/" + strings.TrimSpace(packetID),
		"access_policy_ref": "rbac://replay/restricted-operator-eval",
		"last_accessed_at":  nil,
	}
}

func ragReplayPacketEvidenceReplayIndex(
	packet ragSynthesisPacket,
	fingerprint map[string]any,
) map[string]any {
	refs := make([]map[string]any, 0, len(packet.SelectedEvidence))
	for _, item := range packet.SelectedEvidence {
		evidenceRef := firstNonEmptyText(item.SourceRef, item.SpanRef, item.ChunkID)
		if evidenceRef == "" {
			continue
		}
		refs = append(refs, map[string]any{
			"evidence_ref": evidenceRef,
			"evidence_sha256": sha256JSONRef(map[string]any{
				"chunk_id":   strings.TrimSpace(item.ChunkID),
				"source_id":  strings.TrimSpace(item.SourceID),
				"source_ref": strings.TrimSpace(item.SourceRef),
				"span_ref":   strings.TrimSpace(item.SpanRef),
				"version_id": strings.TrimSpace(item.VersionID),
			}),
			"source_profile_ref": defaultString(
				firstNonEmptyText(item.SourceUnitKind, item.SourceChannel),
				"rag_source_profile.v1",
			),
		})
	}
	return map[string]any{
		"schema_version":         "evidence_replay_index.v1",
		"evidence_packet_sha256": stringValue(fingerprint["evidence_packet_sha256"]),
		"evidence_profile_ref":   "rag_evidence_profile.v1",
		"evidence_ref_count":     len(refs),
		"evidence_refs":          refs,
	}
}

func ragReplayPacketSensitivity(policy rawCapturePolicy) string {
	if stringSliceContains(policy.AllowedRawFields, "selected_memory_context") {
		return "restricted_llm_io_with_memory"
	}
	if stringSliceContains(policy.AllowedRawFields, "selected_evidence_packet") {
		return "restricted_llm_io_with_evidence"
	}
	return "restricted_llm_io"
}

func ragReplayPacketID(
	run execution.DurableRun,
	packet ragSynthesisPacket,
	fingerprint map[string]any,
) string {
	base := map[string]any{
		"fingerprint": fingerprint,
		"request_id":  defaultString(strings.TrimSpace(run.RequestID), strings.TrimSpace(packet.RequestID)),
		"run_id":      strings.TrimSpace(run.RunID),
		"step_id":     strings.TrimSpace(packet.StepID),
	}
	hash := strings.TrimPrefix(sha256JSONRef(base), "sha256:")
	return "llm_replay_packet_" + hash[:24]
}

var replayObjectKeyUnsafeRE = regexp.MustCompile(`[^a-zA-Z0-9._/-]+`)

func ragReplayPacketObjectKey(createdAt time.Time, packetID string) string {
	datePrefix := createdAt.UTC().Format("2006/01/02")
	safePacketID := strings.Trim(replayObjectKeyUnsafeRE.ReplaceAllString(packetID, "_"), "/")
	return path.Join("llm-replay-packets", datePrefix, safePacketID+".json")
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == want {
			return true
		}
	}
	return false
}

func ptrStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
