package httpapi

import (
	"net/http"
	"strings"
)

func routeLabelFor(method string, path string) string {
	switch {
	case method == http.MethodGet && path == "/healthz":
		return "/healthz"
	case method == http.MethodGet && path == "/readyz":
		return "/readyz"
	case method == http.MethodGet && path == "/metrics":
		return "/metrics"
	case method == http.MethodPost && path == "/internal/execution/runs":
		return "/internal/execution/runs"
	case method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/runs/") &&
		strings.HasSuffix(path, "/steps"):
		return "/internal/execution/runs/:runId/steps"
	case method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/runs/") &&
		strings.HasSuffix(path, "/events"):
		return "/internal/execution/runs/:runId/events"
	case method == http.MethodPost && strings.HasPrefix(path, "/internal/execution/runs/") &&
		strings.HasSuffix(path, "/cancel"):
		return "/internal/execution/runs/:runId/cancel"
	case method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/runs/"):
		return "/internal/execution/runs/:runId"
	case method == http.MethodPost && path == "/internal/query/campus-services/service-status":
		return "/internal/query/campus-services/service-status"
	case method == http.MethodPost && path == "/internal/query/campus-services/service-guide":
		return "/internal/query/campus-services/service-guide"
	case method == http.MethodPost && path == "/internal/query/campus-services/transport-schedule":
		return "/internal/query/campus-services/transport-schedule"
	case method == http.MethodPost && path == "/internal/query/campus-services/contact-directory":
		return "/internal/query/campus-services/contact-directory"
	case method == http.MethodPost && path == "/internal/query/calendar/academic-calendar":
		return "/internal/query/calendar/academic-calendar"
	case method == http.MethodPost && path == "/internal/query/notices/discover":
		return "/internal/query/notices/discover"
	case method == http.MethodPost && path == "/internal/query/notices/get":
		return "/internal/query/notices/get"
	default:
		return "/__unknown__"
	}
}

func defaultOutcome(path string, statusCode int) string {
	if path == "/readyz" {
		if statusCode == http.StatusOK {
			return "ready"
		}
		return "degraded"
	}
	if path == "/metrics" || path == "/healthz" {
		return "ok"
	}
	if statusCode == 499 {
		return "client_canceled"
	}
	if statusCode == http.StatusNotFound {
		return "not_found"
	}
	return "unknown"
}

type observedResponseWriter struct {
	http.ResponseWriter
	status       int
	wrote        bool
	outcomeValue string
	traceIDValue string
}

func newObservedResponseWriter(writer http.ResponseWriter) *observedResponseWriter {
	return &observedResponseWriter{
		ResponseWriter: writer,
	}
}

func (w *observedResponseWriter) Write(body []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func (w *observedResponseWriter) WriteHeader(status int) {
	w.status = status
	w.wrote = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *observedResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *observedResponseWriter) statusCode() int {
	if w.wrote {
		return w.status
	}
	if w.outcomeValue == "client_canceled" {
		return 499
	}
	return 0
}

func (w *observedResponseWriter) outcome() string {
	return w.outcomeValue
}

func (w *observedResponseWriter) traceID() string {
	return w.traceIDValue
}

type outcomeSetter interface {
	setOutcome(string)
}

type traceIDSetter interface {
	setTraceID(string)
}

func (w *observedResponseWriter) setOutcome(outcome string) {
	w.outcomeValue = outcome
}

func (w *observedResponseWriter) setTraceID(traceID string) {
	w.traceIDValue = traceID
}

func setOutcome(response http.ResponseWriter, outcome string) {
	if writer, ok := response.(outcomeSetter); ok {
		writer.setOutcome(outcome)
	}
}

func setTraceID(response http.ResponseWriter, traceID string) {
	if writer, ok := response.(traceIDSetter); ok {
		writer.setTraceID(traceID)
	}
}
