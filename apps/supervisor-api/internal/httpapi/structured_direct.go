package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredquery"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/telemetry"
)

func (s *Server) handleDirectStructuredAnswer(
	response http.ResponseWriter,
	request *http.Request,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) bool {
	handoff := executionRequest.StructuredHandoff
	if handoff == nil || !isStructuredPayloadKind(handoff.PayloadKind) {
		return false
	}

	requestCtx, complete, ok := s.beginDirectStructuredExecution(
		response,
		request,
		executionRequest,
		startedAt,
	)
	if !ok {
		return true
	}
	defer complete(lifecycle.StateCompleted)

	ctx, cancel := context.WithTimeout(
		requestCtx,
		time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond,
	)
	defer cancel()

	rawPayload, err := structuredQueryPayload(handoff, executionRequest.NoticeAccessContext)
	if err != nil {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_invalid_payload")
		writeError(
			response,
			http.StatusBadGateway,
			"structured_runtime_invalid_payload",
			"Go structured runtime payload could not be encoded.",
			false,
		)
		return true
	}

	result := s.executeStructuredRuntime(ctx, handoff.PayloadKind, rawPayload)
	s.metrics.RecordStructuredQuery(handoff.PayloadKind, result.Outcome, result.StatusCode)
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_error")
		writeError(
			response,
			http.StatusBadGateway,
			"structured_runtime_error",
			"Go structured runtime returned an invalid response.",
			true,
		)
		return true
	}

	resultBody, err := structuredResultMap(result.Body)
	if err != nil {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_invalid_response")
		writeError(
			response,
			http.StatusBadGateway,
			"structured_runtime_invalid_response",
			"Go structured runtime response could not be encoded.",
			true,
		)
		return true
	}

	supervisorResponse := shapeStructuredSupervisorResponse(
		handoff.Target,
		handoff.PayloadKind,
		resultBody,
		executionRequest.TraceID,
	)
	setOutcome(response, "supervisor_response")
	s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer.completed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "supervisor_response",
		StatusCode:          http.StatusOK,
		Duration:            time.Since(startedAt),
	}, executionRequest))
	writeJSON(response, http.StatusOK, supervisorResponse)
	return true
}

func (s *Server) handleDirectStructuredAnswerStream(
	response http.ResponseWriter,
	request *http.Request,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) bool {
	handoff := executionRequest.StructuredHandoff
	if handoff == nil || !isStructuredPayloadKind(handoff.PayloadKind) {
		return false
	}

	requestCtx, complete, ok := s.beginDirectStructuredStreamExecution(
		response,
		request,
		executionRequest,
		startedAt,
	)
	if !ok {
		return true
	}
	defer complete(lifecycle.StateCompleted)

	ctx, cancel := context.WithTimeout(
		requestCtx,
		time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond,
	)
	defer cancel()

	rawPayload, err := structuredQueryPayload(handoff, executionRequest.NoticeAccessContext)
	if err != nil {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_invalid_payload")
		emitStructuredRuntimeStreamFailure(
			response,
			executionRequest,
			http.StatusBadGateway,
			"structured_runtime_invalid_payload",
			"Go structured runtime payload could not be encoded.",
			false,
		)
		return true
	}

	result := s.executeStructuredRuntime(ctx, handoff.PayloadKind, rawPayload)
	s.metrics.RecordStructuredQuery(handoff.PayloadKind, result.Outcome, result.StatusCode)
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_error")
		emitStructuredRuntimeStreamFailure(
			response,
			executionRequest,
			http.StatusBadGateway,
			"structured_runtime_error",
			"Go structured runtime returned an invalid response.",
			true,
		)
		return true
	}

	resultBody, err := structuredResultMap(result.Body)
	if err != nil {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_invalid_response")
		emitStructuredRuntimeStreamFailure(
			response,
			executionRequest,
			http.StatusBadGateway,
			"structured_runtime_invalid_response",
			"Go structured runtime response could not be encoded.",
			true,
		)
		return true
	}

	supervisorResponse := shapeStructuredSupervisorResponse(
		handoff.Target,
		handoff.PayloadKind,
		resultBody,
		executionRequest.TraceID,
	)
	setOutcome(response, "supervisor_response")
	s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer_stream.completed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "supervisor_response",
		StatusCode:          http.StatusOK,
		Duration:            time.Since(startedAt),
	}, executionRequest))
	emitSSE(response, "execution.completed", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.completed",
		Status:     "completed",
		Outcome:    "supervisor_response",
		HTTPStatus: http.StatusOK,
		Response:   supervisorResponse,
	})
	return true
}

