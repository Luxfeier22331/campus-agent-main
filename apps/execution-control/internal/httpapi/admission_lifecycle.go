//go:build retired_bridge_serving

package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
)

func (s *Server) writeAdmissionRejection(
	response http.ResponseWriter,
	decision admission.Decision,
	requestID string,
) bool {
	switch decision {
	case admission.DecisionQueueFull:
		setOutcome(response, "transport_queue_full")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_queue_full",
			"Execution admission queue is full.",
		)
		return true
	case admission.DecisionLaneQueueFull:
		setOutcome(response, "transport_lane_queue_full")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_lane_queue_full",
			"Execution admission lane queue is full.",
		)
		return true
	case admission.DecisionQueueTimeout:
		setOutcome(response, "transport_queue_timeout")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_queue_timeout",
			"Execution admission queue wait timed out.",
		)
		return true
	case admission.DecisionLaneQueueTimeout:
		setOutcome(response, "transport_lane_queue_timeout")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_lane_queue_timeout",
			"Execution admission lane queue wait timed out.",
		)
		return true
	case admission.DecisionDraining:
		setOutcome(response, "transport_draining")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_draining",
			"Execution runtime is draining.",
		)
		return true
	case admission.DecisionClientCanceled:
		if s.lifecycle.Canceled(requestID) {
			setOutcome(response, "execution_cancelled")
			writeError(
				response,
				statusClientClosedRequest,
				"execution_cancelled",
				"Execution was cancelled.",
				false,
			)
			return true
		}
		setOutcome(response, "client_canceled")
		return true
	default:
		setOutcome(response, "transport_admission_rejected")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_admission_rejected",
			"Execution admission rejected the request.",
		)
		return true
	}
}

func (s *Server) lifecycleStateForRejectedAdmission(
	requestID string,
	decision admission.Decision,
	requestCtx context.Context,
) lifecycle.State {
	if decision == admission.DecisionClientCanceled {
		if s.lifecycle.Canceled(requestID) ||
			errors.Is(context.Cause(requestCtx), lifecycle.ErrExecutionCanceled) {
			return lifecycle.StateCanceled
		}
		return lifecycle.StateClientCanceled
	}
	if errors.Is(requestCtx.Err(), context.DeadlineExceeded) {
		return lifecycle.StateTimedOut
	}
	return lifecycle.StateFailed
}
