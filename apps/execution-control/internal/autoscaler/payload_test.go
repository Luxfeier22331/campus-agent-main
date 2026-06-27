package autoscaler

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBuildAppAPIRuntimePayloadKeepsSchemaAndSafeEvidence(t *testing.T) {
	input := TemporalRuntimeInput{
		Now: time.Date(2026, 6, 15, 10, 0, 5, 0, time.UTC),
		ReplicaCounts: map[string]int{
			"activity-worker-knowledge": 1,
		},
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-knowledge": {
				MaxReplicas: 3,
				MinReplicas: 1,
				TaskQueue:   "campus-agent.activity.knowledge",
			},
		},
		Snapshots: []TemporalTaskQueueSnapshot{{
			Backlog:       SourceMetric{State: SourceMetricUnsupported},
			SnapshotID:    "snapshot-1",
			TaskQueue:     "campus-agent.activity.knowledge",
			TaskQueueKind: TaskQueueKindActivity,
		}},
	}
	plan, err := PlanFromTemporalRuntime(input)
	if err != nil {
		t.Fatalf("PlanFromTemporalRuntime returned error: %v", err)
	}

	payload := BuildAppAPIRuntimePayload(input, plan)
	if payload.SchemaVersion != "temporal_task_queue_metrics_snapshot.v1" {
		t.Fatalf("schema = %q", payload.SchemaVersion)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	for _, forbidden := range []string{"rawTemporalResponse", "authorization", "cookie"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("payload contains forbidden field %q: %s", forbidden, body)
		}
	}
}

func TestAppAPIRuntimePayloadCarriesWorkerAutoscalerPostures(t *testing.T) {
	payload := AppAPIRuntimePayload{
		Postures: []WorkerAutoscalerPosture{{
			CurrentReplicas:  1,
			DesiredReplicas:  2,
			Evidence:         map[string]any{"hpaName": "keda-hpa-activity-worker-knowledge"},
			LastScaleEventAt: ptrString("2026-06-15T10:00:06Z"),
			LastScaleEventID: ptrString("hpa-scale-event-1"),
			MaxReplicas:      5,
			MetricFreshness:  SourceMetric{MS: ptrInt(15000), State: SourceMetricObserved},
			MinReplicas:      1,
			ObservedAt:       "2026-06-15T10:00:20Z",
			Reason:           "hpa_desired_replicas_above_current",
			ScalerKind:       ScalerKindKEDATemporal,
			ScalerStatus:     ScalerStatusHealthy,
			TargetService:    "activity-worker-knowledge",
			TaskQueue:        "campus-agent.activity.knowledge",
			TaskQueueKind:    TaskQueueKindActivity,
		}},
		SchemaVersion: SchemaVersion,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	if !strings.Contains(string(body), `"postures"`) ||
		!strings.Contains(string(body), `"scalerKind":"keda_temporal"`) ||
		!strings.Contains(string(body), `"metricFreshness":{"ms":15000,"state":"observed"}`) {
		t.Fatalf("posture payload not encoded correctly: %s", body)
	}
}

func ptrInt(value int) *int {
	return &value
}

func ptrString(value string) *string {
	return &value
}
