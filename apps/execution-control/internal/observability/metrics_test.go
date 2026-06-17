package observability

import (
	"strings"
	"testing"
	"time"
)

func TestMetricsPrometheusIncludesCountersAndDurations(t *testing.T) {
	metrics := NewMetrics()

	finish := metrics.BeginRequest("/internal/execution/runs")
	finish(200, "execution_response", 120*time.Millisecond)
	metrics.RecordAdmissionDecision("queue_full", 0)
	metrics.RecordAdmissionDecision("admitted_queued", 12*time.Millisecond)
	metrics.RecordAdmissionDecisionForLane("rag", "admitted_queued", 8*time.Millisecond)
	metrics.RecordCapabilityGate("campus_services", "structured_runtime", "closed")
	metrics.RecordPersonalMemoryOperation("recall", "completed", "none", 34*time.Millisecond, 2, 128)
	metrics.RecordPersonalMemoryOperation("append", "failed", "hindsight_append_failed", 42*time.Millisecond, 0, 0)
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
		`campus_execution_control_requests_total{route="/internal/execution/runs",outcome="execution_response",status_class="2xx"} 1`,
		`campus_execution_control_request_duration_ms_bucket{route="/internal/execution/runs",le="250.000"} 1`,
		`campus_execution_control_request_duration_ms_count{route="/internal/execution/runs"} 1`,
		`campus_execution_control_inflight_requests{route="/internal/execution/runs"} 0`,
		`campus_execution_control_admission_decisions_total{decision="queue_full"} 1`,
		`campus_execution_control_admission_lane_decisions_total{lane="rag",decision="admitted_queued"} 1`,
		`campus_execution_control_admission_queue_wait_ms_count 2`,
		`campus_execution_control_admission_lane_queue_wait_ms_count{lane="rag"} 1`,
		`campus_execution_control_capability_gate_decisions_total{capability="campus_services",gate="structured_runtime",decision="closed"} 1`,
		`campus_execution_control_personal_memory_operations_total{operation="append",outcome="failed",failure_kind="hindsight_append_failed"} 1`,
		`campus_execution_control_personal_memory_operations_total{operation="recall",outcome="completed",failure_kind="none"} 1`,
		`campus_execution_control_personal_memory_operation_duration_ms_count{operation="recall"} 1`,
		`campus_execution_control_personal_memory_selected_items_count_bucket{operation="recall",le="5.000"} 1`,
		`campus_execution_control_personal_memory_selected_chars_count_bucket{operation="recall",le="250.000"} 1`,
		`campus_execution_control_runtime_policy_decisions_total{capability="knowledge",lane="rag",scope_gate="out_of_scope",policy_gate="out_of_scope",context_preflight="not_follow_up",routing_next_action="out_of_scope",planning_outcome="not_preplanned",selected_capability="none",selected_tool="none",terminal_outcome="no_answer",fail_close_reason="product_scope_boundary"} 1`,
		`campus_execution_control_lifecycle_completed_total{state="completed"} 1`,
		`campus_execution_control_lifecycle_completed_total{state="failed"} 1`,
		`campus_execution_control_telemetry_exported_total 5`,
		`campus_execution_control_telemetry_failed_total 2`,
		`campus_execution_control_telemetry_sample_ratio 0.25`,
		`campus_execution_control_telemetry_metrics_enabled 1`,
		`campus_execution_control_telemetry_metrics_exporter_configured 1`,
		`campus_execution_control_execution_audit_emitted_total 7`,
		`campus_execution_control_execution_audit_failed_total 1`,
		`campus_execution_control_execution_audit_enabled 1`,
		`campus_execution_control_execution_audit_configured 1`,
	}
	for _, snippet := range expectedSnippets {
		if !strings.Contains(output, snippet) {
			t.Fatalf("expected metrics output to contain %q, got:\n%s", snippet, output)
		}
	}
	retiredSnippets := []string{
		"campus_execution_control_bridge_duration_ms",
		"campus_execution_control_bridge_failures_total",
		"campus_execution_control_bridge_retries_total",
		"campus_execution_control_bridge_cancel_total",
		"campus_execution_control_bridge_circuit",
	}
	for _, snippet := range retiredSnippets {
		if strings.Contains(output, snippet) {
			t.Fatalf("metrics output must not expose retired bridge metric %q:\n%s", snippet, output)
		}
	}
}
