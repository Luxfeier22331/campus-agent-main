package temporalruntime

import (
	app "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
)

func ValidateWorkflowPlan(plan WorkflowTaskPlan, maxSteps int, capabilities AgentCapabilitiesSnapshot) error {
	return app.ValidateWorkflowPlan(operationDomainWorkflowTaskPlan(plan), maxSteps, operationDomainAgentCapabilitiesSnapshot(capabilities))
}
func ValidateWorkflowCompletedSteps(completed []WorkflowCompletedStep, plan WorkflowTaskPlan) error {
	return app.ValidateWorkflowCompletedSteps(func() []app.WorkflowCompletedStep {
		if completed == nil {
			return nil
		}
		out := make([]app.WorkflowCompletedStep, len(completed))
		for i, v := range completed {
			out[i] = operationDomainWorkflowCompletedStep(v)
		}
		return out
	}(), operationDomainWorkflowTaskPlan(plan))
}
func ValidateWorkflowRemainingSteps(steps []WorkflowTaskPlanStep, maxSteps int, completed []WorkflowCompletedStep, capabilities AgentCapabilitiesSnapshot) error {
	return app.ValidateWorkflowRemainingSteps(func() []app.WorkflowTaskPlanStep {
		if steps == nil {
			return nil
		}
		out := make([]app.WorkflowTaskPlanStep, len(steps))
		for i, v := range steps {
			out[i] = operationDomainWorkflowTaskPlanStep(v)
		}
		return out
	}(), maxSteps, func() []app.WorkflowCompletedStep {
		if completed == nil {
			return nil
		}
		out := make([]app.WorkflowCompletedStep, len(completed))
		for i, v := range completed {
			out[i] = operationDomainWorkflowCompletedStep(v)
		}
		return out
	}(), operationDomainAgentCapabilitiesSnapshot(capabilities))
}
func ValidateWorkflowReplanDecision(replan WorkflowTaskReplan) error {
	return app.ValidateWorkflowReplanDecision(operationDomainWorkflowTaskReplan(replan))
}
func WorkflowPlanContainsStep(plan WorkflowTaskPlan, want WorkflowTaskPlanStep) bool {
	return app.WorkflowPlanContainsStep(operationDomainWorkflowTaskPlan(plan), operationDomainWorkflowTaskPlanStep(want))
}
func WorkflowTaskPlanStepEqual(left WorkflowTaskPlanStep, right WorkflowTaskPlanStep) bool {
	return app.WorkflowTaskPlanStepEqual(operationDomainWorkflowTaskPlanStep(left), operationDomainWorkflowTaskPlanStep(right))
}
func ValidateWorkflowStepOutcome(step WorkflowCompletedStep) error {
	return app.ValidateWorkflowStepOutcome(operationDomainWorkflowCompletedStep(step))
}
func WorkflowFailureRecoverable(code string) bool { return app.WorkflowFailureRecoverable(code) }
func WorkflowToolFailureRecoverable(failure *ExecutionFailure) bool {
	return app.WorkflowToolFailureRecoverable(func() *app.ExecutionFailure {
		if failure == nil {
			return nil
		}
		out := operationDomainExecutionFailure(*failure)
		return &out
	}())
}
func WorkflowSourceUnavailable(code string) bool { return app.WorkflowSourceUnavailable(code) }
func WorkflowCompletedSourceAttempts(completed []WorkflowCompletedStep) []WorkflowSourceAttempt {
	return func() []WorkflowSourceAttempt {
		values := app.WorkflowCompletedSourceAttempts(func() []app.WorkflowCompletedStep {
			if completed == nil {
				return nil
			}
			out := make([]app.WorkflowCompletedStep, len(completed))
			for i, v := range completed {
				out[i] = operationDomainWorkflowCompletedStep(v)
			}
			return out
		}())
		out := make([]WorkflowSourceAttempt, len(values))
		for i, v := range values {
			out[i] = operationWireWorkflowSourceAttempt(v)
		}
		return out
	}()
}

