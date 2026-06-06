//go:build !retired_pg_lease

package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func durableFinalizationResponseForBridge(
	run execution.DurableRun,
	response bridge.ExecuteResponse,
) (map[string]any, error) {
	if response.Kind != "durable_agent_response" {
		return nil, fmt.Errorf("durable bridge returned unsupported kind %q", response.Kind)
	}
	body, err := decodeJSONObject(response.Body)
	if err != nil {
		return nil, fmt.Errorf("decode durable bridge response: %w", err)
	}
	return finalizeAgentBridgeResponse(
		body,
		run.TraceID,
		durableFinalizerContextForRun(run),
	)
}

func durableFinalizerContextForRun(run execution.DurableRun) supervisorFinalizerContext {
	return supervisorFinalizerContext{
		RuntimeDecisions: execution.RuntimeDecisionSummary{
			SelectedTarget: "rag-agent",
			RuntimeVersions: map[string]any{
				"durable_run_contract": "durable-agent-runtime-contract-v1",
			},
		},
		Branch: "durable_run",
		RuntimeVersions: map[string]any{
			"durable_run_contract": "durable-agent-runtime-contract-v1",
		},
	}
}

func durableExecutionRequestForRun(run execution.DurableRun) (json.RawMessage, error) {
	rawPayload, exists := run.Metadata["execution_payload"]
	if !exists {
		return nil, errors.New("durable run metadata.execution_payload is required")
	}
	rawHandoff, exists := run.Metadata["handoff"]
	payload, err := json.Marshal(rawPayload)
	if err != nil {
		return nil, fmt.Errorf("encode durable execution payload: %w", err)
	}
	handoff, err := durableRuntimeHandoffForRun(run, rawPayload, rawHandoff, exists)
	if err != nil {
		return nil, err
	}
	projected, err := execution.BridgePayloadForHandoff(payload, handoff)
	if err != nil {
		return nil, err
	}
	return projected, nil
}

func durableRuntimeHandoffForRun(
	run execution.DurableRun,
	rawPayload any,
	rawHandoff any,
	hasHandoff bool,
) (execution.RuntimeHandoff, error) {
	if hasHandoff {
		return durableRuntimeHandoffFromMetadata(rawHandoff)
	}
	if run.Lane != execution.DurableLaneRAG {
		return execution.RuntimeHandoff{}, errors.New("durable run metadata.handoff is required")
	}
	payloadRecord, ok := rawPayload.(map[string]any)
	if !ok {
		return execution.RuntimeHandoff{}, errors.New("durable run metadata.execution_payload must be an object")
	}
	userGoal, ok := payloadRecord["user_goal"].(string)
	if !ok || strings.TrimSpace(userGoal) == "" {
		return execution.RuntimeHandoff{}, errors.New(
			"durable run metadata.execution_payload.user_goal is required for rag handoff planning",
		)
	}
	return execution.RuntimeHandoff{
		Target:       "rag-agent",
		PayloadKind:  "rag_request",
		Payload:      map[string]any{"query_text": strings.TrimSpace(userGoal)},
		AllowedTools: []string{"retrieval.query"},
	}, nil
}

func durableRuntimeHandoffFromMetadata(raw any) (execution.RuntimeHandoff, error) {
	record, ok := raw.(map[string]any)
	if !ok {
		return execution.RuntimeHandoff{}, errors.New("durable run metadata.handoff must be an object")
	}
	target, err := requiredDurableString(record, "target")
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	payloadKind, err := requiredDurableString(record, "payload_kind")
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	payload, ok := record["payload"].(map[string]any)
	if !ok {
		return execution.RuntimeHandoff{}, errors.New("durable run metadata.handoff.payload must be an object")
	}
	allowedTools, err := durableStringSlice(record["allowed_tools"], "allowed_tools")
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	expectedArtifacts, err := durableOptionalStringSlice(
		record["expected_artifacts"],
		"expected_artifacts",
	)
	if err != nil {
		return execution.RuntimeHandoff{}, err
	}
	requiredProjectionKind := ""
	if rawRequiredProjectionKind, exists := record["required_projection_kind"]; exists {
		requiredProjectionKind, err = durableOptionalString(
			rawRequiredProjectionKind,
			"required_projection_kind",
		)
		if err != nil {
			return execution.RuntimeHandoff{}, err
		}
	}
	return execution.RuntimeHandoff{
		Target:                 target,
		PayloadKind:            payloadKind,
		Payload:                payload,
		AllowedTools:           allowedTools,
		RequiredProjectionKind: requiredProjectionKind,
		ExpectedArtifacts:      expectedArtifacts,
	}, nil
}

func requiredDurableString(record map[string]any, field string) (string, error) {
	value, exists := record[field]
	if !exists {
		return "", fmt.Errorf("durable run metadata.handoff.%s is required", field)
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("durable run metadata.handoff.%s must be a non-empty string", field)
	}
	return text, nil
}

func durableOptionalString(value any, field string) (string, error) {
	if value == nil {
		return "", nil
	}
	text, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("durable run metadata.handoff.%s must be a string", field)
	}
	return strings.TrimSpace(text), nil
}

func durableStringSlice(value any, field string) ([]string, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("durable run metadata.handoff.%s must be an array", field)
	}
	result := make([]string, 0, len(items))
	for index, item := range items {
		text, ok := item.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return nil, fmt.Errorf(
				"durable run metadata.handoff.%s[%d] must be a non-empty string",
				field,
				index,
			)
		}
		result = append(result, text)
	}
	return result, nil
}

func durableOptionalStringSlice(value any, field string) ([]string, error) {
	if value == nil {
		return nil, nil
	}
	return durableStringSlice(value, field)
}
