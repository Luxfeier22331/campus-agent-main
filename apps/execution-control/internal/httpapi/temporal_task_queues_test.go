package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalmetrics"
)

type fakeTemporalTaskQueueSampler struct {
	payload temporalmetrics.SnapshotPayload
}

func (f fakeTemporalTaskQueueSampler) Sample(context.Context) (temporalmetrics.SnapshotPayload, error) {
	return f.payload, nil
}

func TestTemporalTaskQueuesRequiresMetricsToken(t *testing.T) {
	server := NewServer(config.Config{OpsWebInternalToken: "ops-web-token"})
	server.temporalTaskQueueSampler = fakeTemporalTaskQueueSampler{}
	request := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/internal/ops/temporal/task-queues",
		nil,
	)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestTemporalTaskQueuesReturnsCurrentSampleWithoutPersistence(t *testing.T) {
	backlog := 3
	ageMS := 2500
	server := NewServer(config.Config{OpsWebInternalToken: "ops-web-token"})
	server.temporalTaskQueueSampler = fakeTemporalTaskQueueSampler{payload: temporalmetrics.SnapshotPayload{
		SchemaVersion: temporalmetrics.SchemaVersion,
		Snapshots: []temporalmetrics.TaskQueueSnapshot{{
			Backlog:       temporalmetrics.SourceCountMetric{Count: &backlog, State: temporalmetrics.SourceMetricObserved},
			OldestTaskAge: temporalmetrics.SourceDurationMetric{MS: &ageMS, State: temporalmetrics.SourceMetricObserved},
			PollerCount:   2,
			SampledAt:     "2026-07-12T12:00:00Z",
			TaskQueue:     "campus-agent.activity.agent",
			TaskQueueKind: temporalmetrics.TaskQueueKindActivity,
		}},
	}}
	request := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/internal/ops/temporal/task-queues",
		nil,
	)
	request.Header.Set("authorization", "Bearer ops-web-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	for _, fragment := range []string{
		`"sampledAt":"2026-07-12T12:00:00Z"`,
		`"name":"campus-agent.activity.agent"`,
		`"backlogCount":3`,
		`"oldestTaskAgeSeconds":2.5`,
		`"pollerCount":2`,
	} {
		if !strings.Contains(response.Body.String(), fragment) {
			t.Fatalf("body = %s, missing %s", response.Body.String(), fragment)
		}
	}
}
