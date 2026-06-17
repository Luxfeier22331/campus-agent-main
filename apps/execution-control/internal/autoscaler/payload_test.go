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
			"activity-worker-knowledge-retrieval": 1,
		},
		ServicePolicies: map[string]ServicePolicy{
			"activity-worker-knowledge-retrieval": {
				MaxReplicas: 3,
				MinReplicas: 1,
				TaskQueue:   "campus-agent.activity.knowledge.retrieval",
			},
		},
		Snapshots: []TemporalTaskQueueSnapshot{{
			Backlog:       SourceMetric{State: SourceMetricUnsupported},
			SnapshotID:    "snapshot-1",
			TaskQueue:     "campus-agent.activity.knowledge.retrieval",
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
