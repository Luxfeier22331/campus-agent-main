package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestMemoryReflectActivityProjectsSanitizedReflection(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 13, 5, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-reflect", "我之后主要关注保研材料", ptrBool(true), now)
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-reflect"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.MemoryReflectActivity(
		context.Background(),
		temporalruntime.MemoryReflectActivityInput{
			IncludeBasedOn: true,
			Query:          "总结用户长期偏好",
			RequestID:      "req-memory-reflect",
			RunID:          "run-memory-reflect",
			TraceID:        memoryAppendTraceID("run-memory-reflect"),
		},
	)
	if err != nil {
		t.Fatalf("memory reflect: %v", err)
	}
	if output.Status != "completed" ||
		output.ReflectRef != "projection://runs/run-memory-reflect/memory/reflect" {
		t.Fatalf("reflect output = %#v", output)
	}
	if executor.seenReflect.UserID != "user-executor" ||
		executor.seenReflect.TenantID != "tenant-main" ||
		executor.seenReflect.ThreadID != "conv-run-memory-reflect" ||
		executor.seenReflect.Query != "总结用户长期偏好" ||
		!executor.seenReflect.IncludeBasedOn {
		t.Fatalf("seen reflect = %#v", executor.seenReflect)
	}

	payload := memoryStepResultPayloadForTest(t, store, "run-memory-reflect", "memory.reflect")
	if payload["reflect_ref"] != "projection://runs/run-memory-reflect/memory/reflect" ||
		payload["schema_version"] != "memory_reflect_result_v1" ||
		payload["status"] != "completed" ||
		payload["text"] != "用户偏好先给结论。" {
		t.Fatalf("payload = %#v, want sanitized reflect projection", payload)
	}
	if _, ok := payload["tool_calls"].([]any); ok {
		t.Fatalf("reflect projection leaked raw tool calls: %#v", payload)
	}
}

func memoryStepResultPayloadForTest(t *testing.T, store *execution.InMemoryRunProjectionStore, runID string, stepID string) map[string]any {
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
