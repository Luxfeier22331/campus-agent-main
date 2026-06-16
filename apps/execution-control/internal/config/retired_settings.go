package config

import (
	"fmt"
	"os"
	"strings"
)

func rejectRetiredDurableWorkerLoopSettings() error {
	retired := []string{
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_WORKER_ID",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LANE",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_POLL_INTERVAL_MS",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_TTL_MS",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_HEARTBEAT_INTERVAL_MS",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; use Temporal workers", name)
		}
	}
	return nil
}

func rejectRetiredDurableRecoveryLoopSettings() error {
	retired := []string{
		"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED",
		"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_INTERVAL_MS",
		"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_MAX_RETRY_ATTEMPTS",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; use Temporal retry and timeout policies", name)
		}
	}
	return nil
}

func rejectRetiredPythonBridgeSettings() error {
	retired := []string{
		"SUPERVISOR_AGENT_WORKER_BASE_URL",
		"SUPERVISOR_AGENT_WORKER_SHARED_SECRET",
		"SUPERVISOR_AGENT_WORKER_RESPONSE_LIMIT_BYTES",
		"SUPERVISOR_AGENT_WORKER_TIMEOUT_MS",
		"SUPERVISOR_AGENT_WORKER_CANCEL_TIMEOUT_MS",
		"EXECUTION_CONTROL_BRIDGE_BREAKER_FAILURE_THRESHOLD",
		"EXECUTION_CONTROL_BRIDGE_BREAKER_OPEN_MS",
		"EXECUTION_CONTROL_BRIDGE_RETRY_MAX_ATTEMPTS",
		"EXECUTION_CONTROL_BRIDGE_RETRY_BASE_MS",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; online answer execution uses Temporal RAG activities", name)
		}
	}
	return nil
}

func rejectRetiredSupervisorSettings() error {
	retired := []string{
		"SUPERVISOR_PROMPT_MODEL",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; use EXECUTION_PROMPT_MODEL", name)
		}
	}
	return nil
}

func rejectRetiredPersonalMemoryQdrantSettings() error {
	retired := []string{
		"PERSONAL_MEMORY_COLLECTION",
		"PERSONAL_MEMORY_TOP_K",
		"PERSONAL_MEMORY_MAX_CHARS",
		"PERSONAL_MEMORY_SCORE_THRESHOLD",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; personal memory uses Zep CE", name)
		}
	}
	return nil
}

func rejectRetiredZepMemorySettings() error {
	retired := []string{
		"ZEP_BASE_URL",
		"ZEP_API_KEY",
		"ZEP_PROJECT_SALT",
		"ZEP_TIMEOUT_SECONDS",
		"ZEP_RECALL_MAX_CHARS",
		"ZEP_ASSISTANT_NAME",
		"ZEP_USER_NAME",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; use PERSONAL_MEMORY_* for Zep CE", name)
		}
	}
	return nil
}
