package observability

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

var durationBucketsMS = []float64{
	10,
	25,
	50,
	100,
	250,
	500,
	1_000,
	2_500,
	5_000,
	10_000,
	30_000,
}

type requestKey struct {
	Route       string
	Outcome     string
	StatusClass string
}

type routeHistogram struct {
	Buckets []uint64
	Count   uint64
	SumMS   float64
}

type AdmissionSnapshot struct {
	Active         int
	Queued         int
	QueueCapacity  int
	Draining       bool
	Lanes          map[string]AdmissionLaneSnapshot
	Lifecycle      LifecycleSnapshot
	BridgeCircuit  BridgeCircuitSnapshot
	Telemetry      TelemetrySnapshot
	ExecutionAudit ExecutionAuditSnapshot
}

type AdmissionLaneSnapshot struct {
	Active        int
	Queued        int
	QueueCapacity int
}

type LifecycleSnapshot struct {
	ActiveExecutions     int
	CancelRequestedCount int
	CompletedRetained    int
	CompletedByState     map[string]int
}

type TelemetrySnapshot struct {
	Enabled            bool
	ExporterConfigured bool
	ExportedCount      uint64
	DroppedCount       uint64
	FailedCount        uint64
	SampleRatio        string
	LastError          string
}

type ExecutionAuditSnapshot struct {
	Enabled           bool
	Configured        bool
	QueueDepth        int
	BatchSize         int
	EmittedCount      uint64
	DroppedCount      uint64
	FailedCount       uint64
	RetriedCount      uint64
	SpooledCount      uint64
	SpoolDrainedCount uint64
	SpoolDroppedCount uint64
	SpoolEnabled      bool
	LastError         string
}

type BridgeRuntimeSnapshot struct {
	LastAnswerFailureCode string
	LastAnswerFailureAt   string
	LastAnswerSuccessAt   string
}

type BridgeCircuitSnapshot struct {
	State         string
	OpenCount     uint64
	RejectedCount uint64
}

type laneDecisionKey struct {
	Lane     string
	Decision string
}

type structuredQueryKey struct {
	Tool        string
	Outcome     string
	StatusClass string
}

type capabilityGateKey struct {
	Capability string
	Gate       string
	Decision   string
}

type RuntimeDecisionLabels struct {
	Capability            string
	Lane                  string
	ScopeGate             string
	PolicyGate            string
	ContextPreflightState string
	RoutingNextAction     string
	PlanningOutcome       string
}

type runtimeDecisionKey struct {
	Capability            string
	Lane                  string
	ScopeGate             string
	PolicyGate            string
	ContextPreflightState string
	RoutingNextAction     string
	PlanningOutcome       string
}

type Metrics struct {
	mu sync.Mutex

	inflight                map[string]int64
	requestTotals           map[requestKey]uint64
	requestDurations        map[string]*routeHistogram
	admissionDecisionTotals map[string]uint64
	laneDecisionTotals      map[laneDecisionKey]uint64
	admissionWaitDurations  *routeHistogram
	laneWaitDurations       map[string]*routeHistogram
	bridgeDurations         *routeHistogram
	bridgeFailureTotals     map[string]uint64
	bridgeCancelTotals      map[string]uint64
	structuredQueryTotals   map[structuredQueryKey]uint64
	capabilityGateTotals    map[capabilityGateKey]uint64
	runtimeDecisionTotals   map[runtimeDecisionKey]uint64
	lastAnswerFailureCode   string
	lastAnswerFailureAt     time.Time
	lastAnswerSuccessAt     time.Time
}

