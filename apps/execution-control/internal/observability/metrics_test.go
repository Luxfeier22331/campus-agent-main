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
	metrics.RecordAdmissionDecisionForGroup("primary_agent", "admitted_queued", 8*time.Millisecond)
	metrics.RecordToolGate("transport_schedule_lookup", "tool_read_model_runtime", "closed")
	metrics.RecordPersonalMemoryOperation("recall", "completed", "none", 34*time.Millisecond, 2, 128)
	metrics.RecordPersonalMemoryOperation("append", "failed", "hindsight_append_failed", 42*time.Millisecond, 0, 0)

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
			SubmittedCount:    5,
			FailedCount:       2,
			SampleRatio:       "0.25",
			MetricsEnabled:    true,
			MetricsConfigured: true,
		},
	}))

	expectedSnippets := []string{
		`campus_execution_control_requests_total{route="/internal/execution/runs",outcome="execution_response",status_class="2xx"} 1`,
		`campus_execution_control_request_duration_ms_bucket{route="/internal/execution/runs",le="250.000"} 1`,
		`campus_execution_control_request_duration_ms_count{route="/internal/execution/runs"} 1`,
		`campus_execution_control_inflight_requests{route="/internal/execution/runs"} 0`,
		`campus_execution_control_admission_decisions_total{decision="queue_full"} 1`,
		`campus_execution_control_admission_group_decisions_total{group="primary_agent",decision="admitted_queued"} 1`,
		`campus_execution_control_admission_queue_wait_ms_count 2`,
		`campus_execution_control_admission_group_queue_wait_ms_count{group="primary_agent"} 1`,
		`campus_execution_control_tool_gate_decisions_total{tool="transport_schedule_lookup",gate="tool_read_model_runtime",decision="closed"} 1`,
		`campus_execution_control_personal_memory_operations_total{operation="append",outcome="failed",failure_kind="hindsight_append_failed"} 1`,
		`campus_execution_control_personal_memory_operations_total{operation="recall",outcome="completed",failure_kind="none"} 1`,
		`campus_execution_control_personal_memory_operation_duration_ms_count{operation="recall"} 1`,
		`campus_execution_control_personal_memory_selected_items_count_bucket{operation="recall",le="5.000"} 1`,
		`campus_execution_control_personal_memory_selected_chars_count_bucket{operation="recall",le="250.000"} 1`,
		`campus_execution_control_lifecycle_completed_total{state="completed"} 1`,
		`campus_execution_control_lifecycle_completed_total{state="failed"} 1`,
		`campus_execution_control_telemetry_submitted_total 5`,
		`campus_execution_control_telemetry_failed_total 2`,
		`campus_execution_control_telemetry_sample_ratio 0.25`,
		`campus_execution_control_telemetry_metrics_enabled 1`,
		`campus_execution_control_telemetry_metrics_exporter_configured 1`,
	}
	for _, snippet := range expectedSnippets {
		if !strings.Contains(output, snippet) {
			t.Fatalf("expected metrics output to contain %q, got:\n%s", snippet, output)
		}
	}
	retiredSnippets := []string{
		"campus_execution_control_activity_duration_ms",
		"campus_execution_control_bridge_failures_total",
		"campus_execution_control_bridge_retries_total",
		"campus_execution_control_cancel_delivery_total",
		"campus_execution_control_bridge_circuit",
	}
	for _, snippet := range retiredSnippets {
		if strings.Contains(output, snippet) {
			t.Fatalf("metrics output must not expose retired runtime metric %q:\n%s", snippet, output)
		}
	}
}
