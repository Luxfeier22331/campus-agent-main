package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

var errRAGSynthesisPacketMissing = errors.New("rag synthesis packet missing")

type ragSynthesisPacket = ragruntime.SynthesisPacketProjection

type ragSynthesisResult struct {
	AnswerText              string
	Confidence              string
	GroundingNotes          string
	LLMIOFingerprint        map[string]any
	PromptTrace             map[string]any
	ProviderProfileRevision string
	ProviderRequestBody     map[string]any
	ProviderStatus          int
	ProviderSummary         provider.ExecutionSummary
	ProviderBody            []byte
	SemanticOutcome         string
	UsedEvidenceRefs        []string
	GroundingVerdict        string
}

type ragSynthesisExecutor interface {
	ExecuteRAGSynthesis(context.Context, ragSynthesisPacket) (ragSynthesisResult, error)
	HealthCheck(context.Context) error
}

type providerBackedRAGSynthesisExecutor struct {
	clientFactory      func(providerConfigSnapshot) *provider.ResponsesClient
	configResolver     providerConfigResolver
	generationControls provider.ResponsesGenerationControls
	pricing            provider.PricingCatalog
	providerTimeout    time.Duration
	runtimeRelease     string
}

func (e providerBackedRAGSynthesisExecutor) ExecuteRAGSynthesis(
	ctx context.Context,
	packet ragSynthesisPacket,
) (ragSynthesisResult, error) {
	if err := validateRAGSynthesisPacket(packet); err != nil {
		return ragSynthesisResult{}, err
	}
	executeCtx := ctx
	cancel := func() {}
	if e.providerTimeout > 0 {
		executeCtx, cancel = context.WithTimeout(ctx, e.providerTimeout)
	}
	defer cancel()
	client, snapshot, err := e.resolveClient(executeCtx)
	if err != nil {
		return ragSynthesisResult{}, err
	}
	renderedInput := ragProviderInput(packet)
	providerRequest := provider.ResponsesRequest{
		Input:              renderedInput,
		ProviderRequestRef: providerRequestRefForPacket(packet),
		Text:               ragProviderTextSchema(packet),
	}
	providerRequestBody := ragProviderRequestBodyForReplay(
		snapshot,
		e.generationControls,
		modelNameFromSnapshotOrClient(snapshot),
		providerRequest,
	)
	result := client.Execute(executeCtx, providerRequest)
	modelProvider := defaultStringIfUnknown(
		strings.TrimSpace(snapshot.Provider),
		strings.TrimSpace(result.Summary.ModelProvider),
	)
	modelName := defaultStringIfUnknown(
		strings.TrimSpace(snapshot.Model),
		strings.TrimSpace(result.Summary.ModelName),
	)
	providerProfileRevision := providerProfileRevisionFingerprint(snapshot)
	if strings.Trim(providerProfileRevision, ":") == "" {
		providerProfileRevision = "rag_synthesis:unknown:0"
	}
	promptTrace := ragSynthesisPromptTrace(modelProvider, modelName)
	llmIOFingerprint, err := ragSynthesisLLMIOFingerprint(ragSynthesisFingerprintInput{
		generationControls:      e.generationControls,
		modelName:               modelName,
		modelProvider:           modelProvider,
		packet:                  packet,
		providerProfileRevision: providerProfileRevision,
		renderedInput:           renderedInput,
		requestID:               packet.RequestID,
		run: execution.DurableRun{
			RequestID: packet.RequestID,
			RunID:     packet.RunID,
		},
		runtimeRelease: e.runtimeRelease,
	})
	if err != nil {
		return ragSynthesisResult{}, err
	}
	if result.Err != nil {
		return ragSynthesisResult{
			LLMIOFingerprint:        llmIOFingerprint,
			PromptTrace:             promptTrace,
			ProviderProfileRevision: providerProfileRevision,
			ProviderRequestBody:     providerRequestBody,
			ProviderBody:            result.Body,
			ProviderStatus:          result.Status,
			ProviderSummary:         result.Summary,
		}, result.Err
	}
	output, err := extractRAGSynthesisOutput(result.Body, packet.SelectedEvidence)
	if err != nil {
		return ragSynthesisResult{
			LLMIOFingerprint:        llmIOFingerprint,
			PromptTrace:             promptTrace,
			ProviderProfileRevision: providerProfileRevision,
			ProviderRequestBody:     providerRequestBody,
			ProviderBody:            result.Body,
			ProviderStatus:          result.Status,
			ProviderSummary:         result.Summary,
		}, err
	}
	return ragSynthesisResult{
		AnswerText:              output.AnswerText,
		Confidence:              output.Confidence,
		GroundingNotes:          output.GroundingNotes,
		LLMIOFingerprint:        llmIOFingerprint,
		PromptTrace:             promptTrace,
		ProviderProfileRevision: providerProfileRevision,
		ProviderRequestBody:     providerRequestBody,
		ProviderStatus:          result.Status,
		ProviderSummary:         result.Summary,
		ProviderBody:            result.Body,
		SemanticOutcome:         output.SemanticOutcome,
		UsedEvidenceRefs:        output.UsedEvidenceRefs,
	}, nil
}

