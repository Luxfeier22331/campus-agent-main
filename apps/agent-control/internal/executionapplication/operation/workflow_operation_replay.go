package operation

import "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"

func WorkflowOperationReplayStep(
	steps []execution.RunStepProjection,
	stepID string,
) (execution.RunStepProjection, bool) {
	for _, step := range steps {
		if step.StepID == stepID {
			return step, true
		}
	}
	return execution.RunStepProjection{}, false
}
