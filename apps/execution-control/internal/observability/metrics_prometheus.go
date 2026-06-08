package observability

import (
	"fmt"
	"strings"
)

func (m *Metrics) Prometheus(admissionSnapshots ...AdmissionSnapshot) []byte {
	m.mu.Lock()
	defer m.mu.Unlock()

	var builder strings.Builder

	builder.WriteString("# HELP campus_execution_control_requests_total Total requests handled by execution-control.\n")
	builder.WriteString("# TYPE campus_execution_control_requests_total counter\n")
	for _, key := range sortedRequestKeys(m.requestTotals) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_requests_total{route=%q,outcome=%q,status_class=%q} %d\n",
			key.Route,
			key.Outcome,
			key.StatusClass,
			m.requestTotals[key],
		)
	}

	builder.WriteString("# HELP campus_execution_control_request_duration_ms Request duration in milliseconds.\n")
	builder.WriteString("# TYPE campus_execution_control_request_duration_ms histogram\n")
	for _, route := range sortedRoutes(m.requestDurations) {
		histogram := m.requestDurations[route]
		for index, bound := range durationBucketsMS {
			fmt.Fprintf(
				&builder,
				"campus_execution_control_request_duration_ms_bucket{route=%q,le=%q} %d\n",
				route,
				formatFloat(bound),
				histogram.Buckets[index],
			)
		}
		fmt.Fprintf(
			&builder,
			"campus_execution_control_request_duration_ms_bucket{route=%q,le=\"+Inf\"} %d\n",
			route,
			histogram.Count,
		)
		fmt.Fprintf(
			&builder,
			"campus_execution_control_request_duration_ms_sum{route=%q} %s\n",
			route,
			formatFloat(histogram.SumMS),
		)
		fmt.Fprintf(
			&builder,
			"campus_execution_control_request_duration_ms_count{route=%q} %d\n",
			route,
			histogram.Count,
		)
	}

	builder.WriteString("# HELP campus_execution_control_inflight_requests Current inflight requests by route.\n")
	builder.WriteString("# TYPE campus_execution_control_inflight_requests gauge\n")
	for _, route := range sortedRoutesInt64(m.inflight) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_inflight_requests{route=%q} %d\n",
			route,
			m.inflight[route],
		)
	}

	builder.WriteString("# HELP campus_execution_control_admission_decisions_total Total admission decisions by decision.\n")
	builder.WriteString("# TYPE campus_execution_control_admission_decisions_total counter\n")
	for _, decision := range sortedStringKeys(m.admissionDecisionTotals) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_admission_decisions_total{decision=%q} %d\n",
			decision,
			m.admissionDecisionTotals[decision],
		)
	}
	builder.WriteString("# HELP campus_execution_control_admission_lane_decisions_total Total admission decisions by lane and decision.\n")
	builder.WriteString("# TYPE campus_execution_control_admission_lane_decisions_total counter\n")
	for _, key := range sortedLaneDecisionKeys(m.laneDecisionTotals) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_admission_lane_decisions_total{lane=%q,decision=%q} %d\n",
			key.Lane,
			key.Decision,
			m.laneDecisionTotals[key],
		)
	}

	snapshot := AdmissionSnapshot{}
	if len(admissionSnapshots) > 0 {
		snapshot = admissionSnapshots[0]
	}
	builder.WriteString("# HELP campus_execution_control_admission_active Current active admitted answer executions.\n")
	builder.WriteString("# TYPE campus_execution_control_admission_active gauge\n")
	fmt.Fprintf(&builder, "campus_execution_control_admission_active %d\n", snapshot.Active)
	builder.WriteString("# HELP campus_execution_control_admission_queue_depth Current queued answer executions.\n")
	builder.WriteString("# TYPE campus_execution_control_admission_queue_depth gauge\n")
	fmt.Fprintf(&builder, "campus_execution_control_admission_queue_depth %d\n", snapshot.Queued)
	builder.WriteString("# HELP campus_execution_control_admission_queue_capacity Configured queued answer execution capacity.\n")
	builder.WriteString("# TYPE campus_execution_control_admission_queue_capacity gauge\n")
	fmt.Fprintf(&builder, "campus_execution_control_admission_queue_capacity %d\n", snapshot.QueueCapacity)
	builder.WriteString("# HELP campus_execution_control_shutdown_draining Whether execution-control is draining and rejecting new executions.\n")
	builder.WriteString("# TYPE campus_execution_control_shutdown_draining gauge\n")
	if snapshot.Draining {
		builder.WriteString("campus_execution_control_shutdown_draining 1\n")
	} else {
		builder.WriteString("campus_execution_control_shutdown_draining 0\n")
	}
	if len(snapshot.Lanes) > 0 {
		builder.WriteString("# HELP campus_execution_control_admission_lane_active Current active admitted answer executions by lane.\n")
		builder.WriteString("# TYPE campus_execution_control_admission_lane_active gauge\n")
		for _, lane := range sortedAdmissionLaneNames(snapshot.Lanes) {
			fmt.Fprintf(
				&builder,
				"campus_execution_control_admission_lane_active{lane=%q} %d\n",
				lane,
				snapshot.Lanes[lane].Active,
			)
		}
		builder.WriteString("# HELP campus_execution_control_admission_lane_queue_depth Current queued answer executions by lane.\n")
		builder.WriteString("# TYPE campus_execution_control_admission_lane_queue_depth gauge\n")
		for _, lane := range sortedAdmissionLaneNames(snapshot.Lanes) {
			fmt.Fprintf(
				&builder,
				"campus_execution_control_admission_lane_queue_depth{lane=%q} %d\n",
				lane,
				snapshot.Lanes[lane].Queued,
			)
		}
		builder.WriteString("# HELP campus_execution_control_admission_lane_queue_capacity Configured queued answer execution capacity by lane.\n")
		builder.WriteString("# TYPE campus_execution_control_admission_lane_queue_capacity gauge\n")
		for _, lane := range sortedAdmissionLaneNames(snapshot.Lanes) {
			fmt.Fprintf(
				&builder,
				"campus_execution_control_admission_lane_queue_capacity{lane=%q} %d\n",
				lane,
				snapshot.Lanes[lane].QueueCapacity,
			)
		}
	}

	writeHistogram(
		&builder,
		"campus_execution_control_admission_queue_wait_ms",
		"Admission queue wait duration in milliseconds.",
		m.admissionWaitDurations,
	)
	writeHistogram(
		&builder,
		"campus_execution_control_bridge_duration_ms",
		"Supervisor Python bridge duration in milliseconds.",
		m.bridgeDurations,
	)
	for _, lane := range sortedRoutes(m.laneWaitDurations) {
		writeHistogramWithLabel(
			&builder,
			"campus_execution_control_admission_lane_queue_wait_ms",
			"Admission queue wait duration in milliseconds by lane.",
			"lane",
			lane,
			m.laneWaitDurations[lane],
		)
	}

	builder.WriteString("# HELP campus_execution_control_bridge_failures_total Total bridge failures by kind.\n")
	builder.WriteString("# TYPE campus_execution_control_bridge_failures_total counter\n")
	for _, kind := range sortedStringKeys(m.bridgeFailureTotals) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_bridge_failures_total{kind=%q} %d\n",
			kind,
			m.bridgeFailureTotals[kind],
		)
	}
	builder.WriteString("# HELP campus_execution_control_bridge_retries_total Total bridge execution retry attempts by failure kind.\n")
	builder.WriteString("# TYPE campus_execution_control_bridge_retries_total counter\n")
	for _, kind := range sortedStringKeys(m.bridgeRetryTotals) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_bridge_retries_total{kind=%q} %d\n",
			kind,
			m.bridgeRetryTotals[kind],
		)
	}
	builder.WriteString("# HELP campus_execution_control_bridge_cancel_total Total cooperative cancel bridge attempts by outcome.\n")
	builder.WriteString("# TYPE campus_execution_control_bridge_cancel_total counter\n")
	for _, outcome := range sortedStringKeys(m.bridgeCancelTotals) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_bridge_cancel_total{outcome=%q} %d\n",
			outcome,
			m.bridgeCancelTotals[outcome],
		)
	}
	builder.WriteString("# HELP campus_execution_control_bridge_circuit_state Current bridge circuit breaker state.\n")
	builder.WriteString("# TYPE campus_execution_control_bridge_circuit_state gauge\n")
	for _, state := range []string{"closed", "open", "half_open"} {
		value := 0
		if snapshot.BridgeCircuit.State == state {
			value = 1
		}
		fmt.Fprintf(
			&builder,
			"campus_execution_control_bridge_circuit_state{state=%q} %d\n",
			state,
			value,
		)
	}
	builder.WriteString("# HELP campus_execution_control_bridge_circuit_open_total Total bridge circuit breaker open transitions.\n")
	builder.WriteString("# TYPE campus_execution_control_bridge_circuit_open_total counter\n")
	fmt.Fprintf(&builder, "campus_execution_control_bridge_circuit_open_total %d\n", snapshot.BridgeCircuit.OpenCount)
	builder.WriteString("# HELP campus_execution_control_bridge_circuit_rejected_total Total bridge executions rejected by the circuit breaker.\n")
	builder.WriteString("# TYPE campus_execution_control_bridge_circuit_rejected_total counter\n")
	fmt.Fprintf(&builder, "campus_execution_control_bridge_circuit_rejected_total %d\n", snapshot.BridgeCircuit.RejectedCount)
	builder.WriteString("# HELP campus_execution_control_structured_query_requests_total Total structured query requests by tool and outcome.\n")
	builder.WriteString("# TYPE campus_execution_control_structured_query_requests_total counter\n")
	for _, key := range sortedStructuredQueryKeys(m.structuredQueryTotals) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_structured_query_requests_total{tool=%q,outcome=%q,status_class=%q} %d\n",
			key.Tool,
			key.Outcome,
			key.StatusClass,
			m.structuredQueryTotals[key],
		)
	}
	builder.WriteString("# HELP campus_execution_control_capability_gate_decisions_total Total capability gate decisions by capability and gate.\n")
	builder.WriteString("# TYPE campus_execution_control_capability_gate_decisions_total counter\n")
	for _, key := range sortedCapabilityGateKeys(m.capabilityGateTotals) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_capability_gate_decisions_total{capability=%q,gate=%q,decision=%q} %d\n",
			key.Capability,
			key.Gate,
			key.Decision,
			m.capabilityGateTotals[key],
		)
	}
	builder.WriteString("# HELP campus_execution_control_runtime_policy_decisions_total Total Go runtime policy decisions by bounded decision labels.\n")
	builder.WriteString("# TYPE campus_execution_control_runtime_policy_decisions_total counter\n")
	for _, key := range sortedRuntimeDecisionKeys(m.runtimeDecisionTotals) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_runtime_policy_decisions_total{capability=%q,lane=%q,scope_gate=%q,policy_gate=%q,context_preflight=%q,routing_next_action=%q,planning_outcome=%q,selected_target=%q,selected_tool=%q,terminal_outcome=%q,fail_close_reason=%q} %d\n",
			key.Capability,
			key.Lane,
			key.ScopeGate,
			key.PolicyGate,
			key.ContextPreflightState,
			key.RoutingNextAction,
			key.PlanningOutcome,
			key.SelectedTarget,
			key.SelectedTool,
			key.TerminalOutcome,
			key.FailCloseReason,
			m.runtimeDecisionTotals[key],
		)
	}
	builder.WriteString("# HELP campus_execution_control_lifecycle_active_executions Current registered executions.\n")
	builder.WriteString("# TYPE campus_execution_control_lifecycle_active_executions gauge\n")
	fmt.Fprintf(&builder, "campus_execution_control_lifecycle_active_executions %d\n", snapshot.Lifecycle.ActiveExecutions)
	builder.WriteString("# HELP campus_execution_control_lifecycle_cancel_requested_total Total explicit cancel requests accepted by execution-control.\n")
	builder.WriteString("# TYPE campus_execution_control_lifecycle_cancel_requested_total counter\n")
	fmt.Fprintf(&builder, "campus_execution_control_lifecycle_cancel_requested_total %d\n", snapshot.Lifecycle.CancelRequestedCount)
	builder.WriteString("# HELP campus_execution_control_lifecycle_completed_retained_total Total completed execution lifecycle records.\n")
	builder.WriteString("# TYPE campus_execution_control_lifecycle_completed_retained_total counter\n")
	fmt.Fprintf(&builder, "campus_execution_control_lifecycle_completed_retained_total %d\n", snapshot.Lifecycle.CompletedRetained)
	builder.WriteString("# HELP campus_execution_control_lifecycle_completed_total Total completed execution lifecycle records by final state.\n")
	builder.WriteString("# TYPE campus_execution_control_lifecycle_completed_total counter\n")
	for _, state := range sortedStringKeys(snapshot.Lifecycle.CompletedByState) {
		fmt.Fprintf(
			&builder,
			"campus_execution_control_lifecycle_completed_total{state=%q} %d\n",
			state,
			snapshot.Lifecycle.CompletedByState[state],
		)
	}
	builder.WriteString("# HELP campus_execution_control_telemetry_dropped_total Total telemetry events dropped by execution-control.\n")
	builder.WriteString("# TYPE campus_execution_control_telemetry_dropped_total counter\n")
	fmt.Fprintf(&builder, "campus_execution_control_telemetry_dropped_total %d\n", snapshot.Telemetry.DroppedCount)
	builder.WriteString("# HELP campus_execution_control_telemetry_exported_total Total telemetry spans exported by execution-control.\n")
	builder.WriteString("# TYPE campus_execution_control_telemetry_exported_total counter\n")
	fmt.Fprintf(&builder, "campus_execution_control_telemetry_exported_total %d\n", snapshot.Telemetry.ExportedCount)
	builder.WriteString("# HELP campus_execution_control_telemetry_failed_total Total telemetry exporter failures observed by execution-control.\n")
	builder.WriteString("# TYPE campus_execution_control_telemetry_failed_total counter\n")
	fmt.Fprintf(&builder, "campus_execution_control_telemetry_failed_total %d\n", snapshot.Telemetry.FailedCount)
	builder.WriteString("# HELP campus_execution_control_telemetry_sample_ratio Configured execution-control OTel sample ratio.\n")
	builder.WriteString("# TYPE campus_execution_control_telemetry_sample_ratio gauge\n")
	fmt.Fprintf(&builder, "campus_execution_control_telemetry_sample_ratio %s\n", defaultMetricNumber(snapshot.Telemetry.SampleRatio))
	builder.WriteString("# HELP campus_execution_control_telemetry_enabled Whether OTel telemetry is enabled.\n")
	builder.WriteString("# TYPE campus_execution_control_telemetry_enabled gauge\n")
	if snapshot.Telemetry.Enabled {
		builder.WriteString("campus_execution_control_telemetry_enabled 1\n")
	} else {
		builder.WriteString("campus_execution_control_telemetry_enabled 0\n")
	}
	builder.WriteString("# HELP campus_execution_control_telemetry_exporter_configured Whether OTel exporter is configured.\n")
	builder.WriteString("# TYPE campus_execution_control_telemetry_exporter_configured gauge\n")
	if snapshot.Telemetry.ExporterConfigured {
		builder.WriteString("campus_execution_control_telemetry_exporter_configured 1\n")
	} else {
		builder.WriteString("campus_execution_control_telemetry_exporter_configured 0\n")
	}
	builder.WriteString("# HELP campus_execution_control_telemetry_metrics_enabled Whether OTel metrics export is enabled.\n")
	builder.WriteString("# TYPE campus_execution_control_telemetry_metrics_enabled gauge\n")
	if snapshot.Telemetry.MetricsEnabled {
		builder.WriteString("campus_execution_control_telemetry_metrics_enabled 1\n")
	} else {
		builder.WriteString("campus_execution_control_telemetry_metrics_enabled 0\n")
	}
	builder.WriteString("# HELP campus_execution_control_telemetry_metrics_exporter_configured Whether OTel metrics exporter is configured.\n")
	builder.WriteString("# TYPE campus_execution_control_telemetry_metrics_exporter_configured gauge\n")
	if snapshot.Telemetry.MetricsConfigured {
		builder.WriteString("campus_execution_control_telemetry_metrics_exporter_configured 1\n")
	} else {
		builder.WriteString("campus_execution_control_telemetry_metrics_exporter_configured 0\n")
	}
	builder.WriteString("# HELP campus_execution_control_execution_audit_emitted_total Total execution audit events accepted by execution-control emitter.\n")
	builder.WriteString("# TYPE campus_execution_control_execution_audit_emitted_total counter\n")
	fmt.Fprintf(&builder, "campus_execution_control_execution_audit_emitted_total %d\n", snapshot.ExecutionAudit.EmittedCount)
	builder.WriteString("# HELP campus_execution_control_execution_audit_failed_total Total execution audit delivery failures.\n")
	builder.WriteString("# TYPE campus_execution_control_execution_audit_failed_total counter\n")
	fmt.Fprintf(&builder, "campus_execution_control_execution_audit_failed_total %d\n", snapshot.ExecutionAudit.FailedCount)
	builder.WriteString("# HELP campus_execution_control_execution_audit_enabled Whether execution audit emission is enabled.\n")
	builder.WriteString("# TYPE campus_execution_control_execution_audit_enabled gauge\n")
	if snapshot.ExecutionAudit.Enabled {
		builder.WriteString("campus_execution_control_execution_audit_enabled 1\n")
	} else {
		builder.WriteString("campus_execution_control_execution_audit_enabled 0\n")
	}
	builder.WriteString("# HELP campus_execution_control_execution_audit_configured Whether execution audit emission is configured.\n")
	builder.WriteString("# TYPE campus_execution_control_execution_audit_configured gauge\n")
	if snapshot.ExecutionAudit.Configured {
		builder.WriteString("campus_execution_control_execution_audit_configured 1\n")
	} else {
		builder.WriteString("campus_execution_control_execution_audit_configured 0\n")
	}

	return []byte(builder.String())
}