func ragProviderRequestBodyForReplay(
	snapshot providerConfigSnapshot,
	controls provider.ResponsesGenerationControls,
	modelName string,
	request provider.ResponsesRequest,
) map[string]any {
	model := strings.TrimSpace(modelName)
	if model == "" {
		model = strings.TrimSpace(snapshot.Model)
	}
	payload := map[string]any{
		"input":  request.Input,
		"model":  model,
		"stream": false,
	}
	if controls.MaxOutputTokens > 0 {
		payload["max_output_tokens"] = controls.MaxOutputTokens
	}
	if strings.TrimSpace(controls.ReasoningEffort) != "" {
		payload["reasoning"] = map[string]any{"effort": strings.TrimSpace(controls.ReasoningEffort)}
	}
	if controls.Store != nil {
		payload["store"] = *controls.Store
	}
	if request.Text != nil {
		text := cloneAnyMapFromMetadata(request.Text)
		if strings.TrimSpace(controls.TextVerbosity) != "" {
			text["verbosity"] = strings.TrimSpace(controls.TextVerbosity)
		}
		payload["text"] = text
	}
	return payload
}

func modelNameFromSnapshotOrClient(snapshot providerConfigSnapshot) string {
	return strings.TrimSpace(snapshot.Model)
}

func (e providerBackedRAGSynthesisExecutor) HealthCheck(context.Context) error {
	if e.configResolver == nil && e.clientFactory == nil {
		return errors.New("rag synthesis provider config resolver is not configured")
	}
	return nil
}

func (e providerBackedRAGSynthesisExecutor) resolveClient(
	ctx context.Context,
) (*provider.ResponsesClient, providerConfigSnapshot, error) {
	if e.clientFactory != nil && e.configResolver == nil {
		snapshot := providerConfigSnapshot{
			Model:    "unknown",
			Provider: "unknown",
			Role:     string(providerConfigRoleRAGSynthesis),
		}
		client := e.clientFactory(snapshot)
		if client == nil {
			return nil, providerConfigSnapshot{}, errors.New("rag synthesis provider client is not configured")
		}
		return client, snapshot, nil
	}
	if e.configResolver == nil {
		return nil, providerConfigSnapshot{}, errors.New("rag synthesis provider config resolver is not configured")
	}
	snapshot, err := e.configResolver.ResolveActiveProviderConfig(ctx, providerConfigRoleRAGSynthesis)
	if err != nil {
		return nil, providerConfigSnapshot{}, err
	}
	if e.clientFactory != nil {
		client := e.clientFactory(snapshot)
		if client == nil {
			return nil, providerConfigSnapshot{}, errors.New("rag synthesis provider client is not configured")
		}
		return client, snapshot, nil
	}
	return provider.NewResponsesClient(provider.ResponsesClientConfig{
		APIKey:             snapshot.APIKey,
		BaseURL:            snapshot.BaseURL,
		GenerationControls: e.generationControls,
		ModelName:          snapshot.Model,
		ModelProvider:      snapshot.Provider,
		Pricing:            e.pricing,
	}), snapshot, nil
}

