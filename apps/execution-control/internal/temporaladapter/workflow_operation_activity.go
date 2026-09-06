package temporaladapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const workflowOperationInvocationSchemaVersion = "workflow_operation_invocation.v1"

const (
	workflowCampusSearchToolName         = "campus_search"
	workflowPersonalMemoryRecallToolName = "personal_memory_recall"
)

var workflowLowercaseSHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

var workflowTaskStepIDPattern = regexp.MustCompile(`^step\.[a-z0-9][a-z0-9_-]{0,63}$`)

// SolveTask decides whether the request can be answered in this operation or
// needs a durable task plan. It owns no browser-visible output; answer text is
// streamed through the internal runtime contract and finalized by Temporal.
func (s *Adapter) SolveTask(
	ctx context.Context,
	input temporalruntime.SolveTaskActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return s.runWorkflowOperationActivity(ctx, workflowOperationActivityRequest{
		AdmissionSnapshot: input.AdmissionSnapshot,
		ConversationID:    input.ConversationID,
		MaxSteps:          input.MaxSteps,
		Operation:         temporalruntime.WorkflowOperationSolve,
		Payload: map[string]any{
			"max_steps": input.MaxSteps,
		},
		RequestID:                input.RequestID,
		StepID:                   "solve.initial",
		StepKind:                 "solver",
		Stream:                   true,
		TraceParent:              input.TraceParent,
		VisibleFunctionToolNames: input.VisibleFunctionToolNames,
	})
}

