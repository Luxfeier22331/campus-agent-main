package execution

import (
	"context"
	"errors"
	"testing"
)

func TestInMemoryWorkflowRunStoreTracksRunStateAndDefensiveCopies(t *testing.T) {
	store := NewInMemoryWorkflowRunStore()
	ctx := context.Background()
	run := WorkflowRun{
		RunID:     "run-001",
		RequestID: "req-001",
		TraceID:   "trace-001",
		PlanID:    "plan:single_step:knowledge:rag_request",
		Mode:      WorkflowModeSingleStep,
		Branch:    "delegate",
		State:     WorkflowStatePending,
	}

	created, err := store.Create(ctx, run)
	if err != nil {
		t.Fatalf("create workflow run: %v", err)
	}
	created.State = WorkflowStateFailed

	stored, err := store.Get(ctx, "run-001")
	if err != nil {
		t.Fatalf("get workflow run: %v", err)
	}
	if stored.State != WorkflowStatePending {
		t.Fatalf("stored state = %q, want pending defensive copy", stored.State)
	}

	allowedTools := []string{"retrieval.query"}
	withHandoff, err := store.AppendHandoff(ctx, "run-001", HandoffStep{
		Capability:   "knowledge",
		PayloadKind:  "rag_request",
		AllowedTools: allowedTools,
		SelectedTool: "retrieval.query",
	})
	if err != nil {
		t.Fatalf("append capability: %v", err)
	}
	allowedTools[0] = "mutated"
	withHandoff.HandoffChain[0].AllowedTools[0] = "mutated-again"

	withStep, err := store.AppendStep(ctx, "run-001", WorkflowStep{
		StepID:       "tool_call",
		SpanKind:     "tool_call",
		ParentStepID: "handoff",
		Capability:   "knowledge",
		ToolName:     "retrieval.query",
		Outcome:      "completed",
		ResultStatus: "completed",
	})
	if err != nil {
		t.Fatalf("append step: %v", err)
	}
	withStep.Steps[0].ToolName = "mutated"

	withProjection, err := store.AppendStepOutputProjection(ctx, "run-001", StepOutputProjection{
		ProjectionID:   "proj-notice-001",
		SourceStepID:   "capability:notice:campus_notice_get",
		ProjectionKind: ProjectionKindNoticeContext,
		ContentHash:    "sha256:test",
		Payload: map[string]any{
			"title": "smoke notice",
		},
		Safety: ProjectionSafetySummary{
			MaxChars:      1600,
			FieldsPresent: []string{"title"},
		},
	})
	if err != nil {
		t.Fatalf("append step output projection: %v", err)
	}
	withProjection.ContextProjections[0].Payload["title"] = "mutated"
	withProjection.ContextProjections[0].Safety.FieldsPresent[0] = "mutated"

	withInvocation, err := store.AppendCapabilityInvocation(ctx, "run-001", CapabilityInvocation{
		InvocationID:   "capability-invocation:knowledge:1",
		WorkflowRunRef: "run-001",
		StepID:         "capability:knowledge:rag_request",
		CapabilityID:   "knowledge",
		Status:         "completed",
		AllowedTools:   []string{"retrieval.query"},
		UsedTools:      []string{"retrieval.query"},
	})
	if err != nil {
		t.Fatalf("append agent invocation: %v", err)
	}
	withInvocation.CapabilityInvocations[0].AllowedTools[0] = "mutated"

	withToolCallSummary, err := store.AppendToolCallSummary(ctx, "run-001", ToolCallSummary{
		ToolCallID:        "run-001:tool_call",
		WorkflowRunRef:    "run-001",
		StepID:            "tool_call",
		LifecycleState:    "completed",
		ResultProjection:  "bounded_summary",
		RawResultIncluded: false,
		ToolName:          "retrieval.query",
		Capability:        "knowledge",
		ResultStatus:      "completed",
		ArgumentSummary:   map[string]any{"collection": "student_rules"},
		SourceIDs:         []string{"student_rules:library"},
		SafeDetails:       map[string]any{"schema_version": "agent-execution-projection-v1"},
	})
	if err != nil {
		t.Fatalf("append tool call summary: %v", err)
	}
	withToolCallSummary.ToolCallSummaries[0].ArgumentSummary["collection"] = "mutated"
	withToolCallSummary.ToolCallSummaries[0].SourceIDs[0] = "mutated"

	completed, err := store.Complete(ctx, "run-001", WorkflowStateCompleted)
	if err != nil {
		t.Fatalf("complete workflow run: %v", err)
	}
	if completed.State != WorkflowStateCompleted {
		t.Fatalf("completed state = %q, want completed", completed.State)
	}
	if completed.HandoffChain[0].AllowedTools[0] != "retrieval.query" {
		t.Fatalf("stored handoff = %#v, want defensive copy", completed.HandoffChain[0])
	}
	if completed.Steps[0].ToolName != "retrieval.query" {
		t.Fatalf("stored step = %#v, want defensive copy", completed.Steps[0])
	}
	if completed.ContextProjections[0].Payload["title"] != "smoke notice" {
		t.Fatalf(
			"stored projection payload = %#v, want defensive copy",
			completed.ContextProjections[0].Payload,
		)
	}
	if completed.ContextProjections[0].Safety.FieldsPresent[0] != "title" {
		t.Fatalf(
			"stored projection safety = %#v, want defensive copy",
			completed.ContextProjections[0].Safety,
		)
	}
	if completed.CapabilityInvocations[0].AllowedTools[0] != "retrieval.query" {
		t.Fatalf(
			"stored agent invocation = %#v, want defensive copy",
			completed.CapabilityInvocations[0],
		)
	}
	if completed.ToolCallSummaries[0].ArgumentSummary["collection"] != "student_rules" {
		t.Fatalf(
			"stored tool call summary argument = %#v, want defensive copy",
			completed.ToolCallSummaries[0].ArgumentSummary,
		)
	}
	if completed.ToolCallSummaries[0].SourceIDs[0] != "student_rules:library" {
		t.Fatalf(
			"stored tool call summary source ids = %#v, want defensive copy",
			completed.ToolCallSummaries[0].SourceIDs,
		)
	}
}

