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

func rejectRetiredPromptRuntimeSettings() error {
	retired := []string{
		"PROMPT_RUNTIME_PROVIDER",
		"PROMPT_RUNTIME_MODEL",
		"PROMPT_RUNTIME_API_KEY",
		"PROMPT_RUNTIME_TRANSPORT",
		"PROMPT_RUNTIME_BASE_URL",
		"PROMPT_RUNTIME_REASONING_EFFORT",
		"PROMPT_RUNTIME_MAX_OUTPUT_TOKENS",
		"PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS",
		"PROMPT_RUNTIME_READ_TIMEOUT_SECONDS",
		"PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS",
		"PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS",
		"PROMPT_RUNTIME_MAX_CONNECTIONS",
		"PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS",
		"PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS",
		"PROMPT_STRICT_STRUCTURED_OUTPUTS",
		"EXECUTION_PROMPT_MODEL",
		"SUPERVISOR_PROMPT_MODEL",
		"EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; use provider-config projection profiles", name)
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
			return fmt.Errorf("%s is retired; personal memory uses Hindsight", name)
		}
	}
	return nil
}

func rejectRetiredPredecessorMemorySettings() error {
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
			return fmt.Errorf("%s is retired; use PERSONAL_MEMORY_* for Hindsight", name)
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
			return fmt.Errorf("%s is retired; use the Go execution runtime", name)
		}
	}
	return nil
}
