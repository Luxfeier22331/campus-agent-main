package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/telemetry"
)

type executionMode string

const (
	executionModeAnswer       executionMode = "answer"
	executionModeAnswerStream executionMode = "answer_stream"
)

type executionRunnerEvent struct {
	Name    string
	Payload streamPayload
}

type executionRunResult struct {
	BridgeResponse bridge.ExecuteResponse
	BridgeDuration time.Duration
	BridgeRunState bridgeExecutionRunState
	QueueWait      time.Duration
	RequestContext context.Context
	WorkflowRun    *execution.WorkflowRun
	Terminal       *executionTerminal

	complete func(lifecycle.State)
}

type executionTerminal struct {
	State       lifecycle.State
	Code        string
	Message     string
	StatusCode  int
	Retryable   bool
	Outcome     string
	FailureKind string
}

type bridgeExecutionRunState struct {
	AttemptCount int
	RetryCount   int
}

func (r executionRunResult) Complete(state lifecycle.State) {
	if r.complete != nil {
		r.complete(state)
	}
}

func (s *Server) runWorkflowExecution(
	parentCtx context.Context,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
	mode executionMode,
	emitProgress func(executionRunnerEvent),
) executionRunResult {
	if executionRequest.WorkflowMode == execution.WorkflowModeMultiStep {
		return s.runMultiStepBridgeExecution(parentCtx, executionRequest, startedAt, mode, emitProgress)
	}
	return s.runBridgeExecution(parentCtx, executionRequest, startedAt, mode, emitProgress)
}

func (s *Server) runBridgeExecution(
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
		code := "execution_lifecycle_unavailable"
		status := http.StatusInternalServerError
		message := "Supervisor execution lifecycle could not be registered."
		retryable := true
		if errors.Is(registerErr, lifecycle.ErrDuplicateExecution) {
			code = "execution_already_in_flight"
			status = http.StatusConflict
			message = "Supervisor execution request_id is already active."
			retryable = true
		}
		return executionRunResult{
			Terminal: &executionTerminal{
				State:      lifecycle.StateFailed,
				Code:       code,
				Message:    message,
				StatusCode: status,
				Retryable:  retryable,
				Outcome:    code,
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
		s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
			Name:                string(mode) + ".admission_rejected",
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
		s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
			Name:                string(mode) + ".failed",
			RequestID:           executionRequest.RequestID,
			TraceID:             executionRequest.TraceID,
			Lane:                executionRequest.Lane,
			RequestedCapability: executionRequest.RequestedCapability,
			Outcome:             "supervisor_bridge_circuit_open",
			FailureCode:         "circuit_open",
			StatusCode:          http.StatusServiceUnavailable,
			Duration:            time.Since(startedAt),
		}, executionRequest))
		s.emitExecutionAudit(requestCtx, runtimeAuditEvent(executionaudit.Event{
			Duration:            time.Since(startedAt),
			EventType:           "execution.bridge_failed",
			FailureKind:         "circuit_open",
			HTTPStatus:          http.StatusServiceUnavailable,
			Lane:                executionRequest.Lane,
			QueueWait:           queueWaitDuration,
			RequestID:           executionRequest.RequestID,
			RequestedCapability: executionRequest.RequestedCapability,
			Retryable:           true,
			TraceID:             executionRequest.TraceID,
		}, executionRequest))
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

	bridgeCtx, bridgeCancel := context.WithTimeout(
		requestCtx,
		time.Duration(s.config.BridgeTimeoutMS)*time.Millisecond,
	)
	defer bridgeCancel()

	bridgeStartedAt := time.Now()
	bridgeResponse, bridgeRunState, err := s.executeBridgeWithRetry(
		bridgeCtx,
		requestCtx,
		executionRequest,
		emitProgress,
		bridge.Request{
			Payload: executionRequest.Payload,
			TraceHeaders: telemetry.InjectBridgeTraceHeaders(
				requestCtx,
				executionRequest.RequestID,
				executionRequest.TraceID,
			),
		},
	)
	bridgeDuration := time.Since(bridgeStartedAt)
	if bridgeRunState.AttemptCount <= 0 {
		bridgeRunState.AttemptCount = 1
	}
	if bridgeRunState.RetryCount < 0 {
		bridgeRunState.RetryCount = 0
	}
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
		if state != lifecycle.StateClientCanceled {
			s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
				Name:                terminalTelemetryEventName(mode, state),
				RequestID:           executionRequest.RequestID,
				TraceID:             executionRequest.TraceID,
				Lane:                executionRequest.Lane,
				RequestedCapability: executionRequest.RequestedCapability,
				Outcome:             code,
				FailureCode:         failureKind,
				StatusCode:          status,
				Duration:            time.Since(startedAt),
			}, executionRequest))
			s.emitExecutionAudit(requestCtx, runtimeAuditEvent(executionaudit.Event{
				BridgeDuration:      bridgeDuration,
				Duration:            time.Since(startedAt),
				EventType:           auditEventTypeForBridgeFailure(state),
				FailureKind:         failureKind,
				HTTPStatus:          status,
				Lane:                executionRequest.Lane,
				QueueWait:           queueWaitDuration,
				RequestID:           executionRequest.RequestID,
				RequestedCapability: executionRequest.RequestedCapability,
				Retryable:           state != lifecycle.StateCanceled,
				TraceID:             executionRequest.TraceID,
			}, executionRequest))
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

	return executionRunResult{
		BridgeResponse: bridgeResponse,
		BridgeDuration: bridgeDuration,
		BridgeRunState: bridgeRunState,
		QueueWait:      queueWaitDuration,
		RequestContext: requestCtx,
		complete:       complete,
	}
}

