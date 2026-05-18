package observability

import (
	"strings"
	"testing"
	"time"
)

func TestMetricsPrometheusIncludesCountersAndDurations(t *testing.T) {
	metrics := NewMetrics()

	finish := metrics.BeginRequest("/api/v1/answer")
	finish(200, "supervisor_response", 120*time.Millisecond)
	metrics.RecordAdmissionDecision("queue_full", 0)
	metrics.RecordAdmissionDecision("admitted_queued", 12*time.Millisecond)
	metrics.RecordAdmissionDecisionForLane("rag", "admitted_queued", 8*time.Millisecond)
	metrics.RecordBridgeDuration(90 * time.Millisecond)
	metrics.RecordBridgeFailure("timeout")
	metrics.RecordBridgeSuccess()
	metrics.RecordCapabilityGate("campus_services", "structured_runtime", "closed")
	metrics.RecordRuntimeDecision(RuntimeDecisionLabels{
		Capability:            "knowledge",
		Lane:                  "rag",
		ScopeGate:             "out_of_scope",
		PolicyGate:            "out_of_scope",
		ContextPreflightState: "not_follow_up",
		RoutingNextAction:     "out_of_scope",
		PlanningOutcome:       "not_preplanned",
		TerminalOutcome:       "no_answer",
		FailCloseReason:       "product_scope_boundary",
	})

	output := string(metrics.Prometheus(AdmissionSnapshot{
		Lifecycle: LifecycleSnapshot{
			CompletedRetained: 2,
			CompletedByState: map[string]int{
				"completed": 1,
				"failed":    1,
			},
		},
		Telemetry: TelemetrySnapshot{
			DroppedCount:      3,
			ExportedCount:     5,
			FailedCount:       2,
			SampleRatio:       "0.25",
			MetricsEnabled:    true,
			MetricsConfigured: true,
		},
		ExecutionAudit: ExecutionAuditSnapshot{
			Enabled:      true,
			Configured:   true,
			EmittedCount: 7,
			FailedCount:  1,
		},
	}))

	expectedSnippets := []string{
		`campus_supervisor_api_requests_total{route="/api/v1/answer",outcome="supervisor_response",status_class="2xx"} 1`,
		`campus_supervisor_api_request_duration_ms_bucket{route="/api/v1/answer",le="250.000"} 1`,
		`campus_supervisor_api_request_duration_ms_count{route="/api/v1/answer"} 1`,
		`campus_supervisor_api_inflight_requests{route="/api/v1/answer"} 0`,
		`campus_supervisor_api_admission_decisions_total{decision="queue_full"} 1`,
		`campus_supervisor_api_admission_lane_decisions_total{lane="rag",decision="admitted_queued"} 1`,
		`campus_supervisor_api_admission_queue_wait_ms_count 2`,
		`campus_supervisor_api_admission_lane_queue_wait_ms_count{lane="rag"} 1`,
		`campus_supervisor_api_bridge_duration_ms_count 1`,
		`campus_supervisor_api_bridge_failures_total{kind="timeout"} 1`,
		`campus_supervisor_api_capability_gate_decisions_total{capability="campus_services",gate="structured_runtime",decision="closed"} 1`,
		`campus_supervisor_api_runtime_policy_decisions_total{capability="knowledge",lane="rag",scope_gate="out_of_scope",policy_gate="out_of_scope",context_preflight="not_follow_up",routing_next_action="out_of_scope",planning_outcome="not_preplanned",selected_target="none",selected_tool="none",terminal_outcome="no_answer",fail_close_reason="product_scope_boundary"} 1`,
		`campus_supervisor_api_lifecycle_completed_total{state="completed"} 1`,
		`campus_supervisor_api_lifecycle_completed_total{state="failed"} 1`,
		`campus_supervisor_api_telemetry_exported_total 5`,
		`campus_supervisor_api_telemetry_failed_total 2`,
		`campus_supervisor_api_telemetry_sample_ratio 0.25`,
		`campus_supervisor_api_telemetry_metrics_enabled 1`,
		`campus_supervisor_api_telemetry_metrics_exporter_configured 1`,
		`campus_supervisor_api_execution_audit_emitted_total 7`,
		`campus_supervisor_api_execution_audit_failed_total 1`,
		`campus_supervisor_api_execution_audit_enabled 1`,
		`campus_supervisor_api_execution_audit_configured 1`,
	}
	for _, snippet := range expectedSnippets {
		if !strings.Contains(output, snippet) {
			t.Fatalf("expected metrics output to contain %q, got:\n%s", snippet, output)
		}
	}
}

func TestBridgeRuntimeSnapshotTracksLastSuccessAndFailure(t *testing.T) {
	metrics := NewMetrics()

	metrics.RecordBridgeFailure("unavailable")
	metrics.RecordBridgeSuccess()

	snapshot := metrics.BridgeRuntimeSnapshot()
	if snapshot.LastAnswerFailureCode != "unavailable" {
		t.Fatalf(
			"LastAnswerFailureCode = %q, want unavailable",
			snapshot.LastAnswerFailureCode,
		)
	}
	if snapshot.LastAnswerFailureAt == "" {
		t.Fatal("expected LastAnswerFailureAt to be populated")
	}
	if snapshot.LastAnswerSuccessAt == "" {
		t.Fatal("expected LastAnswerSuccessAt to be populated")
	}
}
