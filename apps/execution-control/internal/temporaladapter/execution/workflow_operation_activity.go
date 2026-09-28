package execution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/citationdiagnostic"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const WorkflowOperationInvocationSchemaVersion = "workflow_operation_invocation.v1"

// SolveTask decides whether the request can be answered in this operation or
// needs a durable task plan. It owns no browser-visible output; answer text is
// streamed through the internal runtime contract and finalized by Temporal.
// streamModelAnswers reports whether solve/execute_step operations should stream
// model answer deltas to the browser. It is gated by the answer-transport switch
// (EXECUTION_CONTROL_ANSWER_TRANSPORT) and defaults to buffered while the
// provider gateway rejects streaming requests that declare function tools.
func (s *Adapter) streamModelAnswers() bool {
	return s.Config.AnswerTransport == config.AnswerTransportStream
}

func (s *Adapter) SolveTask(
	ctx context.Context,
	input temporalruntime.SolveTaskActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return s.RunWorkflowOperationActivity(ctx, WorkflowOperationActivityRequest{
		AdmissionSnapshot: workflowcontract.AdmissionToDomain(input.AdmissionSnapshot),
		ConversationID:    input.ConversationID,
		MaxSteps:          input.MaxSteps,
		Operation:         temporalruntime.WorkflowOperationSolve,
		Payload: map[string]any{
			"max_steps": input.MaxSteps,
		},
		RequestID:   input.RequestID,
		StepID:      "solve.initial",
		StepKind:    "solver",
		Stream:      s.streamModelAnswers(),
		TraceParent: input.TraceParent,
	})
}

// ExecuteTaskStep is the executor activity for one durable plan step.
func (s *Adapter) ExecuteTaskStep(
	ctx context.Context,
	input temporalruntime.ExecuteTaskStepActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	stepID := WorkflowTaskStepID(input.Step.ID)
	return s.RunWorkflowOperationActivity(ctx, WorkflowOperationActivityRequest{
		PriorEvidence:       input.PriorEvidence,
		PriorSourceAttempts: input.PriorSourceAttempts,
		AdmissionSnapshot:   workflowcontract.AdmissionToDomain(input.AdmissionSnapshot),
		CompletedSteps:      input.CompletedSteps,
		ConversationID:      input.ConversationID,
		Operation:           temporalruntime.WorkflowOperationExecuteStep,
		Payload: map[string]any{
			"completed_steps": input.CompletedSteps,
			"citation_start":  input.CitationStart,
			"plan":            input.Plan,
			"step":            input.Step,
		},
		RequestID:     input.RequestID,
		CitationStart: input.CitationStart,
		Plan:          &input.Plan,
		Step:          &input.Step,
		StepID:        stepID,
		StepKind:      "executor",
		Stream:        s.streamModelAnswers(),
		TraceParent:   input.TraceParent,
	})
}

// ReplanTask inspects the accumulated evidence and can replace the remaining
// plan. Its index is part of the durable step identity so retries never create
// a second provider invocation for the same replanning decision.
func (s *Adapter) ReplanTask(
	ctx context.Context,
	input temporalruntime.ReplanTaskActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	if input.ReplanIndex <= 0 {
		return temporalruntime.WorkflowOperationActivityOutput{}, WorkflowOperationInputError(
			"replan_index must be positive",
		)
	}
	return s.RunWorkflowOperationActivity(ctx, WorkflowOperationActivityRequest{
		AdmissionSnapshot:   workflowcontract.AdmissionToDomain(input.AdmissionSnapshot),
		CompletedSteps:      input.CompletedSteps,
		ConversationID:      input.ConversationID,
		Operation:           temporalruntime.WorkflowOperationReplan,
		PriorEvidence:       input.PriorEvidence,
		PriorSourceAttempts: input.PriorSourceAttempts,
		Payload: map[string]any{
			"completed_steps":     input.CompletedSteps,
			"max_remaining_steps": input.MaxRemainingSteps,
			"plan":                input.Plan,
			"remaining_steps":     input.RemainingSteps,
		},
		RequestID:         input.RequestID,
		Plan:              &input.Plan,
		RemainingSteps:    append([]temporalruntime.WorkflowTaskPlanStep{}, input.RemainingSteps...),
		MaxRemainingSteps: input.MaxRemainingSteps,
		ReplanIndex:       input.ReplanIndex,
		StepID:            fmt.Sprintf("solve.replan.%d", input.ReplanIndex),
		StepKind:          "replanner",
		TraceParent:       input.TraceParent,
	})
}

// SynthesizeAnswer generates a final answer from existing materials. Recovery
// after visible Solve deltas is buffered so separate answers cannot interleave.
func (s *Adapter) SynthesizeAnswer(
	ctx context.Context,
	input temporalruntime.SynthesizeAnswerActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	mode := strings.TrimSpace(input.Mode)
	if mode == "" {
		mode = "planned"
	}
	payload := map[string]any{
		"remaining_facts": append([]temporalruntime.WorkflowRemainingFacts{}, input.RemainingFacts...),
		"evidence":        append([]temporalruntime.WorkflowEvidence{}, input.Evidence...),
		"mode":            mode,
		"source_attempts": append([]temporalruntime.WorkflowSourceAttempt{}, input.SourceAttempts...),
	}
	if strings.TrimSpace(input.RecoveryReason) != "" {
		payload["recovery_reason"] = input.RecoveryReason
	}
	return s.RunWorkflowOperationActivity(ctx, WorkflowOperationActivityRequest{
		AdmissionSnapshot: workflowcontract.AdmissionToDomain(input.AdmissionSnapshot),
		ConversationID:    input.ConversationID,
		Evidence:          input.Evidence,
		Mode:              mode,
		RecoveryReason:    input.RecoveryReason,
		SourceAttempts:    input.SourceAttempts,
		Operation:         temporalruntime.WorkflowOperationSynthesize,
		Payload:           payload,
		RequestID:         input.RequestID,
		StepID:            "answer.synthesize",
		StepKind:          "synthesizer",
		Stream:            !input.BufferAnswer,
		TraceParent:       input.TraceParent,
	})
}

type WorkflowOperationActivityRequest struct {
	PriorEvidence       []temporalruntime.WorkflowEvidence
	PriorSourceAttempts []temporalruntime.WorkflowSourceAttempt
	AdmissionSnapshot   execution.AgentAdmissionSnapshot
	CompletedSteps      []temporalruntime.WorkflowCompletedStep
	ConversationID      string
	CitationStart       int
	Evidence            []temporalruntime.WorkflowEvidence
	Mode                string
	RecoveryReason      string
	SourceAttempts      []temporalruntime.WorkflowSourceAttempt
	Goal                string
	MaxSteps            int
	MaxRemainingSteps   int
	Operation           temporalruntime.WorkflowOperation
	Payload             map[string]any
	Plan                *temporalruntime.WorkflowTaskPlan
	RemainingSteps      []temporalruntime.WorkflowTaskPlanStep
	RequestID           string
	ReplanIndex         int
	StepID              string
	StepKind            string
	Stream              bool
	Step                *temporalruntime.WorkflowTaskPlanStep
	TraceParent         string
}