func (s *Server) executeBridgeWithRetry(
	bridgeCtx context.Context,
	requestCtx context.Context,
	executionRequest execution.AnswerExecutionRequest,
	emitProgress func(executionRunnerEvent),
	request bridge.Request,
) (bridge.ExecuteResponse, bridgeExecutionRunState, error) {
	maxAttempts := s.config.BridgeRetryMaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 1
	}
	retryBase := time.Duration(s.config.BridgeRetryBaseMS) * time.Millisecond
	if retryBase < 0 {
		retryBase = 0
	}
	runState := bridgeExecutionRunState{}
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		runState.AttemptCount = attempt
		attemptStartedAt := time.Now()
		s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
			Name:                "agent.bridge.started",
			RequestID:           executionRequest.RequestID,
			TraceID:             executionRequest.TraceID,
			Lane:                executionRequest.Lane,
			RequestedCapability: executionRequest.RequestedCapability,
			Decision:            "attempt_started",
		}, executionRequest))
		response, err := s.bridge.Execute(bridgeCtx, request)
		attemptDuration := time.Since(attemptStartedAt)
		s.metrics.RecordBridgeDuration(attemptDuration)
		if err == nil {
			s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
				Name:                "agent.bridge.completed",
				RequestID:           executionRequest.RequestID,
				TraceID:             executionRequest.TraceID,
				Lane:                executionRequest.Lane,
				RequestedCapability: executionRequest.RequestedCapability,
				Outcome:             "completed",
				BridgeDuration:      attemptDuration,
			}, executionRequest))
			return response, runState, nil
		}
		lastErr = err
		failureKind, retryable := s.retryableBridgeExecutionFailure(
			err,
			requestCtx,
			bridgeCtx,
			executionRequest.RequestID,
		)
		if !retryable || attempt >= maxAttempts {
			s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
				Name:                "agent.bridge.failed",
				RequestID:           executionRequest.RequestID,
				TraceID:             executionRequest.TraceID,
				Lane:                executionRequest.Lane,
				RequestedCapability: executionRequest.RequestedCapability,
				Outcome:             "failed",
				FailureCode:         failureKind,
				BridgeDuration:      attemptDuration,
			}, executionRequest))
			break
		}
		runState.RetryCount++
		s.metrics.RecordBridgeRetry(failureKind)
		if emitProgress != nil {
			emitProgress(executionRunnerEvent{
				Name: "execution.retrying",
				Payload: streamPayload{
					RequestID:  executionRequest.RequestID,
					TraceID:    executionRequest.TraceID,
					EventType:  "execution.retrying",
					Status:     "running",
					Outcome:    "bridge_retry",
					Retryable:  true,
					OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
				},
			})
		}
		if !sleepBeforeBridgeRetry(bridgeCtx, retryBase, attempt) {
			break
		}
	}
	return bridge.ExecuteResponse{}, runState, lastErr
}

