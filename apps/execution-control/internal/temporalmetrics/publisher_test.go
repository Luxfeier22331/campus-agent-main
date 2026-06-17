package temporalmetrics

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPublisherPostsSnapshotToAppAPIInternalIngest(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("x-app-internal-auth") != "shared-secret" {
			t.Fatalf("x-app-internal-auth = %q", request.Header.Get("x-app-internal-auth"))
		}
		if request.URL.Path != "/api/internal/operator/runtime/temporal-task-queue-snapshots" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		_, _ = response.Write([]byte(`{"acceptedSnapshots":1,"acceptedDecisions":0,"acceptedActuations":0}`))
	}))
	defer server.Close()

	publisher := Publisher{
		BaseURL:      server.URL,
		SharedSecret: "shared-secret",
		Timeout:      time.Second,
	}
	err := publisher.Publish(t.Context(), SnapshotPayload{
		SchemaVersion: SchemaVersion,
		Snapshots: []TaskQueueSnapshot{{
			Backlog:                SourceCountMetric{State: SourceMetricUnsupported},
			Namespace:              "default",
			OldestTaskAge:          SourceDurationMetric{State: SourceMetricUnsupported},
			PollerCount:            1,
			PollerIdentities:       []string{"worker-1"},
			SampledAt:              "2026-06-15T10:00:00Z",
			ScheduleToStartLatency: SourceDurationMetric{State: SourceMetricUnsupported},
			SnapshotID:             "snapshot-1",
			Source:                 DefaultSamplerSource,
			TaskQueue:              "campus-agent.workflow",
			TaskQueueKind:          TaskQueueKindWorkflow,
		}},
	})
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if captured["schemaVersion"] != SchemaVersion {
		t.Fatalf("schemaVersion = %v", captured["schemaVersion"])
	}
}
