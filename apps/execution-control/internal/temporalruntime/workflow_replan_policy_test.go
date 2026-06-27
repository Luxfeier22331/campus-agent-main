package temporalruntime

import (
	"errors"
	"testing"
)

func TestPrimaryAgentBoundedReplanUsesTypedOutcomeMatrix(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		reason string
		want   bool
	}{
		{name: "provider timeout", reason: "provider_timeout", want: true},
		{name: "tool handler failed", reason: "tool_handler_failed", want: true},
		{name: "provider connection aborted", reason: "provider_connection_aborted", want: true},
		{name: "tool executor not configured", reason: "tool_executor_not_configured", want: true},
		{name: "transient internal query failed", reason: "transient_internal_query_failed", want: true},
		{name: "clarification required", reason: "clarification_required", want: false},
		{name: "out of scope", reason: "out_of_scope", want: false},
		{name: "not found", reason: "not_found", want: false},
		{name: "current state unverifiable", reason: "current_state_unverifiable", want: false},
		{name: "source conflict", reason: "source_conflict", want: false},
		{name: "temporal scope ambiguous", reason: "temporal_scope_ambiguous", want: false},
		{name: "schema contract drift", reason: "schema_contract_drift", want: false},
		{name: "tool not visible", reason: "tool_not_visible", want: false},
		{name: "tool not admitted", reason: "tool_not_admitted", want: false},
		{name: "unclassified failure", reason: "", want: false},
		{name: "unknown reason", reason: "unexpected_runtime_failure", want: false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got := primaryAgentAllowsBoundedReplan(ExecutePrimaryAgentActivityOutput{
				RunID:  "run-primary-replan-matrix",
				Status: "failed",
				ToolResults: []AgentToolResult{{
					FailCloseReason: testCase.reason,
					Status:          "failed",
					ToolName:        "transport_schedule_lookup",
				}},
			})
			if got != testCase.want {
				t.Fatalf("primaryAgentAllowsBoundedReplan(%q) = %v, want %v", testCase.reason, got, testCase.want)
			}
		})
	}
}

func TestPrimaryAgentBoundedReplanRejectsMixedUnclassifiedToolResults(t *testing.T) {
	got := primaryAgentAllowsBoundedReplan(ExecutePrimaryAgentActivityOutput{
		RunID:  "run-primary-replan-mixed",
		Status: "failed",
		ToolResults: []AgentToolResult{
			{
				FailCloseReason: "provider_timeout",
				Status:          "failed",
				ToolName:        "transport_schedule_lookup",
			},
			{
				Status:   "failed",
				ToolName: "transport_schedule_lookup",
			},
		},
	})
	if got {
		t.Fatal("mixed retryable and unclassified tool results must fail closed")
	}
}

func TestWorkflowFailureAllowsReplanUsesTypedOutcomeMatrix(t *testing.T) {
	step := ToolBranchStep{
		ToolTarget: "transport_schedule_lookup",
		ToolName:   "transport_schedule_lookup",
	}
	for _, testCase := range []struct {
		name    string
		message string
		want    bool
	}{
		{name: "provider timeout", message: "typed tool failed fail_close_reason=provider_timeout", want: true},
		{name: "tool handler failed", message: "typed tool failed fail_close_reason=tool_handler_failed", want: true},
		{name: "provider connection aborted", message: "typed tool failed fail_close_reason=provider_connection_aborted", want: true},
		{name: "tool executor not configured", message: "typed tool failed fail_close_reason=tool_executor_not_configured", want: true},
		{name: "transient internal query failed", message: "typed tool failed fail_close_reason=transient_internal_query_failed", want: true},
		{name: "current state unverifiable", message: "typed tool failed fail_close_reason=current_state_unverifiable", want: false},
		{name: "schema contract drift", message: "typed tool failed fail_close_reason=schema_contract_drift", want: false},
		{name: "tool not visible", message: "typed tool failed fail_close_reason=tool_not_visible", want: false},
		{name: "tool not admitted", message: "typed tool failed fail_close_reason=tool_not_admitted", want: false},
		{name: "unclassified failure", message: "typed tool transport_schedule_lookup failed", want: false},
		{name: "unknown reason", message: "typed tool failed fail_close_reason=unexpected_runtime_failure", want: false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got := workflowFailureAllowsReplan(step, errors.New(testCase.message))
			if got != testCase.want {
				t.Fatalf("workflowFailureAllowsReplan(%q) = %v, want %v", testCase.message, got, testCase.want)
			}
		})
	}
}
