package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const inferredMemoryConfidenceThreshold = 0.9

type memoryExtractionExecutor interface {
	ExtractMemoryCandidates(
		context.Context,
		execution.DurableRun,
		map[string]any,
	) (memoryExtractionResult, error)
	HealthCheck(context.Context) error
}

type memoryExtractionResult struct {
	Candidates      []temporalruntime.MemoryCandidate
	SkipReasons     []string
	SkippedCount    int
	ProviderBody    []byte
	ProviderSummary provider.ExecutionSummary
}

type providerBackedMemoryExtractionExecutor struct {
	clientFactory  func(providerConfigSnapshot) *provider.ResponsesClient
	configResolver providerConfigResolver
	pricing        provider.PricingCatalog
}

func newMemoryExtractionExecutor(
	cfg config.Config,
	configResolver providerConfigResolver,
) (memoryExtractionExecutor, error) {
	catalog, err := provider.LoadPricingCatalog(cfg.ProviderPricingPath)
	if err != nil {
		return nil, err
	}
	return providerBackedMemoryExtractionExecutor{
		configResolver: configResolver,
		pricing:        catalog,
	}, nil
}

func (e providerBackedMemoryExtractionExecutor) ExtractMemoryCandidates(
	ctx context.Context,
	run execution.DurableRun,
	payload map[string]any,
) (memoryExtractionResult, error) {
	userGoal := strings.TrimSpace(optionalStringFromAny(payload["user_goal"]))
	if userGoal == "" {
		return memoryExtractionResult{
			SkipReasons:  []string{"no_high_confidence_memory"},
			SkippedCount: 1,
		}, nil
	}
	packet := memoryExtractionPacket(run, payload, userGoal)
	sourceHash, err := memoryruntime.HashProjection(packet)
	if err != nil {
		return memoryExtractionResult{}, err
	}
	client, err := e.resolveClient(ctx)
	if err != nil {
		return memoryExtractionResult{}, err
	}
	result := client.Execute(ctx, provider.ResponsesRequest{
		Input:              memoryExtractionProviderInput(packet),
		ProviderRequestRef: "provider://requests/" + strings.TrimSpace(run.RunID) + "/memory/extract",
		Text:               memoryExtractionTextSchema(),
	})
	if result.Err != nil {
		return memoryExtractionResult{ProviderSummary: result.Summary, ProviderBody: result.Body}, result.Err
	}
	candidates, skipped, reasons, err := extractMemoryCandidatesFromProviderBody(run, sourceHash, result.Body)
	if err != nil {
		return memoryExtractionResult{ProviderSummary: result.Summary, ProviderBody: result.Body}, err
	}
	return memoryExtractionResult{
		Candidates:      candidates,
		ProviderBody:    result.Body,
		ProviderSummary: result.Summary,
		SkipReasons:     reasons,
		SkippedCount:    skipped,
	}, nil
}

func (e providerBackedMemoryExtractionExecutor) HealthCheck(context.Context) error {
	if e.configResolver == nil && e.clientFactory == nil {
		return errors.New("memory extraction provider config resolver is not configured")
	}
	return nil
}

