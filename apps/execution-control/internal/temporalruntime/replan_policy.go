package temporalruntime

import "strings"

func primaryAgentAllowsBoundedReplan(agent ExecutePrimaryAgentActivityOutput) bool {
	if strings.TrimSpace(agent.Status) != "failed" {
		return false
	}
	if len(agent.ToolResults) == 0 {
		return false
	}
	for _, result := range agent.ToolResults {
		if !typedOutcomeAllowsBoundedReplan(result.FailCloseReason) {
			return false
		}
	}
	return true
}

func typedOutcomeAllowsBoundedReplan(reason string) bool {
	switch strings.TrimSpace(reason) {
	case "provider_timeout",
		"tool_handler_failed",
		"provider_connection_aborted",
		"tool_executor_not_configured",
		"transient_internal_query_failed":
		return true
	default:
		return false
	}
}

func primaryAgentReplanReason(agent ExecutePrimaryAgentActivityOutput) string {
	for _, result := range agent.ToolResults {
		reason := strings.TrimSpace(result.FailCloseReason)
		if reason != "" {
			return "bounded_replan_after_" + reason
		}
	}
	return "bounded_replan_after_primary_agent_failed"
}

func workflowFailureAllowsReplan(step ToolBranchStep, err error) bool {
	if err == nil {
		return false
	}
	if step.ToolTarget == "knowledge_query" {
		return true
	}
	failure := sanitizeWorkflowFailure(err)
	return typedOutcomeAllowsBoundedReplan(failCloseReasonFromWorkflowFailure(failure))
}

func failCloseReasonFromWorkflowFailure(failure string) string {
	const marker = "fail_close_reason="
	index := strings.Index(failure, marker)
	if index < 0 {
		return ""
	}
	remainder := failure[index+len(marker):]
	if fieldEnd := strings.IndexAny(remainder, " \t\n\r,;"); fieldEnd >= 0 {
		remainder = remainder[:fieldEnd]
	}
	return strings.TrimSpace(remainder)
}

func reasonForReplanFailure(step ToolBranchStep, err error) string {
	if step.ToolTarget == "knowledge_query" {
		return "knowledge_branch_failed"
	}
	if step.ToolName != "" {
		return "typed_tool_failed"
	}
	return "tool_branch_failed"
}