func (s *Server) retryableBridgeExecutionFailure(
	err error,
	requestCtx context.Context,
	bridgeCtx context.Context,
	requestID string,
) (string, bool) {
	_, _, _, failureKind, state := s.bridgeExecutionError(
		err,
		requestCtx,
		bridgeCtx,
		requestID,
	)
	if state == lifecycle.StateCanceled || state == lifecycle.StateClientCanceled {
		return failureKind, false
	}
	return failureKind, failureKind == "unavailable"
}

func sleepBeforeBridgeRetry(ctx context.Context, base time.Duration, attempt int) bool {
	if base <= 0 || attempt <= 0 {
		return true
	}
	delay := base * time.Duration(attempt)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func terminalTelemetryEventName(mode executionMode, state lifecycle.State) string {
	switch state {
	case lifecycle.StateCompleted:
		return string(mode) + ".completed"
	case lifecycle.StateCanceled:
		return string(mode) + ".cancelled"
	default:
		return string(mode) + ".failed"
	}
}

func (s *Server) recordBridgeWriteOutcome(
	requestCtx context.Context,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
	bridgeDuration time.Duration,
	queueWaitDuration time.Duration,
	mode executionMode,
	writeOutcome bridgeWriteOutcome,
) {
	if writeOutcome.CircuitFailure {
		s.bridgeBreaker.RecordFailure()
	} else if writeOutcome.CircuitSuccess {
		s.bridgeBreaker.RecordSuccess()
	}
	s.telemetry.Emit(requestCtx, runtimeTelemetryEvent(telemetry.Event{
		Name:                terminalTelemetryEventName(mode, writeOutcome.State),
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             writeOutcome.Outcome,
		FailureCode:         writeOutcome.FailureKind,
		StatusCode:          writeOutcome.StatusCode,
		Duration:            time.Since(startedAt),
	}, executionRequest))
	if writeOutcome.State == lifecycle.StateFailed && writeOutcome.FailureKind != "" {
		s.emitExecutionAudit(requestCtx, runtimeAuditEvent(executionaudit.Event{
			BridgeDuration:      bridgeDuration,
			Duration:            time.Since(startedAt),
			EventType:           "execution.bridge_failed",
			FailureKind:         writeOutcome.FailureKind,
			HTTPStatus:          writeOutcome.StatusCode,
			Lane:                executionRequest.Lane,
			QueueWait:           queueWaitDuration,
			RequestID:           executionRequest.RequestID,
			RequestedCapability: executionRequest.RequestedCapability,
			Retryable:           writeOutcome.StatusCode >= 500,
			TraceID:             executionRequest.TraceID,
		}, executionRequest))
	}
	if writeOutcome.State == lifecycle.StateCanceled {
		s.emitExecutionAudit(requestCtx, runtimeAuditEvent(executionaudit.Event{
			BridgeDuration:      bridgeDuration,
			Duration:            time.Since(startedAt),
			EventType:           "execution.cancelled",
			HTTPStatus:          writeOutcome.StatusCode,
			Lane:                executionRequest.Lane,
			QueueWait:           queueWaitDuration,
			RequestID:           executionRequest.RequestID,
			RequestedCapability: executionRequest.RequestedCapability,
			Retryable:           false,
			TraceID:             executionRequest.TraceID,
		}, executionRequest))
	}
}

func (s *Server) writeTerminalError(response http.ResponseWriter, terminal executionTerminal) {
	if terminal.Retryable && strings.HasPrefix(terminal.Code, "transport_") {
		response.Header().Set("retry-after", retryAfterSeconds(s.config.QueueTimeoutMS))
	}
	writeError(
		response,
		terminal.StatusCode,
		terminal.Code,
		terminal.Message,
		terminal.Retryable,
	)
}
