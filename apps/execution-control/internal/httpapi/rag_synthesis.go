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
	AnswerText       string
	Confidence       string
	ProviderSummary  provider.ExecutionSummary
	ProviderBody     []byte
	SemanticOutcome  string
	GroundingVerdict string
}

type ragSynthesisExecutor interface {
	ExecuteRAGSynthesis(context.Context, ragSynthesisPacket) (ragSynthesisResult, error)
	HealthCheck(context.Context) error
}

type providerBackedRAGSynthesisExecutor struct {
	clientFactory   func(providerConfigSnapshot) *provider.ResponsesClient
	configResolver  providerConfigResolver
	pricing         provider.PricingCatalog
	providerTimeout time.Duration
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
	client, err := e.resolveClient(executeCtx)
	if err != nil {
		return ragSynthesisResult{}, err
	}
	result := client.Execute(executeCtx, provider.ResponsesRequest{
		Input:              ragProviderInput(packet),
		ProviderRequestRef: providerRequestRefForPacket(packet),
		Text:               ragProviderTextSchema(packet),
	})
	if result.Err != nil {
		return ragSynthesisResult{ProviderSummary: result.Summary, ProviderBody: result.Body}, result.Err
	}
	answerText, err := extractRAGAnswerText(result.Body)
	if err != nil {
		return ragSynthesisResult{ProviderSummary: result.Summary, ProviderBody: result.Body}, err
	}
	return ragSynthesisResult{
		AnswerText:      answerText,
		Confidence:      "medium",
		ProviderSummary: result.Summary,
		ProviderBody:    result.Body,
		SemanticOutcome: "answer_from_selected_evidence",
	}, nil
}

func (e providerBackedRAGSynthesisExecutor) HealthCheck(context.Context) error {
	if e.configResolver == nil && e.clientFactory == nil {
		return errors.New("rag synthesis provider config resolver is not configured")
	}
	return nil
}

func (e providerBackedRAGSynthesisExecutor) resolveClient(
	ctx context.Context,
) (*provider.ResponsesClient, error) {
	if e.clientFactory != nil && e.configResolver == nil {
		client := e.clientFactory(providerConfigSnapshot{})
		if client == nil {
			return nil, errors.New("rag synthesis provider client is not configured")
		}
		return client, nil
	}
	if e.configResolver == nil {
		return nil, errors.New("rag synthesis provider config resolver is not configured")
	}
	snapshot, err := e.configResolver.ResolveActiveProviderConfig(ctx, providerConfigRoleRAGSynthesis)
	if err != nil {
		return nil, err
	}
	if e.clientFactory != nil {
		client := e.clientFactory(snapshot)
		if client == nil {
			return nil, errors.New("rag synthesis provider client is not configured")
		}
		return client, nil
	}
	return provider.NewResponsesClient(provider.ResponsesClientConfig{
		APIKey:        snapshot.APIKey,
		BaseURL:       snapshot.BaseURL,
		ModelName:     snapshot.Model,
		ModelProvider: snapshot.Provider,
		Pricing:       e.pricing,
	}), nil
}

func ragProviderInput(packet ragSynthesisPacket) []map[string]any {
	evidence := make([]map[string]any, 0, len(packet.SelectedEvidence))
	for _, item := range packet.SelectedEvidence {
		evidence = append(evidence, map[string]any{
			"source_id":  item.SourceID,
			"chunk_id":   item.ChunkID,
			"span_ref":   item.SpanRef,
			"title":      item.Title,
			"excerpt":    item.Excerpt,
			"source_ref": item.SourceRef,
		})
	}
	memoryContext := make([]map[string]any, 0, len(packet.MemoryContext))
	for _, item := range packet.MemoryContext {
		memoryContext = append(memoryContext, map[string]any{
			"memory_id":    item.MemoryID,
			"memory_type":  item.MemoryType,
			"capability":   item.Capability,
			"compact_text": item.CompactText,
			"score":        item.Score,
			"updated_at":   item.UpdatedAt,
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
				"query_intent":       packet.QueryIntent,
				"output_schema_id":   packet.OutputSchemaID,
				"prompt_refs":        packet.PromptRefs,
				"memory_context":     memoryContext,
				"memory_ref":         packet.MemoryRef,
				"selected_evidence":  evidence,
				"request_id":         packet.RequestID,
				"payload_sha256":     packet.PayloadSHA256,
				"projection_context": map[string]any{"run_id": packet.RunID, "step_id": packet.StepID},
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
				"required":             []string{"answer_text"},
				"properties": map[string]any{
					"answer_text": map[string]any{"type": "string"},
				},
			},
		},
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

func extractRAGAnswerText(body []byte) (string, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("parse provider response payload: %w", err)
	}
	if parsed, ok := payload["output_parsed"].(map[string]any); ok {
		return requiredRAGAnswerText(parsed)
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
				return requiredRAGAnswerText(parsed)
			}
			text, ok := content["text"].(string)
			if !ok || strings.TrimSpace(text) == "" {
				continue
			}
			var decoded map[string]any
			if err := json.Unmarshal([]byte(text), &decoded); err != nil {
				continue
			}
			return requiredRAGAnswerText(decoded)
		}
	}
	return "", errors.New("provider response did not contain answer_text")
}

