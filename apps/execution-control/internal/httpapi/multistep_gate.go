package httpapi

import (
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *Server) rejectMultiStepWorkflowUnavailable(
	response http.ResponseWriter,
	request execution.AnswerExecutionRequest,
) bool {
	reason := s.multiStepWorkflowUnavailableReason(request)
	if reason == "" {
		return false
	}
	setOutcome(response, "supervisor_multistep_workflow_unavailable")
	writeError(
		response,
		http.StatusServiceUnavailable,
		"supervisor_multistep_workflow_unavailable",
		"Execution multi-step workflow runtime is not available.",
		true,
	)
	return true
}

func (s *Server) rejectMultiStepWorkflowUnavailableStream(
	response http.ResponseWriter,
	request execution.AnswerExecutionRequest,
) bool {
	reason := s.multiStepWorkflowUnavailableReason(request)
	if reason == "" {
		return false
	}
	setOutcome(response, "supervisor_multistep_workflow_unavailable")
	emitSSE(response, "execution.failed", streamPayload{
		RequestID:  request.RequestID,
		TraceID:    request.TraceID,
		EventType:  "execution.failed",
		Status:     "failed",
		Outcome:    "supervisor_multistep_workflow_unavailable",
		HTTPStatus: http.StatusServiceUnavailable,
		Retryable:  true,
		Error: &errorInfo{
			Code:      "supervisor_multistep_workflow_unavailable",
			Message:   "Execution multi-step workflow runtime is not available.",
			Retryable: true,
		},
		OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	return true
}

func (s *Server) multiStepWorkflowUnavailableReason(
	request execution.AnswerExecutionRequest,
) string {
	if request.WorkflowMode != execution.WorkflowModeMultiStep {
		return ""
	}
	if !s.config.MultiStepWorkflowEnabled {
		return "multi_step_disabled"
	}
	if len(request.PlannedHandoffs) < 2 {
		return "multi_step_plan_incomplete"
	}
	if s.workflowRunsErr != nil {
		return "workflow_run_store_init_failed"
	}
	if s.workflowRuns == nil {
		return "workflow_run_store_missing"
	}
	return ""
}
