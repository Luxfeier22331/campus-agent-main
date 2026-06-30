package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestMemoryOperationStatusActivityProjectsSanitizedStatus(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 13, 0, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-operation-status", "我之后主要关注保研材料", ptrBool(true), now)
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-operation-status"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.MemoryOperationStatusActivity(
		context.Background(),
		temporalruntime.MemoryOperationStatusActivityInput{
			OperationID: "op-memory-status",
			RequestID:   "req-memory-operation-status",
			RunID:       "run-memory-operation-status",
			TraceID:     memoryAppendTraceID("run-memory-operation-status"),
		},
	)
	if err != nil {
		t.Fatalf("memory operation status: %v", err)
	}
	if output.Status != "completed" || output.OperationID != "op-memory-status" {
		t.Fatalf("operation status output = %#v", output)
	}
	if executor.seenOperationStatus.UserID != "user-executor" ||
		executor.seenOperationStatus.TenantID != "tenant-main" {
		t.Fatalf("seen operation status = %#v", executor.seenOperationStatus)
	}

	payload := memoryStepResultPayloadForTest(t, store, "run-memory-operation-status", "memory.operation_status")
	if payload["operation_id"] != "op-memory-status" ||
		payload["operation_ref"] != "projection://runs/run-memory-operation-status/memory/operations/op-memory-status" ||
		payload["status"] != "completed" ||
		payload["schema_version"] != "memory_operation_status_result_v1" {
		t.Fatalf("payload = %#v, want sanitized operation status projection", payload)
	}
	if _, ok := payload["result_metadata"].(map[string]any); ok {
		t.Fatalf("operation status projection leaked raw result metadata: %#v", payload)
	}
	if _, ok := payload["error_message"].(string); ok {
		t.Fatalf("operation status projection leaked raw error message: %#v", payload)
	}
}

func memoryStepResultPayloadForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	stepID string,
) map[string]any {
	t.Helper()
	results, err := store.ListStepResults(context.Background(), runID)
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	for _, result := range results {
		if result.StepID == stepID {
			return result.SanitizedPayload
		}
	}
	t.Fatalf("%s projection missing in run %s", stepID, runID)
	return nil
}
