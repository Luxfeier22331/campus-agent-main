package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredplanning"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredquery"
)

const (
	runnerName = "supervisor-api-go"
)

type inputPayload struct {
	PreviewReportPath string        `json:"preview_report_path"`
	BundleScope       string        `json:"bundle_scope"`
	Cases             []runtimeCase `json:"cases"`
}

type runtimeCase struct {
	CaseID                      string            `json:"case_id"`
	Collection                  string            `json:"collection"`
	InventoryID                 string            `json:"inventory_id"`
	Mode                        string            `json:"mode"`
	UserGoal                    string            `json:"user_goal"`
	ExpectedTarget              string            `json:"expected_target"`
	ExpectedPayloadKind         string            `json:"expected_payload_kind"`
	ExpectedSelectedTool        string            `json:"expected_selected_tool"`
	ExpectedOutcome             string            `json:"expected_outcome"`
	ExpectedResolvedDisplayName string            `json:"expected_resolved_display_name"`
	ExpectedFailCloseReason     string            `json:"expected_fail_close_reason"`
	ExpectedFieldStatus         map[string]string `json:"expected_field_status"`
	RequiredBodyTokens          []string          `json:"required_body_tokens"`
}

type previewReport struct {
	Results []previewResult `json:"results"`
}

type previewResult struct {
	SelectedWriteID string                 `json:"selected_write_id"`
	Collection      string                 `json:"collection"`
	InventoryID     string                 `json:"inventory_id"`
	Bundle          map[string]any         `json:"bundle"`
	FullBundle      map[string]any         `json:"full_bundle"`
}

type outputPayload struct {
	SchemaVersion string       `json:"schema_version"`
	Runner        string       `json:"runner"`
	Results       []caseResult `json:"results"`
}

type caseResult struct {
	CaseID          string         `json:"case_id"`
	Collection      string         `json:"collection"`
	InventoryID     string         `json:"inventory_id"`
	SelectedWriteID string         `json:"selected_write_id"`
	Passed          bool           `json:"passed"`
	Failures        []string       `json:"failures"`
	Observed        observedResult `json:"observed"`
}

type observedResult struct {
	Capability          string            `json:"capability"`
	Target              string            `json:"target"`
	PayloadKind         string            `json:"payload_kind"`
	SelectedTool        string            `json:"selected_tool"`
	Outcome             string            `json:"outcome"`
	ResolvedDisplayName string            `json:"resolved_display_name"`
	FailCloseReason     string            `json:"fail_close_reason"`
	FieldStatus         map[string]string `json:"field_status"`
	Body                map[string]any    `json:"body"`
}

type memoryProjectionStore struct {
	bundle structuredquery.ProjectionBundle
}

func (s memoryProjectionStore) HealthCheck(context.Context) error {
	return nil
}

func (s memoryProjectionStore) CurrentReleaseID(context.Context) (string, error) {
	return "preview-runtime-release", nil
}

func (s memoryProjectionStore) ProjectionReady(context.Context) (bool, error) {
	return true, nil
}

func (s memoryProjectionStore) LoadBundleForRelease(
	context.Context,
	string,
) (structuredquery.ProjectionBundle, error) {
	return s.bundle, nil
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
		return fmt.Errorf("read preview runtime verifier input: %w", err)
	}
	var payload inputPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return fmt.Errorf("parse preview runtime verifier input: %w", err)
	}
	if strings.TrimSpace(payload.PreviewReportPath) == "" {
		return fmt.Errorf("preview_report_path is required")
	}
	bundleScope := normalizeBundleScope(payload.BundleScope)
	report, err := loadPreviewReport(payload.PreviewReportPath)
	if err != nil {
		return err
	}
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		return fmt.Errorf("load intent policy: %w", err)
	}
	results := make([]caseResult, 0, len(payload.Cases))
	for _, item := range payload.Cases {
		result, err := evaluateCase(item, report, policy, bundleScope)
		if err != nil {
			return fmt.Errorf("evaluate case %s: %w", item.CaseID, err)
		}
		results = append(results, result)
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(outputPayload{
		SchemaVersion: "official_web_selected_write_preview_runtime_verification.v1",
		Runner:        runnerName,
		Results:       results,
	})
}

func loadPreviewReport(path string) (previewReport, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return previewReport{}, fmt.Errorf("read preview report: %w", err)
	}
	var report previewReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return previewReport{}, fmt.Errorf("parse preview report: %w", err)
	}
	return report, nil
}