func NewMetrics() *Metrics {
	return &Metrics{
		inflight:         make(map[string]int64),
		requestTotals:    make(map[requestKey]uint64),
		requestDurations: make(map[string]*routeHistogram),
		admissionDecisionTotals: map[string]uint64{
			"admitted_immediate": 0,
			"admitted_queued":    0,
			"queue_full":         0,
			"queue_timeout":      0,
			"lane_queue_full":    0,
			"lane_queue_timeout": 0,
			"client_canceled":    0,
			"draining":           0,
		},
		laneDecisionTotals:     make(map[laneDecisionKey]uint64),
		admissionWaitDurations: newHistogram(),
		laneWaitDurations:      make(map[string]*routeHistogram),
		bridgeDurations:        newHistogram(),
		bridgeFailureTotals: map[string]uint64{
			"timeout":          0,
			"unavailable":      0,
			"invalid_response": 0,
		},
		bridgeCancelTotals: map[string]uint64{
			"accepted":       0,
			"not_found":      0,
			"not_configured": 0,
			"failed":         0,
		},
		structuredQueryTotals: make(map[structuredQueryKey]uint64),
		capabilityGateTotals:  make(map[capabilityGateKey]uint64),
		runtimeDecisionTotals: make(map[runtimeDecisionKey]uint64),
	}
}

func (m *Metrics) BeginRequest(route string) func(statusCode int, outcome string, duration time.Duration) {
	m.mu.Lock()
	m.inflight[route]++
	m.mu.Unlock()

	return func(statusCode int, outcome string, duration time.Duration) {
		m.mu.Lock()
		defer m.mu.Unlock()

		if current := m.inflight[route]; current > 0 {
			m.inflight[route] = current - 1
		}

		key := requestKey{
			Route:       route,
			Outcome:     outcome,
			StatusClass: statusClass(statusCode),
		}
		m.requestTotals[key]++

		histogram := m.requestDurations[route]
		if histogram == nil {
			histogram = &routeHistogram{
				Buckets: make([]uint64, len(durationBucketsMS)),
			}
			m.requestDurations[route] = histogram
		}
		durationMS := float64(duration) / float64(time.Millisecond)
		histogram.Count++
		histogram.SumMS += durationMS
		for index, bound := range durationBucketsMS {
			if durationMS <= bound {
				histogram.Buckets[index]++
			}
		}
	}
}

func (m *Metrics) RecordAdmissionDecision(decision string, waitDuration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.admissionDecisionTotals[decision]++
	if decision == "admitted_queued" {
		recordHistogramDuration(m.admissionWaitDurations, waitDuration)
	}
}

func (m *Metrics) RecordAdmissionDecisionForLane(
	lane string,
	decision string,
	waitDuration time.Duration,
) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.admissionDecisionTotals[decision]++
	m.laneDecisionTotals[laneDecisionKey{Lane: lane, Decision: decision}]++
	if decision == "admitted_queued" {
		recordHistogramDuration(m.admissionWaitDurations, waitDuration)
		histogram := m.laneWaitDurations[lane]
		if histogram == nil {
			histogram = newHistogram()
			m.laneWaitDurations[lane] = histogram
		}
		recordHistogramDuration(histogram, waitDuration)
	}
}

func (m *Metrics) RecordBridgeFailure(kind string) {
	now := time.Now().UTC()

	m.mu.Lock()
	defer m.mu.Unlock()
	m.bridgeFailureTotals[kind]++
	m.lastAnswerFailureCode = kind
	m.lastAnswerFailureAt = now
}

func (m *Metrics) RecordBridgeSuccess() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.lastAnswerSuccessAt = time.Now().UTC()
}

func (m *Metrics) RecordBridgeDuration(duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	recordHistogramDuration(m.bridgeDurations, duration)
}

func (m *Metrics) RecordBridgeCancel(outcome string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bridgeCancelTotals[outcome]++
}

func (m *Metrics) RecordStructuredQuery(tool string, outcome string, statusCode int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.structuredQueryTotals[structuredQueryKey{
		Tool:        tool,
		Outcome:     outcome,
		StatusClass: statusClass(statusCode),
	}]++
}

func (m *Metrics) RecordCapabilityGate(capability string, gate string, decision string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.capabilityGateTotals[capabilityGateKey{
		Capability: capability,
		Gate:       gate,
		Decision:   decision,
	}]++
}

