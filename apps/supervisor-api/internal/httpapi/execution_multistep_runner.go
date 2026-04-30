package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/telemetry"
)

func (s *Server) runMultiStepBridgeExecution(
	parentCtx context.Context,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
	mode executionMode,
	emitProgress func(executionRunnerEvent),
) executionRunResult {
	timeoutCtx, requestCancel := context.WithTimeout(
		parentCtx,
		time.Duration(s.config.RequestTimeoutMS)*time.Millisecond,
	)
	executionHandle, requestCtx, registerErr := s.lifecycle.Register(timeoutCtx, lifecycle.Metadata{
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
	})
	if registerErr != nil {
		requestCancel()
		return executionRunResult{
			Terminal: &executionTerminal{
				State:      lifecycle.StateFailed,
				Code:       "execution_lifecycle_unavailable",
				Message:    "Supervisor execution lifecycle could not be registered.",
				StatusCode: http.StatusInternalServerError,
				Retryable:  true,
				Outcome:    "execution_lifecycle_unavailable",
			},
		}
	}
	completed := false
	complete := func(state lifecycle.State) {
		if completed {
			return
		}
		completed = true
		if state == "" {
			state = lifecycle.StateFailed
		}
		s.lifecycle.Complete(executionHandle.RequestID(), state)
		requestCancel()
	}
	terminalResult := func(terminal executionTerminal) executionRunResult {
		complete(terminal.State)
		return executionRunResult{
			RequestContext: requestCtx,
			Terminal:       &terminal,
		}
	}

	runID := "workflow:" + executionRequest.RequestID
	createdRun, err := s.workflowRuns.Create(requestCtx, execution.WorkflowRun{
		RunID:     runID,
		RequestID: executionRequest.RequestID,
		TraceID:   executionRequest.TraceID,
		PlanID:    executionRequest.WorkflowPlanID,
		Mode:      execution.WorkflowModeMultiStep,
		Branch:    "multi_step",
		State:     execution.WorkflowStateRunning,
	})
	if err != nil {
		return terminalResult(executionTerminal{
			State:      lifecycle.StateFailed,
			Code:       "supervisor_multistep_workflow_unavailable",
			Message:    "Supervisor multi-step workflow run state could not be created.",
			StatusCode: http.StatusServiceUnavailable,
			Retryable:  true,
			Outcome:    "supervisor_multistep_workflow_unavailable",
		})
	}
	workflowRun := createdRun

	s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
		Name:                string(mode) + ".accepted",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
	}, executionRequest))
	s.lifecycle.Transition(executionRequest.RequestID, lifecycle.StateQueued)
	if emitProgress != nil {
		emitProgress(executionRunnerEvent{
			Name: "execution.queued",
			Payload: streamPayload{
				RequestID:  executionRequest.RequestID,
				TraceID:    executionRequest.TraceID,
				EventType:  "execution.queued",
				Status:     "queued",
				Outcome:    "queued",
				OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
			},
		})
	}

	queueWaitDuration := time.Duration(0)
	lease, decision := s.admission.AcquireLane(requestCtx, executionRequest.Lane)
	if lease != nil {
		defer lease.Release()
		queueWaitDuration = lease.WaitDuration()
		s.metrics.RecordAdmissionDecisionForLane(
			executionRequest.Lane,
			string(decision),
			queueWaitDuration,
		)
	} else {
		s.metrics.RecordAdmissionDecisionForLane(executionRequest.Lane, string(decision), 0)
		state := s.lifecycleStateForRejectedAdmission(executionRequest.RequestID, decision, requestCtx)
		code, message, retryable := admissionErrorForStream(decision, s.lifecycle.Canceled(executionRequest.RequestID))
		status := http.StatusServiceUnavailable
		if code == "execution_cancelled" || code == "client_canceled" {
			status = statusClientClosedRequest
		}
		return terminalResult(executionTerminal{
			State:      state,
			Code:       code,
			Message:    message,
			StatusCode: status,
			Retryable:  retryable,
			Outcome:    code,
		})
	}

	s.lifecycle.Transition(executionRequest.RequestID, lifecycle.StateRunningBridge)
	if emitProgress != nil {
		emitProgress(executionRunnerEvent{
			Name: "execution.running",
			Payload: streamPayload{
				RequestID:  executionRequest.RequestID,
				TraceID:    executionRequest.TraceID,
				EventType:  "execution.running",
				Status:     "running",
				Outcome:    "running",
				OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
			},
		})
	}
	if !s.bridgeBreaker.Allow() {
		s.metrics.RecordBridgeFailure("circuit_open")
		return terminalResult(executionTerminal{
			State:       lifecycle.StateFailed,
			Code:        "supervisor_bridge_circuit_open",
			Message:     "Supervisor Python bridge circuit is open.",
			StatusCode:  http.StatusServiceUnavailable,
			Retryable:   true,
			Outcome:     "supervisor_bridge_circuit_open",
			FailureKind: "circuit_open",
		})
	}

	totalBridgeDuration := time.Duration(0)
	totalRunState := bridgeExecutionRunState{}
	var finalBridgeResponse bridge.ExecuteResponse
	workflowPayloadContext := execution.BridgePayloadContext{}
	for index, handoff := range executionRequest.PlannedHandoffs {
		selectedTool := runtimeSelectedTool(handoff)
		var appendErr error
		workflowRun, appendErr = s.workflowRuns.AppendHandoff(requestCtx, runID, execution.HandoffStep{
			Target:       handoff.Target,
			PayloadKind:  handoff.PayloadKind,
			AllowedTools: append([]string{}, handoff.AllowedTools...),
			SelectedTool: selectedTool,
		})
		if appendErr != nil {
			return terminalResult(executionTerminal{
				State:      lifecycle.StateFailed,
				Code:       "supervisor_multistep_workflow_unavailable",
				Message:    "Supervisor multi-step workflow run state could not be updated.",
				StatusCode: http.StatusServiceUnavailable,
				Retryable:  true,
				Outcome:    "supervisor_multistep_workflow_unavailable",
			})
		}
		stepPayload, err := execution.BridgePayloadForHandoff(
			executionRequest.Payload,
			handoff,
			workflowPayloadContext,
		)
		if err != nil {
			return terminalResult(executionTerminal{
				State:      lifecycle.StateFailed,
				Code:       "supervisor_multistep_invalid_plan",
				Message:    "Supervisor multi-step workflow plan could not be projected.",
				StatusCode: http.StatusBadGateway,
				Retryable:  false,
				Outcome:    "supervisor_multistep_invalid_plan",
			})
		}
		bridgeCtx, bridgeCancel := context.WithTimeout(
			requestCtx,
			time.Duration(s.config.BridgeTimeoutMS)*time.Millisecond,
		)
		bridgeStartedAt := time.Now()
		bridgeResponse, bridgeRunState, err := s.executeBridgeWithRetry(
			bridgeCtx,
			requestCtx,
			executionRequest,
			emitProgress,
			bridge.Request{Payload: stepPayload},
		)
		bridgeCancel()
		bridgeDuration := time.Since(bridgeStartedAt)
		totalBridgeDuration += bridgeDuration
		totalRunState.AttemptCount += bridgeRunState.AttemptCount
		totalRunState.RetryCount += bridgeRunState.RetryCount
		if err != nil {
			code, message, status, failureKind, state := s.bridgeExecutionError(
				err,
				requestCtx,
				bridgeCtx,
				executionRequest.RequestID,
			)
			if state != lifecycle.StateCanceled && state != lifecycle.StateClientCanceled {
				s.bridgeBreaker.RecordFailure()
				s.metrics.RecordBridgeFailure(failureKind)
			}
			return terminalResult(executionTerminal{
				State:       state,
				Code:        code,
				Message:     message,
				StatusCode:  status,
				Retryable:   state != lifecycle.StateCanceled,
				Outcome:     code,
				FailureKind: failureKind,
			})
		}
		resultStatus := workflowStepStatus(bridgeResponse)
		if resultStatus == "completed" {
			workflowPayloadContext = workflowPayloadContextFromBridgeResponse(
				workflowPayloadContext,
				handoff,
				bridgeResponse,
			)
		}
		workflowRun, _ = s.workflowRuns.AppendStep(requestCtx, runID, execution.WorkflowStep{
			StepID:       "handoff:" + handoff.Target + ":" + handoff.PayloadKind,
			SpanKind:     "handoff",
			ParentStepID: workflowRunParentStepID(index, executionRequest.PlannedHandoffs),
			Target:       handoff.Target,
			ToolName:     selectedTool,
			Outcome:      resultStatus,
			ResultStatus: resultStatus,
			RetryCount:   bridgeRunState.RetryCount,
		})
		finalBridgeResponse = bridgeResponse
		if resultStatus != "completed" {
			workflowRun, _ = s.workflowRuns.Complete(requestCtx, runID, execution.WorkflowStateFailed)
			return executionRunResult{
				BridgeResponse: finalBridgeResponse,
				BridgeDuration: totalBridgeDuration,
				BridgeRunState: totalRunState,
				QueueWait:      queueWaitDuration,
				RequestContext: requestCtx,
				WorkflowRun:    &workflowRun,
				complete:       complete,
			}
		}
	}
	if totalRunState.AttemptCount <= 0 {
		totalRunState.AttemptCount = 1
	}
	workflowRun, err = s.workflowRuns.Complete(requestCtx, runID, execution.WorkflowStateCompleted)
	if err != nil {
		return terminalResult(executionTerminal{
			State:      lifecycle.StateFailed,
			Code:       "supervisor_multistep_workflow_unavailable",
			Message:    "Supervisor multi-step workflow run state could not be completed.",
			StatusCode: http.StatusServiceUnavailable,
			Retryable:  true,
			Outcome:    "supervisor_multistep_workflow_unavailable",
		})
	}
	return executionRunResult{
		BridgeResponse: finalBridgeResponse,
		BridgeDuration: totalBridgeDuration,
		BridgeRunState: totalRunState,
		QueueWait:      queueWaitDuration,
		RequestContext: requestCtx,
		WorkflowRun:    &workflowRun,
		complete:       complete,
	}
}

