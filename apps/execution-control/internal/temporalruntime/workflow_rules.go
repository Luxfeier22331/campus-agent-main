package temporalruntime

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

var workflowTaskStepIDPattern = regexp.MustCompile(`^step\.[a-z0-9][a-z0-9_-]{0,63}$`)

// ValidateWorkflowPlan validates the durable workflow plan semantics shared by
// the Temporal workflow and the runtime adapter.
func ValidateWorkflowPlan(
	plan WorkflowTaskPlan,
	maxSteps int,
	capabilities execution.AgentCapabilitiesSnapshot,
) error {
	if plan.SchemaVersion != "task_plan.v1" || strings.TrimSpace(plan.Goal) == "" ||
		maxSteps < 1 || len(plan.Steps) > maxSteps {
		return errors.New("workflow plan identity or size is invalid")
	}
	known := make(map[string]struct{}, len(plan.Steps))
	visible := workflowVisibleSourceSet(capabilities.VisibleFunctionToolNames, capabilities.HostedWebSearch)
	for _, step := range plan.Steps {
		if !workflowTaskStepIDPattern.MatchString(strings.TrimSpace(step.ID)) || strings.TrimSpace(step.Objective) == "" {
			return fmt.Errorf("workflow plan step %q has invalid identity", step.ID)
		}
		if _, exists := known[step.ID]; exists {
			return fmt.Errorf("workflow plan step %s is duplicated", step.ID)
		}
		if err := validateWorkflowSources(step.ID, step.CandidateSources, visible); err != nil {
			return err
		}
		seenDependencies := map[string]struct{}{}
		for _, dependency := range step.DependsOn {
			if dependency == step.ID {
				return fmt.Errorf("workflow plan step %s depends on itself", step.ID)
			}
			if _, duplicate := seenDependencies[dependency]; duplicate {
				return fmt.Errorf("workflow plan step %s repeats a dependency", step.ID)
			}
			if _, exists := known[dependency]; !exists {
				return fmt.Errorf("workflow plan step %s depends on unknown or later step %s", step.ID, dependency)
			}
			seenDependencies[dependency] = struct{}{}
		}
		known[step.ID] = struct{}{}
	}
	return nil
}

// ValidateWorkflowCompletedSteps validates completed-step metadata and exact
// membership in the already admitted plan. Source semantics belong to the
// plan validator and are intentionally not re-proven here.
func ValidateWorkflowCompletedSteps(
	completed []WorkflowCompletedStep,
	plan WorkflowTaskPlan,
) error {
	if len(completed) > len(plan.Steps) {
		return errors.New("completed workflow step count exceeds the supplied plan")
	}
	seen := map[string]struct{}{}
	for _, item := range completed {
		if item.ExecutionIndex < 1 || strings.TrimSpace(item.Summary) == "" {
			return errors.New("completed workflow step metadata is invalid")
		}
		if _, duplicate := seen[item.Step.ID]; duplicate {
			return fmt.Errorf("completed workflow step %s is duplicated", item.Step.ID)
		}
		if !WorkflowPlanContainsStep(plan, item.Step) {
			return fmt.Errorf("completed workflow step %s is not part of the supplied plan", item.Step.ID)
		}
		seen[item.Step.ID] = struct{}{}
	}
	return nil
}