func (m *Metrics) RecordRuntimeDecision(labels RuntimeDecisionLabels) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runtimeDecisionTotals[runtimeDecisionKey{
		Capability:            defaultMetricLabel(labels.Capability, "unknown"),
		Lane:                  defaultMetricLabel(labels.Lane, "unknown"),
		ScopeGate:             defaultMetricLabel(labels.ScopeGate, "unknown"),
		PolicyGate:            defaultMetricLabel(labels.PolicyGate, "unknown"),
		ContextPreflightState: defaultMetricLabel(labels.ContextPreflightState, "unknown"),
		RoutingNextAction:     defaultMetricLabel(labels.RoutingNextAction, "unknown"),
		PlanningOutcome:       defaultMetricLabel(labels.PlanningOutcome, "unknown"),
	}]++
}

func (m *Metrics) BridgeRuntimeSnapshot() BridgeRuntimeSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()

	return BridgeRuntimeSnapshot{
		LastAnswerFailureCode: m.lastAnswerFailureCode,
		LastAnswerFailureAt:   formatTime(m.lastAnswerFailureAt),
		LastAnswerSuccessAt:   formatTime(m.lastAnswerSuccessAt),
	}
}

func (m *Metrics) Prometheus(admissionSnapshots ...AdmissionSnapshot) []byte {
	m.mu.Lock()
	defer m.mu.Unlock()

	var builder strings.Builder

	builder.WriteString("# HELP campus_supervisor_api_requests_total Total requests handled by supervisor-api.\n")
	builder.WriteString("# TYPE campus_supervisor_api_requests_total counter\n")
	for _, key := range sortedRequestKeys(m.requestTotals) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_requests_total{route=%q,outcome=%q,status_class=%q} %d\n",
			key.Route,
			key.Outcome,
			key.StatusClass,
			m.requestTotals[key],
		)
	}

	builder.WriteString("# HELP campus_supervisor_api_request_duration_ms Request duration in milliseconds.\n")
	builder.WriteString("# TYPE campus_supervisor_api_request_duration_ms histogram\n")
	for _, route := range sortedRoutes(m.requestDurations) {
		histogram := m.requestDurations[route]
		for index, bound := range durationBucketsMS {
			fmt.Fprintf(
				&builder,
				"campus_supervisor_api_request_duration_ms_bucket{route=%q,le=%q} %d\n",
				route,
				formatFloat(bound),
				histogram.Buckets[index],
			)
		}
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_request_duration_ms_bucket{route=%q,le=\"+Inf\"} %d\n",
			route,
			histogram.Count,
		)
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_request_duration_ms_sum{route=%q} %s\n",
			route,
			formatFloat(histogram.SumMS),
		)
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_request_duration_ms_count{route=%q} %d\n",
			route,
			histogram.Count,
		)
	}

	builder.WriteString("# HELP campus_supervisor_api_inflight_requests Current inflight requests by route.\n")
	builder.WriteString("# TYPE campus_supervisor_api_inflight_requests gauge\n")
	for _, route := range sortedRoutesInt64(m.inflight) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_inflight_requests{route=%q} %d\n",
			route,
			m.inflight[route],
		)
	}

	builder.WriteString("# HELP campus_supervisor_api_admission_decisions_total Total admission decisions by decision.\n")
	builder.WriteString("# TYPE campus_supervisor_api_admission_decisions_total counter\n")
	for _, decision := range sortedStringKeys(m.admissionDecisionTotals) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_admission_decisions_total{decision=%q} %d\n",
			decision,
			m.admissionDecisionTotals[decision],
		)
	}
	builder.WriteString("# HELP campus_supervisor_api_admission_lane_decisions_total Total admission decisions by lane and decision.\n")
	builder.WriteString("# TYPE campus_supervisor_api_admission_lane_decisions_total counter\n")
	for _, key := range sortedLaneDecisionKeys(m.laneDecisionTotals) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_admission_lane_decisions_total{lane=%q,decision=%q} %d\n",
			key.Lane,
			key.Decision,
			m.laneDecisionTotals[key],
		)
	}

	snapshot := AdmissionSnapshot{}
	if len(admissionSnapshots) > 0 {
		snapshot = admissionSnapshots[0]
	}
	builder.WriteString("# HELP campus_supervisor_api_admission_active Current active admitted answer executions.\n")
	builder.WriteString("# TYPE campus_supervisor_api_admission_active gauge\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_admission_active %d\n", snapshot.Active)
	builder.WriteString("# HELP campus_supervisor_api_admission_queue_depth Current queued answer executions.\n")
	builder.WriteString("# TYPE campus_supervisor_api_admission_queue_depth gauge\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_admission_queue_depth %d\n", snapshot.Queued)
	builder.WriteString("# HELP campus_supervisor_api_admission_queue_capacity Configured queued answer execution capacity.\n")
	builder.WriteString("# TYPE campus_supervisor_api_admission_queue_capacity gauge\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_admission_queue_capacity %d\n", snapshot.QueueCapacity)
	builder.WriteString("# HELP campus_supervisor_api_shutdown_draining Whether supervisor-api is draining and rejecting new executions.\n")
	builder.WriteString("# TYPE campus_supervisor_api_shutdown_draining gauge\n")
	if snapshot.Draining {
		builder.WriteString("campus_supervisor_api_shutdown_draining 1\n")
	} else {
		builder.WriteString("campus_supervisor_api_shutdown_draining 0\n")
	}
	if len(snapshot.Lanes) > 0 {
		builder.WriteString("# HELP campus_supervisor_api_admission_lane_active Current active admitted answer executions by lane.\n")
		builder.WriteString("# TYPE campus_supervisor_api_admission_lane_active gauge\n")
		for _, lane := range sortedAdmissionLaneNames(snapshot.Lanes) {
			fmt.Fprintf(
				&builder,
				"campus_supervisor_api_admission_lane_active{lane=%q} %d\n",
				lane,
				snapshot.Lanes[lane].Active,
			)
		}
		builder.WriteString("# HELP campus_supervisor_api_admission_lane_queue_depth Current queued answer executions by lane.\n")
		builder.WriteString("# TYPE campus_supervisor_api_admission_lane_queue_depth gauge\n")
		for _, lane := range sortedAdmissionLaneNames(snapshot.Lanes) {
			fmt.Fprintf(
				&builder,
				"campus_supervisor_api_admission_lane_queue_depth{lane=%q} %d\n",
				lane,
				snapshot.Lanes[lane].Queued,
			)
		}
		builder.WriteString("# HELP campus_supervisor_api_admission_lane_queue_capacity Configured queued answer execution capacity by lane.\n")
		builder.WriteString("# TYPE campus_supervisor_api_admission_lane_queue_capacity gauge\n")
		for _, lane := range sortedAdmissionLaneNames(snapshot.Lanes) {
			fmt.Fprintf(
				&builder,
				"campus_supervisor_api_admission_lane_queue_capacity{lane=%q} %d\n",
				lane,
				snapshot.Lanes[lane].QueueCapacity,
			)
		}
	}

	writeHistogram(
		&builder,
		"campus_supervisor_api_admission_queue_wait_ms",
		"Admission queue wait duration in milliseconds.",
		m.admissionWaitDurations,
	)
	writeHistogram(
		&builder,
		"campus_supervisor_api_bridge_duration_ms",
		"Supervisor Python bridge duration in milliseconds.",
		m.bridgeDurations,
	)
	for _, lane := range sortedRoutes(m.laneWaitDurations) {
		writeHistogramWithLabel(
			&builder,
			"campus_supervisor_api_admission_lane_queue_wait_ms",
			"Admission queue wait duration in milliseconds by lane.",
			"lane",
			lane,
			m.laneWaitDurations[lane],
		)
	}

	builder.WriteString("# HELP campus_supervisor_api_bridge_failures_total Total bridge failures by kind.\n")
	builder.WriteString("# TYPE campus_supervisor_api_bridge_failures_total counter\n")
	for _, kind := range sortedStringKeys(m.bridgeFailureTotals) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_bridge_failures_total{kind=%q} %d\n",
			kind,
			m.bridgeFailureTotals[kind],
		)
	}
	builder.WriteString("# HELP campus_supervisor_api_bridge_cancel_total Total cooperative cancel bridge attempts by outcome.\n")
	builder.WriteString("# TYPE campus_supervisor_api_bridge_cancel_total counter\n")
	for _, outcome := range sortedStringKeys(m.bridgeCancelTotals) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_bridge_cancel_total{outcome=%q} %d\n",
			outcome,
			m.bridgeCancelTotals[outcome],
		)
	}
	builder.WriteString("# HELP campus_supervisor_api_bridge_circuit_state Current bridge circuit breaker state.\n")
	builder.WriteString("# TYPE campus_supervisor_api_bridge_circuit_state gauge\n")
	for _, state := range []string{"closed", "open", "half_open"} {
		value := 0
		if snapshot.BridgeCircuit.State == state {
			value = 1
		}
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_bridge_circuit_state{state=%q} %d\n",
			state,
			value,
		)
	}
	builder.WriteString("# HELP campus_supervisor_api_bridge_circuit_open_total Total bridge circuit breaker open transitions.\n")
	builder.WriteString("# TYPE campus_supervisor_api_bridge_circuit_open_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_bridge_circuit_open_total %d\n", snapshot.BridgeCircuit.OpenCount)
	builder.WriteString("# HELP campus_supervisor_api_bridge_circuit_rejected_total Total bridge executions rejected by the circuit breaker.\n")
	builder.WriteString("# TYPE campus_supervisor_api_bridge_circuit_rejected_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_bridge_circuit_rejected_total %d\n", snapshot.BridgeCircuit.RejectedCount)
	builder.WriteString("# HELP campus_supervisor_api_structured_query_requests_total Total structured query requests by tool and outcome.\n")
	builder.WriteString("# TYPE campus_supervisor_api_structured_query_requests_total counter\n")
	for _, key := range sortedStructuredQueryKeys(m.structuredQueryTotals) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_structured_query_requests_total{tool=%q,outcome=%q,status_class=%q} %d\n",
			key.Tool,
			key.Outcome,
			key.StatusClass,
			m.structuredQueryTotals[key],
		)
	}
	builder.WriteString("# HELP campus_supervisor_api_capability_gate_decisions_total Total capability gate decisions by capability and gate.\n")
	builder.WriteString("# TYPE campus_supervisor_api_capability_gate_decisions_total counter\n")
	for _, key := range sortedCapabilityGateKeys(m.capabilityGateTotals) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_capability_gate_decisions_total{capability=%q,gate=%q,decision=%q} %d\n",
			key.Capability,
			key.Gate,
			key.Decision,
			m.capabilityGateTotals[key],
		)
	}
	builder.WriteString("# HELP campus_supervisor_api_runtime_policy_decisions_total Total Go runtime policy decisions by bounded decision labels.\n")
	builder.WriteString("# TYPE campus_supervisor_api_runtime_policy_decisions_total counter\n")
	for _, key := range sortedRuntimeDecisionKeys(m.runtimeDecisionTotals) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_runtime_policy_decisions_total{capability=%q,lane=%q,scope_gate=%q,policy_gate=%q,context_preflight=%q,routing_next_action=%q,planning_outcome=%q} %d\n",
			key.Capability,
			key.Lane,
			key.ScopeGate,
			key.PolicyGate,
			key.ContextPreflightState,
			key.RoutingNextAction,
			key.PlanningOutcome,
			m.runtimeDecisionTotals[key],
		)
	}
	builder.WriteString("# HELP campus_supervisor_api_lifecycle_active_executions Current registered executions.\n")
	builder.WriteString("# TYPE campus_supervisor_api_lifecycle_active_executions gauge\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_lifecycle_active_executions %d\n", snapshot.Lifecycle.ActiveExecutions)
	builder.WriteString("# HELP campus_supervisor_api_lifecycle_cancel_requested_total Total explicit cancel requests accepted by supervisor-api.\n")
	builder.WriteString("# TYPE campus_supervisor_api_lifecycle_cancel_requested_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_lifecycle_cancel_requested_total %d\n", snapshot.Lifecycle.CancelRequestedCount)
	builder.WriteString("# HELP campus_supervisor_api_lifecycle_completed_retained_total Total completed execution lifecycle records.\n")
	builder.WriteString("# TYPE campus_supervisor_api_lifecycle_completed_retained_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_lifecycle_completed_retained_total %d\n", snapshot.Lifecycle.CompletedRetained)
	builder.WriteString("# HELP campus_supervisor_api_lifecycle_completed_total Total completed execution lifecycle records by final state.\n")
	builder.WriteString("# TYPE campus_supervisor_api_lifecycle_completed_total counter\n")
	for _, state := range sortedStringKeys(snapshot.Lifecycle.CompletedByState) {
		fmt.Fprintf(
			&builder,
			"campus_supervisor_api_lifecycle_completed_total{state=%q} %d\n",
			state,
			snapshot.Lifecycle.CompletedByState[state],
		)
	}
	builder.WriteString("# HELP campus_supervisor_api_telemetry_dropped_total Total telemetry events dropped by supervisor-api.\n")
	builder.WriteString("# TYPE campus_supervisor_api_telemetry_dropped_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_telemetry_dropped_total %d\n", snapshot.Telemetry.DroppedCount)
	builder.WriteString("# HELP campus_supervisor_api_telemetry_exported_total Total telemetry spans exported by supervisor-api.\n")
	builder.WriteString("# TYPE campus_supervisor_api_telemetry_exported_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_telemetry_exported_total %d\n", snapshot.Telemetry.ExportedCount)
	builder.WriteString("# HELP campus_supervisor_api_telemetry_failed_total Total telemetry exporter failures observed by supervisor-api.\n")
	builder.WriteString("# TYPE campus_supervisor_api_telemetry_failed_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_telemetry_failed_total %d\n", snapshot.Telemetry.FailedCount)
	builder.WriteString("# HELP campus_supervisor_api_telemetry_sample_ratio Configured supervisor-api OTel sample ratio.\n")
	builder.WriteString("# TYPE campus_supervisor_api_telemetry_sample_ratio gauge\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_telemetry_sample_ratio %s\n", defaultMetricNumber(snapshot.Telemetry.SampleRatio))
	builder.WriteString("# HELP campus_supervisor_api_telemetry_enabled Whether OTel telemetry is enabled.\n")
	builder.WriteString("# TYPE campus_supervisor_api_telemetry_enabled gauge\n")
	if snapshot.Telemetry.Enabled {
		builder.WriteString("campus_supervisor_api_telemetry_enabled 1\n")
	} else {
		builder.WriteString("campus_supervisor_api_telemetry_enabled 0\n")
	}
	builder.WriteString("# HELP campus_supervisor_api_telemetry_exporter_configured Whether OTel exporter is configured.\n")
	builder.WriteString("# TYPE campus_supervisor_api_telemetry_exporter_configured gauge\n")
	if snapshot.Telemetry.ExporterConfigured {
		builder.WriteString("campus_supervisor_api_telemetry_exporter_configured 1\n")
	} else {
		builder.WriteString("campus_supervisor_api_telemetry_exporter_configured 0\n")
	}
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_emitted_total Total execution audit events accepted by supervisor-api emitter.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_emitted_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_execution_audit_emitted_total %d\n", snapshot.ExecutionAudit.EmittedCount)
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_dropped_total Total execution audit events dropped by supervisor-api emitter.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_dropped_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_execution_audit_dropped_total %d\n", snapshot.ExecutionAudit.DroppedCount)
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_failed_total Total execution audit delivery failures.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_failed_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_execution_audit_failed_total %d\n", snapshot.ExecutionAudit.FailedCount)
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_queue_depth Current execution audit emitter queue depth.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_queue_depth gauge\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_execution_audit_queue_depth %d\n", snapshot.ExecutionAudit.QueueDepth)
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_batch_size Configured execution audit batch size.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_batch_size gauge\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_execution_audit_batch_size %d\n", snapshot.ExecutionAudit.BatchSize)
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_retried_total Total execution audit retry attempts.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_retried_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_execution_audit_retried_total %d\n", snapshot.ExecutionAudit.RetriedCount)
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_spooled_total Total execution audit events written to local spool.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_spooled_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_execution_audit_spooled_total %d\n", snapshot.ExecutionAudit.SpooledCount)
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_spool_drained_total Total execution audit spooled events delivered after restart.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_spool_drained_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_execution_audit_spool_drained_total %d\n", snapshot.ExecutionAudit.SpoolDrainedCount)
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_spool_dropped_total Total execution audit spool files dropped by retention limits.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_spool_dropped_total counter\n")
	fmt.Fprintf(&builder, "campus_supervisor_api_execution_audit_spool_dropped_total %d\n", snapshot.ExecutionAudit.SpoolDroppedCount)
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_spool_enabled Whether local execution audit spool is configured.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_spool_enabled gauge\n")
	if snapshot.ExecutionAudit.SpoolEnabled {
		builder.WriteString("campus_supervisor_api_execution_audit_spool_enabled 1\n")
	} else {
		builder.WriteString("campus_supervisor_api_execution_audit_spool_enabled 0\n")
	}
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_enabled Whether execution audit emission is enabled.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_enabled gauge\n")
	if snapshot.ExecutionAudit.Enabled {
		builder.WriteString("campus_supervisor_api_execution_audit_enabled 1\n")
	} else {
		builder.WriteString("campus_supervisor_api_execution_audit_enabled 0\n")
	}
	builder.WriteString("# HELP campus_supervisor_api_execution_audit_configured Whether execution audit emission is configured.\n")
	builder.WriteString("# TYPE campus_supervisor_api_execution_audit_configured gauge\n")
	if snapshot.ExecutionAudit.Configured {
		builder.WriteString("campus_supervisor_api_execution_audit_configured 1\n")
	} else {
		builder.WriteString("campus_supervisor_api_execution_audit_configured 0\n")
	}

	return []byte(builder.String())
}