func (s *Adapter) RunWorkflowOperationActivity(
	ctx context.Context,
	request WorkflowOperationActivityRequest,
) (result temporalruntime.WorkflowOperationActivityOutput, resultErr error) {
	// Detailed diagnostics stay in the operation receipt and execution projections.
	// Both first delivery and receipt replay return only workflow decision fields.
	defer func() {
		if result.Failure != nil {
			copied := *result.Failure
			copied.Reason = ""
			copied.Citation = nil
			result.Failure = &copied
		}
	}()

	if strings.TrimSpace(request.RequestID) == "" || strings.TrimSpace(request.ConversationID) == "" ||
		strings.TrimSpace(request.StepID) == "" || request.Operation == "" {
		return temporalruntime.WorkflowOperationActivityOutput{}, WorkflowOperationInputError(
			"workflow operation identity is incomplete",
		)
	}
	stopHeartbeat := activityprojection.StartTemporalActivityHeartbeat(ctx, "workflow."+string(request.Operation), 10*time.Second)
	defer stopHeartbeat()
	run, err := s.TemporalActivityRun(ctx, request.RequestID)
	if err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	if strings.TrimSpace(s.Config.AgentRuntimeBaseURL) == "" ||
		strings.TrimSpace(s.Config.AgentRuntimeSharedSecret) == "" {
		return s.FailWorkflowOperationActivity(
			ctx,
			run,
			request,
			"agent_runtime_not_configured",
			errors.New("agent runtime base URL and shared secret are required"),
		)
	}
	if err := execution.ValidateAdmissionSnapshot(request.AdmissionSnapshot); err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "admission_snapshot_invalid", err)
	}
	run, err = s.BeginWorkflowRun(ctx, run, time.Now().UTC().Truncate(time.Microsecond))
	if err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	inputMetadata, err := execution.InputMetadata(run)
	if err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "execution_input_metadata_invalid", err)
	}
	executionPayload, err := s.LoadExecutionPayload(ctx, run)
	if err != nil {
		return s.FailWorkflowOperationActivity(
			ctx,
			run,
			request,
			execution.InputFailureKind(err, "execution_input_unavailable"),
			err,
		)
	}
	request.Goal = strings.TrimSpace(execution.StringValue(executionPayload["user_goal"]))
	if request.Payload == nil {
		request.Payload = map[string]any{}
	}
	request.Payload["goal"] = request.Goal
	if err := ValidateWorkflowOperationRequest(request); err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_input_invalid", err)
	}
	limits := LimitsFromAdmissionSnapshot(request.AdmissionSnapshot.AgentLimits)
	limits.MaxTurns = request.AdmissionSnapshot.AgentBudget.MaxModelTurns
	limits.MaxFunctionToolCalls = request.AdmissionSnapshot.AgentBudget.MaxFunctionToolCalls
	limits.MaxPlanSteps = request.AdmissionSnapshot.AgentBudget.MaxPlanSteps
	limits.MaxReplans = request.AdmissionSnapshot.AgentBudget.MaxReplans
	conversationContext, err := WorkflowConversationContextForRun(executionPayload, limits)
	if err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "context_budget_exceeded", err)
	}
	providerPayload := WorkflowOperationRuntimeRequestPayload(
		run,
		request,
		conversationContext,
		limits,
		activityprojection.TemporalActivityAttempt(ctx),
	)
	providerRequestBody, err := json.Marshal(providerPayload)
	if err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_invocation_envelope_invalid", err)
	}
	if err := execution.ValidateOperationPayloadBytes(providerRequestBody); err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_payload_too_large", err)
	}
	providerRequestSHA256, err := WorkflowOperationProviderRequestSHA256(providerPayload)
	if err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_invocation_envelope_invalid", err)
	}
	invocationID := run.RequestID + ":" + request.StepID
	envelope := WorkflowOperationInvocationEnvelope{
		AdmissionSnapshotSHA256: execution.HashAdmissionJSON(request.AdmissionSnapshot),
		ExecutionInputSHA256:    strings.TrimSpace(inputMetadata.ExecutionInputSHA256),
		InvocationID:            invocationID,
		Operation:               request.Operation,
		ProviderRequestSHA256:   providerRequestSHA256,
		RequestID:               run.RequestID,
		SchemaVersion:           WorkflowOperationInvocationSchemaVersion,
		StepID:                  request.StepID,
	}
	invocationSHA256 := activityprojection.Sha256AnyValue(envelope)
	receipt, disposition, err := s.Receipts.Begin(ctx, invocationID, run.RequestID, invocationSHA256)
	if err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_invocation_receipt_failed", err)
	}
	if disposition == execution.AgentInvocationDispositionAmbiguous {
		return temporalruntime.WorkflowOperationActivityOutput{}, activityprojection.SanitizedTemporalApplicationErrorWithDetails(
			"workflow_attempt_uncertain",
			map[string]string{
				"invocation_id": strings.TrimSpace(invocationID),
				"request_id":    strings.TrimSpace(run.RequestID),
				"receipt_state": string(receipt.State),
				"step_id":       strings.TrimSpace(request.StepID),
			},
			true,
		)
	}
	if disposition == execution.AgentInvocationDispositionReplay {
		var replay temporalruntime.WorkflowOperationActivityOutput
		if err := decodeReceiptOutput(receipt.OutputJSON, &replay); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"workflow_attempt_uncertain",
				err,
				true,
			)
		}
		encodedReplay, err := json.Marshal(replay)
		if err != nil || Sha256Bytes(encodedReplay) != receipt.OutputSHA256 {
			return temporalruntime.WorkflowOperationActivityOutput{}, activityprojection.SanitizedTemporalApplicationError("workflow_attempt_uncertain", errors.New("receipt output digest differs"), true)
		}
		if err := s.RepairWorkflowOperationReplayProjection(ctx, run, request, receipt, replay); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"workflow_operation_projection_repair_failed",
				err,
				false,
			)
		}
		return replay, nil
	}
	receiptCompleted := false
	defer func() {
		if resultErr == nil || receiptCompleted {
			return
		}
		failureCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := s.Receipts.Fail(failureCtx, receipt, "workflow_operation_failed"); err != nil {
			resultErr = errors.Join(resultErr, err)
		}
	}()
	startedAt := receipt.CreatedAt
	resultRef := activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID)
	startedProjection := s.WithTemporalActivityEvidence(ctx, activityprojection.TemporalStepProjection{
		Attempt:       activityprojection.TemporalActivityAttempt(ctx),
		Run:           run,
		Status:        "started",
		StepID:        request.StepID,
		StepKind:      request.StepKind,
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		WorkerID:      s.Config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: resultRef,
		ParentStepID:  "",
		Payload: map[string]any{
			"operation":                   string(request.Operation),
			"execution_control_release":   strings.TrimSpace(s.Config.DeploymentRelease),
			"agent_capabilities":          execution.AgentCapabilitiesProjectionPayload(request.AdmissionSnapshot.AgentCapabilities),
			"agent_budget":                execution.AgentRuntimeBudgetProjectionPayload(request.AdmissionSnapshot.AgentBudget),
			"tool_contract_fingerprint":   execution.ToolContractFingerprintSnapshotMap(request.AdmissionSnapshot.ToolContractFingerprint),
			"visible_function_tool_names": append([]string{}, request.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames...),
		},
	}, activityprojection.TemporalActivityAttempt(ctx))
	if err := s.ProjectTemporalStep(ctx, startedProjection); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	response, err := s.CallWorkflowOperationRuntime(
		ctx,
		run,
		request.Operation,
		request.TraceParent,
		providerRequestBody,
		limits.AgentDeadlineMS,
		request.Stream,
	)
	if err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, WorkflowRuntimeFailureKind(err), err)
	}
	if response.Operation != "" && strings.TrimSpace(response.Operation) != string(request.Operation) {
		return s.FailWorkflowOperationActivity(
			ctx,
			run,
			request,
			"workflow_operation_result_invalid",
			fmt.Errorf("runtime operation %q does not match %q", response.Operation, request.Operation),
		)
	}
	if err := execution.ValidateAgentRuntimeToolContract(
		request.AdmissionSnapshot.ToolContractFingerprint,
		response.ToolContractFingerprint,
	); err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "tool_contract_mismatch", err)
	}
	output, err := WorkflowOperationOutputFromRuntimeResponse(response, request.Operation, resultRef)
	if err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", err)
	}
	output.RequestID = run.RequestID
	output.WorkflowResultRef = resultRef
	output.RuntimeRelease = strings.TrimSpace(response.RuntimeRelease)
	if request.Operation == temporalruntime.WorkflowOperationSynthesize {
		if len(response.Evidence) != 0 || len(response.SourceAttempts) != 0 {
			return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("synthesizer must not echo evidence"))
		}
		output.Evidence = append([]temporalruntime.WorkflowEvidence{}, request.Evidence...)
		output.SourceAttempts = append([]temporalruntime.WorkflowSourceAttempt{}, request.SourceAttempts...)
	}
	if output.Status != "completed" && output.Status != "failed" {
		return s.FailWorkflowOperationActivity(
			ctx,
			run,
			request,
			"workflow_operation_incomplete",
			fmt.Errorf("runtime operation status is %q", output.Status),
		)
	}
	if output.Status == "failed" {
		if output.Failure == nil || strings.TrimSpace(output.Failure.Code) == "" {
			return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("failed runtime result has no classified failure"))
		}
	}
	if err := ValidateWorkflowOperationOutputSources(request, output); err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", err)
	}
	if output.Status != "failed" && request.Operation == temporalruntime.WorkflowOperationSolve {
		if output.SolveOutcome != "answer" && output.SolveOutcome != "plan" {
			return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("solver result has no valid outcome"))
		}
		if output.SolveOutcome == "answer" && strings.TrimSpace(output.FinalOutput) == "" {
			return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("solver answer is empty"))
		}
		if output.SolveOutcome == "plan" && output.Plan == nil {
			return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("solver plan is missing"))
		}
	}
	if output.Status != "failed" && request.Operation == temporalruntime.WorkflowOperationReplan && output.Replan == nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("replanner result has no decision"))
	}
	if output.Status != "failed" && request.Operation == temporalruntime.WorkflowOperationReplan {
		decisionErr := temporalruntime.ValidateWorkflowReplanDecision(*output.Replan)
		if decisionErr == nil {
			decisionErr = temporalruntime.ValidateWorkflowRemainingSteps(
				output.Replan.RemainingSteps,
				request.AdmissionSnapshot.AgentBudget.MaxPlanSteps,
				request.CompletedSteps,
				temporalruntime.AgentCapabilitiesSnapshot(request.AdmissionSnapshot.AgentCapabilities),
			)
		}
		if decisionErr != nil {
			// A rejected model decision is not a transport failure. Preserve its
			// usage and let the workflow continue the existing admitted plan.
			output.Status = "failed"
			output.TerminalReason = "agent_runtime_failed"
			output.Failure = &temporalruntime.ExecutionFailure{Code: "model_output_invalid", Operation: "workflow.replan", Detail: decisionErr.Error()}
			output.Replan = nil
		}
	}
	if output.Status != "failed" && (request.Operation == temporalruntime.WorkflowOperationSolve || request.Operation == temporalruntime.WorkflowOperationExecuteStep || request.Operation == temporalruntime.WorkflowOperationSynthesize) &&
		strings.TrimSpace(output.FinalOutput) == "" {
		if request.Operation != temporalruntime.WorkflowOperationSolve || output.SolveOutcome == "answer" {
			return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("text operation result is empty"))
		}
	}
	if err := ValidateOperationOutputFields(output); err != nil {
		kind := "workflow_operation_result_invalid"
		var sizeError *execution.OperationPayloadTooLargeError
		if errors.As(err, &sizeError) {
			kind = "workflow_operation_payload_too_large"
		}
		return s.FailWorkflowOperationActivity(ctx, run, request, kind, err)
	}
	// Buffered solve answers arrive as one FinalOutput payload without streaming
	// answer_delta events. Project the full text as a single delta + completion so
	// the browser-visible event sequence matches the streaming shape and the
	// canonical terminal projection can render it unchanged.
	if !request.Stream &&
		request.Operation == temporalruntime.WorkflowOperationSolve &&
		output.Status == "completed" &&
		output.SolveOutcome == "answer" &&
		strings.TrimSpace(output.FinalOutput) != "" {
		messageID := run.RequestID + ":answer"
		if err := s.ProjectWorkflowAnswerDelta(ctx, run, messageID, 1, output.FinalOutput); err != nil {
			return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_answer_projection_failed", err)
		}
		if err := s.ProjectWorkflowAnswerCompleted(ctx, run, messageID); err != nil {
			return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_answer_projection_failed", err)
		}
		output.AnswerStarted = true
	}
	if err := s.ProjectWorkflowToolResults(ctx, run, request, response.ToolResults, startedProjection); err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_tool_projection_failed", err)
	}
	completedAt := time.Now().UTC().Truncate(time.Microsecond)
	resultPayload, err := WorkflowOperationResultPayload(
		request,
		output,
		invocationSHA256,
		activityprojection.TemporalActivityAttempt(ctx),
		strings.TrimSpace(s.Config.DeploymentRelease),
	)
	if err != nil {
		return s.FailWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", err)
	}
	var receiptErr error
	if output.Status == "failed" {
		receiptErr = s.Receipts.CompleteFailed(ctx, receipt, output)
	} else {
		receiptErr = s.Receipts.Complete(ctx, receipt, output)
	}
	if err := receiptErr; err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	receiptCompleted = true
	identity := WorkflowProjectionIdentity{
		ActivityAttempt:   startedProjection.ActivityAttempt,
		ActivityID:        startedProjection.ActivityID,
		ActivityType:      startedProjection.ActivityType,
		Attempt:           startedProjection.Attempt,
		PreserveAttempt:   true,
		ScheduledAt:       startedProjection.ScheduledAt,
		ScheduleToStartMS: startedProjection.ScheduleToStartMS,
		StartedAt:         startedProjection.StartedAt,
		TemporalRunID:     startedProjection.TemporalRunID,
		WorkerID:          startedProjection.WorkerID,
		WorkflowID:        startedProjection.WorkflowID,
	}
	projectionStatus := "completed"
	if output.Status == "failed" {
		projectionStatus = "failed"
	}
	if err := s.ProjectTemporalStep(ctx, identity.Apply(activityprojection.TemporalStepProjection{
		Attempt:            startedProjection.Attempt,
		ActivityAttempt:    startedProjection.ActivityAttempt,
		PreserveAttempt:    true,
		Run:                run,
		Status:             projectionStatus,
		StepID:             request.StepID,
		StepKind:           request.StepKind,
		TaskQueue:          temporalruntime.ActivityTaskQueueAgent,
		WorkerID:           identity.WorkerID,
		StartedAt:          startedAt,
		CompletedAt:        completedAt,
		UpdatedAt:          completedAt,
		ResultKind:         WorkflowOperationResultKind(request.Operation),
		ProjectionRef:      resultRef,
		ProviderResponseID: output.ProviderResponseID,
		ModelProvider:      output.ModelProvider,
		ModelName:          output.ModelName,
		ModelRequestCount:  output.Usage.ModelRequestCount,
		InputTokens:        output.Usage.InputTokens,
		OutputTokens:       output.Usage.OutputTokens,
		CachedInputTokens:  output.Usage.CachedInputTokens,
		UsageObserved:      output.Usage.UsageObserved,
		TerminalReason:     output.TerminalReason,
		Payload:            resultPayload,
	})); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	if err := s.AppendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RequestID + ":" + request.StepID + ":completed",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeWorkflowOperationCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "workflow-operation-event-v1",
		Payload: map[string]any{
			"operation":  string(request.Operation),
			"result_ref": resultRef,
			"step_id":    request.StepID,
			"status":     output.Status,
		},
	}); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	if output.Status == "failed" && output.Failure != nil && output.Failure.Code == "model_output_invalid" && len(response.ModelOutputDiagnostic) > 0 {
		var diagnostic execution.ModelOutputDiagnostic
		if json.Unmarshal(response.ModelOutputDiagnostic, &diagnostic) == nil && diagnostic.Valid() {
			diagnosticCtx, cancel := context.WithTimeout(ctx, time.Second)
			err := s.RunProjectionStore.RecordModelOutputDiagnostic(diagnosticCtx, run.RequestID,
				activityprojection.TemporalStepResultID(run.RequestID, request.StepID, startedProjection.Attempt), diagnostic)
			cancel()
			if err != nil {
				slog.Warn("model output diagnostic was not stored", "request_id", run.RequestID, "step_id", request.StepID)
			}
		}
	}
	return output, nil
}

