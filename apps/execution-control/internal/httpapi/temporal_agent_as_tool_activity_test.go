package httpapi

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestValidateAgentAsToolActivityInputRequiresBoundedEnvelope(t *testing.T) {
	valid := temporalruntime.ExecuteAgentAsToolActivityInput{
		AdmittedAgentID:       "notice-semantic-specialist",
		AllowedTools:          []string{"campus_notice_discover"},
		BudgetRef:             "budget://runs/run-agent-tool-001/steps/agent/budget",
		ContextProjectionRefs: []string{"projection://runs/run-agent-tool-001/context/notice"},
		RunID:                 "run-agent-tool-001",
		StepID:                "agent_as_tool:notice",
		TimeoutRef:            "timeout://runs/run-agent-tool-001/steps/agent/timeout",
		TraceID:               "trace-agent-tool-001",
	}

	if err := validateAgentAsToolActivityInput(valid); err != nil {
		t.Fatalf("valid envelope rejected: %v", err)
	}

	for name, mutate := range map[string]func(*temporalruntime.ExecuteAgentAsToolActivityInput){
		"missing allowed tools": func(input *temporalruntime.ExecuteAgentAsToolActivityInput) {
			input.AllowedTools = nil
		},
		"missing context refs": func(input *temporalruntime.ExecuteAgentAsToolActivityInput) {
			input.ContextProjectionRefs = nil
		},
		"missing budget": func(input *temporalruntime.ExecuteAgentAsToolActivityInput) {
			input.BudgetRef = ""
		},
		"missing admitted agent": func(input *temporalruntime.ExecuteAgentAsToolActivityInput) {
			input.AdmittedAgentID = ""
		},
	} {
		t.Run(name, func(t *testing.T) {
			input := valid
			mutate(&input)
			if err := validateAgentAsToolActivityInput(input); err == nil ||
				strings.TrimSpace(err.Error()) == "" {
				t.Fatal("expected invalid envelope to fail closed")
			}
		})
	}
}
