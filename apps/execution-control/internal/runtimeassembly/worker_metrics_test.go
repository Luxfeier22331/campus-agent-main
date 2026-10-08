package runtimeassembly

import (
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestWorkerMetricsSDKGauges(t *testing.T) {
	m := newWorkerMetrics()
	h := m.handler().WithTags(map[string]string{"task_queue": "agent", "worker_type": "ActivityWorker", "workflow_id": "must-not-export"})
	h.Gauge("temporal_worker_task_slots_used")
	read := func() string {
		recorder := httptest.NewRecorder()
		m.ServeHTTP(recorder, httptest.NewRequestWithContext(t.Context(), "GET", "/metrics", nil))
		return recorder.Body.String()
	}
	if !strings.Contains(read(), `temporal_worker_task_slots_used{task_queue="agent",worker_type="ActivityWorker"} 0`) {
		t.Fatal(read())
	}
	h.Gauge("temporal_worker_task_slots_used").Update(4)
	h.Gauge("temporal_worker_task_slots_available").Update(0)
	// Tagged handlers must not mutate their parents or export unrelated SDK metrics.
	h.WithTags(map[string]string{"task_queue": "core"}).Gauge("temporal_worker_task_slots_used").Update(2)
	h.Gauge("unconsumed_gauge").Update(9)
	body := read()
	if !strings.Contains(body, `task_queue="agent",worker_type="ActivityWorker"} 4`) || !strings.Contains(body, `task_queue="core",worker_type="ActivityWorker"} 2`) {
		t.Fatal(body)
	}
	if strings.Contains(body, "workflow_id") || strings.Contains(body, "unconsumed_gauge") {
		t.Fatal(body)
	}
	h.Gauge("temporal_worker_task_slots_used").Update(0)
	if !strings.Contains(read(), `task_queue="agent",worker_type="ActivityWorker"} 0`) {
		t.Fatal(read())
	}
}

func TestWorkerMetricsConcurrentSDKUpdatesAndScrapes(t *testing.T) {
	m := newWorkerMetrics()
	h := m.handler()
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			gauge := h.WithTags(map[string]string{"task_queue": "agent", "worker_type": "ActivityWorker"}).Gauge("temporal_worker_task_slots_used")
			for i := range 100 {
				gauge.Update(float64(i))
				m.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), "GET", "/metrics", nil))
			}
		})
	}
	wg.Wait()
}