// ValidateWorkflowRemainingSteps validates a replacement path against the
// completed steps and the admitted workflow budget.
func ValidateWorkflowRemainingSteps(
	steps []WorkflowTaskPlanStep,
	maxSteps int,
	completed []WorkflowCompletedStep,
	capabilities execution.AgentCapabilitiesSnapshot,
) error {
	if len(completed)+len(steps) > maxSteps {
		return errors.New("workflow steps exceed budget")
	}
	completedIDs := make(map[string]struct{}, len(completed))
	known := make(map[string]struct{}, len(completed)+len(steps))
	for _, item := range completed {
		completedIDs[item.Step.ID] = struct{}{}
		known[item.Step.ID] = struct{}{}
	}
	visible := workflowVisibleSourceSet(capabilities.VisibleFunctionToolNames, capabilities.HostedWebSearch)
	for _, step := range steps {
		if !workflowTaskStepIDPattern.MatchString(strings.TrimSpace(step.ID)) || strings.TrimSpace(step.Objective) == "" {
			return fmt.Errorf("remaining workflow step %q has invalid identity", step.ID)
		}
		if _, done := completedIDs[step.ID]; done {
			return fmt.Errorf("remaining step %s is already completed", step.ID)
		}
		if _, duplicate := known[step.ID]; duplicate {
			return fmt.Errorf("remaining step %s is duplicated", step.ID)
		}
		if err := validateWorkflowSources(step.ID, step.CandidateSources, visible); err != nil {
			return err
		}
		for _, dependency := range step.DependsOn {
			if dependency == step.ID {
				return fmt.Errorf("remaining step %s depends on itself", step.ID)
			}
			if _, exists := known[dependency]; !exists {
				return fmt.Errorf("remaining step %s depends on unknown or later step %s", step.ID, dependency)
			}
		}
		known[step.ID] = struct{}{}
	}
	return nil
}

// ValidateWorkflowReplanDecision validates the decision/remaining-step shape.
func ValidateWorkflowReplanDecision(replan WorkflowTaskReplan) error {
	switch replan.Decision {
	case "synthesize":
		if len(replan.RemainingSteps) != 0 {
			return errors.New("synthesize decision must not contain remaining steps")
		}
	case "continue":
		if len(replan.RemainingSteps) == 0 {
			return errors.New("continuing replan decision requires remaining steps")
		}
	default:
		return fmt.Errorf("unsupported replan decision %q", replan.Decision)
	}
	return nil
}

func workflowVisibleSourceSet(values []string, hostedWebSearch bool) map[WorkflowSource]struct{} {
	visible := map[WorkflowSource]struct{}{}
	if hostedWebSearch {
		visible[WorkflowSourceWebSearch] = struct{}{}
	}
	for _, value := range values {
		switch WorkflowSource(strings.TrimSpace(value)) {
		case WorkflowSourceCampusSearch:
			visible[WorkflowSourceCampusSearch] = struct{}{}
		case WorkflowSourcePersonalMemoryRecall:
			visible[WorkflowSourcePersonalMemoryRecall] = struct{}{}
		}
	}
	return visible
}

func validateWorkflowSources(
	stepID string,
	sources []WorkflowSource,
	visible map[WorkflowSource]struct{},
) error {
	if len(sources) == 0 || len(sources) > 3 {
		return fmt.Errorf("workflow step %s candidate source count is invalid", stepID)
	}
	seen := map[WorkflowSource]struct{}{}
	for _, source := range sources {
		if _, duplicate := seen[source]; duplicate {
			return fmt.Errorf("workflow step %s repeats candidate source %s", stepID, source)
		}
		seen[source] = struct{}{}
		if _, available := visible[source]; !available {
			return fmt.Errorf("workflow step %s uses unavailable source %s", stepID, source)
		}
	}
	return nil
}

// WorkflowPlanContainsStep compares a completed or admitted step with the
// canonical definition in the current plan.
func WorkflowPlanContainsStep(plan WorkflowTaskPlan, want WorkflowTaskPlanStep) bool {
	for _, step := range plan.Steps {
		if WorkflowTaskPlanStepEqual(step, want) {
			return true
		}
	}
	return false
}

// WorkflowTaskPlanStepEqual compares the semantic fields owned by the
// workflow plan contract.
func WorkflowTaskPlanStepEqual(left, right WorkflowTaskPlanStep) bool {
	return left.ID == right.ID && left.Objective == right.Objective &&
		sameWorkflowSources(left.CandidateSources, right.CandidateSources) &&
		sameWorkflowStrings(left.DependsOn, right.DependsOn)
}

func sameWorkflowSources(left, right []WorkflowSource) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func sameWorkflowStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
