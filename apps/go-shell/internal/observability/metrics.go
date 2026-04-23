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
	transportSaturatedTotal uint64
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

func (m *Metrics) RecordTransportSaturated() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.transportSaturatedTotal++
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

func (m *Metrics) BridgeRuntimeSnapshot() BridgeRuntimeSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()

	return BridgeRuntimeSnapshot{
		LastAnswerFailureCode: m.lastAnswerFailureCode,
		LastAnswerFailureAt:   formatTime(m.lastAnswerFailureAt),
		LastAnswerSuccessAt:   formatTime(m.lastAnswerSuccessAt),
	}
}

func (m *Metrics) Prometheus() []byte {
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

	builder.WriteString("# HELP campus_go_shell_transport_saturated_total Total requests rejected by transport admission saturation.\n")
	builder.WriteString("# TYPE campus_go_shell_transport_saturated_total counter\n")
	fmt.Fprintf(
		&builder,
		"campus_go_shell_transport_saturated_total %d\n",
		m.transportSaturatedTotal,
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
