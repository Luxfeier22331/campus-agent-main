//go:build retired_bridge_serving

package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
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
				Message:    "Execution lifecycle could not be registered.",
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
	var workflowRun execution.WorkflowRun
	completeWorkflowRun := func(state execution.WorkflowState) {
		if s.workflowRuns == nil {
			return
		}
		updated, completeErr := s.workflowRuns.Complete(requestCtx, runID, state)
		if completeErr == nil {
			workflowRun = updated
		}
	}
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
			Message:    "Execution multi-step workflow run state could not be created.",
			StatusCode: http.StatusServiceUnavailable,
			Retryable:  true,
			Outcome:    "supervisor_multistep_workflow_unavailable",
		})
	}
	workflowRun = createdRun

	if err := s.emitTelemetry(requestCtx, runtimeTelemetryEvent(telemetry.Event{
		Name:                string(mode) + ".accepted",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
	}, executionRequest)); err != nil {
		return terminalResult(*telemetryDeliveryTerminal())
	}
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
	workflowContextProjections := []execution.StepOutputProjection{}
	lastCapabilityInvocationID := ""
	for index, handoff := range executionRequest.PlannedHandoffs {
		selectedTool := runtimeSelectedTool(handoff)
		var appendErr error
		workflowRun, appendErr = s.workflowRuns.AppendHandoff(requestCtx, runID, execution.HandoffStep{
			Capability:   handoff.Capability,
			PayloadKind:  handoff.PayloadKind,
			AllowedTools: append([]string{}, handoff.AllowedTools...),
			SelectedTool: selectedTool,
		})
		if appendErr != nil {
			return terminalResult(executionTerminal{
				State:      lifecycle.StateFailed,
				Code:       "supervisor_multistep_workflow_unavailable",
				Message:    "Execution multi-step workflow run state could not be updated.",
				StatusCode: http.StatusServiceUnavailable,
				Retryable:  true,
				Outcome:    "supervisor_multistep_workflow_unavailable",
			})
		}
		if handoff.RequiredProjectionKind != "" &&
			!workflowHasRequiredProjection(workflowContextProjections, handoff.RequiredProjectionKind) {
			completeWorkflowRun(execution.WorkflowStateFailed)
			return terminalResult(executionTerminal{
				State:      lifecycle.StateFailed,
				Code:       "supervisor_multistep_projection_unavailable",
				Message:    "Execution multi-step workflow projection could not be created.",
				StatusCode: http.StatusBadGateway,
				Retryable:  false,
				Outcome:    "supervisor_multistep_projection_unavailable",
			})
		}
		stepPayload, err := execution.BridgePayloadForHandoff(
			executionRequest.Payload,
			handoff,
			workflowContextProjections...,
		)
		if err != nil {
			completeWorkflowRun(execution.WorkflowStateFailed)
			return terminalResult(executionTerminal{
				State:      lifecycle.StateFailed,
				Code:       "supervisor_multistep_invalid_plan",
				Message:    "Execution multi-step workflow plan could not be projected.",
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
		bridgeResponse, bridgeRunState, terminal, err := s.executeBridgeWithRetry(
			bridgeCtx,
			requestCtx,
			executionRequest,
			emitProgress,
			bridge.Request{
				Payload: stepPayload,
				TraceHeaders: telemetry.InjectBridgeTraceHeaders(
					requestCtx,
					executionRequest.RequestID,
					executionRequest.TraceID,
				),
			},
		)
		bridgeCancel()
		if terminal != nil {
			completeWorkflowRun(execution.WorkflowStateFailed)
			return terminalResult(*terminal)
		}
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
			completeWorkflowRun(workflowRunStateForLifecycleState(state))
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
		bridgeBody, _ := decodeJSONObject(bridgeResponse.Body)
		bridgeResult, _ := bridgeBody["result"].(map[string]any)
		bridgeCapabilityObservability, _ := bridgeBody["capability_observability"].(map[string]any)
		stepID := "capability:" + handoff.Capability + ":" + handoff.PayloadKind
		stepProjections := workflowProjectionsFromBridgeResponse(
			handoff,
			stepID,
			bridgeResponse,
		)
		if resultStatus == "error" {
			workflowRun, _ = s.workflowRuns.AppendStep(requestCtx, runID, execution.WorkflowStep{
				StepID:          stepID,
				SpanKind:        "handoff",
				ParentStepID:    workflowRunParentStepID(index, executionRequest.PlannedHandoffs),
				Capability:      handoff.Capability,
				ToolName:        selectedTool,
				Outcome:         resultStatus,
				ResultStatus:    resultStatus,
				RetryCount:      bridgeRunState.RetryCount,
				FailCloseReason: workflowFailCloseReason(bridgeResult, bridgeCapabilityObservability),
			})
			workflowRun, _ = s.workflowRuns.Complete(
				requestCtx,
				runID,
				workflowStateForStatus(resultStatus),
			)
			finalBridgeResponse = bridgeResponse
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
		if artifactErr := validateWorkflowStepArtifacts(handoff, stepProjections); artifactErr != nil {
			workflowRun, _ = s.workflowRuns.AppendStep(requestCtx, runID, execution.WorkflowStep{
				StepID:          stepID,
				SpanKind:        "handoff",
				ParentStepID:    workflowRunParentStepID(index, executionRequest.PlannedHandoffs),
				Capability:      handoff.Capability,
				ToolName:        selectedTool,
				Outcome:         "failed",
				ResultStatus:    resultStatus,
				RetryCount:      bridgeRunState.RetryCount,
				FailCloseReason: "artifact_incomplete",
			})
			completeWorkflowRun(execution.WorkflowStateFailed)
			return terminalResult(executionTerminal{
				State:      lifecycle.StateFailed,
				Code:       "supervisor_multistep_artifact_incomplete",
				Message:    artifactErr.Error(),
				StatusCode: http.StatusBadGateway,
				Retryable:  false,
				Outcome:    "supervisor_multistep_artifact_incomplete",
			})
		}
		for _, projection := range stepProjections {
			workflowContextProjections = append(workflowContextProjections, projection)
			workflowRun, appendErr = s.workflowRuns.AppendStepOutputProjection(
				requestCtx,
				runID,
				projection,
			)
			if appendErr != nil {
				completeWorkflowRun(execution.WorkflowStateFailed)
				return terminalResult(executionTerminal{
					State:      lifecycle.StateFailed,
					Code:       "supervisor_multistep_workflow_unavailable",
					Message:    "Execution multi-step workflow run state could not be updated.",
					StatusCode: http.StatusServiceUnavailable,
					Retryable:  true,
					Outcome:    "supervisor_multistep_workflow_unavailable",
				})
			}
		}
		workflowRun, _ = s.workflowRuns.AppendStep(requestCtx, runID, execution.WorkflowStep{
			StepID:       stepID,
			SpanKind:     "handoff",
			ParentStepID: workflowRunParentStepID(index, executionRequest.PlannedHandoffs),
			Capability:   handoff.Capability,
			ToolName:     selectedTool,
			Outcome:      resultStatus,
			ResultStatus: resultStatus,
			RetryCount:   bridgeRunState.RetryCount,
		})
		invocationID := "capability-invocation:" + handoff.Capability + ":" + handoff.PayloadKind
		parentInvocationID := ""
		if index > 0 {
			parentInvocationID = lastCapabilityInvocationID
		}
		workflowRun, _ = s.workflowRuns.AppendCapabilityInvocation(requestCtx, runID, execution.CapabilityInvocation{
			InvocationID:       invocationID,
			ParentInvocationID: parentInvocationID,
			WorkflowRunRef:     runID,
			StepID:             stepID,
			CapabilityID:       handoff.Capability,
			Status:             resultStatus,
			AllowedTools:       append([]string{}, handoff.AllowedTools...),
			UsedTools:          workflowSelectedTools(nil, selectedTool),
			ProjectionIDs:      workflowInputProjectionIDsForHandoff(handoff, workflowContextProjections),
		})
		if selectedTool != "" {
			toolArgumentSummary := workflowHandoffPayloadSummary(&handoff)
			toolArgumentSummary["payload_kind"] = handoff.PayloadKind
			toolArgumentSummary["selected_tool"] = selectedTool
			toolSummary := execution.ToolCallSummary{
				ToolCallID:        runID + ":" + stepID,
				WorkflowRunRef:    runID,
				StepID:            stepID,
				LifecycleState:    workflowToolLifecycleState(resultStatus),
				ResultProjection:  "bounded_summary",
				RawResultIncluded: false,
				ToolName:          selectedTool,
				Capability:        handoff.Capability,
				ResultStatus:      resultStatus,
				ArgumentSummary:   safeWorkflowMap(toolArgumentSummary),
				SourceIDs: workflowSummarySourceIDs(
					bridgeResult,
					bridgeCapabilityObservability,
				),
				SafeDetails:                workflowSafeDetails(bridgeCapabilityObservability),
				ProviderToolCallProjection: workflowProviderToolCallProjection(bridgeCapabilityObservability),
			}
			if businessOutcome := workflowBusinessOutcome(bridgeResult, bridgeCapabilityObservability); businessOutcome != "" {
				toolSummary.BusinessOutcome = businessOutcome
			}
			if failCloseReason := workflowFailCloseReason(bridgeResult, bridgeCapabilityObservability); failCloseReason != "" {
				toolSummary.FailCloseReason = failCloseReason
			}
			if accessDecision := stringValue(bridgeCapabilityObservability["access_decision"]); accessDecision != "" {
				toolSummary.AccessDecision = accessDecision
			}
			workflowRun, _ = s.workflowRuns.AppendToolCallSummary(requestCtx, runID, toolSummary)
		}
		lastCapabilityInvocationID = invocationID
		finalBridgeResponse = bridgeResponse
		if resultStatus != "completed" {
			workflowRun, _ = s.workflowRuns.Complete(
				requestCtx,
				runID,
				workflowStateForStatus(resultStatus),
			)
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
			Message:    "Execution multi-step workflow run state could not be completed.",
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
