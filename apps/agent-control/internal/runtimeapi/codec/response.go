package codec

import (
	wire "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/agentruntimeprotocol"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
)

func mapRuntimeResult(r wire.AgentRuntimeResponse) executionapplication.AgentRuntimeResult {
	out := executionapplication.AgentRuntimeResult{
		Operation:               r.Operation,
		SolveOutcome:            r.SolveOutcome,
		Status:                  r.Status,
		Error:                   executionapplication.AgentRuntimeError(r.Error),
		RequestID:               r.RequestID,
		ContextUsage:            r.ContextUsage,
		FinalOutput:             r.FinalOutput,
		Plan:                    r.Plan,
		Replan:                  r.Replan,
		RemainingFacts:          r.RemainingFacts,
		Evidence:                r.Evidence,
		SourceAttempts:          r.SourceAttempts,
		ModelName:               r.ModelName,
		ModelProvider:           r.ModelProvider,
		ProviderResponseID:      r.ProviderResponseID,
		StageTiming:             r.StageTiming,
		TerminalReason:          r.TerminalReason,
		ToolContractFingerprint: r.ToolContractFingerprint,
		RuntimeRelease:          r.RuntimeRelease,
		Usage:                   executionapplication.AgentRuntimeUsage(r.Usage),
		ModelOutputDiagnostic:   r.ModelOutputDiagnostic,
		WebEvidence:             r.WebEvidence,
		WebSearchDiagnostic:     r.WebSearchDiagnostic,
		Failure:                 r.Failure,
		AnswerStarted:           r.AnswerStarted,
	}
	if r.ToolResults != nil {
		out.ToolResults = make([]executionapplication.AgentToolResult, len(r.ToolResults))
		for i, t := range r.ToolResults {
			out.ToolResults[i] = executionapplication.AgentToolResult(t)
		}
	}
	return out
}
