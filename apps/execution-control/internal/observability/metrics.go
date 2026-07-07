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
	Groups         map[string]AdmissionGroupSnapshot
	Lifecycle      LifecycleSnapshot
	Telemetry      TelemetrySnapshot
	ExecutionAudit ExecutionAuditSnapshot
}

type AdmissionGroupSnapshot struct {
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

type groupDecisionKey struct {
	Group    string
	Decision string
}

type toolReadModelKey struct {
	Tool        string
	Outcome     string
	StatusClass string
}

type toolGateKey struct {
	Tool     string
	Gate     string
	Decision string
}

type personalMemoryOperationKey struct {
	Operation   string
	Outcome     string
	FailureKind string
}

type valueHistogram struct {
	Bounds  []float64
	Buckets []uint64
	Count   uint64
	Sum     float64
}

type RuntimeDecisionLabels struct {
	Target                string
	TaskQueue             string
	ScopeGate             string
	PolicyGate            string
	ContextPreflightState string
	RoutingNextAction     string
	PlanningOutcome       string
	SelectedTool          string
	TerminalOutcome       string
	FailCloseReason       string
}

type runtimeDecisionKey struct {
	Target                string
	TaskQueue             string
	ScopeGate             string
	PolicyGate            string
	ContextPreflightState string
	RoutingNextAction     string
	PlanningOutcome       string
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
	groupDecisionTotals     map[groupDecisionKey]uint64
	admissionWaitDurations  *routeHistogram
	groupWaitDurations      map[string]*routeHistogram
	toolReadModelTotals     map[toolReadModelKey]uint64
	toolGateTotals          map[toolGateKey]uint64
	personalMemoryTotals    map[personalMemoryOperationKey]uint64
	personalMemoryDurations map[string]*routeHistogram
	personalMemoryItems     map[string]*valueHistogram
	personalMemoryChars     map[string]*valueHistogram
	runtimeDecisionTotals   map[runtimeDecisionKey]uint64
}

func NewMetrics() *Metrics {
	return &Metrics{
		inflight:         make(map[string]int64),
		requestTotals:    make(map[requestKey]uint64),
		requestDurations: make(map[string]*routeHistogram),
		admissionDecisionTotals: map[string]uint64{
			"admitted_immediate":  0,
			"admitted_queued":     0,
			"queue_full":          0,
			"queue_timeout":       0,
			"group_queue_full":    0,
			"group_queue_timeout": 0,
			"client_canceled":     0,
			"draining":            0,
		},
		groupDecisionTotals:     make(map[groupDecisionKey]uint64),
		admissionWaitDurations:  newHistogram(),
		groupWaitDurations:      make(map[string]*routeHistogram),
		toolReadModelTotals:     make(map[toolReadModelKey]uint64),
		toolGateTotals:          make(map[toolGateKey]uint64),
		personalMemoryTotals:    make(map[personalMemoryOperationKey]uint64),
		personalMemoryDurations: make(map[string]*routeHistogram),
		personalMemoryItems:     make(map[string]*valueHistogram),
		personalMemoryChars:     make(map[string]*valueHistogram),
		runtimeDecisionTotals:   make(map[runtimeDecisionKey]uint64),
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

func (m *Metrics) RecordAdmissionDecisionForGroup(
	group string,
	decision string,
	waitDuration time.Duration,
) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.admissionDecisionTotals[decision]++
	m.groupDecisionTotals[groupDecisionKey{Group: group, Decision: decision}]++
	if decision == "admitted_queued" {
		recordHistogramDuration(m.admissionWaitDurations, waitDuration)
		histogram := m.groupWaitDurations[group]
		if histogram == nil {
			histogram = newHistogram()
			m.groupWaitDurations[group] = histogram
		}
		recordHistogramDuration(histogram, waitDuration)
	}
}

func (m *Metrics) RecordToolReadModel(tool string, outcome string, statusCode int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.toolReadModelTotals[toolReadModelKey{
		Tool:        tool,
		Outcome:     outcome,
		StatusClass: statusClass(statusCode),
	}]++
}

func (m *Metrics) RecordToolGate(tool string, gate string, decision string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.toolGateTotals[toolGateKey{
		Tool:     tool,
		Gate:     gate,
		Decision: decision,
	}]++
}

func (m *Metrics) RecordPersonalMemoryOperation(
	operation string,
	outcome string,
	failureKind string,
	duration time.Duration,
	selectedItems int,
	selectedChars int,
) {
	m.mu.Lock()
	defer m.mu.Unlock()

	operation = defaultMetricLabel(operation, "unknown")
	outcome = defaultMetricLabel(outcome, "unknown")
	failureKind = defaultMetricLabel(failureKind, "none")
	m.personalMemoryTotals[personalMemoryOperationKey{
		Operation:   operation,
		Outcome:     outcome,
		FailureKind: failureKind,
	}]++
	durationHistogram := m.personalMemoryDurations[operation]
	if durationHistogram == nil {
		durationHistogram = newHistogram()
		m.personalMemoryDurations[operation] = durationHistogram
	}
	recordHistogramDuration(durationHistogram, duration)
	itemHistogram := m.personalMemoryItems[operation]
	if itemHistogram == nil {
		itemHistogram = newValueHistogram([]float64{0, 1, 2, 5, 10, 25, 50})
		m.personalMemoryItems[operation] = itemHistogram
	}
	recordValueHistogram(itemHistogram, float64(selectedItems))
	charHistogram := m.personalMemoryChars[operation]
	if charHistogram == nil {
		charHistogram = newValueHistogram([]float64{0, 100, 250, 500, 1_000, 2_500, 5_000, 10_000})
		m.personalMemoryChars[operation] = charHistogram
	}
	recordValueHistogram(charHistogram, float64(selectedChars))
}

func (m *Metrics) RecordRuntimeDecision(labels RuntimeDecisionLabels) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runtimeDecisionTotals[runtimeDecisionKey{
		Target:                defaultMetricLabel(labels.Target, "unknown"),
		TaskQueue:             defaultMetricLabel(labels.TaskQueue, "unknown"),
		ScopeGate:             defaultMetricLabel(labels.ScopeGate, "unknown"),
		PolicyGate:            defaultMetricLabel(labels.PolicyGate, "unknown"),
		ContextPreflightState: defaultMetricLabel(labels.ContextPreflightState, "unknown"),
		RoutingNextAction:     defaultMetricLabel(labels.RoutingNextAction, "unknown"),
		PlanningOutcome:       defaultMetricLabel(labels.PlanningOutcome, "unknown"),
		SelectedTool:          defaultMetricLabel(labels.SelectedTool, "none"),
		TerminalOutcome:       defaultMetricLabel(labels.TerminalOutcome, "none"),
		FailCloseReason:       defaultMetricLabel(labels.FailCloseReason, "none"),
	}]++
}
