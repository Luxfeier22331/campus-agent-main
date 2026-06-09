package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredplanning"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
)

const (
	runnerName = "execution-control-go"
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
	ExpectedCapability          string            `json:"expected_capability"`
	ExpectedPayloadKind         string            `json:"expected_payload_kind"`
	ExpectedSelectedTool        string            `json:"expected_selected_tool"`
	ExpectedOutcome             string            `json:"expected_outcome"`
	ExpectedResolvedDisplayName string            `json:"expected_resolved_display_name"`
	ExpectedFailCloseReason     string            `json:"expected_fail_close_reason"`
	ExpectedFieldStatus         map[string]string `json:"expected_field_status"`
	ExpectedGuideFocus          string            `json:"expected_guide_focus"`
	RequiredSelectedSectionIDs  []string          `json:"required_selected_section_ids"`
	MaxSelectedSectionCount     *int              `json:"max_selected_section_count"`
	RequiredBodyTokens          []string          `json:"required_body_tokens"`
	ForbiddenBodyTokens         []string          `json:"forbidden_body_tokens"`
}

type previewReport struct {
	Results []previewResult `json:"results"`
}

type previewResult struct {
	SelectedWriteID string         `json:"selected_write_id"`
	Collection      string         `json:"collection"`
	InventoryID     string         `json:"inventory_id"`
	Bundle          map[string]any `json:"bundle"`
	FullBundle      map[string]any `json:"full_bundle"`
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
	targetPreview, err := findPreviewResult(report, item.Collection, item.InventoryID, bundleScope)
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
			observed.Capability = strings.TrimSpace(handoff.Capability)
			observed.PayloadKind = strings.TrimSpace(handoff.PayloadKind)
			if len(handoff.AllowedTools) == 1 {
				observed.SelectedTool = strings.TrimSpace(handoff.AllowedTools[0])
			}
			if item.ExpectedGuideFocus != "" {
				observedGuideFocus := stringValue(handoff.Payload["guide_focus"])
				if observedGuideFocus != strings.TrimSpace(item.ExpectedGuideFocus) {
					failures = append(
						failures,
						fmt.Sprintf("guide_focus=%s expected=%s", observedGuideFocus, item.ExpectedGuideFocus),
					)
				}
			}
			if observed.Capability != strings.TrimSpace(item.ExpectedCapability) {
				failures = append(
					failures,
					fmt.Sprintf("capability=%s expected=%s", observed.Capability, item.ExpectedCapability),
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
			selectedSectionIDs := stringSlice(body["selected_section_ids"])
			for _, expectedSectionID := range item.RequiredSelectedSectionIDs {
				expectedSectionID = strings.TrimSpace(expectedSectionID)
				if expectedSectionID == "" {
					continue
				}
				if !stringSliceContains(selectedSectionIDs, expectedSectionID) {
					failures = append(failures, "missing_selected_section_id="+expectedSectionID)
				}
			}
			if item.MaxSelectedSectionCount != nil && len(selectedSectionIDs) > *item.MaxSelectedSectionCount {
				failures = append(
					failures,
					fmt.Sprintf(
						"selected_section_count=%d expected_max=%d",
						len(selectedSectionIDs),
						*item.MaxSelectedSectionCount,
					),
				)
			}
			for _, token := range item.RequiredBodyTokens {
				if strings.TrimSpace(token) == "" {
					continue
				}
				if !strings.Contains(bodyText, token) {
					failures = append(failures, "missing_body_token="+token)
				}
			}
			for _, token := range item.ForbiddenBodyTokens {
				token = strings.TrimSpace(token)
				if token == "" {
					continue
				}
				if strings.Contains(bodyText, token) {
					failures = append(failures, "forbidden_body_token="+token)
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
	bundleScope string,
) (previewResult, error) {
	for _, item := range report.Results {
		if strings.TrimSpace(item.Collection) == strings.TrimSpace(collection) &&
			strings.TrimSpace(item.InventoryID) == strings.TrimSpace(inventoryID) {
			return item, nil
		}
	}
	if normalizeBundleScope(bundleScope) == "full_impact" {
		for _, item := range report.Results {
			if strings.TrimSpace(item.Collection) == strings.TrimSpace(collection) {
				return item, nil
			}
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
	trustedTime := previewTrustedTimeForCase(
		bundleMap,
		strings.TrimSpace(item.Collection),
		strings.TrimSpace(item.InventoryID),
	)
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

func previewTrustedTimeForCase(
	bundleMap map[string]any,
	collection string,
	inventoryID string,
) string {
	for _, record := range previewRecordsForCollection(bundleMap, collection) {
		if previewRecordInventoryID(record) != inventoryID {
			continue
		}
		if anchor := previewTrustedTimeFromRecord(record); anchor != "" {
			return anchor
		}
	}
	for _, record := range previewRecordsForCollection(bundleMap, collection) {
		if anchor := previewTrustedTimeFromRecord(record); anchor != "" {
			return anchor
		}
	}
	return ""
}

func previewRecordsForCollection(bundleMap map[string]any, collection string) []map[string]any {
	field := ""
	switch strings.TrimSpace(collection) {
	case "service_guide":
		field = "service_guide_records"
	case "contact_directory":
		field = "contact_records"
	default:
		return nil
	}
	items, ok := bundleMap[field].([]any)
	if !ok {
		return nil
	}
	records := make([]map[string]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if ok {
			records = append(records, record)
		}
	}
	return records
}

func previewRecordInventoryID(record map[string]any) string {
	for _, sourceRef := range stringSlice(record["source_refs"]) {
		parts := strings.Split(strings.TrimSpace(sourceRef), ":")
		if len(parts) < 3 {
			continue
		}
		if parts[0] != "official_web" {
			continue
		}
		inventoryID := strings.TrimSpace(parts[1])
		if inventoryID != "" {
			return inventoryID
		}
	}
	return ""
}

func previewTrustedTimeFromRecord(record map[string]any) string {
	effectiveFrom := strings.TrimSpace(stringValue(record["effective_from"]))
	if effectiveFrom == "" {
		return ""
	}
	parsed, err := time.Parse(time.RFC3339, effectiveFrom)
	if err != nil {
		return ""
	}
	return parsed.Add(time.Second).Format(time.RFC3339)
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

func stringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		text := stringValue(item)
		if text == "" {
			continue
		}
		result = append(result, text)
	}
	return result
}

func stringSliceContains(values []string, needle string) bool {
	needle = strings.TrimSpace(needle)
	if needle == "" {
		return false
	}
	for _, value := range values {
		if strings.TrimSpace(value) == needle {
			return true
		}
	}
	return false
}