// ExecuteTaskStep is the executor activity for one durable plan step.
func (s *Adapter) ExecuteTaskStep(
	ctx context.Context,
	input temporalruntime.ExecuteTaskStepActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	stepID := workflowTaskStepID(input.Step.ID)
	return s.runWorkflowOperationActivity(ctx, workflowOperationActivityRequest{
		AdmissionSnapshot: input.AdmissionSnapshot,
		CompletedSteps:    input.CompletedSteps,
		ConversationID:    input.ConversationID,
		Operation:         temporalruntime.WorkflowOperationExecuteStep,
		Payload: map[string]any{
			"completed_steps": input.CompletedSteps,
			"citation_start":  input.CitationStart,
			"plan":            input.Plan,
			"step":            input.Step,
		},
		RequestID:                input.RequestID,
		CitationStart:            input.CitationStart,
		Plan:                     &input.Plan,
		Step:                     &input.Step,
		StepID:                   stepID,
		StepKind:                 "executor",
		TraceParent:              input.TraceParent,
		VisibleFunctionToolNames: input.VisibleFunctionToolNames,
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
		return temporalruntime.WorkflowOperationActivityOutput{}, workflowOperationInputError(
			"replan_index must be positive",
		)
	}
	return s.runWorkflowOperationActivity(ctx, workflowOperationActivityRequest{
		AdmissionSnapshot: input.AdmissionSnapshot,
		CompletedSteps:    input.CompletedSteps,
		ConversationID:    input.ConversationID,
		Operation:         temporalruntime.WorkflowOperationReplan,
		Payload: map[string]any{
			"completed_steps":     input.CompletedSteps,
			"max_remaining_steps": input.MaxRemainingSteps,
			"plan":                input.Plan,
			"remaining_steps":     input.RemainingSteps,
		},
		RequestID:                input.RequestID,
		Plan:                     &input.Plan,
		RemainingSteps:           append([]temporalruntime.WorkflowTaskPlanStep{}, input.RemainingSteps...),
		MaxRemainingSteps:        input.MaxRemainingSteps,
		ReplanIndex:              input.ReplanIndex,
		StepID:                   fmt.Sprintf("solve.replan.%d", input.ReplanIndex),
		StepKind:                 "replanner",
		TraceParent:              input.TraceParent,
		VisibleFunctionToolNames: input.VisibleFunctionToolNames,
	})
}

// SynthesizeAnswer is the only operation that may stream answer text to the
// browser. The activity itself receives the completed operation result and
// writes the durable finalization projection; intermediate workflow state is
// kept internal.
func (s *Adapter) SynthesizeAnswer(
	ctx context.Context,
	input temporalruntime.SynthesizeAnswerActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return s.runWorkflowOperationActivity(ctx, workflowOperationActivityRequest{
		AdmissionSnapshot: input.AdmissionSnapshot,
		CompletedSteps:    input.CompletedSteps,
		ConversationID:    input.ConversationID,
		Evidence:          input.Evidence,
		Operation:         temporalruntime.WorkflowOperationSynthesize,
		Payload: map[string]any{
			"completed_steps": input.CompletedSteps,
			"evidence":        input.Evidence,
			"plan":            input.Plan,
		},
		RequestID:                input.RequestID,
		Plan:                     &input.Plan,
		StepID:                   "answer.synthesize",
		StepKind:                 "synthesizer",
		Stream:                   true,
		TraceParent:              input.TraceParent,
		VisibleFunctionToolNames: input.VisibleFunctionToolNames,
	})
}

type workflowOperationActivityRequest struct {
	AdmissionSnapshot        execution.AgentAdmissionSnapshot
	CompletedSteps           []temporalruntime.WorkflowCompletedStep
	ConversationID           string
	CitationStart            int
	Evidence                 []temporalruntime.WorkflowEvidence
	Goal                     string
	MaxSteps                 int
	MaxRemainingSteps        int
	Operation                temporalruntime.WorkflowOperation
	Payload                  map[string]any
	Plan                     *temporalruntime.WorkflowTaskPlan
	RemainingSteps           []temporalruntime.WorkflowTaskPlanStep
	RequestID                string
	ReplanIndex              int
	StepID                   string
	StepKind                 string
	Stream                   bool
	Step                     *temporalruntime.WorkflowTaskPlanStep
	TraceParent              string
	VisibleFunctionToolNames []string
}

func (s *Adapter) runWorkflowOperationActivity(
	ctx context.Context,
	request workflowOperationActivityRequest,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	if strings.TrimSpace(request.RequestID) == "" || strings.TrimSpace(request.ConversationID) == "" ||
		strings.TrimSpace(request.StepID) == "" || request.Operation == "" {
		return temporalruntime.WorkflowOperationActivityOutput{}, workflowOperationInputError(
			"workflow operation identity is incomplete",
		)
	}
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "workflow."+string(request.Operation), 10*time.Second)
	defer stopHeartbeat()
	run, err := s.temporalActivityRun(ctx, request.RequestID)
	if err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	if strings.TrimSpace(s.config.AgentRuntimeBaseURL) == "" ||
		strings.TrimSpace(s.config.AgentRuntimeSharedSecret) == "" {
		return s.failWorkflowOperationActivity(
			ctx,
			run,
			request,
			"agent_runtime_not_configured",
			errors.New("agent runtime base URL and shared secret are required"),
		)
	}
	if err := execution.ValidateAdmissionSnapshotForVisibleTools(
		request.AdmissionSnapshot,
		request.VisibleFunctionToolNames,
	); err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "admission_snapshot_invalid", err)
	}
	run, err = s.beginWorkflowRun(ctx, run, time.Now().UTC().Truncate(time.Microsecond))
	if err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	inputMetadata, err := execution.InputMetadata(run)
	if err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "execution_input_metadata_invalid", err)
	}
	executionPayload, err := s.loadExecutionPayload(ctx, run)
	if err != nil {
		return s.failWorkflowOperationActivity(
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
	if err := validateWorkflowOperationRequest(request); err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_input_invalid", err)
	}
	limits := limitsFromAdmissionSnapshot(request.AdmissionSnapshot.AgentLimits)
	limits.MaxTurns = request.AdmissionSnapshot.AgentBudget.MaxModelTurns
	limits.MaxFunctionToolCalls = request.AdmissionSnapshot.AgentBudget.MaxFunctionToolCalls
	limits.MaxPlanSteps = request.AdmissionSnapshot.AgentBudget.MaxPlanSteps
	limits.MaxReplans = request.AdmissionSnapshot.AgentBudget.MaxReplans
	conversationContext, err := workflowConversationContextForRun(executionPayload, limits)
	if err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "context_budget_exceeded", err)
	}
	providerPayload := workflowOperationRuntimeRequestPayload(
		run,
		request,
		conversationContext,
		limits,
		temporalActivityAttempt(ctx),
	)
	providerRequestBody, err := json.Marshal(providerPayload)
	if err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_invocation_envelope_invalid", err)
	}
	providerRequestSHA256, err := workflowOperationProviderRequestSHA256(providerPayload)
	if err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_invocation_envelope_invalid", err)
	}
	invocationID := run.RequestID + ":" + request.StepID
	envelope := workflowOperationInvocationEnvelope{
		AdmissionSnapshotSHA256: execution.HashAdmissionJSON(request.AdmissionSnapshot),
		ExecutionInputSHA256:    strings.TrimSpace(inputMetadata.ExecutionInputSHA256),
		InvocationID:            invocationID,
		Operation:               request.Operation,
		ProviderRequestSHA256:   providerRequestSHA256,
		RequestID:               run.RequestID,
		SchemaVersion:           workflowOperationInvocationSchemaVersion,
		StepID:                  request.StepID,
	}
	if err := validateWorkflowOperationInvocationEnvelope(envelope, request.AdmissionSnapshot); err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_invocation_envelope_invalid", err)
	}
	invocationSHA256 := sha256AnyValue(envelope)
	receiptNow := time.Now().UTC().Truncate(time.Microsecond)
	_, disposition, err := s.runProjectionStore.BeginAgentInvocation(ctx, execution.AgentInvocationReceipt{
		InvocationID: invocationID,
		RequestID:    run.RequestID,
		InputSHA256:  invocationSHA256,
		CreatedAt:    receiptNow,
		UpdatedAt:    receiptNow,
	})
	if err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_invocation_receipt_failed", err)
	}
	if disposition == execution.AgentInvocationDispositionAmbiguous {
		return temporalruntime.WorkflowOperationActivityOutput{}, sanitizedTemporalApplicationError(
			"workflow_attempt_uncertain",
			errors.New("workflow operation receipt is already started without a result"),
			true,
		)
	}
	if disposition == execution.AgentInvocationDispositionReplay {
		receipt, receiptErr := s.runProjectionStore.GetAgentInvocationReceipt(ctx, invocationID)
		if receiptErr != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, receiptErr
		}
		var replay temporalruntime.WorkflowOperationActivityOutput
		if err := json.Unmarshal(receipt.OutputJSON, &replay); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, sanitizedTemporalApplicationError(
				"workflow_attempt_uncertain",
				err,
				true,
			)
		}
		if err := s.repairWorkflowOperationReplayProjection(ctx, run, request, receipt, replay); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, sanitizedTemporalApplicationError(
				"workflow_operation_projection_repair_failed",
				err,
				false,
			)
		}
		return replay, nil
	}
	startedAt := receiptNow
	resultRef := workflowOperationResultRef(run.RequestID, request.StepID)
	startedProjection := s.withTemporalActivityEvidence(ctx, temporalStepProjection{
		Attempt:       temporalActivityAttempt(ctx),
		Run:           run,
		Status:        "started",
		StepID:        request.StepID,
		StepKind:      request.StepKind,
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: resultRef,
		ParentStepID:  "",
		Payload: map[string]any{
			"operation":                   string(request.Operation),
			"execution_control_release":   strings.TrimSpace(s.config.DeploymentRelease),
			"agent_capabilities":          execution.AgentCapabilitiesProjectionPayload(request.AdmissionSnapshot.AgentCapabilities),
			"agent_budget":                execution.AgentRuntimeBudgetProjectionPayload(request.AdmissionSnapshot.AgentBudget),
			"tool_contract_fingerprint":   execution.ToolContractFingerprintSnapshotMap(request.AdmissionSnapshot.ToolContractFingerprint),
			"visible_function_tool_names": append([]string{}, request.VisibleFunctionToolNames...),
		},
	}, temporalActivityAttempt(ctx))
	if err := s.projectTemporalStep(ctx, startedProjection); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	response, err := s.callWorkflowOperationRuntime(
		ctx,
		run,
		request.Operation,
		request.TraceParent,
		providerRequestBody,
		limits.AgentDeadlineMS,
		request.Stream,
	)
	if err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, workflowRuntimeFailureKind(err), err)
	}
	if response.Operation != "" && strings.TrimSpace(response.Operation) != string(request.Operation) {
		return s.failWorkflowOperationActivity(
			ctx,
			run,
			request,
			"workflow_operation_result_invalid",
			fmt.Errorf("runtime operation %q does not match %q", response.Operation, request.Operation),
		)
	}
	if request.AdmissionSnapshot.ToolContractFingerprintSHA256 != "" {
		if err := execution.ValidateAgentRuntimeToolContract(
			request.AdmissionSnapshot.ToolContractFingerprint,
			response.ToolContractFingerprint,
		); err != nil {
			return s.failWorkflowOperationActivity(ctx, run, request, "tool_contract_mismatch", err)
		}
	}
	output, err := workflowOperationOutputFromRuntimeResponse(response, request.Operation, resultRef)
	if err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", err)
	}
	output.RequestID = run.RequestID
	output.WorkflowResultRef = resultRef
	output.RuntimeRelease = strings.TrimSpace(response.RuntimeRelease)
	if output.Status != "completed" {
		return s.failWorkflowOperationActivity(
			ctx,
			run,
			request,
			"workflow_operation_incomplete",
			fmt.Errorf("runtime operation status is %q", output.Status),
		)
	}
	if err := validateWorkflowOperationOutputSources(request, output); err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", err)
	}
	if request.Operation == temporalruntime.WorkflowOperationSolve {
		if output.SolveOutcome != "answer" && output.SolveOutcome != "plan" {
			return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("solver result has no valid outcome"))
		}
		if output.SolveOutcome == "answer" && strings.TrimSpace(output.FinalOutput) == "" {
			return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("solver answer is empty"))
		}
		if output.SolveOutcome == "plan" && output.Plan == nil {
			return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("solver plan is missing"))
		}
	}
	if request.Operation == temporalruntime.WorkflowOperationSolve && output.Plan != nil {
		if err := validateWorkflowPlanForOperation(
			*output.Plan,
			request.MaxSteps,
			stringSet(request.VisibleFunctionToolNames),
			request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch,
		); err != nil {
			return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", err)
		}
	}
	if request.Operation == temporalruntime.WorkflowOperationReplan && output.Replan == nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("replanner result has no decision"))
	}
	if request.Operation == temporalruntime.WorkflowOperationReplan {
		if output.Replan.Decision == "synthesize" && len(output.Replan.RemainingSteps) != 0 {
			return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("synthesize decision must not contain remaining steps"))
		}
		if output.Replan.Decision != "synthesize" && len(output.Replan.RemainingSteps) == 0 {
			return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("continuing replan decision requires remaining steps"))
		}
		if err := validateWorkflowRemainingSteps(
			output.Replan.RemainingSteps,
			request.MaxRemainingSteps,
			request.CompletedSteps,
			stringSet(request.VisibleFunctionToolNames),
			request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch,
		); err != nil {
			return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", err)
		}
	}
	if (request.Operation == temporalruntime.WorkflowOperationSolve || request.Operation == temporalruntime.WorkflowOperationExecuteStep || request.Operation == temporalruntime.WorkflowOperationSynthesize) &&
		strings.TrimSpace(output.FinalOutput) == "" {
		if request.Operation != temporalruntime.WorkflowOperationSolve || output.SolveOutcome == "answer" {
			return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", errors.New("text operation result is empty"))
		}
	}
	if err := s.projectWorkflowToolResults(ctx, run, request, output, startedProjection); err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_tool_projection_failed", err)
	}
	completedAt := time.Now().UTC().Truncate(time.Microsecond)
	resultPayload, err := workflowOperationResultPayload(
		request,
		output,
		invocationSHA256,
		temporalActivityAttempt(ctx),
		strings.TrimSpace(s.config.DeploymentRelease),
	)
	if err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_operation_result_invalid", err)
	}
	outputSummary, err := json.Marshal(output)
	if err != nil {
		return s.failWorkflowOperationActivity(ctx, run, request, "workflow_invocation_receipt_failed", err)
	}
	completedReceiptAt := time.Now().UTC().Truncate(time.Microsecond)
	if _, err := s.runProjectionStore.CompleteAgentInvocation(ctx, execution.AgentInvocationReceipt{
		InvocationID: invocationID,
		RequestID:    run.RequestID,
		InputSHA256:  invocationSHA256,
		State:        execution.AgentInvocationReceiptStateCompleted,
		OutputJSON:   outputSummary,
		OutputSHA256: sha256Bytes(outputSummary),
		CreatedAt:    receiptNow,
		CompletedAt:  completedReceiptAt,
		UpdatedAt:    completedReceiptAt,
	}); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	identity := workflowProjectionIdentity{
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
	if err := s.projectTemporalStep(ctx, identity.apply(temporalStepProjection{
		Attempt:            startedProjection.Attempt,
		ActivityAttempt:    startedProjection.ActivityAttempt,
		PreserveAttempt:    true,
		Run:                run,
		Status:             "completed",
		StepID:             request.StepID,
		StepKind:           request.StepKind,
		TaskQueue:          temporalruntime.ActivityTaskQueueAgent,
		WorkerID:           identity.WorkerID,
		StartedAt:          startedAt,
		CompletedAt:        completedAt,
		UpdatedAt:          completedAt,
		ResultKind:         workflowOperationResultKind(request.Operation),
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
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
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
	return output, nil
}

type workflowOperationInvocationEnvelope struct {
	AdmissionSnapshotSHA256 string                            `json:"admission_snapshot_sha256"`
	ExecutionInputSHA256    string                            `json:"execution_input_sha256"`
	InvocationID            string                            `json:"invocation_id"`
	Operation               temporalruntime.WorkflowOperation `json:"operation"`
	ProviderRequestSHA256   string                            `json:"provider_request_sha256"`
	RequestID               string                            `json:"request_id"`
	SchemaVersion           string                            `json:"schema_version"`
	StepID                  string                            `json:"step_id"`
}

func validateWorkflowOperationInvocationEnvelope(
	envelope workflowOperationInvocationEnvelope,
	snapshot execution.AgentAdmissionSnapshot,
) error {
	if envelope.SchemaVersion != workflowOperationInvocationSchemaVersion ||
		envelope.Operation == "" || strings.TrimSpace(envelope.RequestID) == "" ||
		envelope.InvocationID != strings.TrimSpace(envelope.RequestID)+":"+strings.TrimSpace(envelope.StepID) {
		return errors.New("workflow operation invocation identity is invalid")
	}
	for _, digest := range []string{
		envelope.AdmissionSnapshotSHA256,
		envelope.ExecutionInputSHA256,
		envelope.ProviderRequestSHA256,
	} {
		if !workflowLowercaseSHA256Pattern.MatchString(digest) {
			return errors.New("workflow operation invocation hash is invalid")
		}
	}
	if execution.HashAdmissionJSON(snapshot) != envelope.AdmissionSnapshotSHA256 {
		return errors.New("workflow operation admission snapshot hash mismatch")
	}
	return nil
}

func validateWorkflowOperationRequest(request workflowOperationActivityRequest) error {
	if strings.TrimSpace(request.Goal) == "" {
		return errors.New("workflow operation goal is required")
	}
	visible := stringSet(request.VisibleFunctionToolNames)
	switch request.Operation {
	case temporalruntime.WorkflowOperationSolve:
		if request.StepID != "solve.initial" || request.MaxSteps < 1 ||
			request.MaxSteps > request.AdmissionSnapshot.AgentBudget.MaxPlanSteps || !request.Stream {
			return errors.New("solver identity, stream mode, or step budget is invalid")
		}
	case temporalruntime.WorkflowOperationExecuteStep:
		if request.Plan == nil || request.Step == nil || request.StepID != workflowTaskStepID(request.Step.ID) {
			return errors.New("executor step identity is invalid")
		}
		if request.CitationStart < 1 {
			return errors.New("executor citation_start must be positive")
		}
		if err := validateWorkflowPlanForOperation(*request.Plan, request.AdmissionSnapshot.AgentBudget.MaxPlanSteps, visible, request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch); err != nil {
			return err
		}
		if !workflowPlanContainsStep(*request.Plan, *request.Step) {
			return errors.New("executor step is not part of the supplied plan")
		}
		if err := validateWorkflowCompletedSteps(request.CompletedSteps, *request.Plan, visible, request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch); err != nil {
			return err
		}
	case temporalruntime.WorkflowOperationReplan:
		if request.Plan == nil || request.ReplanIndex < 1 ||
			request.StepID != fmt.Sprintf("solve.replan.%d", request.ReplanIndex) {
			return errors.New("replanner identity is invalid")
		}
		if request.MaxRemainingSteps < 0 || request.MaxRemainingSteps > request.AdmissionSnapshot.AgentBudget.MaxPlanSteps {
			return errors.New("replanner remaining-step budget is invalid")
		}
		if err := validateWorkflowPlanForOperation(*request.Plan, request.AdmissionSnapshot.AgentBudget.MaxPlanSteps, visible, request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch); err != nil {
			return err
		}
		if err := validateWorkflowCompletedSteps(request.CompletedSteps, *request.Plan, visible, request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch); err != nil {
			return err
		}
		if err := validateWorkflowRemainingSteps(request.RemainingSteps, request.MaxRemainingSteps, request.CompletedSteps, visible, request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch); err != nil {
			return err
		}
	case temporalruntime.WorkflowOperationSynthesize:
		if request.Plan == nil || request.StepID != "answer.synthesize" || !request.Stream {
			return errors.New("synthesizer identity or stream mode is invalid")
		}
		if err := validateWorkflowPlanForOperation(*request.Plan, request.AdmissionSnapshot.AgentBudget.MaxPlanSteps, visible, request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch); err != nil {
			return err
		}
		if err := validateWorkflowCompletedSteps(request.CompletedSteps, *request.Plan, visible, request.AdmissionSnapshot.AgentCapabilities.HostedWebSearch); err != nil {
			return err
		}
		for _, item := range request.Evidence {
			if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Excerpt) == "" {
				return errors.New("synthesizer evidence fields are required")
			}
		}
	default:
		return fmt.Errorf("unsupported workflow operation %q", request.Operation)
	}
	return nil
}

func validateWorkflowOperationOutputSources(
	request workflowOperationActivityRequest,
	output temporalruntime.WorkflowOperationActivityOutput,
) error {
	switch request.Operation {
	case temporalruntime.WorkflowOperationExecuteStep:
		if request.Step == nil {
			return errors.New("executor source validation requires a step")
		}
		allowed := workflowCandidateSourceSet(request.Step.CandidateSources)
		if err := validateWorkflowOutputToolResults(output.ToolResults, allowed); err != nil {
			return err
		}
		if err := validateWorkflowOutputSourceAttempts(output.SourceAttempts, allowed); err != nil {
			return err
		}
		if err := validateWorkflowOutputEvidence(output.Evidence, allowed); err != nil {
			return err
		}
		if output.CompletedStep != nil {
			if !sameWorkflowPlanStep(output.CompletedStep.Step, *request.Step) {
				return errors.New("executor completed step does not match the admitted step")
			}
			if err := validateWorkflowOutputSourceAttempts(output.CompletedStep.SourceAttempts, allowed); err != nil {
				return err
			}
			if err := validateWorkflowOutputEvidence(output.CompletedStep.Evidence, allowed); err != nil {
				return err
			}
		}
		return validateWorkflowOutputWebSearch(output, allowed)
	case temporalruntime.WorkflowOperationSolve:
		if len(output.ToolResults) > 0 || len(output.Evidence) > 0 || len(output.SourceAttempts) > 0 ||
			output.WebSearchUsed || len(output.WebCitations) > 0 {
			return errors.New("solver returned retrieval output")
		}
		return nil
	case temporalruntime.WorkflowOperationReplan:
		if len(output.ToolResults) > 0 || len(output.Evidence) > 0 || len(output.SourceAttempts) > 0 ||
			output.WebSearchUsed || len(output.WebCitations) > 0 {
			return fmt.Errorf("workflow %s operation returned source output", request.Operation)
		}
		return nil
	case temporalruntime.WorkflowOperationSynthesize:
		if len(output.ToolResults) > 0 || output.WebSearchUsed || len(output.WebCitations) > 0 {
			return errors.New("synthesizer returned retrieval output")
		}
		return nil
	default:
		return fmt.Errorf("unsupported workflow operation %q", request.Operation)
	}
}

func workflowAvailableSourceSet(visible []string, hostedWebSearch bool) map[temporalruntime.WorkflowSource]struct{} {
	allowed := map[temporalruntime.WorkflowSource]struct{}{}
	for _, name := range visible {
		switch strings.TrimSpace(name) {
		case workflowCampusSearchToolName:
			allowed[temporalruntime.WorkflowSourceCampusSearch] = struct{}{}
		case workflowPersonalMemoryRecallToolName:
			allowed[temporalruntime.WorkflowSourcePersonalMemoryRecall] = struct{}{}
		}
	}
	if hostedWebSearch {
		allowed[temporalruntime.WorkflowSourceWebSearch] = struct{}{}
	}
	return allowed
}

func workflowCandidateSourceSet(
	sources []temporalruntime.WorkflowSource,
) map[temporalruntime.WorkflowSource]struct{} {
	allowed := make(map[temporalruntime.WorkflowSource]struct{}, len(sources))
	for _, source := range sources {
		allowed[source] = struct{}{}
	}
	return allowed
}

func validateWorkflowOutputToolResults(
	results []temporalruntime.AgentToolResult,
	allowed map[temporalruntime.WorkflowSource]struct{},
) error {
	for _, result := range results {
		source, ok := workflowSourceForToolName(result.ToolName)
		if !ok {
			return fmt.Errorf("workflow tool result uses unsupported local tool %q", result.ToolName)
		}
		if _, admitted := allowed[source]; !admitted {
			return fmt.Errorf("workflow tool %q is not a candidate source for the current step", result.ToolName)
		}
	}
	return nil
}

func validateWorkflowOutputSourceAttempts(
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

func validateWorkflowOutputEvidence(
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

func validateWorkflowOutputWebSearch(
	output temporalruntime.WorkflowOperationActivityOutput,
	allowed map[temporalruntime.WorkflowSource]struct{},
) error {
	if !output.WebSearchUsed && len(output.WebCitations) > 0 {
		return errors.New("workflow web citations require a web search attempt")
	}
	if output.WebSearchUsed && len(output.WebCitations) == 0 {
		noMatch := false
		for _, attempt := range output.SourceAttempts {
			if attempt.Source == temporalruntime.WorkflowSourceWebSearch && attempt.Status == "no_match" {
				noMatch = true
				break
			}
		}
		if !noMatch {
			return errors.New("workflow web search without citations must be recorded as no_match")
		}
	}
	if output.WebSearchUsed || len(output.WebCitations) > 0 {
		if _, admitted := allowed[temporalruntime.WorkflowSourceWebSearch]; !admitted {
			return errors.New("workflow web search is not a candidate source for the current step")
		}
	}
	return nil
}

func workflowSourceForToolName(
	toolName string,
) (temporalruntime.WorkflowSource, bool) {
	switch strings.TrimSpace(toolName) {
	case workflowCampusSearchToolName:
		return temporalruntime.WorkflowSourceCampusSearch, true
	case workflowPersonalMemoryRecallToolName:
		return temporalruntime.WorkflowSourcePersonalMemoryRecall, true
	default:
		return "", false
	}
}

func sameWorkflowPlanStep(
	left temporalruntime.WorkflowTaskPlanStep,
	right temporalruntime.WorkflowTaskPlanStep,
) bool {
	return left.ID == right.ID && left.Objective == right.Objective &&
		sameWorkflowSources(left.CandidateSources, right.CandidateSources) &&
		sameWorkflowStrings(left.DependsOn, right.DependsOn)
}

func validateWorkflowPlanForOperation(
	plan temporalruntime.WorkflowTaskPlan,
	maxSteps int,
	visible map[string]struct{},
	hostedWebSearch bool,
) error {
	if plan.SchemaVersion != "task_plan.v1" || strings.TrimSpace(plan.Goal) == "" ||
		maxSteps < 1 || len(plan.Steps) > maxSteps {
		return errors.New("workflow plan identity or size is invalid")
	}
	known := map[string]struct{}{}
	for _, step := range plan.Steps {
		if !workflowTaskStepIDPattern.MatchString(strings.TrimSpace(step.ID)) || strings.TrimSpace(step.Objective) == "" {
			return fmt.Errorf("workflow plan step %q has invalid identity", step.ID)
		}
		if _, exists := known[step.ID]; exists {
			return fmt.Errorf("workflow plan step %s is duplicated", step.ID)
		}
		if err := validateWorkflowCandidateSources(step.ID, step.CandidateSources, visible, hostedWebSearch); err != nil {
			return err
		}
		seenDependencies := map[string]struct{}{}
		for _, dependency := range step.DependsOn {
			if dependency == step.ID {
				return fmt.Errorf("workflow plan step %s depends on itself", step.ID)
			}
			if _, duplicate := seenDependencies[dependency]; duplicate {
				return fmt.Errorf("workflow plan step %s repeats a dependency", step.ID)
			}
			if _, exists := known[dependency]; !exists {
				return fmt.Errorf("workflow plan step %s depends on unknown or later step %s", step.ID, dependency)
			}
			seenDependencies[dependency] = struct{}{}
		}
		known[step.ID] = struct{}{}
	}
	return nil
}

func validateWorkflowCandidateSources(
	stepID string,
	sources []temporalruntime.WorkflowSource,
	visible map[string]struct{},
	hostedWebSearch bool,
) error {
	if len(sources) == 0 || len(sources) > 3 {
		return fmt.Errorf("workflow step %s candidate source count is invalid", stepID)
	}
	seen := map[temporalruntime.WorkflowSource]struct{}{}
	for _, source := range sources {
		if _, duplicate := seen[source]; duplicate {
			return fmt.Errorf("workflow step %s repeats candidate source %s", stepID, source)
		}
		seen[source] = struct{}{}
		switch source {
		case temporalruntime.WorkflowSourceCampusSearch, temporalruntime.WorkflowSourcePersonalMemoryRecall:
			if _, admitted := visible[string(source)]; !admitted {
				return fmt.Errorf("workflow step %s uses non-admitted source %s", stepID, source)
			}
		case temporalruntime.WorkflowSourceWebSearch:
			if !hostedWebSearch {
				return fmt.Errorf("workflow step %s uses non-admitted source %s", stepID, source)
			}
		default:
			return fmt.Errorf("workflow step %s uses unsupported source %q", stepID, source)
		}
	}
	return nil
}

func validateWorkflowCompletedSteps(
	completed []temporalruntime.WorkflowCompletedStep,
	plan temporalruntime.WorkflowTaskPlan,
	visible map[string]struct{},
	hostedWebSearch bool,
) error {
	if len(completed) > len(plan.Steps) {
		return errors.New("completed workflow step count exceeds the supplied plan")
	}
	seen := map[string]struct{}{}
	for _, item := range completed {
		if item.ExecutionIndex < 1 || strings.TrimSpace(item.Summary) == "" {
			return errors.New("completed workflow step metadata is invalid")
		}
		if _, duplicate := seen[item.Step.ID]; duplicate {
			return fmt.Errorf("completed workflow step %s is duplicated", item.Step.ID)
		}
		if !workflowPlanContainsStep(plan, item.Step) {
			return fmt.Errorf("completed workflow step %s is not part of the supplied plan", item.Step.ID)
		}
		if err := validateWorkflowCandidateSources(item.Step.ID, item.Step.CandidateSources, visible, hostedWebSearch); err != nil {
			return err
		}
		seen[item.Step.ID] = struct{}{}
	}
	return nil
}

func validateWorkflowRemainingSteps(
	remaining []temporalruntime.WorkflowTaskPlanStep,
	maxRemaining int,
	completed []temporalruntime.WorkflowCompletedStep,
	visible map[string]struct{},
	hostedWebSearch bool,
) error {
	if len(remaining) > maxRemaining {
		return errors.New("remaining workflow steps exceed the admitted budget")
	}
	known := map[string]struct{}{}
	for _, item := range completed {
		known[item.Step.ID] = struct{}{}
	}
	for _, step := range remaining {
		if !workflowTaskStepIDPattern.MatchString(strings.TrimSpace(step.ID)) || strings.TrimSpace(step.Objective) == "" {
			return fmt.Errorf("remaining workflow step %q has invalid identity", step.ID)
		}
		if _, duplicate := known[step.ID]; duplicate {
			return fmt.Errorf("remaining workflow step %s is duplicated or already completed", step.ID)
		}
		if err := validateWorkflowCandidateSources(step.ID, step.CandidateSources, visible, hostedWebSearch); err != nil {
			return err
		}
		for _, dependency := range step.DependsOn {
			if dependency == step.ID {
				return fmt.Errorf("remaining workflow step %s depends on itself", step.ID)
			}
			if _, exists := known[dependency]; !exists {
				return fmt.Errorf("remaining workflow step %s depends on unknown or later step %s", step.ID, dependency)
			}
		}
		known[step.ID] = struct{}{}
	}
	return nil
}

func workflowPlanContainsStep(
	plan temporalruntime.WorkflowTaskPlan,
	want temporalruntime.WorkflowTaskPlanStep,
) bool {
	for _, step := range plan.Steps {
		if step.ID != want.ID || step.Objective != want.Objective ||
			!sameWorkflowSources(step.CandidateSources, want.CandidateSources) ||
			!sameWorkflowStrings(step.DependsOn, want.DependsOn) {
			continue
		}
		return true
	}
	return false
}

func sameWorkflowSources(left, right []temporalruntime.WorkflowSource) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func sameWorkflowStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func workflowOperationInputError(message string) error {
	return sanitizedTemporalApplicationError("workflow_operation_input_invalid", errors.New(message), true)
}

func workflowTaskStepID(stepID string) string {
	stepID = strings.TrimSpace(stepID)
	if stepID == "" {
		return "task.step.invalid"
	}
	return "task.step." + stepID
}

func workflowOperationResultRef(requestID string, stepID string) string {
	return temporalProjectionRef(requestID, strings.ReplaceAll(strings.TrimSpace(stepID), ".", "/")+"/result")
}

func workflowOperationResultKind(operation temporalruntime.WorkflowOperation) string {
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

func workflowOperationRuntimeRequestPayload(
	run execution.DurableRun,
	request workflowOperationActivityRequest,
	conversationContext map[string]any,
	limits workflowRuntimeLimits,
	activityAttempt int,
) map[string]any {
	payload := map[string]any{
		"activity_attempt":             activityAttempt,
		"user_id":                      run.OwnerUserID,
		"request_id":                   run.RequestID,
		"conversation_id":              run.ConversationID,
		"operation":                    string(request.Operation),
		"operation_input":              request.Payload,
		"visible_function_tool_names":  append([]string{}, request.VisibleFunctionToolNames...),
		"limits":                       workflowRuntimeLimitsPayload(limits),
		"expected_model_target_sha256": request.AdmissionSnapshot.ModelTargetSHA256,
	}
	if expected := execution.ToolContractFingerprintSnapshotMap(request.AdmissionSnapshot.ToolContractFingerprint); expected != nil {
		payload["expected_tool_contract_fingerprint"] = expected
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
func workflowOperationProviderRequestSHA256(payload map[string]any) (string, error) {
	fingerprintPayload := execution.CloneAnyMapFromValue(payload)
	delete(fingerprintPayload, "activity_attempt")
	encoded, err := json.Marshal(fingerprintPayload)
	if err != nil {
		return "", fmt.Errorf("encode stable workflow operation request fingerprint: %w", err)
	}
	return sha256Bytes(encoded), nil
}

func workflowOperationOutputFromRuntimeResponse(
	response agentRuntimeResponse,
	operation temporalruntime.WorkflowOperation,
	resultRef string,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	output := temporalruntime.WorkflowOperationActivityOutput{
		Operation:               operation,
		SolveOutcome:            strings.TrimSpace(response.SolveOutcome),
		WorkflowResultRef:       resultRef,
		ContextUsage:            execution.CloneAnyMapFromValue(response.ContextUsage),
		FinalOutput:             strings.TrimSpace(response.FinalOutput),
		ModelName:               strings.TrimSpace(response.ModelName),
		ModelProvider:           strings.TrimSpace(response.ModelProvider),
		PromptTrace:             execution.CloneAnyMapFromValue(response.PromptTrace),
		ProviderResponseID:      strings.TrimSpace(response.ProviderResponseID),
		RequestID:               strings.TrimSpace(response.RequestID),
		StageTiming:             execution.CloneAnyMapFromValue(response.StageTiming),
		Status:                  strings.TrimSpace(response.Status),
		ToolContractFingerprint: execution.CloneAnyMapFromValue(response.ToolContractFingerprint),
		ToolResults:             workflowToolResultsFromRuntimeResponse(response),
		RuntimeRelease:          strings.TrimSpace(response.RuntimeRelease),
		Usage: temporalruntime.AgentUsageSummary{
			CachedInputTokens: response.Usage.CachedInputTokens,
			InputTokens:       response.Usage.InputTokens,
			ModelRequestCount: response.Usage.ModelRequestCount,
			OutputTokens:      response.Usage.OutputTokens,
			UsageObserved:     response.Usage.UsageObserved,
		},
		WebCitations:  workflowWebCitationsFromRuntimeResponse(response),
		WebSearchUsed: response.WebSearchUsed,
	}
	if response.StructuredOutput != nil {
		output.StructuredOutput = execution.CloneAnyMapFromValue(response.StructuredOutput)
	}
	if len(response.Evidence) > 0 {
		if err := decodeWorkflowValue(response.Evidence, &output.Evidence); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, fmt.Errorf("decode workflow evidence: %w", err)
		}
	}
	if len(response.SourceAttempts) > 0 {
		if err := decodeWorkflowValue(response.SourceAttempts, &output.SourceAttempts); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, fmt.Errorf("decode workflow source attempts: %w", err)
		}
	}
	if len(response.CompletedStep) > 0 {
		var completed temporalruntime.WorkflowCompletedStep
		if err := decodeWorkflowValue(response.CompletedStep, &completed); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, fmt.Errorf("decode completed workflow step: %w", err)
		}
		output.CompletedStep = &completed
	}
	if operation == temporalruntime.WorkflowOperationSolve {
		if output.SolveOutcome != "answer" && output.SolveOutcome != "plan" {
			return temporalruntime.WorkflowOperationActivityOutput{}, errors.New("solve outcome is missing or invalid")
		}
		if output.SolveOutcome == "plan" {
			if len(response.StructuredOutput) == 0 {
				return temporalruntime.WorkflowOperationActivityOutput{}, errors.New("solve plan structured output is missing")
			}
			var plan temporalruntime.WorkflowTaskPlan
			if err := decodeWorkflowValue(response.StructuredOutput, &plan); err != nil {
				return temporalruntime.WorkflowOperationActivityOutput{}, fmt.Errorf("decode solve task plan: %w", err)
			}
			if plan.SchemaVersion != "task_plan.v1" || strings.TrimSpace(plan.Goal) == "" {
				return temporalruntime.WorkflowOperationActivityOutput{}, errors.New("solve task plan identity is invalid")
			}
			output.Plan = &plan
		}
	}
	if operation == temporalruntime.WorkflowOperationReplan {
		if len(response.StructuredOutput) == 0 {
			return temporalruntime.WorkflowOperationActivityOutput{}, errors.New("replanner structured output is missing")
		}
		var replan temporalruntime.WorkflowTaskReplan
		if err := decodeWorkflowValue(response.StructuredOutput, &replan); err != nil {
			return temporalruntime.WorkflowOperationActivityOutput{}, fmt.Errorf("decode task replan: %w", err)
		}
		if replan.SchemaVersion != "task_replan.v1" || strings.TrimSpace(replan.Decision) == "" {
			return temporalruntime.WorkflowOperationActivityOutput{}, errors.New("task replan identity is invalid")
		}
		output.Replan = &replan
	}
	return output, nil
}

func workflowToolResultsFromRuntimeResponse(
	response agentRuntimeResponse,
) []temporalruntime.AgentToolResult {
	results := make([]temporalruntime.AgentToolResult, 0, len(response.ToolResults))
	for _, result := range response.ToolResults {
		results = append(results, temporalruntime.AgentToolResult{
			ArgumentsJSON: execution.CloneAnyMapFromValue(result.ArgumentsJSON),
			DurationMS:    result.DurationMS,
			Failure:       result.Failure,
			InvocationID:  strings.TrimSpace(result.InvocationID),
			Result:        execution.CloneAnyMapFromValue(result.Result),
			Status:        strings.TrimSpace(result.Status),
			ToolName:      strings.TrimSpace(result.ToolName),
		})
	}
	return results
}

func workflowWebCitationsFromRuntimeResponse(
	response agentRuntimeResponse,
) []temporalruntime.AgentWebCitation {
	result := make([]temporalruntime.AgentWebCitation, 0, len(response.WebCitations))
	for _, citation := range response.WebCitations {
		result = append(result, temporalruntime.AgentWebCitation{
			EndIndex:   citation.EndIndex,
			StartIndex: citation.StartIndex,
			Title:      strings.TrimSpace(citation.Title),
			URL:        strings.TrimSpace(citation.URL),
		})
	}
	return result
}

func decodeWorkflowValue(value any, target any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, target)
}

func workflowOperationResultPayload(
	request workflowOperationActivityRequest,
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
		"web_search_used": output.WebSearchUsed,
	}
	if output.Plan != nil {
		payload["plan_sha256"] = sha256AnyValue(output.Plan)
	}
	if output.Replan != nil {
		payload["replan_sha256"] = sha256AnyValue(output.Replan)
	}
	if output.CompletedStep != nil {
		payload["completed_step_sha256"] = sha256AnyValue(output.CompletedStep)
	}
	payload["evidence_sha256"] = sha256AnyValue(output.Evidence)
	payload["source_attempts_sha256"] = sha256AnyValue(output.SourceAttempts)
	payload["tool_results_sha256"] = sha256AnyValue(output.ToolResults)
	payload["final_output_sha256"] = sha256AnyValue(output.FinalOutput)
	return payload, nil
}

func (s *Adapter) projectWorkflowToolResults(
	ctx context.Context,
	run execution.DurableRun,
	request workflowOperationActivityRequest,
	output temporalruntime.WorkflowOperationActivityOutput,
	identity temporalStepProjection,
) error {
	visible := stringSet(request.VisibleFunctionToolNames)
	completedAt := time.Now().UTC().Truncate(time.Microsecond)
	for _, result := range output.ToolResults {
		toolName := strings.TrimSpace(result.ToolName)
		if toolName == "" || strings.TrimSpace(result.InvocationID) == "" {
			return errors.New("workflow tool result identity is required")
		}
		if _, admitted := visible[toolName]; !admitted {
			return fmt.Errorf("workflow tool %s was not visible for this operation", toolName)
		}
		durationMS, err := workflowToolDurationMS(result.DurationMS)
		if err != nil {
			return err
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
			"outcome":               boundedToolOutcome(resultPayload["outcome"]),
			"result_sha256":         sha256AnyValue(resultPayload),
			"severity":              severity,
			"tool_name":             toolName,
			"tool_status":           status,
		}
		if result.Failure != nil {
			payload["failure"] = result.Failure
		}
		if toolName == workflowCampusSearchToolName && status == "completed" {
			payload["result"] = execution.CloneAnyMapFromValue(resultPayload)
		}
		projectionClass := projectionClassForToolName(toolName)
		if err := s.projectTemporalStep(ctx, identityWithParent(identity, request.StepID, temporalStepProjection{
			Attempt:         identity.Attempt,
			ActivityAttempt: identity.ActivityAttempt,
			Tool:            projectionClass,
			Run:             run,
			Status:          toolStepStatus(status),
			StepID:          fmt.Sprintf("sdk_tool.execute.%s.%s", toolName, result.InvocationID),
			StepKind:        "tool",
			TaskQueue:       temporalruntime.ActivityTaskQueueForToolTarget(projectionClass),
			WorkerID:        identity.WorkerID,
			StartedAt:       identity.StartedAt,
			CompletedAt:     completedAt,
			DurationMS:      durationMS,
			UpdatedAt:       completedAt,
			ResultKind:      toolResultKind(status),
			ProjectionRef:   workflowToolProjectionRef(run.RequestID, toolName, result.InvocationID),
			Payload:         payload,
		})); err != nil {
			return err
		}
	}
	return nil
}

func identityWithParent(
	identity temporalStepProjection,
	parentStepID string,
	projection temporalStepProjection,
) temporalStepProjection {
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

func (s *Adapter) failWorkflowOperationActivity(
	ctx context.Context,
	run execution.DurableRun,
	request workflowOperationActivityRequest,
	failureKind string,
	cause error,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	summary := summarizeTemporalFailure(failureKind)
	payload := map[string]any{
		"failure": map[string]any{
			"code":      summary.Kind,
			"operation": string(request.Operation),
		},
		"operation": string(request.Operation),
		"severity":  "error",
	}
	addWorkflowFailureEvidence(payload, cause)
	err := s.projectTemporalFailureStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   summary.Kind,
		ProjectionRef: workflowOperationResultRef(run.RequestID, request.StepID),
		ResultKind:    "activity_failure",
		StepID:        request.StepID,
		StepKind:      request.StepKind,
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		Payload:       payload,
	}, cause)
	if err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, sanitizedTemporalApplicationError(
			"activity_projection_failed",
			err,
			false,
		)
	}
	return temporalruntime.WorkflowOperationActivityOutput{}, temporalApplicationError(summary, true)
}