type WorkflowOperationInvocationEnvelope struct {
	AdmissionSnapshotSHA256 string                            `json:"admission_snapshot_sha256"`
	ExecutionInputSHA256    string                            `json:"execution_input_sha256"`
	InvocationID            string                            `json:"invocation_id"`
	Operation               temporalruntime.WorkflowOperation `json:"operation"`
	ProviderRequestSHA256   string                            `json:"provider_request_sha256"`
	RequestID               string                            `json:"request_id"`
	SchemaVersion           string                            `json:"schema_version"`
	StepID                  string                            `json:"step_id"`
}

func ValidateWorkflowOperationRequest(request WorkflowOperationActivityRequest) error {
	if strings.TrimSpace(request.Goal) == "" {
		return errors.New("workflow operation goal is required")
	}
	switch request.Operation {
	case temporalruntime.WorkflowOperationSolve:
		// Solve may run buffered (Stream=false) while the provider gateway rejects
		// streaming requests that declare function tools; the buffered answer is
		// projected as a single delta after completion. Re-enable the strict
		// stream requirement when the gateway defect is fixed.
		if request.StepID != "solve.initial" || request.MaxSteps < 1 ||
			request.MaxSteps > request.AdmissionSnapshot.AgentBudget.MaxPlanSteps {
			return errors.New("solver identity, stream mode, or step budget is invalid")
		}
	case temporalruntime.WorkflowOperationExecuteStep:
		if request.Plan == nil || request.Step == nil || request.StepID != WorkflowTaskStepID(request.Step.ID) {
			return errors.New("executor step identity is invalid")
		}
		if request.CitationStart < 1 {
			return errors.New("executor citation_start must be positive")
		}
		if !temporalruntime.WorkflowPlanContainsStep(*request.Plan, *request.Step) {
			return errors.New("executor step is not part of the supplied plan")
		}
	case temporalruntime.WorkflowOperationReplan:
		if request.Plan == nil || request.ReplanIndex < 1 ||
			request.StepID != fmt.Sprintf("solve.replan.%d", request.ReplanIndex) {
			return errors.New("replanner identity is invalid")
		}
		if request.MaxRemainingSteps < 0 || request.MaxRemainingSteps != request.AdmissionSnapshot.AgentBudget.MaxPlanSteps-len(request.CompletedSteps) {
			return errors.New("replanner remaining-step budget is invalid")
		}
	case temporalruntime.WorkflowOperationSynthesize:
		if request.StepID != "answer.synthesize" || (!request.Stream && request.Mode != "recovery") {
			return errors.New("synthesizer identity or stream mode is invalid")
		}
		mode := strings.TrimSpace(request.Mode)
		if mode == "" {
			mode = "planned"
		}
		if mode != "planned" && mode != "recovery" {
			return errors.New("synthesis mode is invalid")
		}
		if mode == "recovery" && (len(request.Evidence) == 0 || strings.TrimSpace(request.RecoveryReason) == "") {
			return errors.New("recovery synthesis requires evidence and a failure reason")
		}
		for _, item := range request.Evidence {
			if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Excerpt) == "" {
				return errors.New("synthesizer evidence fields are required")
			}
		}
		if mode == "recovery" {
			if err := ValidateWorkflowOutputEvidence(request.Evidence, WorkflowCandidateSourceSetFromAdmission(request.AdmissionSnapshot)); err != nil {
				return err
			}
			if err := ValidateWorkflowOutputSourceAttempts(request.SourceAttempts, WorkflowCandidateSourceSetFromAdmission(request.AdmissionSnapshot)); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("unsupported workflow operation %q", request.Operation)
	}
	return nil
}

