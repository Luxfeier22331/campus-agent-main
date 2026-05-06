package httpapi

import (
	"context"
	"net/http"
	"strings"
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
	workflowContextProjections := []execution.StepOutputProjection{}
	lastAgentInvocationID := ""
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
		if handoff.RequiredProjectionKind != "" &&
			!workflowHasRequiredProjection(workflowContextProjections, handoff.RequiredProjectionKind) {
			return terminalResult(executionTerminal{
				State:      lifecycle.StateFailed,
				Code:       "supervisor_multistep_projection_unavailable",
				Message:    "Supervisor multi-step workflow projection could not be created.",
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
		bridgeBody, _ := decodeJSONObject(bridgeResponse.Body)
		bridgeResult, _ := bridgeBody["result"].(map[string]any)
		bridgeAgentObservability, _ := bridgeBody["agent_observability"].(map[string]any)
		for _, projection := range workflowProjectionsFromBridgeResponse(
			handoff,
			"handoff:"+handoff.Target+":"+handoff.PayloadKind,
			bridgeResponse,
		) {
			workflowContextProjections = append(workflowContextProjections, projection)
			workflowRun, appendErr = s.workflowRuns.AppendStepOutputProjection(
				requestCtx,
				runID,
				projection,
			)
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
		}
		stepProjectionIDs := workflowProjectionIDsForSourceStep(
			workflowContextProjections,
			"handoff:"+handoff.Target+":"+handoff.PayloadKind,
		)
		stepID := "handoff:" + handoff.Target + ":" + handoff.PayloadKind
		workflowRun, _ = s.workflowRuns.AppendStep(requestCtx, runID, execution.WorkflowStep{
			StepID:       stepID,
			SpanKind:     "handoff",
			ParentStepID: workflowRunParentStepID(index, executionRequest.PlannedHandoffs),
			Target:       handoff.Target,
			ToolName:     selectedTool,
			Outcome:      resultStatus,
			ResultStatus: resultStatus,
			RetryCount:   bridgeRunState.RetryCount,
		})
		invocationID := "agent-invocation:" + handoff.Target + ":" + handoff.PayloadKind
		parentInvocationID := ""
		if index > 0 {
			parentInvocationID = lastAgentInvocationID
		}
		workflowRun, _ = s.workflowRuns.AppendAgentInvocation(requestCtx, runID, execution.AgentInvocation{
			InvocationID:       invocationID,
			ParentInvocationID: parentInvocationID,
			WorkflowRunRef:     runID,
			StepID:             stepID,
			AgentID:            handoff.Target,
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
				ToolCallID:                 runID + ":" + stepID,
				WorkflowRunRef:             runID,
				StepID:                     stepID,
				LifecycleState:             workflowToolLifecycleState(resultStatus),
				ResultProjection:           "bounded_summary",
				RawResultIncluded:          false,
				ToolName:                   selectedTool,
				Target:                     handoff.Target,
				ResultStatus:               resultStatus,
				ArgumentSummary:            safeWorkflowMap(toolArgumentSummary),
				SourceIDs: workflowSummarySourceIDs(
					bridgeResult,
					bridgeAgentObservability,
					stepProjectionIDs,
				),
				SafeDetails:                workflowSafeDetails(bridgeAgentObservability),
				ProviderToolCallProjection: workflowProviderToolCallProjection(bridgeAgentObservability),
			}
			if businessOutcome := workflowBusinessOutcome(bridgeResult, bridgeAgentObservability); businessOutcome != "" {
				toolSummary.BusinessOutcome = businessOutcome
			}
			if failCloseReason := workflowFailCloseReason(bridgeResult, bridgeAgentObservability); failCloseReason != "" {
				toolSummary.FailCloseReason = failCloseReason
			}
			if accessDecision := stringValue(bridgeAgentObservability["access_decision"]); accessDecision != "" {
				toolSummary.AccessDecision = accessDecision
			}
			workflowRun, _ = s.workflowRuns.AppendToolCallSummary(requestCtx, runID, toolSummary)
		}
		lastAgentInvocationID = invocationID
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

func workflowInputProjectionIDsForHandoff(
	handoff execution.RuntimeHandoff,
	projections []execution.StepOutputProjection,
) []string {
	projectionIDs := make([]string, 0, len(projections))
	for _, projection := range projections {
		if !executionProjectionAllowedForHandoff(handoff, projection) {
			continue
		}
		if projection.ProjectionID != "" {
			projectionIDs = append(projectionIDs, projection.ProjectionID)
		}
	}
	return projectionIDs
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

func workflowBusinessOutcome(
	result map[string]any,
	agentObservability map[string]any,
) string {
	return defaultString(
		stringValue(agentObservability["tool_outcome"]),
		defaultString(stringValue(agentObservability["result_outcome"]), stringValue(result["outcome"])),
	)
}

func workflowFailCloseReason(
	result map[string]any,
	agentObservability map[string]any,
) string {
	return defaultString(
		stringValue(result["fail_close_reason"]),
		stringValue(agentObservability["fail_close_reason"]),
	)
}

func workflowSafeDetails(agentObservability map[string]any) map[string]any {
	safeDetails, _ := agentObservability["safe_details"].(map[string]any)
	if hasForbiddenWorkflowTraceKey(safeDetails) {
		return map[string]any{}
	}
	return safeWorkflowMap(safeDetails)
}

func workflowProviderToolCallProjection(agentObservability map[string]any) map[string]any {
	safeDetails := workflowSafeDetails(agentObservability)
	projection, _ := safeDetails["provider_tool_call_projection"].(map[string]any)
	if hasForbiddenWorkflowTraceKey(projection) {
		return map[string]any{}
	}
	return safeWorkflowMap(projection)
}

func workflowSummarySourceIDs(
	result map[string]any,
	agentObservability map[string]any,
	fallbackProjectionIDs []string,
) []string {
	sourceIDs := workflowSourceIDs(result)
	if len(sourceIDs) > 0 {
		return sourceIDs
	}
	safeDetails := workflowSafeDetails(agentObservability)
	sourceRefsUsed := stringArrayValue(safeDetails["source_refs_used"])
	if len(sourceRefsUsed) == 0 {
		return append([]string{}, fallbackProjectionIDs...)
	}
	unique := make([]string, 0, len(sourceRefsUsed))
	for _, sourceID := range sourceRefsUsed {
		appendWorkflowSourceID(&unique, sourceID)
	}
	return unique
}

func workflowProjectionIDsForSourceStep(
	projections []execution.StepOutputProjection,
	sourceStepID string,
) []string {
	ids := []string{}
	for _, projection := range projections {
		if projection.SourceStepID != sourceStepID || projection.ProjectionID == "" {
			continue
		}
		ids = append(ids, projection.ProjectionID)
	}
	return ids
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

func workflowProjectionsFromBridgeResponse(
	handoff execution.RuntimeHandoff,
	sourceStepID string,
	response bridge.ExecuteResponse,
) []execution.StepOutputProjection {
	if response.Kind != "agent_response" {
		return nil
	}
	body, err := decodeJSONObject(response.Body)
	if err != nil {
		return nil
	}
	status, _ := body["status"].(string)
	result, _ := body["result"].(map[string]any)
	switch {
	case handoff.Target == "campus-services-agent" && handoff.PayloadKind == "transport_schedule_lookup":
		if status != "completed" {
			return nil
		}
		projection, ok := execution.NewScheduleBaselineProjection(
			sourceStepID,
			workflowNestedString(result, "resolved_route", "route_id"),
			workflowNestedString(result, "resolved_route", "display_name"),
			workflowNestedString(result, "resolved_route", "service_family"),
			firstWorkflowString(body, "answer_text"),
			workflowSourceIDs(result),
		)
		if !ok {
			return nil
		}
		return []execution.StepOutputProjection{projection}
	case handoff.Target == "notice-agent" && handoff.PayloadKind == "campus_notice_get":
		if status != "completed" {
			return nil
		}
		projection, ok := execution.NewNoticeContextProjection(
			sourceStepID,
			firstWorkflowString(result, "title"),
			firstWorkflowString(result, "body_excerpt", "bounded_summary"),
			firstWorkflowString(result, "source_url", "canonical_url"),
		)
		if !ok {
			return nil
		}
		return []execution.StepOutputProjection{projection}
	case handoff.Target == "rag-agent" && handoff.PayloadKind == "rag_request":
		return workflowRagStepOutputProjections(sourceStepID, status, result)
	default:
		return nil
	}
}

func workflowRagStepOutputProjections(
	sourceStepID string,
	resultStatus string,
	result map[string]any,
) []execution.StepOutputProjection {
	projections := make([]execution.StepOutputProjection, 0, 2)
	if evidence, _ := result["evidence"].(map[string]any); evidence != nil {
		if projection, ok := execution.NewEvidenceBundleProjection(
			sourceStepID,
			firstWorkflowString(evidence, "corpus"),
			firstWorkflowString(evidence, "collection"),
			firstWorkflowString(evidence, "query_text"),
			workflowEvidenceSourceIDs(evidence),
		); ok {
			projections = append(projections, projection)
		}
	}
	diagnostics, _ := result["diagnostics"].(map[string]any)
	if diagnostics != nil || len(projections) > 0 || resultStatus == "needs_clarification" ||
		resultStatus == "no_answer" {
		groundingVerdict := ""
		semanticOutcome := strings.TrimSpace(resultStatus)
		if diagnostics != nil {
			groundingVerdict = firstWorkflowString(
				diagnostics,
				"grounding_verdict",
				"retrieval_adequacy_verdict",
			)
			if diagnosticsSemanticOutcome := firstWorkflowString(
				diagnostics,
				"semantic_outcome",
			); diagnosticsSemanticOutcome != "" {
				semanticOutcome = diagnosticsSemanticOutcome
			}
		}
		if projection, ok := execution.NewGroundingVerdictProjection(
			sourceStepID,
			groundingVerdict,
			semanticOutcome,
			len(workflowEvidenceSourceIDs(result["evidence"])),
		); ok {
			projections = append(projections, projection)
		}
	}
	return projections
}

func firstWorkflowString(record map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, _ := record[key].(string); value != "" {
			return value
		}
	}
	return ""
}

func workflowNestedString(record map[string]any, parentKey string, childKey string) string {
	parent, _ := record[parentKey].(map[string]any)
	if parent == nil {
		return ""
	}
	value, _ := parent[childKey].(string)
	return value
}

func workflowHasRequiredProjection(
	projections []execution.StepOutputProjection,
	requiredProjectionKind string,
) bool {
	switch requiredProjectionKind {
	case string(execution.ProjectionKindScheduleBaseline):
		_, ok := execution.FirstProjectionOfKind(projections, execution.ProjectionKindScheduleBaseline)
		return ok
	case string(execution.ProjectionKindNoticeContext):
		_, ok := execution.FirstProjectionOfKind(projections, execution.ProjectionKindNoticeContext)
		return ok
	default:
		return false
	}
}

func workflowEvidenceSourceIDs(rawEvidence any) []string {
	evidence, _ := rawEvidence.(map[string]any)
	if evidence == nil {
		return []string{}
	}
	rawSources, _ := evidence["sources"].([]any)
	sourceIDs := make([]string, 0, len(rawSources))
	for _, rawSource := range rawSources {
		source, _ := rawSource.(map[string]any)
		if source == nil {
			continue
		}
		docID := firstWorkflowString(source, "doc_id", "source_id")
		if docID != "" {
			sourceIDs = append(sourceIDs, docID)
		}
	}
	return sourceIDs
}

func executionProjectionAllowedForHandoff(
	handoff execution.RuntimeHandoff,
	projection execution.StepOutputProjection,
) bool {
	if projection.ProjectionID == "" || projection.ProjectionKind == "" {
		return false
	}
	requiredProjectionKind := handoff.RequiredProjectionKind
	if handoff.Target == "rag-agent" {
		return projection.ProjectionKind == execution.ProjectionKindScheduleBaseline ||
			projection.ProjectionKind == execution.ProjectionKindNoticeContext
	}
	if requiredProjectionKind == "" {
		return false
	}
	return string(projection.ProjectionKind) == requiredProjectionKind
}
