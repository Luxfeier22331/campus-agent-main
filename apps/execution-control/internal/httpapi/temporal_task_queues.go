package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalmetrics"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type temporalTaskQueueSampler interface {
	Sample(context.Context) (temporalmetrics.SnapshotPayload, error)
}

type temporalTaskQueueResponse struct {
	Queues    []temporalTaskQueueResponseItem `json:"queues"`
	SampledAt string                          `json:"sampledAt"`
}

type temporalTaskQueueResponseItem struct {
	BacklogCount         *int     `json:"backlogCount"`
	Name                 string   `json:"name"`
	OldestTaskAgeSeconds *float64 `json:"oldestTaskAgeSeconds"`
	PollerCount          int      `json:"pollerCount"`
	Type                 string   `json:"type"`
}

func newTemporalTaskQueueSampler(
	cfg config.Config,
	starter temporalruntime.ChatWorkflowStarter,
) temporalTaskQueueSampler {
	temporalStarter, ok := starter.(*temporalruntime.Starter)
	if !ok || temporalStarter.SDKClient() == nil {
		return nil
	}
	return temporalmetrics.Sampler{
		Client: temporalmetrics.SDKTaskQueueClient{
			Client:    temporalStarter.SDKClient(),
			Namespace: cfg.TemporalNamespace,
		},
		Namespace: cfg.TemporalNamespace,
		Source:    "execution-control.ops-api",
		TaskQueues: []temporalmetrics.TaskQueueTarget{
			{Name: defaultString(strings.TrimSpace(cfg.TemporalTaskQueue), temporalruntime.WorkflowTaskQueue), Kind: temporalmetrics.TaskQueueKindWorkflow},
			{Name: temporalruntime.ActivityTaskQueueCore, Kind: temporalmetrics.TaskQueueKindActivity},
			{Name: temporalruntime.ActivityTaskQueueAgent, Kind: temporalmetrics.TaskQueueKindActivity},
		},
	}
}

func (s *Server) handleTemporalTaskQueues(response http.ResponseWriter, request *http.Request) {
	if !s.metricsAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid metrics auth.", false)
		return
	}
	if s.temporalTaskQueueSampler == nil {
		setOutcome(response, "unavailable")
		writeError(response, http.StatusServiceUnavailable, "temporal_unavailable", "Temporal is not configured.", true)
		return
	}
	timeout := time.Duration(s.config.TemporalStartTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(request.Context(), timeout)
	defer cancel()
	payload, err := s.temporalTaskQueueSampler.Sample(ctx)
	if err != nil {
		setOutcome(response, "unavailable")
		writeError(response, http.StatusServiceUnavailable, "temporal_query_failed", "Temporal task queues could not be read.", true)
		return
	}
	result := temporalTaskQueueResponse{
		Queues:    make([]temporalTaskQueueResponseItem, 0, len(payload.Snapshots)),
		SampledAt: latestSampledAt(payload.Snapshots),
	}
	for _, snapshot := range payload.Snapshots {
		var oldestTaskAgeSeconds *float64
		if snapshot.OldestTaskAge.MS != nil {
			seconds := float64(*snapshot.OldestTaskAge.MS) / 1000
			oldestTaskAgeSeconds = &seconds
		}
		result.Queues = append(result.Queues, temporalTaskQueueResponseItem{
			BacklogCount:         snapshot.Backlog.Count,
			Name:                 snapshot.TaskQueue,
			OldestTaskAgeSeconds: oldestTaskAgeSeconds,
			PollerCount:          snapshot.PollerCount,
			Type:                 snapshot.TaskQueueKind,
		})
	}
	setOutcome(response, "ok")
	writeJSON(response, http.StatusOK, result)
}

func latestSampledAt(snapshots []temporalmetrics.TaskQueueSnapshot) string {
	if len(snapshots) == 0 {
		return ""
	}
	return snapshots[0].SampledAt
}