func ValidateWorkflowOperationOutputSources(
	request WorkflowOperationActivityRequest,
	output temporalruntime.WorkflowOperationActivityOutput,
) error {
	if output.Status != "failed" {
		for _, result := range output.ToolResults {
			if result.Status == "failed" && !temporalruntime.WorkflowToolFailureRecoverable(result.Failure) {
				return errors.New("tool failure is not a recoverable source failure")
			}
		}
	}
	switch request.Operation {
	case temporalruntime.WorkflowOperationExecuteStep:
		if request.Step == nil {
			return errors.New("executor source validation requires a step")
		}
		allowed := WorkflowCandidateSourceSet(request.Step.CandidateSources)
		if err := ValidateWorkflowOutputToolResults(output.ToolResults, allowed); err != nil {
			return err
		}
		if err := ValidateWorkflowOutputSourceAttempts(output.SourceAttempts, allowed); err != nil {
			return err
		}
		if err := ValidateWorkflowOutputEvidence(output.Evidence, allowed); err != nil {
			return err
		}
		return nil
	case temporalruntime.WorkflowOperationSolve:
		allowed := WorkflowCandidateSourceSetFromAdmission(request.AdmissionSnapshot)
		if err := ValidateWorkflowOutputToolResults(output.ToolResults, allowed); err != nil {
			return err
		}
		if err := ValidateWorkflowOutputSourceAttempts(output.SourceAttempts, allowed); err != nil {
			return err
		}
		return ValidateWorkflowOutputEvidence(output.Evidence, allowed)
	case temporalruntime.WorkflowOperationReplan:
		if len(output.ToolResults) > 0 || len(output.Evidence) > 0 || len(output.SourceAttempts) > 0 {
			return fmt.Errorf("workflow %s operation returned source output", request.Operation)
		}
		return nil
	case temporalruntime.WorkflowOperationSynthesize:
		expectedAttempts := request.SourceAttempts
		if len(output.Evidence) != len(request.Evidence) || (len(output.Evidence) > 0 && activityprojection.Sha256AnyValue(output.Evidence) != activityprojection.Sha256AnyValue(request.Evidence)) ||
			len(output.SourceAttempts) != len(expectedAttempts) || (len(expectedAttempts) > 0 && activityprojection.Sha256AnyValue(output.SourceAttempts) != activityprojection.Sha256AnyValue(expectedAttempts)) {
			return errors.New("synthesizer changed admitted evidence or source attempts")
		}
		if len(output.ToolResults) > 0 {
			return errors.New("synthesizer returned retrieval output")
		}
		return nil
	default:
		return fmt.Errorf("unsupported workflow operation %q", request.Operation)
	}
}

func WorkflowCandidateSourceSetFromAdmission(snapshot execution.AgentAdmissionSnapshot) map[temporalruntime.WorkflowSource]struct{} {
	allowed := map[temporalruntime.WorkflowSource]struct{}{}
	for _, name := range snapshot.AgentCapabilities.VisibleFunctionToolNames {
		switch strings.TrimSpace(name) {
		case activityprojection.WorkflowCampusSearchToolName:
			allowed[temporalruntime.WorkflowSourceCampusSearch] = struct{}{}
		case activityprojection.WorkflowPersonalMemoryRecallToolName:
			allowed[temporalruntime.WorkflowSourcePersonalMemoryRecall] = struct{}{}
		}
	}
	if snapshot.AgentCapabilities.HostedWebSearch {
		allowed[temporalruntime.WorkflowSourceWebSearch] = struct{}{}
	}
	return allowed
}

func WorkflowCandidateSourceSet(
	sources []temporalruntime.WorkflowSource,
) map[temporalruntime.WorkflowSource]struct{} {
	allowed := make(map[temporalruntime.WorkflowSource]struct{}, len(sources))
	for _, source := range sources {
		allowed[source] = struct{}{}
	}
	return allowed
}

