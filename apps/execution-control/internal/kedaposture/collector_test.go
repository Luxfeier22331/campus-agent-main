package kedaposture

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/autoscaler"
)

func TestCollectorBuildsHealthyPostureFromDeploymentHPAAndScaledObject(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("authorization") != "Bearer test-token" {
			t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
		}
		switch request.URL.Path {
		case "/apis/apps/v1/namespaces/campus-agent-staging/deployments/activity-worker-knowledge-retrieval":
			writeJSON(t, response, map[string]any{
				"status": map[string]any{"replicas": 1, "readyReplicas": 1},
			})
		case "/apis/autoscaling/v2/namespaces/campus-agent-staging/horizontalpodautoscalers/keda-hpa-activity-worker-knowledge-retrieval":
			writeJSON(t, response, map[string]any{
				"spec": map[string]any{"minReplicas": 1, "maxReplicas": 5},
				"status": map[string]any{
					"conditions": []map[string]any{{
						"lastTransitionTime": "2026-06-15T10:00:05Z",
						"reason":             "SucceededGetScale",
						"status":             "True",
						"type":               "AbleToScale",
					}, {
						"lastTransitionTime": "2026-06-15T10:00:06Z",
						"reason":             "DesiredWithinRange",
						"status":             "True",
						"type":               "ScalingActive",
					}},
					"currentReplicas": 1,
					"desiredReplicas": 2,
				},
			})
		case "/apis/keda.sh/v1alpha1/namespaces/campus-agent-staging/scaledobjects/activity-worker-knowledge-retrieval":
			writeJSON(t, response, map[string]any{
				"metadata": map[string]any{"annotations": map[string]any{}},
				"status": map[string]any{
					"conditions": []map[string]any{{
						"message":            "Scaler ready",
						"reason":             "ScaledObjectReady",
						"status":             "True",
						"type":               "Ready",
						"lastTransitionTime": "2026-06-15T10:00:10Z",
					}},
					"lastActiveTime": "2026-06-15T10:00:10Z",
				},
			})
		case "/api/v1/namespaces/campus-agent-staging/events":
			if request.URL.Query().Get("fieldSelector") != "involvedObject.name=activity-worker-knowledge-retrieval" {
				t.Fatalf("field selector = %q", request.URL.Query().Get("fieldSelector"))
			}
			writeJSON(t, response, map[string]any{"items": []map[string]any{}})
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	collector := Collector{
		Client:    server.Client(),
		Now:       func() time.Time { return time.Date(2026, 6, 15, 10, 0, 20, 0, time.UTC) },
		ServerURL: server.URL,
		Token:     "test-token",
	}

	postures, err := collector.Collect(t.Context(), Config{
		Namespace: "campus-agent-staging",
		Targets: []Target{{
			MaxReplicas:   5,
			MinReplicas:   1,
			Name:          "activity-worker-knowledge-retrieval",
			QueueKind:     autoscaler.TaskQueueKindActivity,
			ScaledObject:  "activity-worker-knowledge-retrieval",
			TaskQueue:     "campus-agent.activity.knowledge.retrieval",
			TargetService: "activity-worker-knowledge-retrieval",
		}},
	})
	if err != nil {
		t.Fatalf("Collect returned error: %v", err)
	}
	if len(postures) != 1 {
		t.Fatalf("posture count = %d", len(postures))
	}
	posture := postures[0]
	if posture.ScalerStatus != autoscaler.ScalerStatusHealthy ||
		posture.Reason != "hpa_desired_replicas_above_current" ||
		posture.CurrentReplicas != 1 ||
		posture.DesiredReplicas != 2 ||
		posture.MetricFreshness.MS == nil ||
		*posture.MetricFreshness.MS != 10000 {
		t.Fatalf("posture = %#v", posture)
	}
	if posture.LastScaleEventAt == nil || *posture.LastScaleEventAt != "2026-06-15T10:00:06Z" {
		t.Fatalf("last scale event not derived from HPA condition: %#v", posture.LastScaleEventAt)
	}
	if posture.Evidence["scaledObjectReady"] != true ||
		posture.Evidence["hpaAbleToScale"] != true ||
		posture.Evidence["deploymentReadyReplicas"] != float64(1) {
		t.Fatalf("evidence = %#v", posture.Evidence)
	}
}

func TestCollectorMarksPausedScaledObject(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/apis/apps/v1/namespaces/campus-agent-staging/deployments/activity-worker-agent":
			writeJSON(t, response, map[string]any{
				"status": map[string]any{"replicas": 1, "readyReplicas": 1},
			})
		case "/apis/autoscaling/v2/namespaces/campus-agent-staging/horizontalpodautoscalers/keda-hpa-activity-worker-agent":
			writeJSON(t, response, map[string]any{
				"spec":   map[string]any{"minReplicas": 1, "maxReplicas": 3},
				"status": map[string]any{"currentReplicas": 1, "desiredReplicas": 1},
			})
		case "/apis/keda.sh/v1alpha1/namespaces/campus-agent-staging/scaledobjects/activity-worker-agent":
			writeJSON(t, response, map[string]any{
				"metadata": map[string]any{
					"annotations": map[string]any{
						"autoscaling.keda.sh/paused-replicas": "1",
					},
				},
				"status": map[string]any{"lastActiveTime": "2026-06-15T09:59:50Z"},
			})
		case "/api/v1/namespaces/campus-agent-staging/events":
			if request.URL.Query().Get("fieldSelector") != "involvedObject.name=activity-worker-agent" {
				t.Fatalf("field selector = %q", request.URL.Query().Get("fieldSelector"))
			}
			writeJSON(t, response, map[string]any{
				"items": []map[string]any{{
					"reason":        "ScaledObjectFallbackActivated",
					"type":          "Warning",
					"message":       "fallback should not override paused posture",
					"lastTimestamp": "2026-06-15T10:00:15Z",
				}},
			})
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	collector := Collector{
		Client:    server.Client(),
		Now:       func() time.Time { return time.Date(2026, 6, 15, 10, 0, 20, 0, time.UTC) },
		ServerURL: server.URL,
		Token:     "test-token",
	}

	postures, err := collector.Collect(t.Context(), Config{
		Namespace: "campus-agent-staging",
		Targets: []Target{{
			MaxReplicas:   3,
			MinReplicas:   1,
			Name:          "activity-worker-agent",
			QueueKind:     autoscaler.TaskQueueKindActivity,
			ScaledObject:  "activity-worker-agent",
			TaskQueue:     "campus-agent.activity.agent",
			TargetService: "activity-worker-agent",
		}},
	})
	if err != nil {
		t.Fatalf("Collect returned error: %v", err)
	}
	if postures[0].ScalerStatus != autoscaler.ScalerStatusPaused ||
		postures[0].Reason != "keda_scaledobject_paused" {
		t.Fatalf("posture = %#v", postures[0])
	}
}

func TestCollectorMarksKEDAFallbackEventDegraded(t *testing.T) {
	server := httptest.NewServer(healthyK8sPostureHandler(t, "activity-worker-knowledge-retrieval", []map[string]any{{
		"reason":        "ScaledObjectFallbackActivated",
		"type":          "Warning",
		"message":       "fallback active for temporal scaler",
		"lastTimestamp": "2026-06-15T10:00:16Z",
	}}))
	defer server.Close()

	postures := collectSinglePosture(t, server, "activity-worker-knowledge-retrieval")
	posture := postures[0]
	if posture.ScalerStatus != autoscaler.ScalerStatusDegraded ||
		posture.Reason != "keda_fallback_active" {
		t.Fatalf("posture = %#v", posture)
	}
	if posture.LastScaleEventAt == nil || *posture.LastScaleEventAt != "2026-06-15T10:00:16Z" {
		t.Fatalf("last scale event not derived from KEDA event: %#v", posture.LastScaleEventAt)
	}
	if posture.Evidence["kedaEventReason"] != "ScaledObjectFallbackActivated" ||
		posture.Evidence["kedaEventType"] != "Warning" ||
		posture.Evidence["kedaEventAt"] != "2026-06-15T10:00:16Z" ||
		posture.Evidence["kedaEventMessage"] != "fallback active for temporal scaler" {
		t.Fatalf("evidence = %#v", posture.Evidence)
	}
}

func TestCollectorMarksKEDAMetricFailureEventDegraded(t *testing.T) {
	server := httptest.NewServer(healthyK8sPostureHandler(t, "activity-worker-knowledge-retrieval", []map[string]any{{
		"reason":    "KEDAMetricSourceFailed",
		"type":      "Warning",
		"message":   "temporal metric source failed",
		"eventTime": "2026-06-15T10:00:17Z",
	}}))
	defer server.Close()

	postures := collectSinglePosture(t, server, "activity-worker-knowledge-retrieval")
	posture := postures[0]
	if posture.ScalerStatus != autoscaler.ScalerStatusDegraded ||
		posture.Reason != "keda_metric_source_failed" {
		t.Fatalf("posture = %#v", posture)
	}
	if posture.LastScaleEventAt == nil || *posture.LastScaleEventAt != "2026-06-15T10:00:17Z" {
		t.Fatalf("last scale event not derived from KEDA event: %#v", posture.LastScaleEventAt)
	}
}

func TestCollectorFailsClosedWhenEventsCannotBeRead(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/apis/apps/v1/namespaces/campus-agent-staging/deployments/activity-worker-knowledge-retrieval":
			writeJSON(t, response, map[string]any{
				"status": map[string]any{"replicas": 1, "readyReplicas": 1},
			})
		case "/apis/autoscaling/v2/namespaces/campus-agent-staging/horizontalpodautoscalers/keda-hpa-activity-worker-knowledge-retrieval":
			writeJSON(t, response, map[string]any{
				"spec": map[string]any{"minReplicas": 1, "maxReplicas": 5},
				"status": map[string]any{
					"conditions": []map[string]any{{
						"lastTransitionTime": "2026-06-15T10:00:06Z",
						"reason":             "DesiredWithinRange",
						"status":             "True",
						"type":               "ScalingActive",
					}},
					"currentReplicas": 1,
					"desiredReplicas": 1,
				},
			})
		case "/apis/keda.sh/v1alpha1/namespaces/campus-agent-staging/scaledobjects/activity-worker-knowledge-retrieval":
			writeJSON(t, response, map[string]any{
				"metadata": map[string]any{"annotations": map[string]any{}},
				"status": map[string]any{
					"conditions": []map[string]any{{
						"reason": "ScaledObjectReady",
						"status": "True",
						"type":   "Ready",
					}},
					"lastActiveTime": "2026-06-15T10:00:10Z",
				},
			})
		case "/api/v1/namespaces/campus-agent-staging/events":
			http.Error(response, "event list unavailable", http.StatusInternalServerError)
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	collector := Collector{
		Client:    server.Client(),
		Now:       func() time.Time { return time.Date(2026, 6, 15, 10, 0, 20, 0, time.UTC) },
		ServerURL: server.URL,
		Token:     "test-token",
	}

	_, err := collector.Collect(t.Context(), Config{
		Namespace: "campus-agent-staging",
		Targets: []Target{{
			MaxReplicas:   5,
			MinReplicas:   1,
			Name:          "activity-worker-knowledge-retrieval",
			QueueKind:     autoscaler.TaskQueueKindActivity,
			ScaledObject:  "activity-worker-knowledge-retrieval",
			TaskQueue:     "campus-agent.activity.knowledge.retrieval",
			TargetService: "activity-worker-knowledge-retrieval",
		}},
	})
	if err == nil {
		t.Fatal("Collect returned nil error")
	}
}

func healthyK8sPostureHandler(t *testing.T, name string, events []map[string]any) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("authorization") != "Bearer test-token" {
			t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
		}
		switch request.URL.Path {
		case "/apis/apps/v1/namespaces/campus-agent-staging/deployments/" + name:
			writeJSON(t, response, map[string]any{
				"status": map[string]any{"replicas": 1, "readyReplicas": 1},
			})
		case "/apis/autoscaling/v2/namespaces/campus-agent-staging/horizontalpodautoscalers/keda-hpa-" + name:
			writeJSON(t, response, map[string]any{
				"spec": map[string]any{"minReplicas": 1, "maxReplicas": 5},
				"status": map[string]any{
					"conditions": []map[string]any{{
						"lastTransitionTime": "2026-06-15T10:00:05Z",
						"reason":             "SucceededGetScale",
						"status":             "True",
						"type":               "AbleToScale",
					}, {
						"lastTransitionTime": "2026-06-15T10:00:06Z",
						"reason":             "DesiredWithinRange",
						"status":             "True",
						"type":               "ScalingActive",
					}},
					"currentReplicas": 1,
					"desiredReplicas": 1,
				},
			})
		case "/apis/keda.sh/v1alpha1/namespaces/campus-agent-staging/scaledobjects/" + name:
			writeJSON(t, response, map[string]any{
				"metadata": map[string]any{"annotations": map[string]any{}},
				"status": map[string]any{
					"conditions": []map[string]any{{
						"message":            "Scaler ready",
						"reason":             "ScaledObjectReady",
						"status":             "True",
						"type":               "Ready",
						"lastTransitionTime": "2026-06-15T10:00:10Z",
					}},
					"lastActiveTime": "2026-06-15T10:00:10Z",
				},
			})
		case "/api/v1/namespaces/campus-agent-staging/events":
			if request.URL.Query().Get("fieldSelector") != "involvedObject.name="+name {
				t.Fatalf("field selector = %q", request.URL.Query().Get("fieldSelector"))
			}
			writeJSON(t, response, map[string]any{"items": events})
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	})
}

func collectSinglePosture(t *testing.T, server *httptest.Server, name string) []autoscaler.WorkerAutoscalerPosture {
	t.Helper()
	collector := Collector{
		Client:    server.Client(),
		Now:       func() time.Time { return time.Date(2026, 6, 15, 10, 0, 20, 0, time.UTC) },
		ServerURL: server.URL,
		Token:     "test-token",
	}
	postures, err := collector.Collect(t.Context(), Config{
		Namespace: "campus-agent-staging",
		Targets: []Target{{
			MaxReplicas:   5,
			MinReplicas:   1,
			Name:          name,
			QueueKind:     autoscaler.TaskQueueKindActivity,
			ScaledObject:  name,
			TaskQueue:     "campus-agent.activity.knowledge.retrieval",
			TargetService: name,
		}},
	})
	if err != nil {
		t.Fatalf("Collect returned error: %v", err)
	}
	if len(postures) != 1 {
		t.Fatalf("posture count = %d", len(postures))
	}
	return postures
}

func writeJSON(t *testing.T, response http.ResponseWriter, value any) {
	t.Helper()
	response.Header().Set("content-type", "application/json")
	if err := json.NewEncoder(response).Encode(value); err != nil {
		t.Fatalf("encode response: %v", err)
	}
}
