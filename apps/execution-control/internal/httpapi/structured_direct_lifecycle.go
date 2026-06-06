package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

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
		code := "execution_lifecycle_unavailable"
		status := http.StatusInternalServerError
		message := "Supervisor execution lifecycle could not be registered."
		if errors.Is(registerErr, lifecycle.ErrDuplicateExecution) {
			code = "execution_already_in_flight"
			status = http.StatusConflict
			message = "Supervisor execution request_id is already active."
		}
		setOutcome(response, code)
		writeError(
			response,
			status,
			code,
			message,
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
		code, _, retryable := admissionErrorForStream(
			decision,
			s.lifecycle.Canceled(executionRequest.RequestID),
		)
		status := http.StatusServiceUnavailable
		if code == "execution_cancelled" || code == "client_canceled" {
			status = statusClientClosedRequest
		}
		if err := s.emitTelemetry(requestCtx, runtimeTelemetryEvent(telemetry.Event{
			Name:                "answer.admission_rejected",
			RequestID:           executionRequest.RequestID,
			TraceID:             executionRequest.TraceID,
			Lane:                executionRequest.Lane,
			RequestedCapability: executionRequest.RequestedCapability,
			Decision:            string(decision),
			Outcome:             code,
			StatusCode:          status,
			Duration:            time.Since(startedAt),
		}, executionRequest)); err != nil {
			complete(lifecycle.StateFailed)
			s.writeTelemetryFailure(response, executionRequest.RequestID, executionRequest.TraceID)
			return nil, nil, false
		}
		if err := s.emitExecutionAudit(requestCtx, runtimeAuditEvent(executionaudit.Event{
			Decision:            string(decision),
			Duration:            time.Since(startedAt),
			EventType:           "execution.admission_rejected",
			HTTPStatus:          status,
			Lane:                executionRequest.Lane,
			RequestID:           executionRequest.RequestID,
			RequestedCapability: executionRequest.RequestedCapability,
			Retryable:           retryable,
			TraceID:             executionRequest.TraceID,
		}, executionRequest)); err != nil {
			complete(lifecycle.StateFailed)
			s.writeExecutionAuditFailure(response, executionRequest.RequestID, executionRequest.TraceID)
			return nil, nil, false
		}
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
		if err := s.emitTelemetry(requestCtx, runtimeTelemetryEvent(telemetry.Event{
			Name:                "answer_stream.admission_rejected",
			RequestID:           executionRequest.RequestID,
			TraceID:             executionRequest.TraceID,
			Lane:                executionRequest.Lane,
			RequestedCapability: executionRequest.RequestedCapability,
			Decision:            string(decision),
			Outcome:             code,
			StatusCode:          status,
			Duration:            time.Since(startedAt),
		}, executionRequest)); err != nil {
			complete(lifecycle.StateFailed)
			emitStructuredRuntimeStreamFailure(
				response,
				executionRequest,
				http.StatusServiceUnavailable,
				"telemetry_delivery_failed",
				"Supervisor telemetry delivery failed.",
				true,
			)
			return nil, nil, false
		}
		if err := s.emitExecutionAudit(requestCtx, runtimeAuditEvent(executionaudit.Event{
			Decision:            string(decision),
			Duration:            time.Since(startedAt),
			EventType:           "execution.admission_rejected",
			HTTPStatus:          status,
			Lane:                executionRequest.Lane,
			RequestID:           executionRequest.RequestID,
			RequestedCapability: executionRequest.RequestedCapability,
			Retryable:           retryable,
			TraceID:             executionRequest.TraceID,
		}, executionRequest)); err != nil {
			complete(lifecycle.StateFailed)
			setOutcome(response, "execution_audit_delivery_failed")
			emitStructuredRuntimeStreamFailure(
				response,
				executionRequest,
				http.StatusServiceUnavailable,
				"execution_audit_delivery_failed",
				"Supervisor execution audit delivery failed.",
				true,
			)
			return nil, nil, false
		}
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
