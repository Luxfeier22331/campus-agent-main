//go:build retired_bridge_serving

package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func semanticExecutionRequestForRun(run execution.DurableRun) (json.RawMessage, error) {
	rawPayload, exists := run.Metadata["execution_payload"]
	if !exists {
		return nil, errors.New("run projection metadata.execution_payload is required")
	}
	rawHandoff, exists := run.Metadata["handoff"]
	payload, err := json.Marshal(rawPayload)
	if err != nil {
		return nil, fmt.Errorf("encode semantic execution payload: %w", err)
	}
	handoff, err := semanticBridgeHandoffForRun(run, rawPayload, rawHandoff, exists)
	if err != nil {
		return nil, err
	}
	projected, err := execution.BridgePayloadForHandoff(payload, handoff)
	if err != nil {
		return nil, err
	}
	return projected, nil
}

func semanticBridgeHandoffForRun(
	run execution.DurableRun,
	rawPayload any,
	rawHandoff any,
	hasHandoff bool,
) (execution.RuntimeHandoff, error) {
	if hasHandoff {
		return semanticBridgeHandoffFromMetadata(rawHandoff)
	}
	if run.Lane != execution.DurableLaneRAG {
		return execution.RuntimeHandoff{}, errors.New("run projection metadata.handoff is required")
	}
	payloadRecord, ok := rawPayload.(map[string]any)
	if !ok {
		return execution.RuntimeHandoff{}, errors.New("run projection metadata.execution_payload must be an object")
	}
	userGoal, ok := payloadRecord["user_goal"].(string)
	if !ok || strings.TrimSpace(userGoal) == "" {
		return execution.RuntimeHandoff{}, errors.New(
			"run projection metadata.execution_payload.user_goal is required for rag handoff planning",
		)
	}
	return execution.RuntimeHandoff{
		Capability:   "knowledge",
		PayloadKind:  "rag_request",
		Payload:      map[string]any{"query_text": strings.TrimSpace(userGoal)},
		AllowedTools: []string{"retrieval.query"},
	}, nil
}

func semanticBridgeHandoffFromMetadata(raw any) (execution.RuntimeHandoff, error) {
	record, ok := raw.(map[string]any)
	if !ok {
		return execution.RuntimeHandoff{}, errors.New("run projection metadata.handoff must be an object")
	}
	target, err := requiredSemanticHandoffString(record, "capability")
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	payloadKind, err := requiredSemanticHandoffString(record, "payload_kind")
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	payload, ok := record["payload"].(map[string]any)
	if !ok {
		return execution.RuntimeHandoff{}, errors.New("run projection metadata.handoff.payload must be an object")
	}
	allowedTools, err := semanticStringSlice(record["allowed_tools"], "allowed_tools")
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	expectedArtifacts, err := semanticOptionalStringSlice(
		record["expected_artifacts"],
		"expected_artifacts",
	)
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	requiredProjectionKind := ""
	if rawRequiredProjectionKind, exists := record["required_projection_kind"]; exists {
		requiredProjectionKind, err = semanticOptionalString(
			rawRequiredProjectionKind,
			"required_projection_kind",
		)
		if err != nil {
			return execution.RuntimeHandoff{}, err
		}
	}
	return execution.RuntimeHandoff{
		Capability:             target,
		PayloadKind:            payloadKind,
		Payload:                payload,
		AllowedTools:           allowedTools,
		RequiredProjectionKind: requiredProjectionKind,
		ExpectedArtifacts:      expectedArtifacts,
	}, nil
}

func requiredSemanticHandoffString(record map[string]any, field string) (string, error) {
	value, exists := record[field]
	if !exists {
		return "", fmt.Errorf("run projection metadata.handoff.%s is required", field)
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("run projection metadata.handoff.%s must be a non-empty string", field)
	}
	return text, nil
}

func semanticOptionalString(value any, field string) (string, error) {
	if value == nil {
		return "", nil
	}
	text, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("run projection metadata.handoff.%s must be a string", field)
	}
	return strings.TrimSpace(text), nil
}

func semanticStringSlice(value any, field string) ([]string, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("run projection metadata.handoff.%s must be an array", field)
	}
	result := make([]string, 0, len(items))
	for index, item := range items {
		text, ok := item.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return nil, fmt.Errorf(
				"run projection metadata.handoff.%s[%d] must be a non-empty string",
				field,
				index,
			)
		}
		result = append(result, text)
	}
	return result, nil
}

func semanticOptionalStringSlice(value any, field string) ([]string, error) {
	if value == nil {
		return nil, nil
	}
	return semanticStringSlice(value, field)
}