// Keep the durable projection useful for local diagnosis without persisting
// provider response bodies or arbitrary error strings.
func addWorkflowFailureEvidence(payload map[string]any, cause error) {
	failure, ok := payload["failure"].(map[string]any)
	if !ok {
		return
	}
	var runtimeError agentRuntimeHTTPError
	if errors.As(cause, &runtimeError) {
		if runtimeError.Detail != "" {
			failure["detail"] = runtimeError.Detail
		}
		if runtimeError.StatusCode > 0 {
			failure["http_status"] = runtimeError.StatusCode
		}
		if runtimeError.InvocationID != "" {
			failure["invocation_id"] = runtimeError.InvocationID
		}
		return
	}
	var runtimeApplicationError agentRuntimeApplicationError
	if errors.As(cause, &runtimeApplicationError) {
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

func (s *Adapter) callWorkflowOperationRuntime(
	ctx context.Context,
	run execution.DurableRun,
	operation temporalruntime.WorkflowOperation,
	traceParent string,
	body []byte,
	deadlineMS int,
	stream bool,
) (agentRuntimeResponse, error) {
	timeout := workflowTransportTimeout(deadlineMS)
	traceContext := telemetry.ExtractTraceParent(ctx, traceParent)
	requestCtx, cancel := context.WithTimeout(traceContext, timeout)
	defer cancel()
	if s == nil || s.agentRuntimeClient == nil {
		return agentRuntimeResponse{}, agentRuntimeRequestBuildError{
			cause: errors.New("agent runtime client is not configured"),
		}
	}
	response, err := s.agentRuntimeClient.Execute(requestCtx, outboundadapter.AgentRuntimeRequest{
		Body:      body,
		RequestID: run.RequestID,
		Stream:    stream,
	})
	if err != nil {
		var requestError *outboundadapter.AgentRuntimeRequestError
		if errors.As(err, &requestError) && requestError.Build {
			return agentRuntimeResponse{}, agentRuntimeRequestBuildError{cause: requestError}
		}
		return agentRuntimeResponse{}, err
	}
	if response.Body == nil {
		return agentRuntimeResponse{}, errors.New("agent runtime response body is missing")
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode == http.StatusUnauthorized {
			return agentRuntimeResponse{}, agentRuntimeHTTPError{StatusCode: response.StatusCode, Code: "unauthorized"}
		}
		var decoded agentRuntimeResponse
		_ = json.NewDecoder(response.Body).Decode(&decoded)
		return agentRuntimeResponse{}, agentRuntimeFailureFromResponse(response.StatusCode, decoded)
	}
	if stream {
		return s.consumeWorkflowRuntimeStream(ctx, run, operation, response.Body)
	}
	var decoded agentRuntimeResponse
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		return agentRuntimeResponse{}, err
	}
	if strings.TrimSpace(decoded.RequestID) != strings.TrimSpace(run.RequestID) {
		return agentRuntimeResponse{}, fmt.Errorf("workflow runtime response request_id does not match request")
	}
	return decoded, nil
}

func (s *Adapter) consumeWorkflowRuntimeStream(
	ctx context.Context,
	run execution.DurableRun,
	operation temporalruntime.WorkflowOperation,
	body io.Reader,
) (agentRuntimeResponse, error) {
	messageID := run.RequestID + ":answer"
	var completed *agentRuntimeResponse
	streamError := error(nil)
	chunkIndex := 0
	terminalEvent := ""
	solveOutcome := ""

	err := readAgentRuntimeSSEEvents(body, func(event agentRuntimeSSEEvent) error {
		if terminalEvent != "" {
			return fmt.Errorf("workflow runtime stream event %q appears after terminal event %q", event.Event, terminalEvent)
		}
		switch event.Event {
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
			var delta struct {
				SchemaVersion string `json:"schema_version"`
				Delta         string `json:"delta"`
			}
			if err := json.Unmarshal(event.Data, &delta); err != nil {
				return fmt.Errorf("decode workflow runtime answer delta: %w", err)
			}
			if delta.SchemaVersion != "workflow_runtime_answer_delta.v1" || delta.Delta == "" {
				return errors.New("workflow runtime answer delta schema or value is invalid")
			}
			if operation == temporalruntime.WorkflowOperationSolve && solveOutcome != "answer" {
				return errors.New("workflow runtime solve answer delta requires an answer decision")
			}
			chunkIndex++
			return s.projectWorkflowAnswerDelta(ctx, run, messageID, chunkIndex, delta.Delta)
		case "completed":
			var response agentRuntimeResponse
			if err := json.Unmarshal(event.Data, &response); err != nil {
				return fmt.Errorf("decode workflow runtime completed event: %w", err)
			}
			if err := validateWorkflowRuntimeCompletedResponse(run, operation, solveOutcome, response); err != nil {
				return err
			}
			completed = &response
			terminalEvent = "completed"
		case "error":
			var runtimeErr struct {
				agentRuntimeError
				RuntimeRelease string `json:"runtime_release"`
			}
			if err := json.Unmarshal(event.Data, &runtimeErr); err != nil {
				return fmt.Errorf("decode workflow runtime error event: %w", err)
			}
			streamError = agentRuntimeApplicationError{
				Code:           strings.TrimSpace(runtimeErr.Code),
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
		return agentRuntimeResponse{}, err
	}
	if streamError != nil {
		return agentRuntimeResponse{}, streamError
	}
	if completed == nil {
		return agentRuntimeResponse{}, errors.New("workflow runtime stream completed without completed event")
	}
	if operation == temporalruntime.WorkflowOperationSolve {
		if solveOutcome == "" {
			return agentRuntimeResponse{}, errors.New("workflow runtime solve completed without a decision")
		}
		if solveOutcome == "plan" && chunkIndex > 0 {
			return agentRuntimeResponse{}, errors.New("workflow runtime solve plan emitted answer text")
		}
	}
	if chunkIndex > 0 {
		if err := s.projectWorkflowAnswerCompleted(ctx, run, messageID); err != nil {
			return agentRuntimeResponse{}, err
		}
	}
	return *completed, nil
}

func validateWorkflowRuntimeCompletedResponse(
	run execution.DurableRun,
	operation temporalruntime.WorkflowOperation,
	solveOutcome string,
	response agentRuntimeResponse,
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

func agentRuntimeResponseFromTemporalOutput(
	output temporalruntime.WorkflowOperationActivityOutput,
) agentRuntimeResponse {
	response := agentRuntimeResponse{
		ContextUsage:            execution.CloneAnyMapFromValue(output.ContextUsage),
		FinalOutput:             output.FinalOutput,
		SolveOutcome:            output.SolveOutcome,
		ModelName:               output.ModelName,
		ModelProvider:           output.ModelProvider,
		PromptTrace:             execution.CloneAnyMapFromValue(output.PromptTrace),
		ProviderResponseID:      output.ProviderResponseID,
		RequestID:               output.RequestID,
		StageTiming:             execution.CloneAnyMapFromValue(output.StageTiming),
		Status:                  output.Status,
		ToolContractFingerprint: execution.CloneAnyMapFromValue(output.ToolContractFingerprint),
		RuntimeRelease:          output.RuntimeRelease,
		Usage: agentRuntimeUsage{
			CachedInputTokens: output.Usage.CachedInputTokens,
			InputTokens:       output.Usage.InputTokens,
			ModelRequestCount: output.Usage.ModelRequestCount,
			OutputTokens:      output.Usage.OutputTokens,
			UsageObserved:     output.Usage.UsageObserved,
		},
		WebSearchUsed: output.WebSearchUsed,
	}
	if output.StructuredOutput != nil {
		response.StructuredOutput = execution.CloneAnyMapFromValue(output.StructuredOutput)
	}
	for _, result := range output.ToolResults {
		response.ToolResults = append(response.ToolResults, agentToolResult{
			ArgumentsJSON: result.ArgumentsJSON,
			DurationMS:    result.DurationMS,
			Failure:       result.Failure,
			InvocationID:  result.InvocationID,
			Result:        result.Result,
			Status:        result.Status,
			ToolName:      result.ToolName,
		})
	}
	for _, citation := range output.WebCitations {
		response.WebCitations = append(response.WebCitations, agentRuntimeWebCitation{
			EndIndex: citation.EndIndex, StartIndex: citation.StartIndex, Title: citation.Title, URL: citation.URL,
		})
	}
	return response
}
