package httpapi

import (
	"net/http"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/observability"
)

func (s *Server) handleMetrics(response http.ResponseWriter, request *http.Request) {
	if !s.metricsAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid metrics bearer token.", false)
		return
	}
	response.Header().Set("content-type", "text/plain; version=0.0.4")
	response.WriteHeader(http.StatusOK)
	status := s.admission.Status()
	laneSnapshots := make(map[string]observability.AdmissionLaneSnapshot, len(status.Lanes))
	for lane, laneStatus := range status.Lanes {
		laneSnapshots[lane] = observability.AdmissionLaneSnapshot{
			Active:        laneStatus.Active,
			Queued:        laneStatus.Queued,
			QueueCapacity: laneStatus.QueueCapacity,
		}
	}
	lifecycleStatus := s.lifecycle.Snapshot()
	bridgeCircuit := s.bridgeBreaker.Snapshot()
	telemetryStatus := s.telemetry.Status()
	executionAuditStatus := s.executionAudit.Status()
	_, _ = response.Write(s.metrics.Prometheus(observability.AdmissionSnapshot{
		Active:        status.Active,
		Queued:        status.Queued,
		QueueCapacity: status.QueueCapacity,
		Draining:      status.Draining,
		Lanes:         laneSnapshots,
		Lifecycle: observability.LifecycleSnapshot{
			ActiveExecutions:     lifecycleStatus.ActiveExecutions,
			CancelRequestedCount: lifecycleStatus.CancelRequestedCount,
			CompletedRetained:    lifecycleStatus.CompletedRetained,
			CompletedByState:     lifecycleStatus.CompletedByState,
		},
		BridgeCircuit: observability.BridgeCircuitSnapshot{
			OpenCount:     bridgeCircuit.OpenCount,
			RejectedCount: bridgeCircuit.RejectedCount,
			State:         bridgeCircuit.State,
		},
		Telemetry: observability.TelemetrySnapshot{
			Enabled:            telemetryStatus.Enabled,
			ExporterConfigured: telemetryStatus.ExporterConfigured,
			MetricsEnabled:     telemetryStatus.MetricsEnabled,
			MetricsConfigured:  telemetryStatus.MetricsExporterConfigured,
			ExportedCount:      telemetryStatus.ExportedCount,
			DroppedCount:       telemetryStatus.DroppedCount,
			FailedCount:        telemetryStatus.FailedCount,
			SampleRatio:        telemetryStatus.SampleRatio,
			LastError:          telemetryStatus.LastError,
		},
		ExecutionAudit: observability.ExecutionAuditSnapshot{
			Configured:   executionAuditStatus.Configured,
			EmittedCount: executionAuditStatus.EmittedCount,
			Enabled:      executionAuditStatus.Enabled,
			FailedCount:  executionAuditStatus.FailedCount,
			LastError:    executionAuditStatus.LastError,
		},
	}))
}
