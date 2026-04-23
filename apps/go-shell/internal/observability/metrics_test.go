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
	metrics.RecordTransportSaturated()
	metrics.RecordBridgeFailure("timeout")
	metrics.RecordBridgeSuccess()

	output := string(metrics.Prometheus())

	expectedSnippets := []string{
		`campus_go_shell_requests_total{route="/api/v1/answer",outcome="supervisor_response",status_class="2xx"} 1`,
		`campus_go_shell_request_duration_ms_bucket{route="/api/v1/answer",le="250.000"} 1`,
		`campus_go_shell_request_duration_ms_count{route="/api/v1/answer"} 1`,
		`campus_go_shell_inflight_requests{route="/api/v1/answer"} 0`,
		`campus_go_shell_transport_saturated_total 1`,
		`campus_go_shell_bridge_failures_total{kind="timeout"} 1`,
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
