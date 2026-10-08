package runtimeassembly

import (
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"

	"go.temporal.io/sdk/client"
)

// workerMetrics exports only SDK slot gauges consumed by the autoscaler. The SDK
// remains the owner of task lifecycle and values; no application counters are kept.
type workerMetrics struct {
	mu     sync.RWMutex
	values map[string]float64
}

type slotMetricsHandler struct {
	client.MetricsHandler
	metrics    *workerMetrics
	queue      string
	workerType string
}

type slotGauge struct {
	metrics *workerMetrics
	key     string
}

func newWorkerMetrics() *workerMetrics { return &workerMetrics{values: make(map[string]float64)} }

func (m *workerMetrics) handler() client.MetricsHandler {
	return slotMetricsHandler{MetricsHandler: client.MetricsNopHandler, metrics: m}
}

func (h slotMetricsHandler) WithTags(tags map[string]string) client.MetricsHandler {
	if value, ok := tags["task_queue"]; ok {
		h.queue = value
	}
	if value, ok := tags["worker_type"]; ok {
		h.workerType = value
	}
	return h
}

func (h slotMetricsHandler) Gauge(name string) client.MetricsGauge {
	if (name != "temporal_worker_task_slots_used" && name != "temporal_worker_task_slots_available") ||
		(h.workerType != "WorkflowWorker" && h.workerType != "ActivityWorker") {
		return client.MetricsNopHandler.Gauge(name)
	}
	key := name + "{task_queue=" + strconv.Quote(h.queue) + ",worker_type=" + strconv.Quote(h.workerType) + "}"
	// Registration makes idle workers visible before their first task arrives.
	h.metrics.mu.Lock()
	if _, exists := h.metrics.values[key]; !exists {
		h.metrics.values[key] = 0
	}
	h.metrics.mu.Unlock()
	return slotGauge{metrics: h.metrics, key: key}
}

func (g slotGauge) Update(value float64) {
	g.metrics.mu.Lock()
	g.metrics.values[g.key] = value
	g.metrics.mu.Unlock()
}

func (m *workerMetrics) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || r.URL.Path != "/metrics" {
		http.NotFound(w, r)
		return
	}
	m.mu.RLock()
	var body strings.Builder
	for _, metric := range []string{"temporal_worker_task_slots_used", "temporal_worker_task_slots_available"} {
		fmt.Fprintf(&body, "# HELP %s Temporal SDK task slots.\n# TYPE %s gauge\n", metric, metric)
	}
	keys := make([]string, 0, len(m.values))
	for key := range m.values {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		fmt.Fprintf(&body, "%s %s\n", key, strconv.FormatFloat(m.values[key], 'g', -1, 64))
	}
	m.mu.RUnlock()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(body.String()))
}

func (runtime *Runtime) MetricsHandler() http.Handler { return runtime.metrics }