// Source unavailability is context for the answer, not a failure of generation.
// Contract/provider failures without usable materials still fail the operation.
func workflowCanSynthesize(evidence []WorkflowEvidence, completed []WorkflowCompletedStep) bool {
	if len(evidence) > 0 {
		return true
	}
	for _, step := range completed {
		for _, attempt := range step.SourceAttempts {
			switch attempt.Status {
			case "matched", "no_match", "completed":
				return true
			case "failed":
				if WorkflowSourceUnavailable(attempt.FailureCode) {
					return true
				}
			}
		}
	}
	return false
}
func workflowHasRecoveryPath(completed []WorkflowCompletedStep, remaining []WorkflowTaskPlanStep, capabilities AgentCapabilitiesSnapshot) bool {
	if nextReadyWorkflowStep(remaining, completed) >= 0 {
		return true
	}
	available := workflowVisibleSourceSet(capabilities.VisibleFunctionToolNames, capabilities.HostedWebSearch)

	for _, step := range completed {
		if step.Failure != nil {
			for _, source := range step.Step.CandidateSources {
				delete(available, source)
			}
		}
		for _, attempt := range step.SourceAttempts {
			if attempt.Status == "failed" || attempt.Status == "no_match" {
				delete(available, attempt.Source)
			}
		}
	}
	return len(available) > 0
}
func workflowVisibleSourceSet(values []string, hosted bool) map[WorkflowSource]struct{} {
	out := map[WorkflowSource]struct{}{}
	for source := range app.VisibleSources(values, hosted) {
		out[WorkflowSource(source)] = struct{}{}
	}
	return out
}
func operationDomainAgentCapabilitiesSnapshot(v AgentCapabilitiesSnapshot) app.AgentCapabilitiesSnapshot {
	return app.AgentCapabilitiesSnapshot{HostedWebSearch: v.HostedWebSearch, SchemaVersion: v.SchemaVersion, VisibleFunctionToolNames: v.VisibleFunctionToolNames}
}
func operationDomainExecutionFailure(v ExecutionFailure) app.ExecutionFailure {
	return app.ExecutionFailure{Citation: v.Citation, Code: v.Code, Detail: v.Detail, HTTPStatus: v.HTTPStatus, InvocationID: v.InvocationID, Operation: v.Operation, Reason: v.Reason, Stage: v.Stage}
}
func operationDomainSourceLink(v SourceLink) app.SourceLink {
	return app.SourceLink{Href: v.Href}
}
func operationDomainWorkflowCompletedStep(v WorkflowCompletedStep) app.WorkflowCompletedStep {
	return app.WorkflowCompletedStep{Evidence: func() []app.WorkflowEvidence {
		if v.Evidence == nil {
			return nil
		}
		out := make([]app.WorkflowEvidence, len(v.Evidence))
		for i, v := range v.Evidence {
			out[i] = operationDomainWorkflowEvidence(v)
		}
		return out
	}(), ExecutionIndex: v.ExecutionIndex, Failure: func() *app.ExecutionFailure {
		if v.Failure == nil {
			return nil
		}
		out := operationDomainExecutionFailure(*v.Failure)
		return &out
	}(), RemainingFacts: v.RemainingFacts, SourceAttempts: func() []app.WorkflowSourceAttempt {
		if v.SourceAttempts == nil {
			return nil
		}
		out := make([]app.WorkflowSourceAttempt, len(v.SourceAttempts))
		for i, v := range v.SourceAttempts {
			out[i] = operationDomainWorkflowSourceAttempt(v)
		}
		return out
	}(), Step: operationDomainWorkflowTaskPlanStep(v.Step), Summary: v.Summary}
}
func operationDomainWorkflowEvidence(v WorkflowEvidence) app.WorkflowEvidence {
	return app.WorkflowEvidence{CitationHref: v.CitationHref, CitationIndex: v.CitationIndex, DocumentID: v.DocumentID, Excerpt: v.Excerpt, ID: v.ID, NoticeID: v.NoticeID, ReleasedAt: v.ReleasedAt, ResultRef: v.ResultRef, RootUnitIDs: v.RootUnitIDs, SchemaVersion: v.SchemaVersion, SectionRef: v.SectionRef, SectionTitle: v.SectionTitle, Source: operationDomainWorkflowSource(v.Source), SourceLink: func() *app.SourceLink {
		if v.SourceLink == nil {
			return nil
		}
		out := operationDomainSourceLink(*v.SourceLink)
		return &out
	}(), Title: v.Title, URL: v.URL, VersionID: v.VersionID, VersionSlug: v.VersionSlug}
}
func operationDomainWorkflowSource(v WorkflowSource) app.WorkflowSource {
	return app.WorkflowSource(v)
}
func operationDomainWorkflowSourceAttempt(v WorkflowSourceAttempt) app.WorkflowSourceAttempt {
	return app.WorkflowSourceAttempt{FailureCode: v.FailureCode, Source: operationDomainWorkflowSource(v.Source), Status: v.Status}
}
func operationDomainWorkflowTaskPlan(v WorkflowTaskPlan) app.WorkflowTaskPlan {
	return app.WorkflowTaskPlan{Goal: v.Goal, SchemaVersion: v.SchemaVersion, Steps: func() []app.WorkflowTaskPlanStep {
		if v.Steps == nil {
			return nil
		}
		out := make([]app.WorkflowTaskPlanStep, len(v.Steps))
		for i, v := range v.Steps {
			out[i] = operationDomainWorkflowTaskPlanStep(v)
		}
		return out
	}()}
}
func operationDomainWorkflowTaskPlanStep(v WorkflowTaskPlanStep) app.WorkflowTaskPlanStep {
	return app.WorkflowTaskPlanStep{CandidateSources: func() []app.WorkflowSource {
		if v.CandidateSources == nil {
			return nil
		}
		out := make([]app.WorkflowSource, len(v.CandidateSources))
		for i, v := range v.CandidateSources {
			out[i] = operationDomainWorkflowSource(v)
		}
		return out
	}(), DependsOn: v.DependsOn, ID: v.ID, Objective: v.Objective}
}
func operationDomainWorkflowTaskReplan(v WorkflowTaskReplan) app.WorkflowTaskReplan {
	return app.WorkflowTaskReplan{Decision: v.Decision, Reason: v.Reason, RemainingSteps: func() []app.WorkflowTaskPlanStep {
		if v.RemainingSteps == nil {
			return nil
		}
		out := make([]app.WorkflowTaskPlanStep, len(v.RemainingSteps))
		for i, v := range v.RemainingSteps {
			out[i] = operationDomainWorkflowTaskPlanStep(v)
		}
		return out
	}(), SchemaVersion: v.SchemaVersion}
}
func operationWireWorkflowSource(v app.WorkflowSource) WorkflowSource {
	return WorkflowSource(v)
}
func operationWireWorkflowSourceAttempt(v app.WorkflowSourceAttempt) WorkflowSourceAttempt {
	return WorkflowSourceAttempt{FailureCode: v.FailureCode, Source: operationWireWorkflowSource(v.Source), Status: v.Status}
}
