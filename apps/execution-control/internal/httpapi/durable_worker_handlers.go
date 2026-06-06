package httpapi

import (
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *Server) handleDurableWorkerProcessNext(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.durableRuntime == nil || s.durableLeaseCoordinator == nil {
		setOutcome(response, "durable_runtime_not_configured")
		writeError(
			response,
			http.StatusServiceUnavailable,
			"durable_runtime_not_configured",
			"Durable runtime store is not configured.",
			true,
		)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	payload, err := decodeJSONObject(body)
	if err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Process request body must be a JSON object.", false)
		return
	}
	workerID := requiredStringFromMap(payload, "worker_id")
	stepID := requiredStringFromMap(payload, "step_id")
	leaseID := requiredStringFromMap(payload, "lease_id")
	lane := execution.DurableLane(requiredStringFromMap(payload, "lane"))
	leaseTTLMS := requiredPositiveIntFromMap(payload, "lease_ttl_ms")
	leaseHeartbeatIntervalMS := requiredPositiveIntFromMap(payload, "lease_heartbeat_interval_ms")
	switch {
	case workerID == "":
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "worker_id is required.", false)
		return
	case stepID == "":
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "step_id is required.", false)
		return
	case leaseID == "":
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "lease_id is required.", false)
		return
	case lane == "":
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "lane is required.", false)
		return
	case leaseTTLMS <= 0:
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "lease_ttl_ms is required.", false)
		return
	case leaseHeartbeatIntervalMS <= 0:
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "lease_heartbeat_interval_ms is required.", false)
		return
	case leaseHeartbeatIntervalMS >= leaseTTLMS:
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "lease_heartbeat_interval_ms must be shorter than lease_ttl_ms.", false)
		return
	}
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:                  s.durableRuntime,
		Coordinator:            s.durableLeaseCoordinator,
		Bridge:                 s.bridge,
		WorkerID:               workerID,
		StepID:                 stepID,
		Lane:                   lane,
		LeaseID:                leaseID,
		LeaseTTL:               time.Duration(leaseTTLMS) * time.Millisecond,
		LeaseHeartbeatInterval: time.Duration(leaseHeartbeatIntervalMS) * time.Millisecond,
	})
	result, err := executor.ProcessNext(request.Context())
	if err != nil {
		setOutcome(response, "durable_worker_process_failed")
		writeError(response, http.StatusConflict, "durable_worker_process_failed", err.Error(), true)
		return
	}
	setOutcome(response, "durable_worker_processed")
	writeJSON(response, http.StatusOK, map[string]any{
		"run_id":   result.RunID,
		"lease_id": result.LeaseID,
		"status":   string(result.Status),
	})
}

func requiredPositiveIntFromMap(payload map[string]any, key string) int {
	value, ok := payload[key]
	if !ok {
		return 0
	}
	number, ok := value.(float64)
	if !ok || number <= 0 || number != float64(int(number)) {
		return 0
	}
	return int(number)
}
