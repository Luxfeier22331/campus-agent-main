package observability

import (
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
	MetricsEnabled     bool
	MetricsConfigured  bool
	ExportedCount      uint64
	DroppedCount       uint64
	FailedCount        uint64
	SampleRatio        string
	LastError          string
}

type ExecutionAuditSnapshot struct {
	Enabled      bool
	Configured   bool
	EmittedCount uint64
	FailedCount  uint64
	LastError    string
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
	SelectedTarget        string
	SelectedTool          string
	TerminalOutcome       string
	FailCloseReason       string
}

type runtimeDecisionKey struct {
	Capability            string
	Lane                  string
	ScopeGate             string
	PolicyGate            string
	ContextPreflightState string
	RoutingNextAction     string
	PlanningOutcome       string
	SelectedTarget        string
	SelectedTool          string
	TerminalOutcome       string
	FailCloseReason       string
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
	bridgeRetryTotals       map[string]uint64
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
		bridgeRetryTotals: make(map[string]uint64),
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

func (m *Metrics) RecordBridgeRetry(kind string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bridgeRetryTotals[kind]++
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
		SelectedTarget:        defaultMetricLabel(labels.SelectedTarget, "none"),
		SelectedTool:          defaultMetricLabel(labels.SelectedTool, "none"),
		TerminalOutcome:       defaultMetricLabel(labels.TerminalOutcome, "none"),
		FailCloseReason:       defaultMetricLabel(labels.FailCloseReason, "none"),
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
