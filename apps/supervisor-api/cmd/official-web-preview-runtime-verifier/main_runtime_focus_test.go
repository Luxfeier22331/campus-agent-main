package main

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPreviewTrustedTimeForCaseUsesTargetInventoryRecordInFullImpactBundle(t *testing.T) {
	bundle := map[string]any{
		"service_guide_records": []any{
			map[string]any{
				"display_name":   "中央民族大学 VPN 使用说明",
				"effective_from": "2026-05-02T00:00:00Z",
				"source_refs":    []any{"official_web:muc-it-vpn-service-guide:owver_vpn"},
			},
			map[string]any{
				"display_name":   "中央民族大学信息公开依申请公开工作流程",
				"effective_from": "2026-05-04T00:00:00Z",
				"source_refs":    []any{"official_web:muc-information-disclosure-application-process:owver_info"},
			},
		},
	}

	got := previewTrustedTimeForCase(
		bundle,
		"service_guide",
		"muc-information-disclosure-application-process",
	)

	if got != "2026-05-04T00:00:01Z" {
		t.Fatalf("trusted time = %q, want 2026-05-04T00:00:01Z", got)
	}
}

func TestRunFailsWhenVPNProcedureCaseLeaksForbiddenTokens(t *testing.T) {
	input := inputPayload{
		PreviewReportPath: writePreviewReportFixture(
			t,
			previewReport{
				Results: []previewResult{
					{
						SelectedWriteID: "owrelease_selected_write_service",
						Collection:      "service_guide",
						InventoryID:     "muc-it-vpn-service-guide",
						Bundle: map[string]any{
							"schema_version": "campus_services_service_guide_projection.v1",
							"service_guide_records": []map[string]any{
								{
									"service_id":      "service:official_web:vpn",
									"display_name":    "中央民族大学 VPN 使用说明",
									"aliases":         []string{"VPN"},
									"category":        "campus_service",
									"campus_scope":    "all",
									"audience":        []string{"student", "unknown"},
									"effective_from":  "2026-05-01T00:00:00+08:00",
									"effective_until": "2099-12-31T23:59:59+08:00",
									"source_refs":     []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
									"guide_sections": []map[string]any{
										{
											"section_id":   "service:official_web:vpn:section:procedure",
											"section_type": "procedure",
											"title":        "中央民族大学 VPN 使用说明",
											"content":      "1. 访问 https://vpn.muc.edu.cn。\n2. 首次使用请根据系统提示下载客户端。",
											"order":        1,
											"source_refs":  []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
									},
									"procedure_groups": []map[string]any{
										{
											"group_id":   "service:official_web:vpn:procedure_group:client_install",
											"title":      "客户端安装",
											"focus_tags": []string{"procedure", "install", "client", "客户端"},
											"order":      1,
											"steps": []map[string]any{
												{
													"step_id":     "service:official_web:vpn:procedure_group:client_install:step:1",
													"content":     "首次使用请根据系统提示下载客户端。",
													"order":       1,
													"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
												},
												{
													"step_id":     "service:official_web:vpn:procedure_group:client_install:step:2",
													"content":     "双击Install EasyConnect.pkg，根据提示完成安装。",
													"order":       2,
													"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
												},
											},
											"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
									},
									"entry_refs": []map[string]any{
										{
											"entry_id":     "service:official_web:vpn:entry:1",
											"label":        "https://vpn.muc.edu.cn",
											"entry_type":   "online_url",
											"url":          "https://vpn.muc.edu.cn",
											"location_ref": "",
											"source_refs":  []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
									},
									"materials":         []any{},
									"office_hours":      []any{},
									"contact_refs":      []any{},
									"eligibility_notes": []any{},
									"field_status": map[string]string{
										"service_process": "present",
										"service_entry":   "present",
									},
									"extraction_status": "ready",
								},
							},
						},
					},
				},
			},
		),
		Cases: []runtimeCase{
			{
				CaseID:                      "service-vpn-procedure-forbidden",
				Collection:                  "service_guide",
				InventoryID:                 "muc-it-vpn-service-guide",
				Mode:                        "planner_runtime",
				UserGoal:                    "VPN客户端怎么安装",
				ExpectedTarget:              "campus-services-agent",
				ExpectedPayloadKind:         "service_guide_lookup",
				ExpectedSelectedTool:        "service_guide_lookup",
				ExpectedOutcome:             "resolved_current",
				ExpectedResolvedDisplayName: "中央民族大学 VPN 使用说明",
				ExpectedGuideFocus:          "procedure",
				MaxSelectedSectionCount:     intPtr(1),
				RequiredSelectedSectionIDs: []string{
					"service:official_web:vpn:procedure_group:client_install",
				},
				RequiredBodyTokens:  []string{"下载客户端"},
				ForbiddenBodyTokens: []string{"Install EasyConnect.pkg"},
			},
		},
	}

	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	var stdout bytes.Buffer
	if err := run(bytes.NewReader(raw), &stdout); err != nil {
		t.Fatalf("run: %v", err)
	}
	var output outputPayload
	if err := json.Unmarshal(stdout.Bytes(), &output); err != nil {
		t.Fatalf("parse output: %v", err)
	}
	if len(output.Results) != 1 {
		t.Fatalf("results len = %d, want 1", len(output.Results))
	}
	if output.Results[0].Passed {
		t.Fatalf("expected failure, got pass: %#v", output.Results[0])
	}
	if !containsFailure(output.Results[0].Failures, "forbidden_body_token=Install EasyConnect.pkg") {
		t.Fatalf("failures = %#v, want forbidden token failure", output.Results[0].Failures)
	}
}

func TestRunPassesWhenVPNProcedureCaseSelectsFocusedSection(t *testing.T) {
	input := inputPayload{
		PreviewReportPath: writePreviewReportFixture(
			t,
			previewReport{
				Results: []previewResult{
					{
						SelectedWriteID: "owrelease_selected_write_service",
						Collection:      "service_guide",
						InventoryID:     "muc-it-vpn-service-guide",
						Bundle: map[string]any{
							"schema_version": "campus_services_service_guide_projection.v1",
							"service_guide_records": []map[string]any{
								{
									"service_id":      "service:official_web:vpn",
									"display_name":    "中央民族大学 VPN 使用说明",
									"aliases":         []string{"VPN"},
									"category":        "campus_service",
									"campus_scope":    "all",
									"audience":        []string{"student", "unknown"},
									"effective_from":  "2026-05-01T00:00:00+08:00",
									"effective_until": "2099-12-31T23:59:59+08:00",
									"source_refs":     []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
									"guide_sections": []map[string]any{
										{
											"section_id":   "service:official_web:vpn:section:procedure",
											"section_type": "procedure",
											"title":        "中央民族大学 VPN 使用说明",
											"content":      "1. 访问 https://vpn.muc.edu.cn。\n2. 输入统一身份认证账号和密码登录。\n3. 首次使用请根据系统提示下载客户端。\n4. 双击Install EasyConnect.pkg，根据提示完成安装。",
											"order":        1,
											"source_refs":  []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
									},
									"procedure_groups": []map[string]any{
										{
											"group_id":   "service:official_web:vpn:procedure_group:direct_login",
											"title":      "直接登录",
											"focus_tags": []string{"entry", "direct_login", "vpn"},
											"order":      1,
											"steps": []map[string]any{
												{
													"step_id":     "service:official_web:vpn:procedure_group:direct_login:step:1",
													"content":     "访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
													"order":       1,
													"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
												},
											},
											"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
										{
											"group_id":   "service:official_web:vpn:procedure_group:client_install",
											"title":      "客户端安装",
											"focus_tags": []string{"procedure", "install", "client", "客户端"},
											"order":      2,
											"steps": []map[string]any{
												{
													"step_id":     "service:official_web:vpn:procedure_group:client_install:step:1",
													"content":     "首次使用请根据系统提示下载客户端。",
													"order":       1,
													"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
												},
												{
													"step_id":     "service:official_web:vpn:procedure_group:client_install:step:2",
													"content":     "双击Install EasyConnect.pkg，根据提示完成安装。",
													"order":       2,
													"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
												},
											},
											"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
										{
											"group_id":   "service:official_web:vpn:procedure_group:mobile_usage",
											"title":      "移动端使用",
											"focus_tags": []string{"procedure", "mobile", "移动端"},
											"order":      3,
											"steps": []map[string]any{
												{
													"step_id":     "service:official_web:vpn:procedure_group:mobile_usage:step:1",
													"content":     "移动端可在企业应用中心打开 EasyConnect。",
													"order":       1,
													"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
												},
											},
											"source_refs": []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
									},
									"entry_refs":        []any{},
									"materials":         []any{},
									"office_hours":      []any{},
									"contact_refs":      []any{},
									"eligibility_notes": []any{},
									"field_status": map[string]string{
										"service_process": "present",
										"service_entry":   "present",
									},
									"extraction_status": "ready",
								},
							},
						},
					},
				},
			},
		),
		Cases: []runtimeCase{
			{
				CaseID:                      "service-vpn-procedure-focused",
				Collection:                  "service_guide",
				InventoryID:                 "muc-it-vpn-service-guide",
				Mode:                        "planner_runtime",
				UserGoal:                    "VPN客户端怎么安装",
				ExpectedTarget:              "campus-services-agent",
				ExpectedPayloadKind:         "service_guide_lookup",
				ExpectedSelectedTool:        "service_guide_lookup",
				ExpectedOutcome:             "resolved_current",
				ExpectedResolvedDisplayName: "中央民族大学 VPN 使用说明",
				ExpectedGuideFocus:          "procedure",
				RequiredSelectedSectionIDs: []string{
					"service:official_web:vpn:procedure_group:client_install",
				},
				MaxSelectedSectionCount: intPtr(1),
				RequiredBodyTokens: []string{
					"下载客户端",
					"Install EasyConnect.pkg",
				},
				ForbiddenBodyTokens: []string{"直接登录", "移动端"},
			},
		},
	}

	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	var stdout bytes.Buffer
	if err := run(bytes.NewReader(raw), &stdout); err != nil {
		t.Fatalf("run: %v", err)
	}
	var output outputPayload
	if err := json.Unmarshal(stdout.Bytes(), &output); err != nil {
		t.Fatalf("parse output: %v", err)
	}
	if len(output.Results) != 1 {
		t.Fatalf("results len = %d, want 1", len(output.Results))
	}
	if !output.Results[0].Passed {
		t.Fatalf("case failed: %#v", output.Results[0].Failures)
	}
}

func TestRunUsesCollectionFullImpactBundleTrustedTimeForCarriedForwardServiceGuideCases(t *testing.T) {
	input := inputPayload{
		PreviewReportPath: writePreviewReportFixture(
			t,
			previewReport{
				Results: []previewResult{
					{
						SelectedWriteID: "owrelease_selected_write_information_disclosure",
						Collection:      "service_guide",
						InventoryID:     "muc-information-disclosure-application-process",
						Bundle: map[string]any{
							"schema_version": "campus_services_service_guide_projection.v1",
							"service_guide_records": []map[string]any{
								{
									"service_id":        "service:official-web:information-disclosure",
									"display_name":      "中央民族大学信息公开依申请公开工作流程",
									"aliases":           []string{"信息公开申请流程"},
									"category":          "campus_service",
									"campus_scope":      "all",
									"audience":          []string{"unknown"},
									"effective_from":    "2026-05-02T00:00:00+08:00",
									"effective_until":   "9999-12-31T23:59:59+08:00",
									"source_refs":       []string{"https://xxgk.muc.edu.cn/info/1007/1113.htm"},
									"materials":         []any{},
									"office_hours":      []any{},
									"contact_refs":      []any{},
									"entry_refs":        []any{},
									"eligibility_notes": []any{},
									"extraction_status": "ready",
									"field_status": map[string]string{
										"service_name":            "present",
										"process_steps":           "present",
										"service_entry":           "source_not_provided",
										"source_url":              "present",
										"source_version_evidence": "present",
										"service_process":         "present",
									},
									"guide_sections": []map[string]any{
										{
											"section_id":   "information-disclosure:procedure",
											"section_type": "procedure",
											"title":        "信息公开申请流程",
											"content":      "1. 提交信息公开申请。",
											"order":        1,
											"source_refs":  []string{"https://xxgk.muc.edu.cn/info/1007/1113.htm"},
										},
									},
								},
							},
						},
						FullBundle: map[string]any{
							"schema_version": "campus_services_service_guide_projection.v1",
							"service_guide_records": []map[string]any{
								{
									"service_id":        "service:official-web:vpn",
									"display_name":      "中央民族大学 VPN 使用说明",
									"aliases":           []string{"VPN 使用说明"},
									"category":          "campus_service",
									"campus_scope":      "all",
									"audience":          []string{"unknown"},
									"effective_from":    "2026-05-03T00:00:00+08:00",
									"effective_until":   "9999-12-31T23:59:59+08:00",
									"source_refs":       []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
									"materials":         []any{},
									"office_hours":      []any{},
									"contact_refs":      []any{},
									"eligibility_notes": []any{},
									"extraction_status": "ready",
									"field_status": map[string]string{
										"service_name":            "present",
										"process_steps":           "present",
										"service_entry":           "present",
										"source_url":              "present",
										"source_version_evidence": "present",
										"service_process":         "present",
									},
									"guide_sections": []map[string]any{
										{
											"section_id":   "vpn:procedure",
											"section_type": "procedure",
											"title":        "VPN 说明",
											"content":      "1. 访问 https://vpn.muc.edu.cn 登录 VPN。",
											"order":        1,
											"source_refs":  []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
										{
											"section_id":   "vpn:entry",
											"section_type": "entry",
											"title":        "办理入口",
											"content":      "https://vpn.muc.edu.cn",
											"order":        2,
											"source_refs":  []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
									},
									"entry_refs": []map[string]any{
										{
											"entry_id":     "vpn:entry:1",
											"label":        "https://vpn.muc.edu.cn",
											"entry_type":   "online_url",
											"url":          "https://vpn.muc.edu.cn",
											"location_ref": "",
											"source_refs":  []string{"https://met.muc.edu.cn/info/1046/1674.htm"},
										},
									},
								},
							},
						},
					},
				},
			},
		),
		BundleScope: "full_impact",
		Cases: []runtimeCase{
			{
				CaseID:                      "service-vpn-entry-full-impact",
				Collection:                  "service_guide",
				InventoryID:                 "muc-it-vpn-service-guide",
				Mode:                        "planner_runtime",
				UserGoal:                    "VPN入口在哪里",
				ExpectedTarget:              "campus-services-agent",
				ExpectedPayloadKind:         "service_guide_lookup",
				ExpectedSelectedTool:        "service_guide_lookup",
				ExpectedOutcome:             "resolved_current",
				ExpectedResolvedDisplayName: "中央民族大学 VPN 使用说明",
				RequiredBodyTokens:          []string{"vpn.muc.edu.cn"},
			},
		},
	}

	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	var stdout bytes.Buffer
	if err := run(bytes.NewReader(raw), &stdout); err != nil {
		t.Fatalf("run: %v", err)
	}
	var output outputPayload
	if err := json.Unmarshal(stdout.Bytes(), &output); err != nil {
		t.Fatalf("parse output: %v", err)
	}
	if len(output.Results) != 1 {
		t.Fatalf("results len = %d, want 1", len(output.Results))
	}
	if !output.Results[0].Passed {
		t.Fatalf("case failed: %#v", output.Results[0].Failures)
	}
}

func writePreviewReportFixture(t *testing.T, report previewReport) string {
	t.Helper()
	path := t.TempDir() + "/preview-report.json"
	raw, err := json.Marshal(report)
	if err != nil {
		t.Fatalf("marshal preview report: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write preview report: %v", err)
	}
	return path
}

func containsFailure(failures []string, needle string) bool {
	for _, item := range failures {
		if strings.TrimSpace(item) == strings.TrimSpace(needle) {
			return true
		}
	}
	return false
}