func newHistogram() *routeHistogram {
	return &routeHistogram{
		Buckets: make([]uint64, len(durationBucketsMS)),
	}
}

func recordHistogramDuration(histogram *routeHistogram, duration time.Duration) {
	durationMS := float64(duration) / float64(time.Millisecond)
	histogram.Count++
	histogram.SumMS += durationMS
	for index, bound := range durationBucketsMS {
		if durationMS <= bound {
			histogram.Buckets[index]++
		}
	}
}

func writeHistogram(
	builder *strings.Builder,
	name string,
	help string,
	histogram *routeHistogram,
) {
	builder.WriteString("# HELP " + name + " " + help + "\n")
	builder.WriteString("# TYPE " + name + " histogram\n")
	for index, bound := range durationBucketsMS {
		fmt.Fprintf(
			builder,
			"%s_bucket{le=%q} %d\n",
			name,
			formatFloat(bound),
			histogram.Buckets[index],
		)
	}
	fmt.Fprintf(builder, "%s_bucket{le=\"+Inf\"} %d\n", name, histogram.Count)
	fmt.Fprintf(builder, "%s_sum %s\n", name, formatFloat(histogram.SumMS))
	fmt.Fprintf(builder, "%s_count %d\n", name, histogram.Count)
}

func writeHistogramWithLabel(
	builder *strings.Builder,
	name string,
	help string,
	labelName string,
	labelValue string,
	histogram *routeHistogram,
) {
	builder.WriteString("# HELP " + name + " " + help + "\n")
	builder.WriteString("# TYPE " + name + " histogram\n")
	for index, bound := range durationBucketsMS {
		fmt.Fprintf(
			builder,
			"%s_bucket{%s=%q,le=%q} %d\n",
			name,
			labelName,
			labelValue,
			formatFloat(bound),
			histogram.Buckets[index],
		)
	}
	fmt.Fprintf(
		builder,
		"%s_bucket{%s=%q,le=\"+Inf\"} %d\n",
		name,
		labelName,
		labelValue,
		histogram.Count,
	)
	fmt.Fprintf(
		builder,
		"%s_sum{%s=%q} %s\n",
		name,
		labelName,
		labelValue,
		formatFloat(histogram.SumMS),
	)
	fmt.Fprintf(
		builder,
		"%s_count{%s=%q} %d\n",
		name,
		labelName,
		labelValue,
		histogram.Count,
	)
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format(time.RFC3339Nano)
}