func (s *Server) beginDirectStructuredExecution(
	response http.ResponseWriter,
	request *http.Request,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) (context.Context, func(lifecycle.State), bool) {
	timeoutCtx, requestCancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.RequestTimeoutMS)*time.Millisecond,
	)
	_, requestCtx, registerErr := s.lifecycle.Register(timeoutCtx, lifecycle.Metadata{
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
	})
	if registerErr != nil {
		requestCancel()
		setOutcome(response, "execution_lifecycle_unavailable")
		writeError(
			response,
			http.StatusInternalServerError,
			"execution_lifecycle_unavailable",
			"Supervisor execution lifecycle could not be registered.",
			true,
		)
		return nil, nil, false
	}
	completed := false
	complete := func(state lifecycle.State) {
		if completed {
			return
		}
		completed = true
		s.lifecycle.Complete(executionRequest.RequestID, state)
		requestCancel()
	}

	s.lifecycle.Transition(executionRequest.RequestID, lifecycle.StateQueued)
	lease, decision := s.admission.AcquireLane(requestCtx, executionRequest.Lane)
	if lease == nil {
		s.metrics.RecordAdmissionDecisionForLane(executionRequest.Lane, string(decision), 0)
		complete(s.lifecycleStateForRejectedAdmission(
			executionRequest.RequestID,
			decision,
			requestCtx,
		))
		s.writeAdmissionRejection(response, decision, executionRequest.RequestID)
		return nil, nil, false
	}
	queueWait := lease.WaitDuration()
	s.metrics.RecordAdmissionDecisionForLane(executionRequest.Lane, string(decision), queueWait)
	s.lifecycle.Transition(executionRequest.RequestID, lifecycle.StateRunningBridge)
	_ = startedAt
	return requestCtx, func(state lifecycle.State) {
		lease.Release()
		complete(state)
	}, true
}

func (s *Server) beginDirectStructuredStreamExecution(
	response http.ResponseWriter,
	request *http.Request,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) (context.Context, func(lifecycle.State), bool) {
	timeoutCtx, requestCancel := context.WithTimeout(
		request.Context(),
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
		code := "execution_lifecycle_unavailable"
		status := http.StatusInternalServerError
		message := "Supervisor execution lifecycle could not be registered."
		if errors.Is(registerErr, lifecycle.ErrDuplicateExecution) {
			code = "execution_already_in_flight"
			status = http.StatusConflict
			message = "Supervisor execution request_id is already active."
		}
		setOutcome(response, code)
		emitStructuredRuntimeStreamFailure(response, executionRequest, status, code, message, true)
		return nil, nil, false
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

	s.lifecycle.Transition(executionRequest.RequestID, lifecycle.StateQueued)
	emitSSE(response, "execution.queued", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.queued",
		Status:     "queued",
		Outcome:    "queued",
		OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})

	lease, decision := s.admission.AcquireLane(requestCtx, executionRequest.Lane)
	if lease == nil {
		s.metrics.RecordAdmissionDecisionForLane(executionRequest.Lane, string(decision), 0)
		state := s.lifecycleStateForRejectedAdmission(
			executionRequest.RequestID,
			decision,
			requestCtx,
		)
		code, message, retryable := admissionErrorForStream(
			decision,
			s.lifecycle.Canceled(executionRequest.RequestID),
		)
		status := http.StatusServiceUnavailable
		if code == "execution_cancelled" || code == "client_canceled" {
			status = statusClientClosedRequest
		}
		s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
			Name:                "answer_stream.admission_rejected",
			RequestID:           executionRequest.RequestID,
			TraceID:             executionRequest.TraceID,
			Lane:                executionRequest.Lane,
			RequestedCapability: executionRequest.RequestedCapability,
			Decision:            string(decision),
			Outcome:             code,
			StatusCode:          status,
			Duration:            time.Since(startedAt),
		}, executionRequest))
		s.emitExecutionAudit(requestCtx, runtimeAuditEvent(executionaudit.Event{
			Decision:            string(decision),
			Duration:            time.Since(startedAt),
			EventType:           "execution.admission_rejected",
			HTTPStatus:          status,
			Lane:                executionRequest.Lane,
			RequestID:           executionRequest.RequestID,
			RequestedCapability: executionRequest.RequestedCapability,
			Retryable:           retryable,
			TraceID:             executionRequest.TraceID,
		}, executionRequest))
		complete(state)
		setOutcome(response, code)
		emitSSE(response, terminalStreamEventName(state), streamPayload{
			RequestID:  executionRequest.RequestID,
			TraceID:    executionRequest.TraceID,
			EventType:  terminalStreamEventName(state),
			Status:     streamStatusForLifecycle(state),
			Outcome:    code,
			HTTPStatus: status,
			Retryable:  retryable,
			Error: &errorInfo{
				Code:      code,
				Message:   message,
				Retryable: retryable,
			},
			OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
		})
		return nil, nil, false
	}
	queueWait := lease.WaitDuration()
	s.metrics.RecordAdmissionDecisionForLane(executionRequest.Lane, string(decision), queueWait)
	s.lifecycle.Transition(executionRequest.RequestID, lifecycle.StateRunningBridge)
	emitSSE(response, "execution.running", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.running",
		Status:     "running",
		Outcome:    "running",
		OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	return requestCtx, func(state lifecycle.State) {
		lease.Release()
		complete(state)
	}, true
}