func ragProviderInput(packet ragSynthesisPacket) []map[string]any {
	evidence := make([]map[string]any, 0, len(packet.SelectedEvidence))
	for _, item := range packet.SelectedEvidence {
		evidence = append(evidence, map[string]any{
			"chunk_id":          item.ChunkID,
			"document_id":       item.DocumentID,
			"excerpt":           item.Excerpt,
			"is_current":        item.IsCurrent,
			"root_unit_id":      item.RootUnitID,
			"source_channel":    item.SourceChannel,
			"source_id":         item.SourceID,
			"source_ref":        item.SourceRef,
			"source_trust_tier": item.SourceTrustTier,
			"source_unit_kind":  item.SourceUnitKind,
			"source_unit_key":   item.SourceUnitKey,
			"span_ref":          item.SpanRef,
			"title":             item.Title,
			"version_id":        item.VersionID,
		})
	}
	memoryContext := make([]map[string]any, 0, len(packet.MemoryContext))
	for _, item := range packet.MemoryContext {
		memoryContext = append(memoryContext, map[string]any{
			"memory_id":    item.MemoryID,
			"memory_type":  item.MemoryType,
			"tool":         item.Tool,
			"compact_text": item.CompactText,
			"score":        item.Score,
			"updated_at":   item.UpdatedAt,
		})
	}
	previousEvidenceContext := make([]map[string]any, 0, len(packet.PreviousEvidenceContext))
	for _, item := range packet.PreviousEvidenceContext {
		previousEvidenceContext = append(previousEvidenceContext, map[string]any{
			"access_scope":  item.AccessScope,
			"collection":    item.Collection,
			"content_hash":  item.ContentHash,
			"document_id":   item.DocumentID,
			"evidence_id":   item.EvidenceID,
			"section_title": item.SectionTitle,
			"snapshot_id":   item.SnapshotID,
			"snippet":       item.Snippet,
			"source_id":     item.SourceID,
			"title":         item.Title,
			"version_id":    item.VersionID,
		})
	}
	return []map[string]any{
		{
			"role":    "developer",
			"type":    "message",
			"content": "You are campus-agent RAG synthesis. Answer only from selected evidence. Return JSON matching the requested schema.",
		},
		{
			"role": "user",
			"type": "message",
			"content": mustMarshalRAGSynthesisPayload(map[string]any{
				"query_intent":              packet.QueryIntent,
				"output_schema_id":          packet.OutputSchemaID,
				"prompt_refs":               packet.PromptRefs,
				"memory_context":            memoryContext,
				"memory_ref":                packet.MemoryRef,
				"previous_evidence_context": previousEvidenceContext,
				"selected_evidence":         evidence,
				"request_id":                packet.RequestID,
				"payload_sha256":            packet.PayloadSHA256,
				"projection_context":        map[string]any{"run_id": packet.RunID, "step_id": packet.StepID},
			}),
		},
	}
}

func nestedMapValue(root map[string]any, path ...string) (any, bool) {
	var current any = root
	for _, segment := range path {
		record, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = record[segment]
		if !ok {
			return nil, false
		}
	}
	return current, true
}

func ragProviderTextSchema(packet ragSynthesisPacket) map[string]any {
	schemaName := strings.TrimSpace(packet.OutputSchemaID)
	if schemaName == "" {
		schemaName = "rag_answer_v2"
	}
	return map[string]any{
		"format": map[string]any{
			"type":   "json_schema",
			"name":   schemaName,
			"strict": true,
			"schema": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required": []string{
					"answer_text",
					"semantic_outcome",
					"confidence",
					"used_evidence_refs",
					"grounding_notes",
				},
				"properties": map[string]any{
					"answer_text":      map[string]any{"type": "string"},
					"semantic_outcome": map[string]any{"type": "string"},
					"confidence": map[string]any{
						"type": "string",
						"enum": []string{"high", "medium", "low"},
					},
					"used_evidence_refs": map[string]any{
						"type":  "array",
						"items": map[string]any{"type": "string"},
					},
					"grounding_notes": map[string]any{"type": "string"},
				},
			},
		},
	}
}

