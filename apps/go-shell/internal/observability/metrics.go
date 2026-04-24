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
	Active        int
	Queued        int
	QueueCapacity int
	Draining      bool
}

type BridgeRuntimeSnapshot struct {
	LastAnswerFailureCode string
	LastAnswerFailureAt   string
	LastAnswerSuccessAt   string
}

type Metrics struct {
	mu sync.Mutex

	inflight                map[string]int64
	requestTotals           map[requestKey]uint64
	requestDurations        map[string]*routeHistogram
	admissionDecisionTotals map[string]uint64
	admissionWaitDurations  *routeHistogram
	bridgeDurations         *routeHistogram
	bridgeFailureTotals     map[string]uint64
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
			"client_canceled":    0,
			"draining":           0,
		},
		admissionWaitDurations: newHistogram(),
		bridgeDurations:        newHistogram(),
		bridgeFailureTotals: map[string]uint64{
			"timeout":          0,
			"unavailable":      0,
			"invalid_response": 0,
		},
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

	builder.WriteString("# HELP campus_go_shell_requests_total Total requests handled by go-shell.\n")
	builder.WriteString("# TYPE campus_go_shell_requests_total counter\n")
	for _, key := range sortedRequestKeys(m.requestTotals) {
		fmt.Fprintf(
			&builder,
			"campus_go_shell_requests_total{route=%q,outcome=%q,status_class=%q} %d\n",
			key.Route,
			key.Outcome,
			key.StatusClass,
			m.requestTotals[key],
		)
	}

	builder.WriteString("# HELP campus_go_shell_request_duration_ms Request duration in milliseconds.\n")
	builder.WriteString("# TYPE campus_go_shell_request_duration_ms histogram\n")
	for _, route := range sortedRoutes(m.requestDurations) {
		histogram := m.requestDurations[route]
		for index, bound := range durationBucketsMS {
			fmt.Fprintf(
				&builder,
				"campus_go_shell_request_duration_ms_bucket{route=%q,le=%q} %d\n",
				route,
				formatFloat(bound),
				histogram.Buckets[index],
			)
		}
		fmt.Fprintf(
			&builder,
			"campus_go_shell_request_duration_ms_bucket{route=%q,le=\"+Inf\"} %d\n",
			route,
			histogram.Count,
		)
		fmt.Fprintf(
			&builder,
			"campus_go_shell_request_duration_ms_sum{route=%q} %s\n",
			route,
			formatFloat(histogram.SumMS),
		)
		fmt.Fprintf(
			&builder,
			"campus_go_shell_request_duration_ms_count{route=%q} %d\n",
			route,
			histogram.Count,
		)
	}

	builder.WriteString("# HELP campus_go_shell_inflight_requests Current inflight requests by route.\n")
	builder.WriteString("# TYPE campus_go_shell_inflight_requests gauge\n")
	for _, route := range sortedRoutesInt64(m.inflight) {
		fmt.Fprintf(
			&builder,
			"campus_go_shell_inflight_requests{route=%q} %d\n",
			route,
			m.inflight[route],
		)
	}

	builder.WriteString("# HELP campus_go_shell_admission_decisions_total Total admission decisions by decision.\n")
	builder.WriteString("# TYPE campus_go_shell_admission_decisions_total counter\n")
	for _, decision := range sortedStringKeys(m.admissionDecisionTotals) {
		fmt.Fprintf(
			&builder,
			"campus_go_shell_admission_decisions_total{decision=%q} %d\n",
			decision,
			m.admissionDecisionTotals[decision],
		)
	}

	snapshot := AdmissionSnapshot{}
	if len(admissionSnapshots) > 0 {
		snapshot = admissionSnapshots[0]
	}
	builder.WriteString("# HELP campus_go_shell_admission_active Current active admitted answer executions.\n")
	builder.WriteString("# TYPE campus_go_shell_admission_active gauge\n")
	fmt.Fprintf(&builder, "campus_go_shell_admission_active %d\n", snapshot.Active)
	builder.WriteString("# HELP campus_go_shell_admission_queue_depth Current queued answer executions.\n")
	builder.WriteString("# TYPE campus_go_shell_admission_queue_depth gauge\n")
	fmt.Fprintf(&builder, "campus_go_shell_admission_queue_depth %d\n", snapshot.Queued)
	builder.WriteString("# HELP campus_go_shell_admission_queue_capacity Configured queued answer execution capacity.\n")
	builder.WriteString("# TYPE campus_go_shell_admission_queue_capacity gauge\n")
	fmt.Fprintf(&builder, "campus_go_shell_admission_queue_capacity %d\n", snapshot.QueueCapacity)
	builder.WriteString("# HELP campus_go_shell_shutdown_draining Whether go-shell is draining and rejecting new executions.\n")
	builder.WriteString("# TYPE campus_go_shell_shutdown_draining gauge\n")
	if snapshot.Draining {
		builder.WriteString("campus_go_shell_shutdown_draining 1\n")
	} else {
		builder.WriteString("campus_go_shell_shutdown_draining 0\n")
	}

	writeHistogram(
		&builder,
		"campus_go_shell_admission_queue_wait_ms",
		"Admission queue wait duration in milliseconds.",
		m.admissionWaitDurations,
	)
	writeHistogram(
		&builder,
		"campus_go_shell_bridge_duration_ms",
		"Supervisor Python bridge duration in milliseconds.",
		m.bridgeDurations,
	)

	builder.WriteString("# HELP campus_go_shell_bridge_failures_total Total bridge failures by kind.\n")
	builder.WriteString("# TYPE campus_go_shell_bridge_failures_total counter\n")
	for _, kind := range sortedStringKeys(m.bridgeFailureTotals) {
		fmt.Fprintf(
			&builder,
			"campus_go_shell_bridge_failures_total{kind=%q} %d\n",
			kind,
			m.bridgeFailureTotals[kind],
		)
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

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format(time.RFC3339Nano)
}

func formatFloat(value float64) string {
	return fmt.Sprintf("%.3f", value)
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
