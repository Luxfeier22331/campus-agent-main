package operation

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
	"strings"
	"time"
)

// PrepareRuntimeOperation builds the admitted input without claiming a model
// invocation. Model-turn receipts are claimed separately by the Runtime Worker.
func (s *OperationService) PrepareRuntimeOperation(ctx context.Context, req OperationRequest) (executionapplication.AgentRuntimeRequest, error) {
	run, err := s.TemporalActivityRun(ctx, req.RequestID)
	if err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	if run.ConversationID != req.ConversationID {
		return executionapplication.AgentRuntimeRequest{}, errors.New("runtime conversation identity mismatch")
	}
	if err := execution.ValidateAdmissionSnapshot(req.AdmissionSnapshot); err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	run, err = s.BeginWorkflowRun(ctx, run, time.Now().UTC())
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
	if err := s.ProjectStep(ctx, activityprojection.StepProjection{
		Run: run, Attempt: 1, Status: "started", StepID: req.StepID, StepKind: req.StepKind,
		TaskQueue: "campus-agent.agent.model.v1", WorkerID: s.WorkerID,
		StartedAt: startedAt, UpdatedAt: startedAt,
		ProjectionRef: activityprojection.WorkflowOperationResultRef(run.RequestID, req.StepID),
		Payload:       map[string]any{"operation": string(req.Operation), "visible_function_tool_names": req.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames},
	}); err != nil {
		return executionapplication.AgentRuntimeRequest{}, err
	}
	return WorkflowOperationRuntimeRequest(run, req, conversation, limits, 1), nil
}