func ValidateWorkflowOutputToolResults(
	results []temporalruntime.AgentToolResult,
	allowed map[temporalruntime.WorkflowSource]struct{},
) error {
	for _, result := range results {
		source, ok := WorkflowSourceForToolName(result.ToolName)
		if !ok {
			return fmt.Errorf("workflow tool result uses unsupported local tool %q", result.ToolName)
		}
		if _, admitted := allowed[source]; !admitted {
			return fmt.Errorf("workflow tool %q is not a candidate source for the current step", result.ToolName)
		}
	}
	return nil
}

func ValidateWorkflowOutputSourceAttempts(
	attempts []temporalruntime.WorkflowSourceAttempt,
	allowed map[temporalruntime.WorkflowSource]struct{},
) error {
	for _, attempt := range attempts {
		if _, admitted := allowed[attempt.Source]; !admitted {
			return fmt.Errorf("workflow source attempt %q is not a candidate source for the current step", attempt.Source)
		}
		switch attempt.Status {
		case "matched", "no_match", "completed", "failed":
		default:
			return fmt.Errorf("workflow source attempt %q has invalid status %q", attempt.Source, attempt.Status)
		}
	}
	return nil
}

func ValidateWorkflowOutputEvidence(
	evidence []temporalruntime.WorkflowEvidence,
	allowed map[temporalruntime.WorkflowSource]struct{},
) error {
	for _, item := range evidence {
		if _, admitted := allowed[item.Source]; !admitted {
			return fmt.Errorf("workflow evidence %q uses a source that is not a candidate for the current step", item.ID)
		}
	}
	return nil
}

func WorkflowSourceForToolName(
	toolName string,
) (temporalruntime.WorkflowSource, bool) {
	switch strings.TrimSpace(toolName) {
	case activityprojection.WorkflowCampusSearchToolName:
		return temporalruntime.WorkflowSourceCampusSearch, true
	case activityprojection.WorkflowPersonalMemoryRecallToolName:
		return temporalruntime.WorkflowSourcePersonalMemoryRecall, true
	default:
		return "", false
	}
}

func WorkflowOperationInputError(message string) error {
	return activityprojection.SanitizedTemporalApplicationError("workflow_operation_input_invalid", errors.New(message), true)
}

func WorkflowTaskStepID(stepID string) string {
	stepID = strings.TrimSpace(stepID)
	if stepID == "" {
		return "task.step.invalid"
	}
	return "task.step." + stepID
}

func WorkflowOperationResultKind(operation temporalruntime.WorkflowOperation) string {
	switch operation {
	case temporalruntime.WorkflowOperationSolve:
		return "solve_result"
	case temporalruntime.WorkflowOperationExecuteStep:
		return "task_step_result"
	case temporalruntime.WorkflowOperationReplan:
		return "task_replan"
	case temporalruntime.WorkflowOperationSynthesize:
		return "answer_synthesis"
	default:
		return "workflow_operation_result"
	}
}

func WorkflowOperationRuntimeRequestPayload(
	run execution.DurableRun,
	request WorkflowOperationActivityRequest,
	conversationContext map[string]any,
	limits WorkflowRuntimeLimits,
	activityAttempt int,
) map[string]any {
	payload := map[string]any{
		"deadline_at":                  run.CreatedAt.Add(time.Duration(request.AdmissionSnapshot.AgentLimits.AgentDeadlineMS) * time.Millisecond).Format(time.RFC3339Nano),
		"activity_attempt":             activityAttempt,
		"user_id":                      run.OwnerUserID,
		"request_id":                   run.RequestID,
		"conversation_id":              run.ConversationID,
		"operation":                    string(request.Operation),
		"operation_input":              request.Payload,
		"visible_function_tool_names":  append([]string{}, request.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames...),
		"limits":                       WorkflowRuntimeLimitsPayload(limits),
		"expected_model_target_sha256": request.AdmissionSnapshot.ModelTargetSHA256,
	}
	if expected := execution.ToolContractFingerprintSnapshotMap(request.AdmissionSnapshot.ToolContractFingerprint); expected != nil {
		payload["expected_tool_contract_fingerprint"] = expected
	}
	if len(request.PriorEvidence) > 0 {
		payload["prior_evidence"] = request.PriorEvidence
	}
	if len(request.PriorSourceAttempts) > 0 {
		payload["prior_source_attempts"] = request.PriorSourceAttempts
	}
	if len(conversationContext) > 0 {
		payload["conversation_context"] = conversationContext
	}
	return payload
}

// workflowOperationProviderRequestSHA256 is the stable logical operation
// fingerprint used by the invocation receipt. activity_attempt remains in
// the actual request because execution-control uses it to fence tool calls,
// but it is delivery metadata rather than a semantic change to the model
// operation. Temporal may therefore retry the same operation with a different
// Activity attempt without creating a new provider invocation identity.
func WorkflowOperationProviderRequestSHA256(payload map[string]any) (string, error) {
	fingerprintPayload := execution.CloneAnyMapFromValue(payload)
	delete(fingerprintPayload, "activity_attempt")
	encoded, err := json.Marshal(fingerprintPayload)
	if err != nil {
		return "", fmt.Errorf("encode stable workflow operation request fingerprint: %w", err)
	}
	return Sha256Bytes(encoded), nil
}

func WorkflowOperationOutputFromRuntimeResponse(
	response AgentRuntimeResponse,
	operation temporalruntime.WorkflowOperation,
	resultRef string,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	tools, err := WorkflowToolResultsFromRuntimeResponse(response, operation)
	if err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	output := temporalruntime.WorkflowOperationActivityOutput{
		Failure:                 normalizedRuntimeFailure(response.Failure),
		AnswerStarted:           response.AnswerStarted,
		Operation:               operation,
		SolveOutcome:            strings.TrimSpace(response.SolveOutcome),
		WorkflowResultRef:       resultRef,
		FinalOutput:             strings.TrimSpace(response.FinalOutput),
		ModelName:               strings.TrimSpace(response.ModelName),
		ModelProvider:           strings.TrimSpace(response.ModelProvider),
		ProviderResponseID:      strings.TrimSpace(response.ProviderResponseID),
		RequestID:               strings.TrimSpace(response.RequestID),
		StageTiming:             execution.CloneAnyMapFromValue(response.StageTiming),
		Status:                  strings.TrimSpace(response.Status),
		ToolContractFingerprint: execution.CloneAnyMapFromValue(response.ToolContractFingerprint),
		ToolResults:             tools,
		RuntimeRelease:          strings.TrimSpace(response.RuntimeRelease),
		Usage: temporalruntime.AgentUsageSummary{
			CachedInputTokens: response.Usage.CachedInputTokens,
			InputTokens:       response.Usage.InputTokens,
			ModelRequestCount: response.Usage.ModelRequestCount,
			OutputTokens:      response.Usage.OutputTokens,
			UsageObserved:     response.Usage.UsageObserved,
		},
		WebEvidence:         response.WebEvidence,
		WebSearchDiagnostic: response.WebSearchDiagnostic,
		TerminalReason:      response.TerminalReason,
	}
	output.Plan = response.Plan
	output.Replan = response.Replan
	output.RemainingFacts = append([]string{}, response.RemainingFacts...)
	if len(response.Evidence) > 0 {
		if err := decodeOperationValue(response.Evidence, &output.Evidence); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, fmt.Errorf("decode workflow evidence: %w", err)
		}
	}
	if len(response.SourceAttempts) > 0 {
		if err := decodeOperationValue(response.SourceAttempts, &output.SourceAttempts); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, fmt.Errorf("decode workflow source attempts: %w", err)
		}
	}
	if output.Status != "failed" && operation == temporalruntime.WorkflowOperationSolve && output.SolveOutcome != "answer" && output.SolveOutcome != "plan" {
		return temporalruntime.WorkflowOperationActivityOutput{}, errors.New("solve outcome is missing or invalid")
	}
	if output.Status != "failed" && output.Replan != nil && (output.Replan.SchemaVersion != "task_replan.v3" || (output.Replan.Decision != "continue" && output.Replan.Decision != "synthesize")) {
		return temporalruntime.WorkflowOperationActivityOutput{}, errors.New("replan schema is invalid")
	}

	return output, nil
}