func (e providerBackedMemoryExtractionExecutor) resolveClient(
	ctx context.Context,
) (*provider.ResponsesClient, error) {
	if e.clientFactory != nil && e.configResolver == nil {
		client := e.clientFactory(providerConfigSnapshot{})
		if client == nil {
			return nil, errors.New("memory extraction provider client is not configured")
		}
		return client, nil
	}
	if e.configResolver == nil {
		return nil, errors.New("memory extraction provider config resolver is not configured")
	}
	snapshot, err := e.configResolver.ResolveActiveProviderConfig(ctx, providerConfigRolePersonalMemoryExtraction)
	if err != nil {
		return nil, err
	}
	if e.clientFactory != nil {
		client := e.clientFactory(snapshot)
		if client == nil {
			return nil, errors.New("memory extraction provider client is not configured")
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

func memoryExtractionProviderInput(
	packet map[string]any,
) []map[string]any {
	return []map[string]any{
		{
			"role": "developer",
			"type": "message",
			"content": strings.Join([]string{
				"You extract compact personal memories for campus-agent.",
				"Return only durable user-specific preferences, goals, stable aliases, or common context.",
				"Do not extract institutional facts, source text, credentials, raw transcript, authorization, or temporary one-off tasks.",
				"Return JSON matching the requested schema.",
			}, " "),
		},
		{
			"role":    "user",
			"type":    "message",
			"content": mustMarshalRAGSynthesisPayload(packet),
		},
	}
}

func memoryExtractionPacket(
	run execution.DurableRun,
	payload map[string]any,
	userGoal string,
) map[string]any {
	return map[string]any{
		"request_id": firstNonEmptyText(payload["request_id"], run.RequestID),
		"requested_capability": firstNonEmptyText(
			payload["requested_capability"],
			run.RequestedCapability,
			"any",
		),
		"run_id":          run.RunID,
		"schema_version":  "personal_memory_extraction_input_v1",
		"session_slots":   sortedMemorySessionSlots(memorySessionSlotsFromPayload(payload)),
		"surface":         run.Surface,
		"terminal_reason": string(run.TerminalReason),
		"user_goal":       userGoal,
	}
}

func sortedMemorySessionSlots(slots map[string]string) []map[string]string {
	if len(slots) == 0 {
		return []map[string]string{}
	}
	names := make([]string, 0, len(slots))
	for name := range slots {
		names = append(names, name)
	}
	sort.Strings(names)
	items := make([]map[string]string, 0, len(names))
	for _, name := range names {
		items = append(items, map[string]string{
			"name":  name,
			"value": slots[name],
		})
	}
	return items
}

func memoryExtractionTextSchema() map[string]any {
	return map[string]any{
		"format": map[string]any{
			"type":   "json_schema",
			"name":   "personal_memory_candidates_v1",
			"strict": true,
			"schema": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"memory_candidates"},
				"properties": map[string]any{
					"memory_candidates": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type":                 "object",
							"additionalProperties": false,
							"required": []string{
								"capability",
								"compact_text",
								"confidence",
								"memory_type",
								"reason_code",
							},
							"properties": map[string]any{
								"capability": map[string]any{
									"type": "string",
									"enum": []string{"knowledge", "campus_services", "notice", "navigation", "any"},
								},
								"compact_text": map[string]any{"type": "string"},
								"confidence":   map[string]any{"type": "number"},
								"memory_type": map[string]any{
									"type": "string",
									"enum": []string{"profile", "goal", "preference", "session_summary", "task_state"},
								},
								"reason_code": map[string]any{"type": "string"},
							},
						},
					},
				},
			},
		},
	}
}

type memoryExtractionPayload struct {
	MemoryCandidates []memoryExtractionCandidate `json:"memory_candidates"`
}

type memoryExtractionCandidate struct {
	Capability  string  `json:"capability"`
	CompactText string  `json:"compact_text"`
	Confidence  float64 `json:"confidence"`
	MemoryType  string  `json:"memory_type"`
	ReasonCode  string  `json:"reason_code"`
}

func extractMemoryCandidatesFromProviderBody(
	run execution.DurableRun,
	sourceHash string,
	body []byte,
) ([]temporalruntime.MemoryCandidate, int, []string, error) {
	payload, err := parseMemoryExtractionPayload(body)
	if err != nil {
		return nil, 0, nil, err
	}
	candidates := make([]temporalruntime.MemoryCandidate, 0, len(payload.MemoryCandidates))
	skipped := 0
	reasons := []string{}
	for _, raw := range payload.MemoryCandidates {
		candidate, reason := normalizeMemoryExtractionCandidate(run, sourceHash, raw)
		if reason != "" {
			skipped++
			reasons = appendUniqueMemoryUpdateReason(reasons, reason)
			continue
		}
		candidates = append(candidates, candidate)
	}
	if len(candidates) == 0 && len(reasons) == 0 {
		skipped = 1
		reasons = append(reasons, "no_high_confidence_memory")
	}
	return candidates, skipped, reasons, nil
}