func ragSynthesisPacketSummary(packet ragSynthesisPacket) map[string]any {
	return map[string]any{
		"evidence_count":         len(packet.SelectedEvidence),
		"memory_context_count":   len(packet.MemoryContext),
		"output_schema_id":       strings.TrimSpace(packet.OutputSchemaID),
		"packet_ref":             temporalProjectionRef(packet.RunID, "synthesis/packet"),
		"payload_sha256":         strings.TrimSpace(packet.PayloadSHA256),
		"previous_context_count": len(packet.PreviousEvidenceContext),
		"prompt_refs":            append([]string{}, packet.PromptRefs...),
		"query_intent_chars":     len([]rune(packet.QueryIntent)),
	}
}

func mustMarshalRAGSynthesisPayload(payload map[string]any) string {
	encoded, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func providerRequestRefForPacket(packet ragSynthesisPacket) string {
	return "provider://requests/" + strings.TrimSpace(packet.RunID) + "/" + strings.TrimSpace(packet.StepID)
}

type ragStructuredSynthesisOutput struct {
	AnswerText       string
	Confidence       string
	GroundingNotes   string
	SemanticOutcome  string
	UsedEvidenceRefs []string
}

func extractRAGSynthesisOutput(
	body []byte,
	selectedEvidence []ragruntime.EvidenceRef,
) (ragStructuredSynthesisOutput, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return ragStructuredSynthesisOutput{}, fmt.Errorf("parse provider response payload: %w", err)
	}
	if status := strings.TrimSpace(stringValue(payload["status"])); status != "" && status != "completed" {
		return ragStructuredSynthesisOutput{}, fmt.Errorf("provider response status is %q", status)
	}
	if strings.TrimSpace(stringValue(payload["refusal"])) != "" {
		return ragStructuredSynthesisOutput{}, errors.New("provider response refusal is not accepted")
	}
	if incomplete, ok := payload["incomplete_details"].(map[string]any); ok && len(incomplete) > 0 {
		return ragStructuredSynthesisOutput{}, errors.New("provider response incomplete_details is not accepted")
	}
	if parsed, ok := payload["output_parsed"].(map[string]any); ok {
		return requiredRAGSynthesisOutput(parsed, selectedEvidence)
	}
	for _, outputItem := range ragAnySlice(payload["output"]) {
		item, ok := outputItem.(map[string]any)
		if !ok {
			continue
		}
		for _, contentItem := range ragAnySlice(item["content"]) {
			content, ok := contentItem.(map[string]any)
			if !ok {
				continue
			}
			if parsed, ok := content["parsed"].(map[string]any); ok {
				return requiredRAGSynthesisOutput(parsed, selectedEvidence)
			}
			if strings.TrimSpace(stringValue(content["refusal"])) != "" {
				return ragStructuredSynthesisOutput{}, errors.New("provider response content refusal is not accepted")
			}
			text, ok := content["text"].(string)
			if !ok || strings.TrimSpace(text) == "" {
				continue
			}
			var decoded map[string]any
			if err := json.Unmarshal([]byte(text), &decoded); err != nil {
				continue
			}
			return requiredRAGSynthesisOutput(decoded, selectedEvidence)
		}
	}
	return ragStructuredSynthesisOutput{}, errors.New("provider response did not contain structured synthesis output")
}

func requiredRAGSynthesisOutput(
	payload map[string]any,
	selectedEvidence []ragruntime.EvidenceRef,
) (ragStructuredSynthesisOutput, error) {
	answerText, ok := payload["answer_text"].(string)
	if !ok || strings.TrimSpace(answerText) == "" {
		return ragStructuredSynthesisOutput{}, errors.New("provider structured output answer_text is required")
	}
	semanticOutcome := strings.TrimSpace(stringValue(payload["semantic_outcome"]))
	if semanticOutcome == "" {
		return ragStructuredSynthesisOutput{}, errors.New("provider structured output semantic_outcome is required")
	}
	confidence := strings.TrimSpace(stringValue(payload["confidence"]))
	switch confidence {
	case "high", "medium", "low":
	default:
		return ragStructuredSynthesisOutput{}, errors.New("provider structured output confidence is required")
	}
	groundingNotes := strings.TrimSpace(stringValue(payload["grounding_notes"]))
	if groundingNotes == "" {
		return ragStructuredSynthesisOutput{}, errors.New("provider structured output grounding_notes is required")
	}
	usedEvidenceRefs := stringSliceFromAny(payload["used_evidence_refs"])
	if len(usedEvidenceRefs) == 0 {
		return ragStructuredSynthesisOutput{}, errors.New("provider structured output used_evidence_refs is required")
	}
	allowedEvidenceRefs := ragSelectedEvidenceRefSet(selectedEvidence)
	for _, ref := range usedEvidenceRefs {
		if _, ok := allowedEvidenceRefs[ref]; !ok {
			return ragStructuredSynthesisOutput{}, fmt.Errorf("provider structured output used_evidence_ref %q was not selected", ref)
		}
	}
	return ragStructuredSynthesisOutput{
		AnswerText:       strings.TrimSpace(answerText),
		Confidence:       confidence,
		GroundingNotes:   groundingNotes,
		SemanticOutcome:  semanticOutcome,
		UsedEvidenceRefs: usedEvidenceRefs,
	}, nil
}