func WorkflowToolResultsFromRuntimeResponse(response AgentRuntimeResponse, operation temporalruntime.WorkflowOperation) ([]temporalruntime.AgentToolResult, error) {
	results := make([]temporalruntime.AgentToolResult, 0, len(response.ToolResults))
	for _, result := range response.ToolResults {
		bounded, err := temporalToolResult(result, operation)
		if err != nil {
			return nil, err
		}
		var failure *temporalruntime.ExecutionFailure
		if result.Failure != nil {
			copied := *normalizedRuntimeFailure(result.Failure)
			copied.Detail = ""
			copied.Reason = ""
			copied.Citation = nil
			failure = &copied
		}
		results = append(results, temporalruntime.AgentToolResult{StartedAt: CloneOptionalTime(result.StartedAt), CompletedAt: CloneOptionalTime(result.CompletedAt), DurationMS: result.DurationMS, Failure: failure, InvocationID: strings.TrimSpace(result.InvocationID), Result: bounded, Status: strings.TrimSpace(result.Status), ToolName: strings.TrimSpace(result.ToolName)})
	}
	return results, nil
}

const temporalMemoryTextLimit = 4000

func WorkflowOperationResultPayload(
	request WorkflowOperationActivityRequest,
	output temporalruntime.WorkflowOperationActivityOutput,
	invocationSHA256 string,
	activityAttempt int,
	runtimeRelease string,
) (map[string]any, error) {
	payload := map[string]any{
		"activity_attempt":           activityAttempt,
		"admission_snapshot_sha256":  execution.SHA256JSONRef(request.AdmissionSnapshot),
		"agent_runtime_release":      strings.TrimSpace(output.RuntimeRelease),
		"execution_control_release":  strings.TrimSpace(runtimeRelease),
		"operation":                  string(request.Operation),
		"solve_outcome":              output.SolveOutcome,
		"provider_invocation_sha256": invocationSHA256,
		"provider_response_id":       output.ProviderResponseID,
		"stage_timing":               execution.CloneAnyMapFromValue(output.StageTiming),
		"status":                     output.Status,
		"terminal_reason":            output.TerminalReason,
		"tool_contract_fingerprint":  execution.CloneAnyMapFromValue(output.ToolContractFingerprint),
		"usage": map[string]any{
			"model_request_count": output.Usage.ModelRequestCount,
			"input_tokens":        output.Usage.InputTokens,
			"output_tokens":       output.Usage.OutputTokens,
			"cached_input_tokens": output.Usage.CachedInputTokens,
			"usage_observed":      output.Usage.UsageObserved,
		},
		"web_search_diagnostic": output.WebSearchDiagnostic,
	}
	if output.Failure != nil {
		payload["failure"] = output.Failure
		payload["failure_kind"] = output.Failure.Code
	}
	if output.Plan != nil {
		payload["plan_sha256"] = activityprojection.Sha256AnyValue(output.Plan)
	}
	if output.Replan != nil {
		payload["replan_sha256"] = activityprojection.Sha256AnyValue(output.Replan)
	}

	payload["evidence_sha256"] = activityprojection.Sha256AnyValue(output.Evidence)
	payload["source_attempts_sha256"] = activityprojection.Sha256AnyValue(output.SourceAttempts)
	payload["tool_results_sha256"] = activityprojection.Sha256AnyValue(output.ToolResults)
	payload["final_output_sha256"] = activityprojection.Sha256AnyValue(output.FinalOutput)
	return payload, nil
}

func (s *Adapter) ProjectWorkflowToolResults(
	ctx context.Context,
	run execution.DurableRun,
	request WorkflowOperationActivityRequest,
	tools []AgentToolResult,
	identity activityprojection.TemporalStepProjection,
) error {
	projectedAt := time.Now().UTC().Truncate(time.Microsecond)
	for _, result := range tools {
		toolName := strings.TrimSpace(result.ToolName)
		if toolName == "" || strings.TrimSpace(result.InvocationID) == "" {
			return errors.New("workflow tool result identity is required")
		}
		// Tool/source admission is completed before projection by
		// validateWorkflowOperationOutputSources. This function only validates
		// projection fields and writes the bounded tool result.
		durationMS, err := WorkflowToolDurationMS(result.DurationMS)
		if err != nil {
			return err
		}
		startedAt, completedAt, err := WorkflowToolProjectionTimes(
			temporalruntime.AgentToolResult{StartedAt: result.StartedAt, CompletedAt: result.CompletedAt},
			identity.StartedAt,
			projectedAt,
		)
		if err != nil {
			return fmt.Errorf("workflow tool %s timing is invalid: %w", toolName, err)
		}
		status := strings.TrimSpace(result.Status)
		if status != "completed" && status != "failed" {
			return fmt.Errorf("workflow tool %s returned invalid status %q", toolName, status)
		}
		resultPayload := execution.CloneAnyMapFromValue(result.Result)
		severity := "info"
		if status == "failed" {
			severity = "error"
		} else if strings.TrimSpace(execution.StringValue(resultPayload["outcome"])) == "no_match" {
			severity = "warning"
		}
		payload := map[string]any{
			"arguments_json_sha256": execution.SHA256JSONRef(result.ArgumentsJSON),
			"invocation_id":         result.InvocationID,
			"operation":             string(request.Operation),
			"parent_step_id":        request.StepID,
			"outcome":               BoundedToolOutcome(resultPayload["outcome"]),
			"result_sha256":         activityprojection.Sha256AnyValue(resultPayload),
			"severity":              severity,
			"tool_name":             toolName,
			"tool_status":           status,
		}
		if result.Failure != nil {
			payload["failure"] = normalizedRuntimeFailure(result.Failure)
		}
		if toolName == activityprojection.WorkflowCampusSearchToolName && status == "completed" {
			payload["result"] = execution.CloneAnyMapFromValue(resultPayload)
		}
		projectionClass := ProjectionClassForToolName(toolName)
		if err := s.ProjectTemporalStep(ctx, IdentityWithParent(identity, request.StepID, activityprojection.TemporalStepProjection{
			Attempt:            identity.Attempt,
			ActivityAttempt:    identity.ActivityAttempt,
			Tool:               projectionClass,
			Run:                run,
			Status:             ToolStepStatus(status),
			StepID:             fmt.Sprintf("sdk_tool.execute.%s.%s", toolName, result.InvocationID),
			StepKind:           "tool",
			TaskQueue:          temporalruntime.ActivityTaskQueueForToolTarget(projectionClass),
			WorkerID:           identity.WorkerID,
			StartedAt:          startedAt,
			CompletedAt:        completedAt,
			AttemptStartedAt:   startedAt,
			AttemptCompletedAt: completedAt,
			DurationMS:         durationMS,
			UpdatedAt:          projectedAt,
			AttemptUpdatedAt:   projectedAt,
			ResultKind:         ToolResultKind(status),
			ProjectionRef:      WorkflowToolProjectionRef(run.RequestID, toolName, result.InvocationID),
			Payload:            payload,
		})); err != nil {
			return err
		}
	}
	return nil
}

func WorkflowToolProjectionTimes(
	result temporalruntime.AgentToolResult,
	fallbackStartedAt time.Time,
	fallbackCompletedAt time.Time,
) (time.Time, time.Time, error) {
	startedAt := CanonicalOptionalToolTime(result.StartedAt, fallbackStartedAt)
	completedAt := CanonicalOptionalToolTime(result.CompletedAt, fallbackCompletedAt)
	if !startedAt.IsZero() && !completedAt.IsZero() && completedAt.Before(startedAt) {
		return time.Time{}, time.Time{}, fmt.Errorf("completed_at precedes started_at")
	}
	return startedAt, completedAt, nil
}