func runtimeSelectedTool(handoff execution.RuntimeHandoff) string {
	if len(handoff.AllowedTools) == 1 {
		return handoff.AllowedTools[0]
	}
	if handoff.Target == "rag-agent" {
		return "retrieval.query"
	}
	return ""
}

func workflowStepStatus(response bridge.ExecuteResponse) string {
	if response.Kind != "agent_response" {
		return "error"
	}
	body, err := decodeJSONObject(response.Body)
	if err != nil {
		return "error"
	}
	status, _ := body["status"].(string)
	if status == "" {
		return "error"
	}
	return status
}

func workflowRunParentStepID(index int, handoffs []execution.RuntimeHandoff) string {
	if index <= 0 || index > len(handoffs)-1 {
		return "runtime_policy"
	}
	previous := handoffs[index-1]
	return "handoff:" + previous.Target + ":" + previous.PayloadKind
}

func workflowPayloadContextFromBridgeResponse(
	current execution.BridgePayloadContext,
	handoff execution.RuntimeHandoff,
	response bridge.ExecuteResponse,
) execution.BridgePayloadContext {
	if handoff.Target != "notice-agent" || runtimeSelectedTool(handoff) != "campus_notice_get" {
		return current
	}
	if response.Kind != "agent_response" {
		return current
	}
	body, err := decodeJSONObject(response.Body)
	if err != nil {
		return current
	}
	if status, _ := body["status"].(string); status != "completed" {
		return current
	}
	result, _ := body["result"].(map[string]any)
	next := execution.BridgePayloadContext{
		NoticeTitle:     firstWorkflowString(result, "title"),
		NoticeBody:      firstWorkflowString(result, "normalized_body", "body_text", "body"),
		NoticeSourceURL: firstWorkflowString(result, "source_url", "canonical_url"),
	}
	if next.NoticeBody == "" {
		next.NoticeBody, _ = body["answer_text"].(string)
	}
	if !bridgePayloadContextHasAnyNoticeContext(next) {
		return current
	}
	return next
}

func firstWorkflowString(record map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, _ := record[key].(string); value != "" {
			return value
		}
	}
	return ""
}

func bridgePayloadContextHasAnyNoticeContext(context execution.BridgePayloadContext) bool {
	return context.NoticeTitle != "" || context.NoticeBody != "" || context.NoticeSourceURL != ""
}
