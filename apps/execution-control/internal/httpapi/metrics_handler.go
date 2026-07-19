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
	groupSnapshots := make(map[string]observability.AdmissionGroupSnapshot, len(status.Groups))
	for group, groupStatus := range status.Groups {
		groupSnapshots[group] = observability.AdmissionGroupSnapshot{
			Active:        groupStatus.Active,
			Queued:        groupStatus.Queued,
			QueueCapacity: groupStatus.QueueCapacity,
		}
	}
	lifecycleStatus := s.lifecycle.Snapshot()
	telemetryStatus := s.telemetry.Status()
	_, _ = response.Write(s.metrics.Prometheus(observability.AdmissionSnapshot{
		Active:        status.Active,
		Queued:        status.Queued,
		QueueCapacity: status.QueueCapacity,
		Draining:      status.Draining,
		Groups:        groupSnapshots,
		Lifecycle: observability.LifecycleSnapshot{
			ActiveExecutions:     lifecycleStatus.ActiveExecutions,
			CancelRequestedCount: lifecycleStatus.CancelRequestedCount,
			CompletedRetained:    lifecycleStatus.CompletedRetained,
			CompletedByState:     lifecycleStatus.CompletedByState,
		},
		Telemetry: observability.TelemetrySnapshot{
			Enabled:            telemetryStatus.Enabled,
			ExporterConfigured: telemetryStatus.ExporterConfigured,
			MetricsEnabled:     telemetryStatus.MetricsEnabled,
			MetricsConfigured:  telemetryStatus.MetricsExporterConfigured,
			SubmittedCount:     telemetryStatus.SubmittedCount,
			DroppedCount:       telemetryStatus.DroppedCount,
			FailedCount:        telemetryStatus.FailedCount,
			SampleRatio:        telemetryStatus.SampleRatio,
			LastError:          telemetryStatus.LastError,
		},
	}))
}