func CanonicalOptionalToolTime(value *time.Time, fallback time.Time) time.Time {
	if value == nil || value.IsZero() {
		return fallback.UTC().Truncate(time.Microsecond)
	}
	return value.UTC().Truncate(time.Microsecond)
}

func CloneOptionalTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := value.UTC().Truncate(time.Microsecond)
	return &cloned
}

func IdentityWithParent(
	identity activityprojection.TemporalStepProjection,
	parentStepID string,
	projection activityprojection.TemporalStepProjection,
) activityprojection.TemporalStepProjection {
	projection.ParentStepID = parentStepID
	projection.ActivityID = identity.ActivityID
	projection.ActivityType = identity.ActivityType
	projection.ActivityAttempt = identity.ActivityAttempt
	projection.Attempt = identity.Attempt
	projection.PreserveAttempt = true
	projection.ScheduledAt = identity.ScheduledAt
	projection.ScheduleToStartMS = identity.ScheduleToStartMS
	projection.TemporalRunID = identity.TemporalRunID
	projection.WorkflowID = identity.WorkflowID
	return projection
}

func (s *Adapter) FailWorkflowOperationActivity(
	ctx context.Context,
	run execution.DurableRun,
	request WorkflowOperationActivityRequest,
	failureKind string,
	cause error,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	summary := activityprojection.SummarizeTemporalFailure(failureKind)
	payload := map[string]any{
		"failure": map[string]any{
			"code":      summary.Kind,
			"operation": string(request.Operation),
		},
		"operation": string(request.Operation),
		"severity":  "error",
	}
	AddWorkflowFailureEvidence(payload, cause)
	// Local result-contract errors contain the rejected field/shape, not the
	// provider body. Keep that reason in Ops instead of erasing the diagnosis.
	if failureKind == "workflow_operation_result_invalid" && cause != nil {
		detail := []rune(cause.Error())
		if len(detail) > 1024 {
			detail = detail[:1024]
		}
		payload["failure"].(map[string]any)["detail"] = string(detail)
	}
	err := s.ProjectTemporalFailureStep(ctx, run, activityprojection.TemporalStepFailureProjection{
		FailureKind:   summary.Kind,
		ProjectionRef: activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID),
		ResultKind:    "activity_failure",
		StepID:        request.StepID,
		StepKind:      request.StepKind,
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		Payload:       payload,
	}, cause)
	if err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"activity_projection_failed",
			err,
			false,
		)
	}
	return temporalruntime.WorkflowOperationActivityOutput{}, activityprojection.TemporalApplicationError(summary, true)
}

// Keep the durable projection useful for local diagnosis without persisting
// provider response bodies or arbitrary error strings.
func AddWorkflowFailureEvidence(payload map[string]any, cause error) {
	failure, ok := payload["failure"].(map[string]any)
	if !ok {
		return
	}
	var runtimeError AgentRuntimeHTTPError
	if errors.As(cause, &runtimeError) {
		if runtimeError.Operation != "" {
			failure["operation"] = runtimeError.Operation
		}
		if reason := citationdiagnostic.Reason(runtimeError.Reason); reason != "" {
			failure["reason"] = reason
		}
		if diagnostic := citationdiagnostic.Normalize(runtimeError.Citation); len(diagnostic) > 0 {
			failure["citation"] = diagnostic
		}
		if runtimeError.Detail != "" {
			failure["detail"] = runtimeError.Detail
		}
		if runtimeError.HTTPStatus > 0 {
			failure["http_status"] = runtimeError.HTTPStatus
		} else if runtimeError.StatusCode > 0 {
			failure["http_status"] = runtimeError.StatusCode
		}
		if runtimeError.InvocationID != "" {
			failure["invocation_id"] = runtimeError.InvocationID
		}
		return
	}
	var runtimeApplicationError AgentRuntimeApplicationError
	if errors.As(cause, &runtimeApplicationError) {
		if runtimeApplicationError.Operation != "" {
			failure["operation"] = runtimeApplicationError.Operation
		}
		if reason := citationdiagnostic.Reason(runtimeApplicationError.Reason); reason != "" {
			failure["reason"] = reason
		}
		if diagnostic := citationdiagnostic.Normalize(runtimeApplicationError.Citation); len(diagnostic) > 0 {
			failure["citation"] = diagnostic
		}
		if runtimeApplicationError.Detail != "" {
			failure["detail"] = runtimeApplicationError.Detail
		}
		if runtimeApplicationError.HTTPStatus > 0 {
			failure["http_status"] = runtimeApplicationError.HTTPStatus
		}
		if runtimeApplicationError.InvocationID != "" {
			failure["invocation_id"] = runtimeApplicationError.InvocationID
		}
	}
}

func (s *Adapter) CallWorkflowOperationRuntime(
	ctx context.Context,
	run execution.DurableRun,
	operation temporalruntime.WorkflowOperation,
	traceParent string,
	body []byte,
	deadlineMS int,
	stream bool,
) (AgentRuntimeResponse, error) {
	reserve := 5 * time.Second
	if operation == temporalruntime.WorkflowOperationExecuteStep || operation == temporalruntime.WorkflowOperationReplan {
		reserve = 30 * time.Second
	}
	timeout := time.Until(run.CreatedAt.Add(time.Duration(deadlineMS)*time.Millisecond).Add(-reserve)) + time.Second
	if timeout <= 0 {
		return AgentRuntimeResponse{}, AgentRuntimeApplicationError{Code: "agent_deadline_exceeded", Operation: "workflow." + string(operation)}
	}
	traceContext := telemetry.ExtractTraceParent(ctx, traceParent)
	requestCtx, cancel := context.WithTimeout(traceContext, timeout)
	defer cancel()
	if s == nil || s.AgentRuntimeClient == nil {
		return AgentRuntimeResponse{}, AgentRuntimeRequestBuildError{
			Cause: errors.New("agent runtime client is not configured"),
		}
	}
	response, err := s.AgentRuntimeClient.Execute(requestCtx, executionapplication.AgentRuntimeRequest{
		Body:      body,
		RequestID: run.RequestID,
		Stream:    stream,
	})
	if err != nil {
		var requestError *executionapplication.AgentRuntimeRequestError
		if errors.As(err, &requestError) && requestError.Build {
			return AgentRuntimeResponse{}, AgentRuntimeRequestBuildError{Cause: requestError}
		}
		return AgentRuntimeResponse{}, err
	}
	if response.Body == nil {
		return AgentRuntimeResponse{}, errors.New("agent runtime response body is missing")
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode == http.StatusUnauthorized {
			return AgentRuntimeResponse{}, AgentRuntimeHTTPError{StatusCode: response.StatusCode, Code: "unauthorized"}
		}
		var decoded AgentRuntimeResponse
		encoded, err := io.ReadAll(io.LimitReader(response.Body, execution.MaxAgentOperationPayloadBytes+1))
		if err != nil {
			return AgentRuntimeResponse{}, err
		}
		if err := execution.ValidateOperationPayloadBytes(encoded); err != nil {
			return AgentRuntimeResponse{}, err
		}
		_ = json.Unmarshal(encoded, &decoded)
		return AgentRuntimeResponse{}, AgentRuntimeFailureFromResponse(response.StatusCode, decoded)
	}
	if stream {
		return s.ConsumeWorkflowRuntimeStream(ctx, run, operation, response.Body)
	}
	var decoded AgentRuntimeResponse
	encoded, readErr := io.ReadAll(io.LimitReader(response.Body, execution.MaxAgentOperationPayloadBytes+1))
	if readErr != nil {
		return AgentRuntimeResponse{}, readErr
	}
	if err := decodeOperationJSON(encoded, &decoded); err != nil {
		return AgentRuntimeResponse{}, err
	}
	if strings.TrimSpace(decoded.RequestID) != strings.TrimSpace(run.RequestID) {
		return AgentRuntimeResponse{}, fmt.Errorf("workflow runtime response request_id does not match request")
	}
	return decoded, nil
}

