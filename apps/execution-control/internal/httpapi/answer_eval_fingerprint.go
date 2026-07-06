package httpapi

import "strings"

type answerEvalFingerprintInput struct {
	BranchKind                string
	EvidenceReplayIndexSHA256 string
	LLMIOFingerprint          map[string]any
	RunID                     string
	SelectedTool              string
	SelectedTools             []string
	StageTiming               map[string]any
	TerminalOutcome           string
	WorkflowMode              string
}

func answerEvalFingerprint(input answerEvalFingerprintInput) map[string]any {
	llmIOFingerprint := cloneAnyMapFromMetadata(input.LLMIOFingerprint)
	toolRuntime := cloneAnyMapFromMetadata(llmIOFingerprint["tool_runtime_fingerprint"])
	selectedTools := uniqueNonEmptyStrings(input.SelectedTools)
	selectedTool := strings.TrimSpace(input.SelectedTool)
	var selectedToolValue any
	if selectedTool == "" {
		selectedToolValue = nil
	} else {
		selectedToolValue = selectedTool
	}
	body := map[string]any{
		"schema_version":               "answer_eval_fingerprint.v1",
		"run_id":                       defaultString(strings.TrimSpace(input.RunID), stringValue(llmIOFingerprint["run_id"])),
		"request_id":                   stringValue(llmIOFingerprint["request_id"]),
		"trace_id":                     stringValue(llmIOFingerprint["trace_id"]),
		"runtime_release":              stringValue(llmIOFingerprint["runtime_release"]),
		"llm_call_site":                stringValue(llmIOFingerprint["llm_call_site"]),
		"llm_io_fingerprint_sha256":    sha256JSONRef(llmIOFingerprint),
		"provider_profile_revision":    stringValue(llmIOFingerprint["provider_profile_revision"]),
		"output_schema_id":             stringValue(llmIOFingerprint["output_schema_id"]),
		"branch_identity":              answerBranchIdentity(llmIOFingerprint, input.BranchKind, input.WorkflowMode),
		"terminal_outcome":             strings.TrimSpace(input.TerminalOutcome),
		"selected_tool":                selectedToolValue,
		"selected_tools":               selectedTools,
		"stage_timing_profile_sha256":  sha256JSONRef(cloneAnyMapFromMetadata(input.StageTiming)),
		"tool_runtime_combined_sha256": stringValue(toolRuntime["combined_sha256"]),
		"evidence_replay_index_sha256": nil,
	}
	if evidenceReplayIndexSHA256 := strings.TrimSpace(input.EvidenceReplayIndexSHA256); evidenceReplayIndexSHA256 != "" {
		body["evidence_replay_index_sha256"] = evidenceReplayIndexSHA256
	}
	fingerprintBody := cloneAnyMapFromMetadata(body)
	delete(fingerprintBody, "answer_fingerprint_sha256")
	body["answer_fingerprint_sha256"] = sha256JSONRef(fingerprintBody)
	return body
}

func answerBranchIdentity(llmIOFingerprint map[string]any, branchKind string, workflowMode string) map[string]any {
	promptID := stringValue(llmIOFingerprint["prompt_id"])
	return map[string]any{
		"schema_version": "answer_branch_identity.v1",
		"prompt_id":      strings.TrimSpace(promptID),
		"branch_kind":    strings.TrimSpace(branchKind),
		"workflow_mode":  strings.TrimSpace(workflowMode),
	}
}

func primaryAgentAnswerBranchKind(terminalKind string, selectedTools []string) string {
	if len(selectedTools) > 0 {
		return "tool_routed"
	}
	switch strings.TrimSpace(terminalKind) {
	case "clarification_required":
		return "clarification"
	case "out_of_scope", "policy_refusal":
		return "policy_refusal"
	default:
		return "direct_no_tool"
	}
}

func primaryAgentAnswerTerminalOutcome(status string, terminalKind string) string {
	switch strings.TrimSpace(status) {
	case "needs_clarification":
		return "needs_clarification"
	case "rejected":
		return "policy_refusal"
	case "no_answer":
		return "unsupported_by_evidence"
	case "error":
		return "runtime_error"
	default:
		if strings.TrimSpace(terminalKind) == "unsupported_by_evidence" {
			return "unsupported_by_evidence"
		}
		return "grounded_answer"
	}
}

func ragSynthesisAnswerTerminalOutcome(semanticOutcome string) string {
	switch strings.TrimSpace(semanticOutcome) {
	case "", "answer_from_selected_evidence", "grounded_answer":
		return "grounded_answer"
	case "unsupported_by_evidence", "no_answer":
		return "unsupported_by_evidence"
	case "policy_refusal", "out_of_scope":
		return "policy_refusal"
	case "runtime_error":
		return "runtime_error"
	default:
		return strings.TrimSpace(semanticOutcome)
	}
}

func uniqueNonEmptyStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result
}