func formatFloat(value float64) string {
	return fmt.Sprintf("%.3f", value)
}

func defaultMetricNumber(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "0"
	}
	return trimmed
}

func defaultMetricLabel(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func sortedRoutes[T any](items map[string]T) []string {
	return sortedStringKeys(items)
}

func sortedRoutesInt64(items map[string]int64) []string {
	return sortedStringKeys(items)
}

func sortedStringKeys[V any](items map[string]V) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedLaneDecisionKeys(items map[laneDecisionKey]uint64) []laneDecisionKey {
	keys := make([]laneDecisionKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Lane != keys[right].Lane {
			return keys[left].Lane < keys[right].Lane
		}
		return keys[left].Decision < keys[right].Decision
	})
	return keys
}

func sortedStructuredQueryKeys(items map[structuredQueryKey]uint64) []structuredQueryKey {
	keys := make([]structuredQueryKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Tool != keys[right].Tool {
			return keys[left].Tool < keys[right].Tool
		}
		if keys[left].Outcome != keys[right].Outcome {
			return keys[left].Outcome < keys[right].Outcome
		}
		return keys[left].StatusClass < keys[right].StatusClass
	})
	return keys
}

func sortedCapabilityGateKeys(items map[capabilityGateKey]uint64) []capabilityGateKey {
	keys := make([]capabilityGateKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Capability != keys[right].Capability {
			return keys[left].Capability < keys[right].Capability
		}
		if keys[left].Gate != keys[right].Gate {
			return keys[left].Gate < keys[right].Gate
		}
		return keys[left].Decision < keys[right].Decision
	})
	return keys
}

