package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

const (
	runnerName       = "execution-control-go"
	evalSharedSecret = "intent-eval-worker-secret"
)

var unsafeRequestIDChars = regexp.MustCompile(`[^A-Za-z0-9_.:-]+`)

type evalInput struct {
	Cases []evalCaseInput `json:"cases"`
}

type evalCaseInput struct {
	CaseID              string          `json:"case_id"`
	UserGoal            string          `json:"user_goal"`
	RequestedCapability string          `json:"requested_capability"`
	RequestedScope      json.RawMessage `json:"requested_scope"`
	VersionQuery        json.RawMessage `json:"version_query"`
	Context             map[string]any  `json:"context"`
}

type evalOutput struct {
	SchemaVersion int              `json:"schema_version"`
	Runner        string           `json:"runner"`
	Results       []evalCaseResult `json:"results"`
}

type evalCaseResult struct {
	CaseID   string                          `json:"case_id"`
	Observed execution.IntentEvalObservation `json:"observed"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(input io.Reader, output io.Writer) error {
	raw, err := io.ReadAll(input)
	if err != nil {
		return fmt.Errorf("read intent eval input: %w", err)
	}
	var payload evalInput
	if err := json.Unmarshal(raw, &payload); err != nil {
		return fmt.Errorf("parse intent eval input: %w", err)
	}
	results := make([]evalCaseResult, 0, len(payload.Cases))
	for _, item := range payload.Cases {
		caseID := strings.TrimSpace(item.CaseID)
		if caseID == "" {
			return fmt.Errorf("case_id is required")
		}
		requestBody, err := item.requestBody(caseID)
		if err != nil {
			return err
		}
		observed, err := execution.ObserveIntentForEval(
			requestBody,
			map[string]string{
				"x-worker-origin-auth": evalSharedSecret,
				"x-trace-id":           "trace-" + safeRequestID(caseID),
			},
			config.Config{
				AuthMode:           "trusted-worker",
				WorkerSharedSecret: evalSharedSecret,
			},
		)
		if err != nil {
			return fmt.Errorf("evaluate intent case %s: %w", caseID, err)
		}
		results = append(results, evalCaseResult{
			CaseID:   caseID,
			Observed: observed,
		})
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(evalOutput{
		SchemaVersion: 1,
		Runner:        runnerName,
		Results:       results,
	})
}

func (c evalCaseInput) requestBody(caseID string) (json.RawMessage, error) {
	payload := map[string]any{
		"user_goal":            strings.TrimSpace(c.UserGoal),
		"request_id":           safeRequestID(caseID),
		"conversation_id":      "intent-eval",
		"requested_capability": strings.TrimSpace(c.RequestedCapability),
		"context":              normalizedContext(c.Context),
	}
	if len(c.RequestedScope) > 0 && string(c.RequestedScope) != "null" {
		value, err := rawJSONValue(c.RequestedScope, "requested_scope")
		if err != nil {
			return nil, err
		}
		payload["requested_scope"] = value
	}
	if len(c.VersionQuery) > 0 && string(c.VersionQuery) != "null" {
		value, err := rawJSONValue(c.VersionQuery, "version_query")
		if err != nil {
			return nil, err
		}
		payload["version_query"] = value
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode intent case %s request: %w", caseID, err)
	}
	return raw, nil
}

func rawJSONValue(raw json.RawMessage, fieldName string) (any, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("parse %s: %w", fieldName, err)
	}
	return value, nil
}

func normalizedContext(input map[string]any) map[string]any {
	context := map[string]any{}
	for key, value := range input {
		context[key] = value
	}
	context["actor"] = normalizedActor(context["actor"])
	context["authorization"] = normalizedAuthorization(context["authorization"])
	if _, ok := context["profile_memory"]; !ok {
		context["profile_memory"] = map[string]any{"items": []any{}}
	}
	if _, ok := context["session"]; !ok {
		context["session"] = map[string]any{"confirmed_slots": []any{}, "turn_count": 0}
	}
	return context
}

func normalizedActor(input any) map[string]any {
	actor, _ := input.(map[string]any)
	result := map[string]any{}
	for key, value := range actor {
		result[key] = value
	}
	if stringValue(result["user_id"]) == "" {
		result["user_id"] = "intent-eval-user"
	}
	if stringValue(result["principal_id"]) == "" {
		result["principal_id"] = "intent-eval-principal"
	}
	if stringValue(result["principal_type"]) == "" {
		result["principal_type"] = "student"
	}
	if _, ok := result["roles"]; !ok {
		result["roles"] = []string{"student"}
	}
	return result
}

func normalizedAuthorization(input any) map[string]any {
	authorization, _ := input.(map[string]any)
	result := map[string]any{}
	for key, value := range authorization {
		result[key] = value
	}
	if stringValue(result["principal_id"]) == "" {
		result["principal_id"] = "intent-eval-principal"
	}
	retrievalFilter, _ := result["retrieval_filter"].(map[string]any)
	filter := map[string]any{}
	for key, value := range retrievalFilter {
		filter[key] = value
	}
	if stringValue(filter["visibility_level"]) == "" {
		filter["visibility_level"] = "public"
	}
	if stringValue(filter["policy_projection_version"]) == "" {
		filter["policy_projection_version"] = "phase1-authorization-projection-v1"
	}
	result["retrieval_filter"] = filter
	return result
}

func stringValue(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func safeRequestID(caseID string) string {
	safe := unsafeRequestIDChars.ReplaceAllString(strings.TrimSpace(caseID), "-")
	if safe == "" {
		return "intent-eval-request"
	}
	return safe
}