func evaluateCase(
	item runtimeCase,
	report previewReport,
	policy runtimepolicy.IntentPolicyArtifact,
	bundleScope string,
) (caseResult, error) {
	targetPreview, err := findPreviewResult(report, item.Collection, item.InventoryID)
	if err != nil {
		return caseResult{}, err
	}
	capability := runtimepolicy.InferCapabilityFromGoal(item.UserGoal, policy)
	plan := structuredplanning.PlanWithPolicy(
		structuredplanning.Request{
			EffectiveCapability: capability,
			UserGoal:            item.UserGoal,
		},
		policy,
	)
	failures := []string{}
	observed := observedResult{
		Capability: capability,
		Body:       map[string]any{},
	}
	if plan == nil {
		failures = append(failures, "planner_returned_nil")
	} else {
		handoff := plan.SelectedHandoff()
		if handoff == nil {
			failures = append(failures, "selected_handoff_missing")
		} else {
			observed.Target = strings.TrimSpace(handoff.Target)
			observed.PayloadKind = strings.TrimSpace(handoff.PayloadKind)
			if len(handoff.AllowedTools) == 1 {
				observed.SelectedTool = strings.TrimSpace(handoff.AllowedTools[0])
			}
			if observed.Target != strings.TrimSpace(item.ExpectedTarget) {
				failures = append(
					failures,
					fmt.Sprintf("target=%s expected=%s", observed.Target, item.ExpectedTarget),
				)
			}
			if observed.PayloadKind != strings.TrimSpace(item.ExpectedPayloadKind) {
				failures = append(
					failures,
					fmt.Sprintf("payload_kind=%s expected=%s", observed.PayloadKind, item.ExpectedPayloadKind),
				)
			}
			if observed.SelectedTool != strings.TrimSpace(item.ExpectedSelectedTool) {
				failures = append(
					failures,
					fmt.Sprintf("selected_tool=%s expected=%s", observed.SelectedTool, item.ExpectedSelectedTool),
				)
			}
			response, err := executePreviewRuntime(item, targetPreview, handoff, bundleScope)
			if err != nil {
				return caseResult{}, err
			}
			body, err := responseBodyMap(response.Body)
			if err != nil {
				return caseResult{}, fmt.Errorf("decode response body for case %s: %w", item.CaseID, err)
			}
			observed.Body = body
			observed.Outcome = stringValue(body["outcome"])
			observed.FailCloseReason = stringValue(body["fail_close_reason"])
			observed.ResolvedDisplayName = resolvedDisplayName(body)
			observed.FieldStatus = fieldStatus(body["field_status"])
			if observed.Outcome != strings.TrimSpace(item.ExpectedOutcome) {
				failures = append(
					failures,
					fmt.Sprintf("outcome=%s expected=%s", observed.Outcome, item.ExpectedOutcome),
				)
			}
			if item.ExpectedResolvedDisplayName != "" &&
				observed.ResolvedDisplayName != strings.TrimSpace(item.ExpectedResolvedDisplayName) {
				failures = append(
					failures,
					fmt.Sprintf(
						"resolved_display_name=%s expected=%s",
						observed.ResolvedDisplayName,
						item.ExpectedResolvedDisplayName,
					),
				)
			}
			if item.ExpectedFailCloseReason != "" &&
				observed.FailCloseReason != strings.TrimSpace(item.ExpectedFailCloseReason) {
				failures = append(
					failures,
					fmt.Sprintf(
						"fail_close_reason=%s expected=%s",
						observed.FailCloseReason,
						item.ExpectedFailCloseReason,
					),
				)
			}
			for key, expected := range item.ExpectedFieldStatus {
				if observed.FieldStatus[key] != strings.TrimSpace(expected) {
					failures = append(
						failures,
						fmt.Sprintf(
							"field_status.%s=%s expected=%s",
							key,
							observed.FieldStatus[key],
							expected,
						),
					)
				}
			}
			bodyText := bodyText(body)
			for _, token := range item.RequiredBodyTokens {
				if strings.TrimSpace(token) == "" {
					continue
				}
				if !strings.Contains(bodyText, token) {
					failures = append(failures, "missing_body_token="+token)
				}
			}
		}
	}
	return caseResult{
		CaseID:          item.CaseID,
		Collection:      item.Collection,
		InventoryID:     item.InventoryID,
		SelectedWriteID: targetPreview.SelectedWriteID,
		Passed:          len(failures) == 0,
		Failures:        failures,
		Observed:        observed,
	}, nil
}