func sortedRuntimeDecisionKeys(items map[runtimeDecisionKey]uint64) []runtimeDecisionKey {
	keys := make([]runtimeDecisionKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Capability != keys[right].Capability {
			return keys[left].Capability < keys[right].Capability
		}
		if keys[left].Lane != keys[right].Lane {
			return keys[left].Lane < keys[right].Lane
		}
		if keys[left].ScopeGate != keys[right].ScopeGate {
			return keys[left].ScopeGate < keys[right].ScopeGate
		}
		if keys[left].PolicyGate != keys[right].PolicyGate {
			return keys[left].PolicyGate < keys[right].PolicyGate
		}
		if keys[left].ContextPreflightState != keys[right].ContextPreflightState {
			return keys[left].ContextPreflightState < keys[right].ContextPreflightState
		}
		if keys[left].RoutingNextAction != keys[right].RoutingNextAction {
			return keys[left].RoutingNextAction < keys[right].RoutingNextAction
		}
		return keys[left].PlanningOutcome < keys[right].PlanningOutcome
	})
	return keys
}

func sortedAdmissionLaneNames(items map[string]AdmissionLaneSnapshot) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedRequestKeys(items map[requestKey]uint64) []requestKey {
	keys := make([]requestKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Route != keys[right].Route {
			return keys[left].Route < keys[right].Route
		}
		if keys[left].Outcome != keys[right].Outcome {
			return keys[left].Outcome < keys[right].Outcome
		}
		return keys[left].StatusClass < keys[right].StatusClass
	})
	return keys
}

func statusClass(statusCode int) string {
	switch {
	case statusCode >= 100 && statusCode < 200:
		return "1xx"
	case statusCode >= 200 && statusCode < 300:
		return "2xx"
	case statusCode >= 300 && statusCode < 400:
		return "3xx"
	case statusCode >= 400 && statusCode < 500:
		return "4xx"
	case statusCode >= 500 && statusCode < 600:
		return "5xx"
	default:
		return "none"
	}
}
