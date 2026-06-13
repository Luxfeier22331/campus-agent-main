package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestTemporalToolResultFromRunFindsSelectedToolResult(t *testing.T) {
	run := execution.DurableRun{
		RunID: "run-tool-result",
		Metadata: map[string]any{
			"temporal_tools": map[string]any{
				"service_status_lookup": map[string]any{
					"capability":   "campus_services",
					"payload_kind": "service_status_lookup",
					"result": map[string]any{
						"outcome": "resolved_current",
					},
					"result_ref": "projection://runs/run-tool-result/tools/service_status_lookup",
					"tool_name":  "service_status_lookup",
				},
			},
		},
	}

	result, err := temporalToolResultFromRun(
		run,
		"projection://runs/run-tool-result/tools/service_status_lookup",
		"service_status_lookup",
	)
	if err != nil {
		t.Fatalf("temporal tool result: %v", err)
	}
	if result.Capability != "campus_services" {
		t.Fatalf("capability = %q", result.Capability)
	}
	if result.PayloadKind != "service_status_lookup" {
		t.Fatalf("payload kind = %q", result.PayloadKind)
	}
	if result.ToolName != "service_status_lookup" {
		t.Fatalf("tool name = %q", result.ToolName)
	}
	if result.ResultRef != "projection://runs/run-tool-result/tools/service_status_lookup" {
		t.Fatalf("result ref = %q", result.ResultRef)
	}
	if result.Result["outcome"] != "resolved_current" {
		t.Fatalf("result outcome = %#v", result.Result["outcome"])
	}
}

func TestTemporalToolResultFromRunRejectsResultRefDrift(t *testing.T) {
	run := execution.DurableRun{
		RunID: "run-tool-drift",
		Metadata: map[string]any{
			"temporal_tools": map[string]any{
				"service_status_lookup": map[string]any{
					"capability":   "campus_services",
					"payload_kind": "service_status_lookup",
					"result":       map[string]any{"outcome": "resolved_current"},
					"result_ref":   "projection://runs/run-tool-drift/tools/service_status_lookup",
					"tool_name":    "service_status_lookup",
				},
			},
		},
	}

	_, err := temporalToolResultFromRun(
		run,
		"projection://runs/run-tool-drift/tools/other",
		"service_status_lookup",
	)
	if err == nil {
		t.Fatal("expected result ref drift error")
	}
	if !strings.Contains(err.Error(), "result ref drift") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestTypedToolFinalizationIsIdempotentAfterCompletedRun(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 9, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-tool-finalization",
		"conv-tool-finalization",
		now,
		map[string]any{
			"capability":    "campus_services",
			"payload_kind":  "service_status_lookup",
			"allowed_tools": []any{"service_status_lookup"},
			"payload":       map[string]any{"service_id": "library"},
		},
	)
	toolRef := temporalProjectionRef("run-tool-finalization", "tools/service_status_lookup")
	run, err := store.GetRun(context.Background(), "run-tool-finalization")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.replaceTemporalToolMetadata(context.Background(), run, func(metadata map[string]any) {
		metadata["service_status_lookup"] = map[string]any{
			"capability":   "campus_services",
			"payload_kind": "service_status_lookup",
			"result": map[string]any{
				"outcome": "resolved_current",
			},
			"result_ref": toolRef,
			"tool_name":  "service_status_lookup",
		}
	}); err != nil {
		t.Fatalf("replace temporal tool metadata: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-tool-finalization",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-tool-finalization",
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("start run: %v", err)
	}

	first, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			RunID:              "run-tool-finalization",
			SelectedCapability: "campus_services",
			SelectedTool:       "service_status_lookup",
			ToolResultRef:      toolRef,
			TraceID:            "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("first finalization: %v", err)
	}
	if first.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("first status = %q", first.Status)
	}

	second, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			RunID:              "run-tool-finalization",
			SelectedCapability: "campus_services",
			SelectedTool:       "service_status_lookup",
			ToolResultRef:      toolRef,
			TraceID:            "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("second finalization: %v", err)
	}
	if second.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("second status = %q", second.Status)
	}
	if second.ProjectionRef != first.ProjectionRef {
		t.Fatalf("second projection ref = %q, want %q", second.ProjectionRef, first.ProjectionRef)
	}
}