func ragSelectedEvidenceRefSet(selectedEvidence []ragruntime.EvidenceRef) map[string]struct{} {
	refs := make(map[string]struct{}, len(selectedEvidence)*4)
	for _, evidence := range selectedEvidence {
		for _, candidate := range []string{
			evidence.SourceRef,
			evidence.SpanRef,
			evidence.SourceID,
			evidence.ChunkID,
		} {
			normalized := strings.TrimSpace(candidate)
			if normalized != "" {
				refs[normalized] = struct{}{}
			}
		}
	}
	return refs
}

func ragAnySlice(value any) []any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	return items
}

func ragSynthesisFinalizedResponse(
	run execution.DurableRun,
	packet ragSynthesisPacket,
	result ragSynthesisResult,
	replayPacketRef *ragReplayPacketIndexRef,
) (map[string]any, error) {
	confidence := strings.TrimSpace(result.Confidence)
	if confidence == "" {
		confidence = "medium"
	}
	semanticOutcome := strings.TrimSpace(result.SemanticOutcome)
	if semanticOutcome == "" {
		semanticOutcome = "answer_from_selected_evidence"
	}
	groundingVerdict := strings.TrimSpace(result.GroundingVerdict)
	promptTrace, err := ragSynthesisFinalPromptTrace(result)
	if err != nil {
		return nil, err
	}
	llmIOFingerprint, err := ragSynthesisFinalLLMIOFingerprint(run, packet, result)
	if err != nil {
		return nil, err
	}
	answerEvalStageProfile := ragSynthesisAnswerEvalStageProfile(packet)
	answerEvalEvidenceReplayIndexSHA256 := sha256JSONRef(
		ragReplayPacketEvidenceReplayIndex(packet, llmIOFingerprint),
	)
	replayPacketRefMap := map[string]any(nil)
	if replayPacketRef != nil {
		replayPacketRefMap = replayPacketRef.ToMap()
	}
	debugTraceRefs := []map[string]any{
		{
			"sink":      "execution_control_projection",
			"trace_id":  strings.TrimSpace(run.TraceID),
			"trace_ref": "projection://runs/" + strings.TrimSpace(run.RunID) + "/synthesis/observability",
		},
	}
	observability := map[string]any{
		"llm_io_fingerprint":     llmIOFingerprint,
		"model_name":             result.ProviderSummary.ModelName,
		"model_provider":         result.ProviderSummary.ModelProvider,
		"selected_tool":          "knowledge_query",
		"result_outcome":         semanticOutcome,
		"model_execution_state":  "go_provider_synthesis_completed",
		"model_execution_detail": result.ProviderSummary.SchemaVersion,
		"prompt_trace":           promptTrace,
		"provider_request_ref":   result.ProviderSummary.ProviderRequestRef,
		"provider_response_id":   result.ProviderSummary.ProviderResponseID,
	}
	observability["answer_eval_fingerprint"] = answerEvalFingerprint(answerEvalFingerprintInput{
		BranchKind:                "rag_synthesis",
		EvidenceReplayIndexSHA256: answerEvalEvidenceReplayIndexSHA256,
		LLMIOFingerprint:          llmIOFingerprint,
		RunID:                     run.RunID,
		SelectedTool:              "knowledge_query",
		SelectedTools:             []string{"knowledge_query"},
		StageTiming:               answerEvalStageProfile,
		TerminalOutcome:           ragSynthesisAnswerTerminalOutcome(semanticOutcome),
		WorkflowMode:              "single_step",
	})
	if replayPacketRefMap != nil {
		observability["replay_packet_ref"] = replayPacketRefMap
	}
	retrievalStageRef := ragRetrievalStageRefForEvidence(run.RunID, packet.SelectedEvidence)
	return executionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		SelectedTool:     ptrString("knowledge_query"),
		Status:           "completed",
		AnswerText:       strings.TrimSpace(result.AnswerText),
		DebugTraceRefs:   debugTraceRefs,
		Error:            nil,
		FollowUpQuestion: "",
		Confidence:       confidence,
		Result: map[string]any{
			"evidence": map[string]any{
				"query_text": packet.QueryIntent,
				"sources":    ragEvidenceSourcesForFinalization(packet.SelectedEvidence),
			},
			"diagnostics": map[string]any{
				"semantic_outcome":       semanticOutcome,
				"grounding_verdict":      groundingVerdict,
				"grounding_notes":        strings.TrimSpace(result.GroundingNotes),
				"used_evidence_refs":     append([]string{}, result.UsedEvidenceRefs...),
				"verification_kind":      "evidence_integrity",
				"model_execution_state":  "go_provider_synthesis_completed",
				"model_execution_detail": result.ProviderSummary.SchemaVersion,
				"prompt_trace":           promptTrace,
				"answer_artifact_ref":    providerRequestRefForPacket(packet),
				"provider_response_ref":  result.ProviderSummary.ProviderResponseID,
				"provider_pricing_ref":   result.ProviderSummary.PricingVersion,
				"retrieval_stage_ref":    retrievalStageRef,
				"evidence_selection_ref": "projection://runs/" + run.RunID + "/evidence/selection",
				"synthesis_step_ref":     "projection://runs/" + run.RunID + "/synthesis",
				"step_projection_schema": "step-result-projection-v1",
			},
		},
		Observability: observability,
		WorkflowTraceSummary: map[string]any{
			"workflow_mode":         "single_step",
			"selected_tool":         "knowledge_query",
			"selected_tools":        []string{"knowledge_query"},
			"answer_artifact_kinds": []string{"provider_execution_summary"},
			"answer_artifact_refs":  []string{providerRequestRefForPacket(packet)},
			"runtime_versions":      map[string]any{"provider_summary": result.ProviderSummary.SchemaVersion},
			"policy_artifact_versions": map[string]any{
				"provider_pricing": result.ProviderSummary.PricingVersion,
			},
		},
		TraceID: run.TraceID,
	}), nil
}

