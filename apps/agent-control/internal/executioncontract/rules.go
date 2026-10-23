package executioncontract

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