func TestTypedToolFinalizationRejectsLateCompletionAfterCanceledRun(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 9, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-tool-late-cancel",
		"conv-tool-late-cancel",
		now,
		map[string]any{
			"capability":    "campus_services",
			"payload_kind":  "service_status_lookup",
			"allowed_tools": []any{"service_status_lookup"},
			"payload":       map[string]any{"service_id": "library"},
		},
	)
	toolRef := temporalProjectionRef("run-tool-late-cancel", "tools/service_status_lookup")
	run, err := store.GetRun(context.Background(), "run-tool-late-cancel")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.replaceTemporalToolMetadata(context.Background(), run, func(metadata map[string]any) {
		metadata["service_status_lookup"] = map[string]any{
			"capability":   "campus_services",
			"payload_kind": "service_status_lookup",
			"result":       map[string]any{"outcome": "resolved_current"},
			"result_ref":   toolRef,
			"tool_name":    "service_status_lookup",
		}
	}); err != nil {
		t.Fatalf("replace temporal tool metadata: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-tool-late-cancel",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-tool-late-cancel",
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("start run: %v", err)
	}
	if _, err := store.CancelRunProjection(context.Background(), execution.DurableRunCancelRequest{
		RunID:  "run-tool-late-cancel",
		Reason: "user_requested",
		Now:    now.Add(4 * time.Second),
	}); err != nil {
		t.Fatalf("cancel run: %v", err)
	}

	_, err = server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			RunID:              "run-tool-late-cancel",
			SelectedCapability: "campus_services",
			SelectedTool:       "service_status_lookup",
			ToolResultRef:      toolRef,
			TraceID:            "trace-executor-001",
		},
	)
	if err == nil {
		t.Fatal("late typed finalization after cancel must fail")
	}
	if !strings.Contains(err.Error(), "already terminal: canceled") {
		t.Fatalf("error = %q, want already terminal canceled", err.Error())
	}
	canceledRun, err := store.GetRun(context.Background(), "run-tool-late-cancel")
	if err != nil {
		t.Fatalf("get canceled run: %v", err)
	}
	if canceledRun.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("run status = %q, want canceled", canceledRun.Status)
	}
	results, err := store.ListStepResults(context.Background(), "run-tool-late-cancel")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	for _, result := range results {
		if result.StepID == "finalization.write" {
			t.Fatalf("late cancel wrote finalization result: %#v", result)
		}
	}
}

func TestExecuteStructuredRuntimeSupportsNoticeChangeSetTypedTool(t *testing.T) {
	server := newServerForTest()
	response := server.executeStructuredRuntime(
		context.Background(),
		"campus_notice_change_set_lookup",
		[]byte(`{"payload":{"query_text":"丰台到海淀通勤车今天乘车点有没有变","route_labels":["丰台到海淀通勤车"],"service_date":"2026-01-02"}}`),
	)

	if response.StatusCode == http.StatusBadRequest {
		t.Fatalf("notice change-set typed tool must be routed to structured runtime, got body %#v", response.Body)
	}
	if response.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want fail-closed temporarily_unverifiable", response.Outcome)
	}
}

func TestExecuteTypedToolActivityFailureProjectsTypedCapability(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 12, 13, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-typed-tool-failure-capability",
		"conv-typed-tool-failure-capability",
		now,
		map[string]any{
			"capability":    "notice",
			"payload_kind":  "campus_notice_change_set_lookup",
			"allowed_tools": []any{"campus_notice_change_set_lookup"},
			"payload": map[string]any{
				"service_date": "2026-01-02",
			},
		},
	)

	_, err := server.ExecuteTypedToolActivity(
		context.Background(),
		temporalruntime.ExecuteTypedToolActivityInput{
			AllowedTools: []string{"campus_notice_change_set_lookup"},
			Capability:   "notice",
			Payload: map[string]any{
				"service_date": "2026-01-02",
			},
			PayloadKind: "campus_notice_change_set_lookup",
			RunID:       "run-typed-tool-failure-capability",
			ToolName:    "campus_notice_change_set_lookup",
			TraceID:     "trace-executor-001",
			WorkerRole:  "activity-worker-notice",
		},
	)
	if err == nil {
		t.Fatal("expected invalid notice change-set payload to fail closed")
	}
	steps, listErr := store.ListRunSteps(context.Background(), "run-typed-tool-failure-capability")
	if listErr != nil {
		t.Fatalf("list steps: %v", listErr)
	}
	if len(steps) != 1 {
		t.Fatalf("step count = %d, want failure step: %#v", len(steps), steps)
	}
	if steps[0].Capability != "notice" {
		t.Fatalf("failed typed tool capability = %q, want notice", steps[0].Capability)
	}
}