func findPreviewResult(
	report previewReport,
	collection string,
	inventoryID string,
) (previewResult, error) {
	for _, item := range report.Results {
		if strings.TrimSpace(item.Collection) == strings.TrimSpace(collection) &&
			strings.TrimSpace(item.InventoryID) == strings.TrimSpace(inventoryID) {
			return item, nil
		}
	}
	return previewResult{}, fmt.Errorf(
		"preview result not found for %s/%s",
		collection,
		inventoryID,
	)
}

func executePreviewRuntime(
	item runtimeCase,
	targetPreview previewResult,
	handoff *structuredplanning.Handoff,
	bundleScope string,
) (structuredquery.Response, error) {
	bundleMap := targetPreview.Bundle
	if normalizeBundleScope(bundleScope) == "full_impact" {
		bundleMap = targetPreview.FullBundle
	}
	bundle, err := bundleFromMap(bundleMap)
	if err != nil {
		return structuredquery.Response{}, err
	}
	trustedTime := previewTrustedTime(targetPreview.Bundle)
	switch strings.TrimSpace(handoff.PayloadKind) {
	case structuredquery.ToolServiceGuideLookup:
		runtime := structuredquery.NewRuntime(structuredquery.Options{
			ServiceGuideReadModelStore: memoryProjectionStore{bundle: bundle},
			TrustedTimeRFC3339:         trustedTime,
		})
		defer runtime.Close()
		raw, err := json.Marshal(handoff.Payload)
		if err != nil {
			return structuredquery.Response{}, fmt.Errorf("marshal service guide payload: %w", err)
		}
		return runtime.LookupServiceGuide(context.Background(), raw), nil
	case structuredquery.ToolContactDirectoryLookup:
		runtime := structuredquery.NewRuntime(structuredquery.Options{
			ContactDirectoryReadModelStore: memoryProjectionStore{bundle: bundle},
			TrustedTimeRFC3339:             trustedTime,
		})
		defer runtime.Close()
		raw, err := json.Marshal(handoff.Payload)
		if err != nil {
			return structuredquery.Response{}, fmt.Errorf("marshal contact payload: %w", err)
		}
		return runtime.LookupContactDirectory(context.Background(), raw), nil
	default:
		return structuredquery.Response{}, fmt.Errorf(
			"unsupported payload kind for case %s: %s",
			item.CaseID,
			handoff.PayloadKind,
		)
	}
}

func normalizeBundleScope(value string) string {
	if strings.TrimSpace(value) == "full_impact" {
		return "full_impact"
	}
	return "task_scope"
}

func previewTrustedTime(bundleMap map[string]any) string {
	for _, field := range []string{"service_guide_records", "contact_records"} {
		records, ok := bundleMap[field].([]any)
		if !ok {
			continue
		}
		for _, item := range records {
			record, ok := item.(map[string]any)
			if !ok {
				continue
			}
			effectiveFrom := strings.TrimSpace(stringValue(record["effective_from"]))
			if effectiveFrom == "" {
				continue
			}
			parsed, err := time.Parse(time.RFC3339, effectiveFrom)
			if err != nil {
				continue
			}
			return parsed.Add(time.Second).Format(time.RFC3339)
		}
	}
	return ""
}

func bundleFromMap(value map[string]any) (structuredquery.ProjectionBundle, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return structuredquery.ProjectionBundle{}, fmt.Errorf("marshal projection bundle: %w", err)
	}
	var bundle structuredquery.ProjectionBundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		return structuredquery.ProjectionBundle{}, fmt.Errorf("parse projection bundle: %w", err)
	}
	return bundle, nil
}

func resolvedDisplayName(body map[string]any) string {
	for _, key := range []string{"resolved_service", "resolved_contact"} {
		item, ok := body[key].(map[string]any)
		if !ok {
			continue
		}
		if display := stringValue(item["display_name"]); display != "" {
			return display
		}
	}
	return ""
}

func fieldStatus(value any) map[string]string {
	item, ok := value.(map[string]any)
	if !ok {
		return map[string]string{}
	}
	result := map[string]string{}
	for key, rawValue := range item {
		key = strings.TrimSpace(key)
		text := stringValue(rawValue)
		if key == "" || text == "" {
			continue
		}
		result[key] = text
	}
	return result
}

func bodyText(body map[string]any) string {
	raw, err := json.Marshal(body)
	if err != nil {
		return ""
	}
	return string(raw)
}

func responseBodyMap(value any) (map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	return body, nil
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