func (s *Adapter) ConsumeWorkflowRuntimeStream(
	ctx context.Context,
	run execution.DurableRun,
	operation temporalruntime.WorkflowOperation,
	body io.Reader,
) (AgentRuntimeResponse, error) {
	messageID := run.RequestID + ":answer"
	var completed *AgentRuntimeResponse
	streamError := error(nil)
	chunkIndex := 0
	terminalEvent := ""
	solveOutcome := ""
	answerInvalidated := false
	retrievalProjection := newRetrievalStreamProjection(s, run)
	defer retrievalProjection.close(ctx)

	err := ReadAgentRuntimeSSEEvents(body, func(event AgentRuntimeSSEEvent) error {
		if terminalEvent != "" {
			return fmt.Errorf("workflow runtime stream event %q appears after terminal event %q", event.Event, terminalEvent)
		}
		switch event.Event {
		case "retrieval_status":
			return retrievalProjection.consume(ctx, operation, event.Data)
		case "solve_decision":
			if operation != temporalruntime.WorkflowOperationSolve || solveOutcome != "" || chunkIndex > 0 {
				return errors.New("workflow runtime solve decision is out of order")
			}
			var decision struct {
				SchemaVersion string `json:"schema_version"`
				Outcome       string `json:"outcome"`
			}
			if err := json.Unmarshal(event.Data, &decision); err != nil {
				return fmt.Errorf("decode workflow runtime solve decision: %w", err)
			}
			if decision.SchemaVersion != "workflow_runtime_solve_decision.v1" ||
				(decision.Outcome != "answer" && decision.Outcome != "plan") {
				return errors.New("workflow runtime solve decision schema or value is invalid")
			}
			solveOutcome = decision.Outcome
		case "answer_delta":
			if operation == temporalruntime.WorkflowOperationExecuteStep {
				return errors.New("executor must not emit answer deltas")
			}
			if answerInvalidated {
				return errors.New("workflow runtime answer delta appears after invalidation")
			}
			var delta struct {
				SchemaVersion string `json:"schema_version"`
				Delta         string `json:"delta"`
				Provisional   *bool  `json:"provisional"`
			}
			if err := json.Unmarshal(event.Data, &delta); err != nil {
				return fmt.Errorf("decode workflow runtime answer delta: %w", err)
			}
			if (delta.SchemaVersion != "workflow_runtime_answer_delta.v1" && delta.SchemaVersion != "workflow_runtime_answer_delta.v2") || delta.Delta == "" {
				return errors.New("workflow runtime answer delta schema or value is invalid")
			}
			if delta.SchemaVersion == "workflow_runtime_answer_delta.v2" && (delta.Provisional == nil || !*delta.Provisional) {
				return errors.New("workflow runtime answer delta must be provisional")
			}
			if operation == temporalruntime.WorkflowOperationSolve && solveOutcome != "answer" {
				return errors.New("workflow runtime solve answer delta requires an answer decision")
			}
			chunkIndex++
			return s.ProjectWorkflowAnswerDelta(ctx, run, messageID, chunkIndex, delta.Delta)
		case "answer_invalidated":
			var invalidation struct {
				SchemaVersion string `json:"schema_version"`
				Reason        string `json:"reason"`
			}
			if err := decodeOperationJSON(event.Data, &invalidation); err != nil {
				return fmt.Errorf("decode workflow runtime answer invalidation: %w", err)
			}
			if answerInvalidated || chunkIndex == 0 || invalidation.SchemaVersion != "workflow_runtime_answer_invalidation.v1" || invalidation.Reason != "terminal_result_unavailable" {
				return errors.New("workflow runtime answer invalidation schema or order is invalid")
			}
			answerInvalidated = true
		case "completed", "failed":
			if event.Event == "completed" && answerInvalidated {
				return errors.New("workflow runtime completed after answer invalidation")
			}
			var response AgentRuntimeResponse
			if err := decodeOperationJSON(event.Data, &response); err != nil {
				return fmt.Errorf("decode workflow runtime completed event: %w", err)
			}
			if event.Event == "failed" {
				if response.RequestID != run.RequestID || response.Operation != string(operation) || response.Status != "failed" || response.Failure == nil {
					return errors.New("invalid failed operation result")
				}
			} else if err := ValidateWorkflowRuntimeCompletedResponse(run, operation, solveOutcome, response); err != nil {
				return err
			}
			response.AnswerStarted = chunkIndex > 0
			completed = &response
			terminalEvent = event.Event
		case "error":
			var runtimeErr struct {
				AgentRuntimeError
				RuntimeRelease string `json:"runtime_release"`
			}
			if err := json.Unmarshal(event.Data, &runtimeErr); err != nil {
				return fmt.Errorf("decode workflow runtime error event: %w", err)
			}
			streamError = AgentRuntimeApplicationError{
				Code:   strings.TrimSpace(runtimeErr.Code),
				Reason: runtimeErr.Reason, Citation: runtimeErr.Citation,
				Detail:         strings.TrimSpace(runtimeErr.Detail),
				HTTPStatus:     runtimeErr.HTTPStatus,
				InvocationID:   strings.TrimSpace(runtimeErr.InvocationID),
				Operation:      strings.TrimSpace(runtimeErr.Operation),
				RuntimeRelease: strings.TrimSpace(runtimeErr.RuntimeRelease),
			}
			terminalEvent = "error"
		default:
			return fmt.Errorf("workflow runtime stream event %q is not supported", event.Event)
		}
		return nil
	})
	if err != nil {
		return AgentRuntimeResponse{}, err
	}
	if streamError != nil {
		return AgentRuntimeResponse{}, streamError
	}
	if completed == nil {
		return AgentRuntimeResponse{}, errors.New("workflow runtime stream completed without completed event")
	}
	if operation == temporalruntime.WorkflowOperationSolve && completed.Status != "failed" {
		if solveOutcome == "" {
			return AgentRuntimeResponse{}, errors.New("workflow runtime solve completed without a decision")
		}
		if solveOutcome == "plan" && chunkIndex > 0 {
			return AgentRuntimeResponse{}, errors.New("workflow runtime solve plan emitted answer text")
		}
	}
	if chunkIndex > 0 && completed.Status != "failed" {
		if err := s.ProjectWorkflowAnswerCompleted(ctx, run, messageID); err != nil {
			return AgentRuntimeResponse{}, err
		}
	}
	return *completed, nil
}

func ValidateWorkflowRuntimeCompletedResponse(
	run execution.DurableRun,
	operation temporalruntime.WorkflowOperation,
	solveOutcome string,
	response AgentRuntimeResponse,
) error {
	if strings.TrimSpace(response.RequestID) != strings.TrimSpace(run.RequestID) {
		return fmt.Errorf("workflow runtime completed request_id does not match request")
	}
	if strings.TrimSpace(response.Operation) != string(operation) {
		return fmt.Errorf("workflow runtime completed operation %q does not match %q", response.Operation, operation)
	}
	if operation == temporalruntime.WorkflowOperationSolve {
		if solveOutcome == "" || strings.TrimSpace(response.SolveOutcome) != solveOutcome {
			return errors.New("workflow runtime solve decision does not match completed outcome")
		}
	}
	return nil
}

func normalizedRuntimeFailure(failure *temporalruntime.ExecutionFailure) *temporalruntime.ExecutionFailure {
	if failure == nil {
		return nil
	}
	copied := *failure
	copied.Reason = citationdiagnostic.Reason(copied.Reason)
	copied.Citation = citationdiagnostic.Normalize(copied.Citation)
	return &copied
}