func ragRetrievalStageRefForEvidence(runID string, evidence []ragruntime.EvidenceRef) string {
	stage := "retrieval/indexed-lookup"
	if retrievalModeForEvidence(evidence) == "live_assisted" {
		stage = "retrieval/live-source-lookup"
	}
	return temporalProjectionRef(runID, stage)
}

func ragSynthesisAnswerEvalStageProfile(packet ragSynthesisPacket) map[string]any {
	return map[string]any{
		"rag.selected_evidence_count": float64(len(packet.SelectedEvidence)),
		"rag.memory_context_count":    float64(len(packet.MemoryContext)),
		"rag.previous_context_count":  float64(len(packet.PreviousEvidenceContext)),
	}
}

func ragEvidenceSourcesForFinalization(evidence []ragruntime.EvidenceRef) []map[string]any {
	sources := make([]map[string]any, 0, len(evidence))
	for _, item := range evidence {
		sources = append(sources, map[string]any{
			"chunk_id":          item.ChunkID,
			"doc_id":            item.SourceID,
			"document_id":       item.DocumentID,
			"is_current":        item.IsCurrent,
			"root_unit_id":      item.RootUnitID,
			"snippet":           item.Excerpt,
			"source_channel":    item.SourceChannel,
			"source_ref":        item.SourceRef,
			"source_title":      item.Title,
			"source_trust_tier": item.SourceTrustTier,
			"structural_ref":    item.SpanRef,
			"version_id":        item.VersionID,
		})
	}
	return sources
}

func validateRAGSynthesisPacket(packet ragSynthesisPacket) error {
	return ragruntime.ValidateSynthesisPacket(packet)
}