func requiredRAGAnswerText(payload map[string]any) (string, error) {
	answerText, ok := payload["answer_text"].(string)
	if !ok || strings.TrimSpace(answerText) == "" {
		return "", errors.New("provider structured output answer_text is required")
	}
	return strings.TrimSpace(answerText), nil
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
) map[string]any {
	confidence := strings.TrimSpace(result.Confidence)
	if confidence == "" {
		confidence = "medium"
	}
	semanticOutcome := strings.TrimSpace(result.SemanticOutcome)
	if semanticOutcome == "" {
		semanticOutcome = "answer_from_selected_evidence"
	}
	groundingVerdict := strings.TrimSpace(result.GroundingVerdict)
	return executionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		SelectedCapability: "knowledge",
		Status:             "completed",
		AnswerText:         strings.TrimSpace(result.AnswerText),
		Error:              nil,
		FollowUpQuestion:   "",
		Confidence:         confidence,
		Result: map[string]any{
			"evidence": map[string]any{
				"query_text": packet.QueryIntent,
				"sources":    ragEvidenceSourcesForFinalization(packet.SelectedEvidence),
			},
			"diagnostics": map[string]any{
				"semantic_outcome":       semanticOutcome,
				"grounding_verdict":      groundingVerdict,
				"verification_kind":      "evidence_integrity",
				"prompt_runtime_state":   "go_provider_synthesis_completed",
				"prompt_runtime_detail":  result.ProviderSummary.SchemaVersion,
				"answer_artifact_ref":    providerRequestRefForPacket(packet),
				"provider_response_ref":  result.ProviderSummary.ProviderResponseID,
				"provider_pricing_ref":   result.ProviderSummary.PricingVersion,
				"retrieval_stage_ref":    "projection://runs/" + run.RunID + "/retrieval/indexed-lookup",
				"evidence_selection_ref": "projection://runs/" + run.RunID + "/evidence/selection",
				"synthesis_step_ref":     "projection://runs/" + run.RunID + "/synthesis",
				"step_projection_schema": "step-result-projection-v1",
			},
		},
		Observability: map[string]any{
			"selected_tool":  "retrieval.query",
			"result_outcome": semanticOutcome,
		},
		WorkflowTraceSummary: map[string]any{
			"workflow_mode":         "single_step",
			"selected_capability":   "knowledge",
			"selected_tools":        []string{"retrieval.query"},
			"answer_artifact_kinds": []string{"provider_execution_summary"},
			"answer_artifact_refs":  []string{providerRequestRefForPacket(packet)},
			"runtime_versions":      map[string]any{"provider_summary": result.ProviderSummary.SchemaVersion},
			"policy_artifact_versions": map[string]any{
				"provider_pricing": result.ProviderSummary.PricingVersion,
			},
		},
		TraceID: run.TraceID,
	})
}

func ragEvidenceSourcesForFinalization(evidence []ragruntime.EvidenceRef) []map[string]any {
	sources := make([]map[string]any, 0, len(evidence))
	for _, item := range evidence {
		sources = append(sources, map[string]any{
			"doc_id":         item.SourceID,
			"chunk_id":       item.ChunkID,
			"source_title":   item.Title,
			"snippet":        item.Excerpt,
			"source_ref":     item.SourceRef,
			"structural_ref": item.SpanRef,
		})
	}
	return sources
}

func validateRAGSynthesisPacket(packet ragSynthesisPacket) error {
	return ragruntime.ValidateSynthesisPacket(packet)
}