func TestInMemoryWorkflowRunStoreRejectsInvalidRunTransitions(t *testing.T) {
	store := NewInMemoryWorkflowRunStore()
	ctx := context.Background()
	if _, err := store.Create(ctx, WorkflowRun{}); err == nil {
		t.Fatal("expected create without run id to fail")
	}
	if _, err := store.Get(ctx, "missing"); !errors.Is(err, ErrWorkflowRunNotFound) {
		t.Fatalf("missing get error = %v, want ErrWorkflowRunNotFound", err)
	}

	_, err := store.Create(ctx, WorkflowRun{
		RunID: "run-multi",
		Mode:  WorkflowModeMultiStep,
		State: WorkflowStatePending,
	})
	if err != nil {
		t.Fatalf("create multi-step run: %v", err)
	}
	if _, err := store.Complete(ctx, "run-multi", WorkflowStateCompleted); err == nil {
		t.Fatal("expected completed multi-step run without handoff chain to fail")
	}
	_, err = store.AppendHandoff(ctx, "run-multi", HandoffStep{Capability: "knowledge"})
	if err != nil {
		t.Fatalf("append first multi-step capability: %v", err)
	}
	if _, err := store.Complete(ctx, "run-multi", WorkflowStateCompleted); err == nil {
		t.Fatal("expected completed multi-step run with one handoff to fail")
	}
	_, err = store.AppendHandoff(ctx, "run-multi", HandoffStep{Capability: "notice"})
	if err != nil {
		t.Fatalf("append second multi-step capability: %v", err)
	}
	if _, err := store.Complete(ctx, "run-multi", WorkflowStateCompleted); err != nil {
		t.Fatalf("complete valid multi-step run: %v", err)
	}
}