func emitStructuredRuntimeStreamFailure(
	response http.ResponseWriter,
	executionRequest execution.AnswerExecutionRequest,
	status int,
	code string,
	message string,
	retryable bool,
) {
	emitSSE(response, "execution.failed", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.failed",
		Status:     "failed",
		Outcome:    code,
		HTTPStatus: status,
		Retryable:  retryable,
		Error: &errorInfo{
			Code:      code,
			Message:   message,
			Retryable: retryable,
		},
		OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func isStructuredPayloadKind(payloadKind string) bool {
	switch payloadKind {
	case structuredquery.ToolServiceStatusLookup,
		structuredquery.ToolServiceGuideLookup,
		structuredquery.ToolTransportScheduleLookup,
		structuredquery.ToolCampusNoticeDiscover,
		structuredquery.ToolCampusNoticeGet:
		return true
	default:
		return false
	}
}

func structuredQueryPayload(
	handoff *execution.RuntimeHandoff,
	noticeAccessContext map[string]any,
) ([]byte, error) {
	if handoff.PayloadKind == structuredquery.ToolCampusNoticeDiscover ||
		handoff.PayloadKind == structuredquery.ToolCampusNoticeGet {
		return json.Marshal(map[string]any{
			"payload":        handoff.Payload,
			"access_context": noticeAccessContext,
		})
	}
	return json.Marshal(handoff.Payload)
}

func (s *Server) executeStructuredRuntime(
	ctx context.Context,
	payloadKind string,
	rawPayload []byte,
) structuredquery.Response {
	switch payloadKind {
	case structuredquery.ToolServiceStatusLookup:
		return s.structuredQuery.LookupServiceStatus(ctx, rawPayload)
	case structuredquery.ToolServiceGuideLookup:
		return s.structuredQuery.LookupServiceGuide(ctx, rawPayload)
	case structuredquery.ToolTransportScheduleLookup:
		return s.structuredQuery.LookupTransportSchedule(ctx, rawPayload)
	case structuredquery.ToolCampusNoticeDiscover:
		return s.structuredQuery.LookupCampusNoticeDiscover(ctx, rawPayload)
	case structuredquery.ToolCampusNoticeGet:
		return s.structuredQuery.LookupCampusNoticeGet(ctx, rawPayload)
	default:
		return structuredquery.Response{
			StatusCode: http.StatusBadRequest,
			Outcome:    "invalid_request",
			Body: map[string]any{
				"error": map[string]any{
					"code":    "invalid_request",
					"message": "unsupported structured payload kind",
				},
			},
		}
	}
}

func structuredResultMap(body any) (map[string]any, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func shapeStructuredSupervisorResponse(
	target string,
	payloadKind string,
	result map[string]any,
	traceID string,
) map[string]any {
	outcome := stringValue(result["outcome"])
	status := supervisorStatusForStructuredOutcome(outcome)
	answerText := structuredAnswerText(payloadKind, result, status)
	failCloseReason := stringValue(result["fail_close_reason"])
	return map[string]any{
		"selected_target":    target,
		"status":             status,
		"answer_text":        answerText,
		"follow_up_question": "",
		"confidence":         confidenceForStructuredOutcome(outcome),
		"result":             result,
		"error":              nil,
		"observability": map[string]any{
			"retrieval_attempted":              false,
			"candidate_count":                  0,
			"retrieved_source_count":           0,
			"citation_expected":                false,
			"citation_count":                   0,
			"citation_missing":                 false,
			"semantic_outcome":                 status,
			"scope_class":                      "structured_runtime",
			"acl_decision":                     "allowed",
			"fail_closed":                      failCloseReason != "",
			"selected_tool":                    payloadKind,
			"tool_business_outcome":            outcome,
			"tool_fail_close_reason":           failCloseReason,
			"tool_historical_downgrade_reason": stringValue(result["historical_downgrade_reason"]),
			"service_guide_focus":              stringValue(result["guide_focus"]),
			"matched_service_category":         stringValue(result["matched_service_category"]),
		},
		"trace_id": traceID,
	}
}

func supervisorStatusForStructuredOutcome(outcome string) string {
	switch outcome {
	case "resolved_current", "resolved_historical_reference":
		return "completed"
	case "clarification_required":
		return "needs_clarification"
	default:
		return "no_answer"
	}
}

func confidenceForStructuredOutcome(outcome string) string {
	if outcome == "resolved_current" || outcome == "resolved_historical_reference" {
		return "high"
	}
	return "low"
}

func structuredAnswerText(payloadKind string, result map[string]any, status string) string {
	if status == "completed" {
		switch payloadKind {
		case structuredquery.ToolServiceStatusLookup:
			subject := stringValue(result["resolved_subject"])
			statusValue := stringValue(result["observed_status"])
			if subject != "" && statusValue != "" {
				return subject + "当前状态：" + statusValue + "。"
			}
		case structuredquery.ToolServiceGuideLookup:
			service := stringValue(nestedMap(result, "resolved_service")["display_name"])
			sections := serviceGuideSectionContents(result["guide_sections"])
			if service != "" && sections != "" {
				return service + "：\n" + sections
			}
		case structuredquery.ToolTransportScheduleLookup:
			route := stringValue(nestedMap(result, "resolved_route")["display_name"])
			departure := stringValue(nestedMap(result, "selected_departure")["departure_at"])
			if route != "" && departure != "" {
				return route + "下一班发车时间：" + departure + "。"
			}
			snapshot := nestedMap(result, "schedule_snapshot")
			snapshotID := stringValue(snapshot["snapshot_id"])
			publishedAt := stringValue(snapshot["published_at"])
			if snapshotID != "" && publishedAt != "" {
				return "当前有效时刻表版本：" + snapshotID + "，发布时间：" + publishedAt + "。"
			}
		case structuredquery.ToolCampusNoticeDiscover:
			titles := noticeTitles(result["notice_cards"])
			if titles != "" {
				return "找到以下通知：" + titles + "。"
			}
		case structuredquery.ToolCampusNoticeGet:
			title := stringValue(result["title"])
			body := strings.TrimSpace(stringValue(result["normalized_body"]))
			if title != "" && body != "" {
				return title + "\n\n" + body
			}
		}
	}
	switch payloadKind {
	case structuredquery.ToolServiceStatusLookup:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应的校园服务状态。"
		}
		return "当前还不能稳定确认这项校园服务的状态。"
	case structuredquery.ToolServiceGuideLookup:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应的办理指南。"
		}
		if stringValue(result["outcome"]) == "clarification_required" {
			return "请明确你要查询的具体服务。"
		}
		return "当前还不能稳定确认这项办理指南。"
	case structuredquery.ToolTransportScheduleLookup:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应的校车线路或班次。"
		}
		return "当前还不能稳定确认校车时刻。"
	case structuredquery.ToolCampusNoticeDiscover:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应通知。"
		}
		return "当前还不能稳定查询通知列表。"
	case structuredquery.ToolCampusNoticeGet:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到这条通知。"
		}
		return "当前还不能稳定读取这条通知。"
	default:
		return "当前还不能稳定完成该结构化查询。"
	}
}

func nestedMap(parent map[string]any, key string) map[string]any {
	value, ok := parent[key].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return value
}

func noticeTitles(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	titles := make([]string, 0, len(items))
	for _, item := range items {
		card, ok := item.(map[string]any)
		if !ok {
			continue
		}
		title := stringValue(card["title"])
		if title != "" {
			titles = append(titles, title)
		}
	}
	return strings.Join(titles, "、")
}

func serviceGuideSectionContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	contents := make([]string, 0, len(items))
	for _, item := range items {
		section, ok := item.(map[string]any)
		if !ok {
			continue
		}
		content := stringValue(section["content"])
		if content != "" {
			contents = append(contents, content)
		}
	}
	return strings.Join(contents, "\n")
}

func stringValue(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}
