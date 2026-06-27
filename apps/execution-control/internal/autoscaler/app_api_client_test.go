package autoscaler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAppAPIClientFetchesInternalTemporalSnapshots(t *testing.T) {
	var capturedPath string
	var capturedSecret string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		capturedPath = request.URL.String()
		capturedSecret = request.Header.Get("x-app-internal-auth")
		_, _ = response.Write([]byte(`{
			"page": {"nextCursor": null},
			"snapshots": [
				{
					"backlog": {"count": null, "state": "unsupported_by_source"},
					"namespace": "default",
					"oldestTaskAge": {"ms": null, "state": "unsupported_by_source"},
					"pollerCount": 0,
					"pollerIdentities": ["activity-worker-knowledge@local"],
					"scheduleToStartLatency": {"ms": null, "state": "unsupported_by_source"},
					"sampledAt": "2026-06-15T10:00:00Z",
					"snapshotId": "temporal-snapshot-knowledge",
					"source": "temporal_matching_describe_task_queue",
					"taskQueue": "campus-agent.activity.knowledge",
					"taskQueueKind": "activity"
				}
			]
		}`))
	}))
	defer server.Close()

	client := AppAPIClient{
		BaseURL:      server.URL,
		SharedSecret: "shared-secret",
		Timeout:      time.Second,
	}
	snapshots, err := client.FetchTemporalTaskQueueSnapshots(t.Context(), 8)
	if err != nil {
		t.Fatalf("FetchTemporalTaskQueueSnapshots returned error: %v", err)
	}

	if capturedPath != "/api/internal/operator/runtime/temporal-task-queues?limit=8" {
		t.Fatalf("path = %q", capturedPath)
	}
	if capturedSecret != "shared-secret" {
		t.Fatalf("secret = %q", capturedSecret)
	}
	if len(snapshots) != 1 {
		t.Fatalf("snapshot count = %d", len(snapshots))
	}
	if snapshots[0].TaskQueue != "campus-agent.activity.knowledge" ||
		snapshots[0].PollerCount != 0 {
		t.Fatalf("snapshot = %#v", snapshots[0])
	}
	if snapshots[0].Namespace != "default" ||
		snapshots[0].Source != "temporal_matching_describe_task_queue" ||
		len(snapshots[0].PollerIdentities) != 1 ||
		snapshots[0].PollerIdentities[0] != "activity-worker-knowledge@local" {
		t.Fatalf("snapshot runtime projection fields were not preserved: %#v", snapshots[0])
	}
}

func TestAppAPIClientPublishesAutoscalerRuntimePayload(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/internal/operator/runtime/temporal-task-queue-snapshots" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.Header.Get("x-app-internal-auth") != "shared-secret" {
			t.Fatalf("x-app-internal-auth = %q", request.Header.Get("x-app-internal-auth"))
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		_, _ = response.Write([]byte(`{"acceptedSnapshots":0,"acceptedDecisions":1,"acceptedActuations":1}`))
	}))
	defer server.Close()

	client := AppAPIClient{
		BaseURL:      server.URL,
		SharedSecret: "shared-secret",
		Timeout:      time.Second,
	}
	err := client.PublishRuntimePayload(t.Context(), AppAPIRuntimePayload{
		SchemaVersion: SchemaVersion,
		Snapshots: []TemporalTaskQueueSnapshot{{
			Backlog:                SourceMetric{State: SourceMetricUnsupported},
			Namespace:              "default",
			OldestTaskAge:          SourceMetric{State: SourceMetricUnsupported},
			PollerCount:            0,
			PollerIdentities:       []string{"activity-worker-knowledge@local"},
			SampledAt:              "2026-06-15T10:00:00Z",
			ScheduleToStartLatency: SourceMetric{State: SourceMetricUnsupported},
			SnapshotID:             "snapshot-1",
			Source:                 "temporal_matching_describe_task_queue",
			TaskQueue:              "campus-agent.activity.knowledge",
			TaskQueueKind:          TaskQueueKindActivity,
		}},
		Decisions: []WorkerAutoscalerDecision{{
			BudgetState:      BudgetWithin,
			CurrentReplicas:  1,
			DecidedAt:        "2026-06-15T10:00:05Z",
			Decision:         DecisionScaleUp,
			DecisionID:       "decision-1",
			DesiredReplicas:  2,
			Evidence:         map[string]any{"pollerCount": 0},
			Reason:           "pollers_missing",
			SourceSnapshotID: "snapshot-1",
			TargetService:    "activity-worker-knowledge",
			TaskQueue:        "campus-agent.activity.knowledge",
			TaskQueueKind:    TaskQueueKindActivity,
		}},
		Actuations: []Actuation{{
			ActedAt:       "2026-06-15T10:00:06Z",
			Action:        "scale",
			ActuationID:   "actuation-1",
			ActuatorKind:  ActuatorKindDockerCompose,
			DecisionID:    "decision-1",
			FromReplicas:  1,
			Status:        ActuationStatusApplied,
			TargetService: "activity-worker-knowledge",
			ToReplicas:    2,
		}},
	})
	if err != nil {
		t.Fatalf("PublishRuntimePayload returned error: %v", err)
	}
	if captured["schemaVersion"] != SchemaVersion {
		t.Fatalf("schemaVersion = %v", captured["schemaVersion"])
	}
	if len(captured["decisions"].([]any)) != 1 || len(captured["actuations"].([]any)) != 1 {
		t.Fatalf("captured payload = %#v", captured)
	}
	snapshots := captured["snapshots"].([]any)
	if len(snapshots) != 1 {
		t.Fatalf("snapshots = %#v", snapshots)
	}
	snapshot := snapshots[0].(map[string]any)
	if snapshot["namespace"] != "default" ||
		snapshot["source"] != "temporal_matching_describe_task_queue" {
		t.Fatalf("snapshot runtime projection fields missing from payload: %#v", snapshot)
	}
	pollers := snapshot["pollerIdentities"].([]any)
	if len(pollers) != 1 || pollers[0] != "activity-worker-knowledge@local" {
		t.Fatalf("snapshot poller identities missing from payload: %#v", snapshot)
	}
}

func TestAppAPIClientFetchesInternalAutoscalerActuations(t *testing.T) {
	var capturedPath string
	var capturedSecret string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		capturedPath = request.URL.String()
		capturedSecret = request.Header.Get("x-app-internal-auth")
		_, _ = response.Write([]byte(`{
			"actuations": [
				{
					"actedAt": "2026-06-15T10:00:06Z",
					"action": "scale",
					"actuationId": "actuation-1",
					"actuatorKind": "docker_compose",
					"decisionId": "decision-1",
					"fromReplicas": 1,
					"status": "applied",
					"targetService": "activity-worker-knowledge",
					"toReplicas": 2
				}
			],
			"page": {"nextCursor": null}
		}`))
	}))
	defer server.Close()

	client := AppAPIClient{
		BaseURL:      server.URL,
		SharedSecret: "shared-secret",
		Timeout:      time.Second,
	}
	actuations, err := client.FetchWorkerAutoscalerActuations(t.Context(), 16)
	if err != nil {
		t.Fatalf("FetchWorkerAutoscalerActuations returned error: %v", err)
	}
	if capturedPath != "/api/internal/operator/runtime/autoscaler/actuations?limit=16" {
		t.Fatalf("path = %q", capturedPath)
	}
	if capturedSecret != "shared-secret" {
		t.Fatalf("secret = %q", capturedSecret)
	}
	if len(actuations) != 1 || actuations[0].ActuationID != "actuation-1" {
		t.Fatalf("actuations = %#v", actuations)
	}
}
