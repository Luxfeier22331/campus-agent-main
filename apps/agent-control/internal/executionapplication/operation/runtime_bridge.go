package operation

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"strings"
	"time"
)

// PrepareRuntimeOperation builds the admitted input without claiming a model
// invocation. Model-turn receipts are claimed separately by the Runtime Worker.
func (s *RuntimeInputService) PrepareRuntimeOperation(ctx context.Context, req OperationRequest) (executionapplication.AgentRuntimeRequest, error) {
	run, err := s.Projection.TemporalActivityRun(ctx, req.RequestID)
	if err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	if run.ConversationID != req.ConversationID {
		return executionapplication.AgentRuntimeRequest{}, errors.New("runtime conversation identity mismatch")
	}
	if err := execution.ValidateAdmissionSnapshot(req.AdmissionSnapshot); err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	run, err = s.Projection.BeginWorkflowRun(ctx, run, time.Now().UTC())
	if err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	payload, err := s.LoadExecutionPayload(ctx, run)
	if err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	req.Goal = strings.TrimSpace(execution.StringValue(payload["user_goal"]))
	if req.Payload == nil {
		req.Payload = map[string]any{}
	}
	req.Payload["goal"] = req.Goal
	if err := ValidateWorkflowOperationRequest(req); err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	limits := LimitsFromAdmissionSnapshot(req.AdmissionSnapshot.AgentLimits)
	limits.MaxTurns = req.AdmissionSnapshot.AgentBudget.MaxModelTurns
	limits.MaxFunctionToolCalls = req.AdmissionSnapshot.AgentBudget.MaxFunctionToolCalls
	limits.MaxPlanSteps = req.AdmissionSnapshot.AgentBudget.MaxPlanSteps
	limits.MaxReplans = req.AdmissionSnapshot.AgentBudget.MaxReplans
	conversation, err := WorkflowConversationContextForRun(payload, limits)
	if err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	if req.Operation == executioncontract.WorkflowOperationSolve || req.Operation == executioncontract.WorkflowOperationExecuteStep {
		req.Stream = s.streamModelAnswers()
	}
	startedAt := time.Now().UTC()
	if evidence := s.Projection.InvocationEvidence(ctx); evidence.Present {
		startedAt = evidence.StartedTime
	}
	if err := s.Projection.ProjectStep(ctx, activityprojection.StepProjection{
		Run: run, Attempt: 1, Status: "started", StepID: req.StepID, StepKind: req.StepKind,
		WorkerID:  s.Projection.WorkerID,
		StartedAt: startedAt, UpdatedAt: startedAt,
		ProjectionRef: activityprojection.WorkflowOperationResultRef(run.RequestID, req.StepID),
		Payload:       map[string]any{"operation": string(req.Operation), "visible_function_tool_names": req.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames},
	}); err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	return WorkflowOperationRuntimeRequest(run, req, conversation, limits, 1), nil
}

func (s *RuntimeInputService) LoadToolContext(ctx context.Context, requestID string) (map[string]any, time.Time, error) {
	run, err := s.Projection.RunProjectionStore.GetRun(ctx, requestID)
	if err != nil {
		return nil, time.Time{}, err
	}
	payload, err := s.LoadExecutionPayload(ctx, run)
	if err != nil {
		return nil, time.Time{}, err
	}
	payload["user_id"] = run.OwnerUserID
	return payload, run.CreatedAt, nil
}