func parseMemoryExtractionPayload(body []byte) (memoryExtractionPayload, error) {
	var root map[string]any
	if err := json.Unmarshal(body, &root); err != nil {
		return memoryExtractionPayload{}, fmt.Errorf("parse memory extraction provider response: %w", err)
	}
	if parsed, ok := root["output_parsed"].(map[string]any); ok {
		return decodeMemoryExtractionPayload(parsed)
	}
	for _, outputItem := range ragAnySlice(root["output"]) {
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
				return decodeMemoryExtractionPayload(parsed)
			}
			text, ok := content["text"].(string)
			if !ok || strings.TrimSpace(text) == "" {
				continue
			}
			var decoded map[string]any
			if err := json.Unmarshal([]byte(text), &decoded); err != nil {
				continue
			}
			return decodeMemoryExtractionPayload(decoded)
		}
	}
	return memoryExtractionPayload{}, errors.New("provider response did not contain memory_candidates")
}

func decodeMemoryExtractionPayload(payload map[string]any) (memoryExtractionPayload, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return memoryExtractionPayload{}, err
	}
	var decoded memoryExtractionPayload
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return memoryExtractionPayload{}, fmt.Errorf("decode memory extraction payload: %w", err)
	}
	return decoded, nil
}

func normalizeMemoryExtractionCandidate(
	run execution.DurableRun,
	sourceHash string,
	raw memoryExtractionCandidate,
) (temporalruntime.MemoryCandidate, string) {
	reasonCode := strings.TrimSpace(raw.ReasonCode)
	compactText := strings.TrimSpace(raw.CompactText)
	if raw.Confidence < inferredMemoryConfidenceThreshold {
		return temporalruntime.MemoryCandidate{}, "low_confidence"
	}
	if compactText == "" {
		return temporalruntime.MemoryCandidate{}, "invalid_candidate"
	}
	if memoryruntime.ContainsForbiddenMemoryPayload(compactText) {
		return temporalruntime.MemoryCandidate{}, "forbidden_payload"
	}
	if reason := memoryCandidateReasonSkipReason(reasonCode); reason != "" {
		return temporalruntime.MemoryCandidate{}, reason
	}
	normalizedSourceHash := strings.TrimSpace(sourceHash)
	if normalizedSourceHash == "" {
		return temporalruntime.MemoryCandidate{}, "missing_source_hash"
	}
	probe := memoryruntime.UpsertRequest{
		Capability:  strings.TrimSpace(raw.Capability),
		CompactText: compactText,
		MemoryID:    "probe",
		MemoryType:  strings.TrimSpace(raw.MemoryType),
		Source:      "inferred",
		Status:      "active",
		UpdatedAt:   "1970-01-01T00:00:00Z",
		UserID:      firstNonEmptyText(run.OwnerUserID, "probe-user"),
	}
	if err := memoryruntime.ValidateUpsertRequest(probe); err != nil {
		return temporalruntime.MemoryCandidate{}, "invalid_candidate"
	}
	memoryID := "inf_" + memoryruntime.PointID(
		run.OwnerUserID,
		normalizedSourceHash+":"+reasonCode+":"+compactText,
	)[:16]
	return temporalruntime.MemoryCandidate{
		Capability:  probe.Capability,
		CompactText: compactText,
		Confidence:  raw.Confidence,
		MemoryID:    memoryID,
		MemoryType:  probe.MemoryType,
		ReasonCode:  reasonCode,
		SourceHash:  normalizedSourceHash,
	}, ""
}

func memoryCandidateReasonSkipReason(reasonCode string) string {
	switch strings.TrimSpace(reasonCode) {
	case "explicit_long_term_goal",
		"explicit_preference",
		"frequent_location",
		"stable_alias",
		"stable_profile",
		"stable_service_context":
		return ""
	case "identity_or_authorization_claim":
		return "identity_or_authorization_claim"
	case "institutional_fact":
		return "institutional_fact"
	case "temporary_request":
		return "temporary_request"
	case "uncertain_inference":
		return "uncertain_inference"
	default:
		return "unsupported_reason_code"
	}
}
