package contract

import (
	app "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	wire "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalruntime"
)

func AppAgentAdmissionSnapshot(v wire.AgentAdmissionSnapshot) app.AgentAdmissionSnapshot {
	return app.AgentAdmissionSnapshot{AgentBudget: AppAgentRuntimeBudgetSnapshot(v.AgentBudget), AgentCapabilities: AppAgentCapabilitiesSnapshot(v.AgentCapabilities), AgentLimits: AppAgentRuntimeLimitsSnapshot(v.AgentLimits), ModelTargetSHA256: v.ModelTargetSHA256, ToolContractFingerprint: AppToolContractFingerprintSnapshot(v.ToolContractFingerprint)}
}
func WireAgentAdmissionSnapshot(v app.AgentAdmissionSnapshot) wire.AgentAdmissionSnapshot {
	return wire.AgentAdmissionSnapshot{AgentBudget: WireAgentRuntimeBudgetSnapshot(v.AgentBudget), AgentCapabilities: WireAgentCapabilitiesSnapshot(v.AgentCapabilities), AgentLimits: WireAgentRuntimeLimitsSnapshot(v.AgentLimits), ModelTargetSHA256: v.ModelTargetSHA256, ToolContractFingerprint: WireToolContractFingerprintSnapshot(v.ToolContractFingerprint)}
}
func AppAgentCapabilitiesSnapshot(v wire.AgentCapabilitiesSnapshot) app.AgentCapabilitiesSnapshot {
	return app.AgentCapabilitiesSnapshot{HostedWebSearch: v.HostedWebSearch, SchemaVersion: v.SchemaVersion, VisibleFunctionToolNames: v.VisibleFunctionToolNames}
}
func WireAgentCapabilitiesSnapshot(v app.AgentCapabilitiesSnapshot) wire.AgentCapabilitiesSnapshot {
	return wire.AgentCapabilitiesSnapshot{HostedWebSearch: v.HostedWebSearch, SchemaVersion: v.SchemaVersion, VisibleFunctionToolNames: v.VisibleFunctionToolNames}
}
func AppAgentRuntimeBudgetSnapshot(v wire.AgentRuntimeBudgetSnapshot) app.AgentRuntimeBudgetSnapshot {
	return app.AgentRuntimeBudgetSnapshot{MaxFunctionToolCalls: v.MaxFunctionToolCalls, MaxModelTurns: v.MaxModelTurns, MaxPlanSteps: v.MaxPlanSteps, MaxReplans: v.MaxReplans, SchemaVersion: v.SchemaVersion}
}
func WireAgentRuntimeBudgetSnapshot(v app.AgentRuntimeBudgetSnapshot) wire.AgentRuntimeBudgetSnapshot {
	return wire.AgentRuntimeBudgetSnapshot{MaxFunctionToolCalls: v.MaxFunctionToolCalls, MaxModelTurns: v.MaxModelTurns, MaxPlanSteps: v.MaxPlanSteps, MaxReplans: v.MaxReplans, SchemaVersion: v.SchemaVersion}
}
func AppAgentRuntimeLimitsSnapshot(v wire.AgentRuntimeLimitsSnapshot) app.AgentRuntimeLimitsSnapshot {
	return app.AgentRuntimeLimitsSnapshot{AgentDeadlineMS: v.AgentDeadlineMS, ContextCharLimit: v.ContextCharLimit, CurrentInputCharLimit: v.CurrentInputCharLimit, MaxOutputTokens: v.MaxOutputTokens}
}
func WireAgentRuntimeLimitsSnapshot(v app.AgentRuntimeLimitsSnapshot) wire.AgentRuntimeLimitsSnapshot {
	return wire.AgentRuntimeLimitsSnapshot{AgentDeadlineMS: v.AgentDeadlineMS, ContextCharLimit: v.ContextCharLimit, CurrentInputCharLimit: v.CurrentInputCharLimit, MaxOutputTokens: v.MaxOutputTokens}
}
func AppAgentToolResult(v wire.AgentToolResult) app.AgentToolResult {
	return app.AgentToolResult{CompletedAt: v.CompletedAt, DurationMS: v.DurationMS, Failure: func() *app.ExecutionFailure {
		if v.Failure == nil {
			return nil
		}
		out := AppExecutionFailure(*v.Failure)
		return &out
	}(), InvocationID: v.InvocationID, Result: v.Result, StartedAt: v.StartedAt, Status: v.Status, ToolName: v.ToolName}
}
func WireAgentToolResult(v app.AgentToolResult) wire.AgentToolResult {
	return wire.AgentToolResult{CompletedAt: v.CompletedAt, DurationMS: v.DurationMS, Failure: func() *wire.ExecutionFailure {
		if v.Failure == nil {
			return nil
		}
		out := WireExecutionFailure(*v.Failure)
		return &out
	}(), InvocationID: v.InvocationID, Result: v.Result, StartedAt: v.StartedAt, Status: v.Status, ToolName: v.ToolName}
}
func AppAgentUsageSummary(v wire.AgentUsageSummary) app.AgentUsageSummary {
	return app.AgentUsageSummary{CachedInputTokens: v.CachedInputTokens, InputTokens: v.InputTokens, ModelRequestCount: v.ModelRequestCount, OutputTokens: v.OutputTokens, UsageObserved: v.UsageObserved}
}
func WireAgentUsageSummary(v app.AgentUsageSummary) wire.AgentUsageSummary {
	return wire.AgentUsageSummary{CachedInputTokens: v.CachedInputTokens, InputTokens: v.InputTokens, ModelRequestCount: v.ModelRequestCount, OutputTokens: v.OutputTokens, UsageObserved: v.UsageObserved}
}
func AppExecuteTaskStepActivityInput(v wire.ExecuteTaskStepActivityInput) app.ExecuteStepInput {
	return app.ExecuteStepInput{CitationStart: v.CitationStart, CompletedSteps: func() []app.WorkflowCompletedStep {
		if v.CompletedSteps == nil {
			return nil
		}
		out := make([]app.WorkflowCompletedStep, len(v.CompletedSteps))
		for i, v := range v.CompletedSteps {
			out[i] = AppWorkflowCompletedStep(v)
		}
		return out
	}(), Plan: AppWorkflowTaskPlan(v.Plan), PriorEvidence: func() []app.WorkflowEvidence {
		if v.PriorEvidence == nil {
			return nil
		}
		out := make([]app.WorkflowEvidence, len(v.PriorEvidence))
		for i, v := range v.PriorEvidence {
			out[i] = AppWorkflowEvidence(v)
		}
		return out
	}(), PriorSourceAttempts: func() []app.WorkflowSourceAttempt {
		if v.PriorSourceAttempts == nil {
			return nil
		}
		out := make([]app.WorkflowSourceAttempt, len(v.PriorSourceAttempts))
		for i, v := range v.PriorSourceAttempts {
			out[i] = AppWorkflowSourceAttempt(v)
		}
		return out
	}(), Step: AppWorkflowTaskPlanStep(v.Step), OperationInputBase: AppOperationInputBase(v.WorkflowOperationActivityInputBase)}
}
func WireExecuteTaskStepActivityInput(v app.ExecuteStepInput) wire.ExecuteTaskStepActivityInput {
	return wire.ExecuteTaskStepActivityInput{CitationStart: v.CitationStart, CompletedSteps: func() []wire.WorkflowCompletedStep {
		if v.CompletedSteps == nil {
			return nil
		}
		out := make([]wire.WorkflowCompletedStep, len(v.CompletedSteps))
		for i, v := range v.CompletedSteps {
			out[i] = WireWorkflowCompletedStep(v)
		}
		return out
	}(), Plan: WireWorkflowTaskPlan(v.Plan), PriorEvidence: func() []wire.WorkflowEvidence {
		if v.PriorEvidence == nil {
			return nil
		}
		out := make([]wire.WorkflowEvidence, len(v.PriorEvidence))
		for i, v := range v.PriorEvidence {
			out[i] = WireWorkflowEvidence(v)
		}
		return out
	}(), PriorSourceAttempts: func() []wire.WorkflowSourceAttempt {
		if v.PriorSourceAttempts == nil {
			return nil
		}
		out := make([]wire.WorkflowSourceAttempt, len(v.PriorSourceAttempts))
		for i, v := range v.PriorSourceAttempts {
			out[i] = WireWorkflowSourceAttempt(v)
		}
		return out
	}(), Step: WireWorkflowTaskPlanStep(v.Step), WorkflowOperationActivityInputBase: WireOperationInputBase(v.OperationInputBase)}
}
func AppExecutionFailure(v wire.ExecutionFailure) app.ExecutionFailure {
	return app.ExecutionFailure{Citation: v.Citation, Code: v.Code, Detail: v.Detail, HTTPStatus: v.HTTPStatus, InvocationID: v.InvocationID, Operation: v.Operation, Reason: v.Reason, Stage: v.Stage}
}
func WireExecutionFailure(v app.ExecutionFailure) wire.ExecutionFailure {
	return wire.ExecutionFailure{Citation: v.Citation, Code: v.Code, Detail: v.Detail, HTTPStatus: v.HTTPStatus, InvocationID: v.InvocationID, Operation: v.Operation, Reason: v.Reason, Stage: v.Stage}
}
func AppFinalizeExecutionCancellationActivityInput(v wire.FinalizeExecutionCancellationActivityInput) app.CancellationInput {
	return app.CancellationInput{CanceledAt: v.CanceledAt, Reason: v.Reason, RequestID: v.RequestID}
}
func WireFinalizeExecutionCancellationActivityInput(v app.CancellationInput) wire.FinalizeExecutionCancellationActivityInput {
	return wire.FinalizeExecutionCancellationActivityInput{CanceledAt: v.CanceledAt, Reason: v.Reason, RequestID: v.RequestID}
}
func AppFinalizeExecutionCancellationActivityOutput(v wire.FinalizeExecutionCancellationActivityOutput) app.CancellationOutput {
	return app.CancellationOutput{RequestID: v.RequestID, Status: v.Status}
}
func WireFinalizeExecutionCancellationActivityOutput(v app.CancellationOutput) wire.FinalizeExecutionCancellationActivityOutput {
	return wire.FinalizeExecutionCancellationActivityOutput{RequestID: v.RequestID, Status: v.Status}
}
func AppFinalizeExecutionFailureActivityInput(v wire.FinalizeExecutionFailureActivityInput) app.FailureInput {
	return app.FailureInput{FailedAt: v.FailedAt, FailureKind: v.FailureKind, RequestID: v.RequestID, Stage: v.Stage}
}
func WireFinalizeExecutionFailureActivityInput(v app.FailureInput) wire.FinalizeExecutionFailureActivityInput {
	return wire.FinalizeExecutionFailureActivityInput{FailedAt: v.FailedAt, FailureKind: v.FailureKind, RequestID: v.RequestID, Stage: v.Stage}
}
func AppFinalizeExecutionFailureActivityOutput(v wire.FinalizeExecutionFailureActivityOutput) app.FailureOutput {
	return app.FailureOutput{CompletedAt: v.CompletedAt, RequestID: v.RequestID, Status: v.Status}
}
func WireFinalizeExecutionFailureActivityOutput(v app.FailureOutput) wire.FinalizeExecutionFailureActivityOutput {
	return wire.FinalizeExecutionFailureActivityOutput{CompletedAt: v.CompletedAt, RequestID: v.RequestID, Status: v.Status}
}
func AppReplanTaskActivityInput(v wire.ReplanTaskActivityInput) app.ReplanInput {
	return app.ReplanInput{CompletedSteps: func() []app.WorkflowCompletedStep {
		if v.CompletedSteps == nil {
			return nil
		}
		out := make([]app.WorkflowCompletedStep, len(v.CompletedSteps))
		for i, v := range v.CompletedSteps {
			out[i] = AppWorkflowCompletedStep(v)
		}
		return out
	}(), MaxRemainingSteps: v.MaxRemainingSteps, Plan: AppWorkflowTaskPlan(v.Plan), PriorEvidence: func() []app.WorkflowEvidence {
		if v.PriorEvidence == nil {
			return nil
		}
		out := make([]app.WorkflowEvidence, len(v.PriorEvidence))
		for i, v := range v.PriorEvidence {
			out[i] = AppWorkflowEvidence(v)
		}
		return out
	}(), PriorSourceAttempts: func() []app.WorkflowSourceAttempt {
		if v.PriorSourceAttempts == nil {
			return nil
		}
		out := make([]app.WorkflowSourceAttempt, len(v.PriorSourceAttempts))
		for i, v := range v.PriorSourceAttempts {
			out[i] = AppWorkflowSourceAttempt(v)
		}
		return out
	}(), RemainingSteps: func() []app.WorkflowTaskPlanStep {
		if v.RemainingSteps == nil {
			return nil
		}
		out := make([]app.WorkflowTaskPlanStep, len(v.RemainingSteps))
		for i, v := range v.RemainingSteps {
			out[i] = AppWorkflowTaskPlanStep(v)
		}
		return out
	}(), ReplanIndex: v.ReplanIndex, OperationInputBase: AppOperationInputBase(v.WorkflowOperationActivityInputBase)}
}
func WireReplanTaskActivityInput(v app.ReplanInput) wire.ReplanTaskActivityInput {
	return wire.ReplanTaskActivityInput{CompletedSteps: func() []wire.WorkflowCompletedStep {
		if v.CompletedSteps == nil {
			return nil
		}
		out := make([]wire.WorkflowCompletedStep, len(v.CompletedSteps))
		for i, v := range v.CompletedSteps {
			out[i] = WireWorkflowCompletedStep(v)
		}
		return out
	}(), MaxRemainingSteps: v.MaxRemainingSteps, Plan: WireWorkflowTaskPlan(v.Plan), PriorEvidence: func() []wire.WorkflowEvidence {
		if v.PriorEvidence == nil {
			return nil
		}
		out := make([]wire.WorkflowEvidence, len(v.PriorEvidence))
		for i, v := range v.PriorEvidence {
			out[i] = WireWorkflowEvidence(v)
		}
		return out
	}(), PriorSourceAttempts: func() []wire.WorkflowSourceAttempt {
		if v.PriorSourceAttempts == nil {
			return nil
		}
		out := make([]wire.WorkflowSourceAttempt, len(v.PriorSourceAttempts))
		for i, v := range v.PriorSourceAttempts {
			out[i] = WireWorkflowSourceAttempt(v)
		}
		return out
	}(), RemainingSteps: func() []wire.WorkflowTaskPlanStep {
		if v.RemainingSteps == nil {
			return nil
		}
		out := make([]wire.WorkflowTaskPlanStep, len(v.RemainingSteps))
		for i, v := range v.RemainingSteps {
			out[i] = WireWorkflowTaskPlanStep(v)
		}
		return out
	}(), ReplanIndex: v.ReplanIndex, WorkflowOperationActivityInputBase: WireOperationInputBase(v.OperationInputBase)}
}
func AppSolveTaskActivityInput(v wire.SolveTaskActivityInput) app.SolveInput {
	return app.SolveInput{MaxSteps: v.MaxSteps, OperationInputBase: AppOperationInputBase(v.WorkflowOperationActivityInputBase)}
}
func WireSolveTaskActivityInput(v app.SolveInput) wire.SolveTaskActivityInput {
	return wire.SolveTaskActivityInput{MaxSteps: v.MaxSteps, WorkflowOperationActivityInputBase: WireOperationInputBase(v.OperationInputBase)}
}
func AppSourceLink(v wire.SourceLink) app.SourceLink {
	return app.SourceLink{Href: v.Href}
}
func WireSourceLink(v app.SourceLink) wire.SourceLink {
	return wire.SourceLink{Href: v.Href}
}
func AppSynthesizeAnswerActivityInput(v wire.SynthesizeAnswerActivityInput) app.SynthesizeInput {
	return app.SynthesizeInput{BufferAnswer: v.BufferAnswer, Evidence: func() []app.WorkflowEvidence {
		if v.Evidence == nil {
			return nil
		}
		out := make([]app.WorkflowEvidence, len(v.Evidence))
		for i, v := range v.Evidence {
			out[i] = AppWorkflowEvidence(v)
		}
		return out
	}(), Mode: v.Mode, RecoveryReason: v.RecoveryReason, RemainingFacts: func() []app.WorkflowRemainingFacts {
		if v.RemainingFacts == nil {
			return nil
		}
		out := make([]app.WorkflowRemainingFacts, len(v.RemainingFacts))
		for i, v := range v.RemainingFacts {
			out[i] = AppWorkflowRemainingFacts(v)
		}
		return out
	}(), SourceAttempts: func() []app.WorkflowSourceAttempt {
		if v.SourceAttempts == nil {
			return nil
		}
		out := make([]app.WorkflowSourceAttempt, len(v.SourceAttempts))
		for i, v := range v.SourceAttempts {
			out[i] = AppWorkflowSourceAttempt(v)
		}
		return out
	}(), OperationInputBase: AppOperationInputBase(v.WorkflowOperationActivityInputBase)}
}
func WireSynthesizeAnswerActivityInput(v app.SynthesizeInput) wire.SynthesizeAnswerActivityInput {
	return wire.SynthesizeAnswerActivityInput{BufferAnswer: v.BufferAnswer, Evidence: func() []wire.WorkflowEvidence {
		if v.Evidence == nil {
			return nil
		}
		out := make([]wire.WorkflowEvidence, len(v.Evidence))
		for i, v := range v.Evidence {
			out[i] = WireWorkflowEvidence(v)
		}
		return out
	}(), Mode: v.Mode, RecoveryReason: v.RecoveryReason, RemainingFacts: func() []wire.WorkflowRemainingFacts {
		if v.RemainingFacts == nil {
			return nil
		}
		out := make([]wire.WorkflowRemainingFacts, len(v.RemainingFacts))
		for i, v := range v.RemainingFacts {
			out[i] = WireWorkflowRemainingFacts(v)
		}
		return out
	}(), SourceAttempts: func() []wire.WorkflowSourceAttempt {
		if v.SourceAttempts == nil {
			return nil
		}
		out := make([]wire.WorkflowSourceAttempt, len(v.SourceAttempts))
		for i, v := range v.SourceAttempts {
			out[i] = WireWorkflowSourceAttempt(v)
		}
		return out
	}(), WorkflowOperationActivityInputBase: WireOperationInputBase(v.OperationInputBase)}
}
func AppToolContractFingerprintSnapshot(v wire.ToolContractFingerprintSnapshot) app.ToolContractFingerprintSnapshot {
	return app.ToolContractFingerprintSnapshot{FunctionSchemaSHA256: v.FunctionSchemaSHA256, SchemaVersion: v.SchemaVersion, ToolsSHA256: v.ToolsSHA256}
}
func WireToolContractFingerprintSnapshot(v app.ToolContractFingerprintSnapshot) wire.ToolContractFingerprintSnapshot {
	return wire.ToolContractFingerprintSnapshot{FunctionSchemaSHA256: v.FunctionSchemaSHA256, SchemaVersion: v.SchemaVersion, ToolsSHA256: v.ToolsSHA256}
}
func AppWebEvidence(v wire.WebEvidence) app.WebEvidence {
	return app.WebEvidence{EndIndex: v.EndIndex, Excerpt: v.Excerpt, SourceLink: func() *app.SourceLink {
		if v.SourceLink == nil {
			return nil
		}
		out := AppSourceLink(*v.SourceLink)
		return &out
	}(), StartIndex: v.StartIndex, Title: v.Title, URL: v.URL}
}
func WireWebEvidence(v app.WebEvidence) wire.WebEvidence {
	return wire.WebEvidence{EndIndex: v.EndIndex, Excerpt: v.Excerpt, SourceLink: func() *wire.SourceLink {
		if v.SourceLink == nil {
			return nil
		}
		out := WireSourceLink(*v.SourceLink)
		return &out
	}(), StartIndex: v.StartIndex, Title: v.Title, URL: v.URL}
}
func AppWebSearchDiagnostic(v wire.WebSearchDiagnostic) app.WebSearchDiagnostic {
	return app.WebSearchDiagnostic{ChunkCount: v.ChunkCount, ConvertedCount: v.ConvertedCount, DiscardReasons: v.DiscardReasons, DiscardedCount: v.DiscardedCount, QueryCount: v.QueryCount, SchemaVersion: v.SchemaVersion, State: v.State, SupportCount: v.SupportCount}
}
func WireWebSearchDiagnostic(v app.WebSearchDiagnostic) wire.WebSearchDiagnostic {
	return wire.WebSearchDiagnostic{ChunkCount: v.ChunkCount, ConvertedCount: v.ConvertedCount, DiscardReasons: v.DiscardReasons, DiscardedCount: v.DiscardedCount, QueryCount: v.QueryCount, SchemaVersion: v.SchemaVersion, State: v.State, SupportCount: v.SupportCount}
}
func AppWorkflowCompletedStep(v wire.WorkflowCompletedStep) app.WorkflowCompletedStep {
	return app.WorkflowCompletedStep{Evidence: func() []app.WorkflowEvidence {
		if v.Evidence == nil {
			return nil
		}
		out := make([]app.WorkflowEvidence, len(v.Evidence))
		for i, v := range v.Evidence {
			out[i] = AppWorkflowEvidence(v)
		}
		return out
	}(), ExecutionIndex: v.ExecutionIndex, Failure: func() *app.ExecutionFailure {
		if v.Failure == nil {
			return nil
		}
		out := AppExecutionFailure(*v.Failure)
		return &out
	}(), RemainingFacts: v.RemainingFacts, SourceAttempts: func() []app.WorkflowSourceAttempt {
		if v.SourceAttempts == nil {
			return nil
		}
		out := make([]app.WorkflowSourceAttempt, len(v.SourceAttempts))
		for i, v := range v.SourceAttempts {
			out[i] = AppWorkflowSourceAttempt(v)
		}
		return out
	}(), Step: AppWorkflowTaskPlanStep(v.Step), Summary: v.Summary}
}
func WireWorkflowCompletedStep(v app.WorkflowCompletedStep) wire.WorkflowCompletedStep {
	return wire.WorkflowCompletedStep{Evidence: func() []wire.WorkflowEvidence {
		if v.Evidence == nil {
			return nil
		}
		out := make([]wire.WorkflowEvidence, len(v.Evidence))
		for i, v := range v.Evidence {
			out[i] = WireWorkflowEvidence(v)
		}
		return out
	}(), ExecutionIndex: v.ExecutionIndex, Failure: func() *wire.ExecutionFailure {
		if v.Failure == nil {
			return nil
		}
		out := WireExecutionFailure(*v.Failure)
		return &out
	}(), RemainingFacts: v.RemainingFacts, SourceAttempts: func() []wire.WorkflowSourceAttempt {
		if v.SourceAttempts == nil {
			return nil
		}
		out := make([]wire.WorkflowSourceAttempt, len(v.SourceAttempts))
		for i, v := range v.SourceAttempts {
			out[i] = WireWorkflowSourceAttempt(v)
		}
		return out
	}(), Step: WireWorkflowTaskPlanStep(v.Step), Summary: v.Summary}
}
func AppWorkflowEvidence(v wire.WorkflowEvidence) app.WorkflowEvidence {
	return app.WorkflowEvidence{CitationHref: v.CitationHref, CitationIndex: v.CitationIndex, DocumentID: v.DocumentID, Excerpt: v.Excerpt, ID: v.ID, NoticeID: v.NoticeID, ReleasedAt: v.ReleasedAt, ResultRef: v.ResultRef, RootUnitIDs: v.RootUnitIDs, SchemaVersion: v.SchemaVersion, SectionRef: v.SectionRef, SectionTitle: v.SectionTitle, Source: AppWorkflowSource(v.Source), SourceLink: func() *app.SourceLink {
		if v.SourceLink == nil {
			return nil
		}
		out := AppSourceLink(*v.SourceLink)
		return &out
	}(), Title: v.Title, URL: v.URL, VersionID: v.VersionID, VersionSlug: v.VersionSlug}
}
func WireWorkflowEvidence(v app.WorkflowEvidence) wire.WorkflowEvidence {
	return wire.WorkflowEvidence{CitationHref: v.CitationHref, CitationIndex: v.CitationIndex, DocumentID: v.DocumentID, Excerpt: v.Excerpt, ID: v.ID, NoticeID: v.NoticeID, ReleasedAt: v.ReleasedAt, ResultRef: v.ResultRef, RootUnitIDs: v.RootUnitIDs, SchemaVersion: v.SchemaVersion, SectionRef: v.SectionRef, SectionTitle: v.SectionTitle, Source: WireWorkflowSource(v.Source), SourceLink: func() *wire.SourceLink {
		if v.SourceLink == nil {
			return nil
		}
		out := WireSourceLink(*v.SourceLink)
		return &out
	}(), Title: v.Title, URL: v.URL, VersionID: v.VersionID, VersionSlug: v.VersionSlug}
}
func AppWorkflowFinalizationActivityOutput(v wire.WorkflowFinalizationActivityOutput) app.FinalizationOutput {
	return app.FinalizationOutput{CompletedAt: v.CompletedAt, ProjectionRef: v.ProjectionRef, RequestID: v.RequestID, Status: v.Status}
}
func WireWorkflowFinalizationActivityOutput(v app.FinalizationOutput) wire.WorkflowFinalizationActivityOutput {
	return wire.WorkflowFinalizationActivityOutput{CompletedAt: v.CompletedAt, ProjectionRef: v.ProjectionRef, RequestID: v.RequestID, Status: v.Status}
}
func AppWorkflowOperation(v wire.WorkflowOperation) app.WorkflowOperation {
	return app.WorkflowOperation(v)
}
func WireWorkflowOperation(v app.WorkflowOperation) wire.WorkflowOperation {
	return wire.WorkflowOperation(v)
}
func AppOperationInputBase(v wire.WorkflowOperationActivityInputBase) app.OperationInputBase {
	return app.OperationInputBase{AdmissionSnapshot: AppAgentAdmissionSnapshot(v.AdmissionSnapshot), ConversationID: v.ConversationID, RequestID: v.RequestID, TraceParent: v.TraceParent}
}
func WireOperationInputBase(v app.OperationInputBase) wire.WorkflowOperationActivityInputBase {
	return wire.WorkflowOperationActivityInputBase{AdmissionSnapshot: WireAgentAdmissionSnapshot(v.AdmissionSnapshot), ConversationID: v.ConversationID, RequestID: v.RequestID, TraceParent: v.TraceParent}
}
func AppWorkflowOperationActivityOutput(v wire.WorkflowOperationActivityOutput) app.OperationOutput {
	return app.OperationOutput{AnswerStarted: v.AnswerStarted, Evidence: func() []app.WorkflowEvidence {
		if v.Evidence == nil {
			return nil
		}
		out := make([]app.WorkflowEvidence, len(v.Evidence))
		for i, v := range v.Evidence {
			out[i] = AppWorkflowEvidence(v)
		}
		return out
	}(), Failure: func() *app.ExecutionFailure {
		if v.Failure == nil {
			return nil
		}
		out := AppExecutionFailure(*v.Failure)
		return &out
	}(), FinalOutput: v.FinalOutput, ModelName: v.ModelName, ModelProvider: v.ModelProvider, Operation: AppWorkflowOperation(v.Operation), Plan: func() *app.WorkflowTaskPlan {
		if v.Plan == nil {
			return nil
		}
		out := AppWorkflowTaskPlan(*v.Plan)
		return &out
	}(), ProviderResponseID: v.ProviderResponseID, RemainingFacts: v.RemainingFacts, Replan: func() *app.WorkflowTaskReplan {
		if v.Replan == nil {
			return nil
		}
		out := AppWorkflowTaskReplan(*v.Replan)
		return &out
	}(), RequestID: v.RequestID, RuntimeRelease: v.RuntimeRelease, SolveOutcome: v.SolveOutcome, SourceAttempts: func() []app.WorkflowSourceAttempt {
		if v.SourceAttempts == nil {
			return nil
		}
		out := make([]app.WorkflowSourceAttempt, len(v.SourceAttempts))
		for i, v := range v.SourceAttempts {
			out[i] = AppWorkflowSourceAttempt(v)
		}
		return out
	}(), StageTiming: v.StageTiming, Status: v.Status, TerminalReason: v.TerminalReason, ToolContractFingerprint: v.ToolContractFingerprint, ToolResults: func() []app.AgentToolResult {
		if v.ToolResults == nil {
			return nil
		}
		out := make([]app.AgentToolResult, len(v.ToolResults))
		for i, v := range v.ToolResults {
			out[i] = AppAgentToolResult(v)
		}
		return out
	}(), Usage: AppAgentUsageSummary(v.Usage), WebEvidence: func() []app.WebEvidence {
		if v.WebEvidence == nil {
			return nil
		}
		out := make([]app.WebEvidence, len(v.WebEvidence))
		for i, v := range v.WebEvidence {
			out[i] = AppWebEvidence(v)
		}
		return out
	}(), WebSearchDiagnostic: func() *app.WebSearchDiagnostic {
		if v.WebSearchDiagnostic == nil {
			return nil
		}
		out := AppWebSearchDiagnostic(*v.WebSearchDiagnostic)
		return &out
	}(), WorkflowResultRef: v.WorkflowResultRef}
}
func WireWorkflowOperationActivityOutput(v app.OperationOutput) wire.WorkflowOperationActivityOutput {
	return wire.WorkflowOperationActivityOutput{AnswerStarted: v.AnswerStarted, Evidence: func() []wire.WorkflowEvidence {
		if v.Evidence == nil {
			return nil
		}
		out := make([]wire.WorkflowEvidence, len(v.Evidence))
		for i, v := range v.Evidence {
			out[i] = WireWorkflowEvidence(v)
		}
		return out
	}(), Failure: func() *wire.ExecutionFailure {
		if v.Failure == nil {
			return nil
		}
		out := WireExecutionFailure(*v.Failure)
		return &out
	}(), FinalOutput: v.FinalOutput, ModelName: v.ModelName, ModelProvider: v.ModelProvider, Operation: WireWorkflowOperation(v.Operation), Plan: func() *wire.WorkflowTaskPlan {
		if v.Plan == nil {
			return nil
		}
		out := WireWorkflowTaskPlan(*v.Plan)
		return &out
	}(), ProviderResponseID: v.ProviderResponseID, RemainingFacts: v.RemainingFacts, Replan: func() *wire.WorkflowTaskReplan {
		if v.Replan == nil {
			return nil
		}
		out := WireWorkflowTaskReplan(*v.Replan)
		return &out
	}(), RequestID: v.RequestID, RuntimeRelease: v.RuntimeRelease, SolveOutcome: v.SolveOutcome, SourceAttempts: func() []wire.WorkflowSourceAttempt {
		if v.SourceAttempts == nil {
			return nil
		}
		out := make([]wire.WorkflowSourceAttempt, len(v.SourceAttempts))
		for i, v := range v.SourceAttempts {
			out[i] = WireWorkflowSourceAttempt(v)
		}
		return out
	}(), StageTiming: v.StageTiming, Status: v.Status, TerminalReason: v.TerminalReason, ToolContractFingerprint: v.ToolContractFingerprint, ToolResults: func() []wire.AgentToolResult {
		if v.ToolResults == nil {
			return nil
		}
		out := make([]wire.AgentToolResult, len(v.ToolResults))
		for i, v := range v.ToolResults {
			out[i] = WireAgentToolResult(v)
		}
		return out
	}(), Usage: WireAgentUsageSummary(v.Usage), WebEvidence: func() []wire.WebEvidence {
		if v.WebEvidence == nil {
			return nil
		}
		out := make([]wire.WebEvidence, len(v.WebEvidence))
		for i, v := range v.WebEvidence {
			out[i] = WireWebEvidence(v)
		}
		return out
	}(), WebSearchDiagnostic: func() *wire.WebSearchDiagnostic {
		if v.WebSearchDiagnostic == nil {
			return nil
		}
		out := WireWebSearchDiagnostic(*v.WebSearchDiagnostic)
		return &out
	}(), WorkflowResultRef: v.WorkflowResultRef}
}
func AppWorkflowRemainingFacts(v wire.WorkflowRemainingFacts) app.WorkflowRemainingFacts {
	return app.WorkflowRemainingFacts{Facts: v.Facts, Objective: v.Objective}
}
func WireWorkflowRemainingFacts(v app.WorkflowRemainingFacts) wire.WorkflowRemainingFacts {
	return wire.WorkflowRemainingFacts{Facts: v.Facts, Objective: v.Objective}
}
func AppWorkflowSource(v wire.WorkflowSource) app.WorkflowSource {
	return app.WorkflowSource(v)
}
func WireWorkflowSource(v app.WorkflowSource) wire.WorkflowSource {
	return wire.WorkflowSource(v)
}
func AppWorkflowSourceAttempt(v wire.WorkflowSourceAttempt) app.WorkflowSourceAttempt {
	return app.WorkflowSourceAttempt{FailureCode: v.FailureCode, Source: AppWorkflowSource(v.Source), Status: v.Status}
}
func WireWorkflowSourceAttempt(v app.WorkflowSourceAttempt) wire.WorkflowSourceAttempt {
	return wire.WorkflowSourceAttempt{FailureCode: v.FailureCode, Source: WireWorkflowSource(v.Source), Status: v.Status}
}
func AppWorkflowTaskPlan(v wire.WorkflowTaskPlan) app.WorkflowTaskPlan {
	return app.WorkflowTaskPlan{Goal: v.Goal, SchemaVersion: v.SchemaVersion, Steps: func() []app.WorkflowTaskPlanStep {
		if v.Steps == nil {
			return nil
		}
		out := make([]app.WorkflowTaskPlanStep, len(v.Steps))
		for i, v := range v.Steps {
			out[i] = AppWorkflowTaskPlanStep(v)
		}
		return out
	}()}
}
func WireWorkflowTaskPlan(v app.WorkflowTaskPlan) wire.WorkflowTaskPlan {
	return wire.WorkflowTaskPlan{Goal: v.Goal, SchemaVersion: v.SchemaVersion, Steps: func() []wire.WorkflowTaskPlanStep {
		if v.Steps == nil {
			return nil
		}
		out := make([]wire.WorkflowTaskPlanStep, len(v.Steps))
		for i, v := range v.Steps {
			out[i] = WireWorkflowTaskPlanStep(v)
		}
		return out
	}()}
}
func AppWorkflowTaskPlanStep(v wire.WorkflowTaskPlanStep) app.WorkflowTaskPlanStep {
	return app.WorkflowTaskPlanStep{CandidateSources: func() []app.WorkflowSource {
		if v.CandidateSources == nil {
			return nil
		}
		out := make([]app.WorkflowSource, len(v.CandidateSources))
		for i, v := range v.CandidateSources {
			out[i] = AppWorkflowSource(v)
		}
		return out
	}(), DependsOn: v.DependsOn, ID: v.ID, Objective: v.Objective}
}
func WireWorkflowTaskPlanStep(v app.WorkflowTaskPlanStep) wire.WorkflowTaskPlanStep {
	return wire.WorkflowTaskPlanStep{CandidateSources: func() []wire.WorkflowSource {
		if v.CandidateSources == nil {
			return nil
		}
		out := make([]wire.WorkflowSource, len(v.CandidateSources))
		for i, v := range v.CandidateSources {
			out[i] = WireWorkflowSource(v)
		}
		return out
	}(), DependsOn: v.DependsOn, ID: v.ID, Objective: v.Objective}
}
func AppWorkflowTaskReplan(v wire.WorkflowTaskReplan) app.WorkflowTaskReplan {
	return app.WorkflowTaskReplan{Decision: v.Decision, Reason: v.Reason, RemainingSteps: func() []app.WorkflowTaskPlanStep {
		if v.RemainingSteps == nil {
			return nil
		}
		out := make([]app.WorkflowTaskPlanStep, len(v.RemainingSteps))
		for i, v := range v.RemainingSteps {
			out[i] = AppWorkflowTaskPlanStep(v)
		}
		return out
	}(), SchemaVersion: v.SchemaVersion}
}
func WireWorkflowTaskReplan(v app.WorkflowTaskReplan) wire.WorkflowTaskReplan {
	return wire.WorkflowTaskReplan{Decision: v.Decision, Reason: v.Reason, RemainingSteps: func() []wire.WorkflowTaskPlanStep {
		if v.RemainingSteps == nil {
			return nil
		}
		out := make([]wire.WorkflowTaskPlanStep, len(v.RemainingSteps))
		for i, v := range v.RemainingSteps {
			out[i] = WireWorkflowTaskPlanStep(v)
		}
		return out
	}(), SchemaVersion: v.SchemaVersion}
}
func AppWriteWorkflowFinalizationActivityInput(v wire.WriteWorkflowFinalizationActivityInput) app.FinalizationInput {
	return app.FinalizationInput{AdmissionSnapshot: AppAgentAdmissionSnapshot(v.AdmissionSnapshot), RequestID: v.RequestID, WorkflowResult: AppWorkflowOperationActivityOutput(v.WorkflowResult)}
}
func WireWriteWorkflowFinalizationActivityInput(v app.FinalizationInput) wire.WriteWorkflowFinalizationActivityInput {
	return wire.WriteWorkflowFinalizationActivityInput{AdmissionSnapshot: WireAgentAdmissionSnapshot(v.AdmissionSnapshot), RequestID: v.RequestID, WorkflowResult: WireWorkflowOperationActivityOutput(v.WorkflowResult)}
}
