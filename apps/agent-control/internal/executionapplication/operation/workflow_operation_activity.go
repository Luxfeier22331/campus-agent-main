package operation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/citationdiagnostic"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/telemetry"
)

const WorkflowOperationInvocationSchemaVersion = "workflow_operation_invocation.v1"

// SolveTask decides whether the request can be answered in this operation or
// needs a durable task plan. It owns no browser-visible output; answer text is
// streamed through the internal runtime contract and finalized by Temporal.
// streamModelAnswers reports whether solve/execute_step operations should stream
// model answer deltas to the browser. It is gated by the answer-transport switch
// (EXECUTION_CONTROL_ANSWER_TRANSPORT) and defaults to buffered while the
// provider gateway rejects streaming requests that declare function tools.
func (s *OperationService) streamModelAnswers() bool {
	return s.Options.AnswerTransport == "stream"
}

func (s *OperationService) SolveTask(
	ctx context.Context,
	input executioncontract.SolveInput,
) (executioncontract.OperationOutput, error) {
	return s.ExecuteOperation(ctx, OperationRequest{
		AdmissionSnapshot: input.AdmissionSnapshot.ToDomain(),
		ConversationID:    input.ConversationID,
		MaxSteps:          input.MaxSteps,
		Operation:         executioncontract.WorkflowOperationSolve,
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
func (s *OperationService) ExecuteTaskStep(
	ctx context.Context,
	input executioncontract.ExecuteStepInput,
) (executioncontract.OperationOutput, error) {
	stepID := WorkflowTaskStepID(input.Step.ID)
	return s.ExecuteOperation(ctx, OperationRequest{
		PriorEvidence:       input.PriorEvidence,
		PriorSourceAttempts: input.PriorSourceAttempts,
		AdmissionSnapshot:   input.AdmissionSnapshot.ToDomain(),
		CompletedSteps:      input.CompletedSteps,
		ConversationID:      input.ConversationID,
		Operation:           executioncontract.WorkflowOperationExecuteStep,
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
func (s *OperationService) ReplanTask(
	ctx context.Context,
	input executioncontract.ReplanInput,
) (executioncontract.OperationOutput, error) {
	if input.ReplanIndex <= 0 {
		return executioncontract.OperationOutput{}, WorkflowOperationInputError(
			"replan_index must be positive",
		)
	}
	return s.ExecuteOperation(ctx, OperationRequest{
		AdmissionSnapshot:   input.AdmissionSnapshot.ToDomain(),
		CompletedSteps:      input.CompletedSteps,
		ConversationID:      input.ConversationID,
		Operation:           executioncontract.WorkflowOperationReplan,
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
		RemainingSteps:    append([]executioncontract.WorkflowTaskPlanStep{}, input.RemainingSteps...),
		MaxRemainingSteps: input.MaxRemainingSteps,
		ReplanIndex:       input.ReplanIndex,
		StepID:            fmt.Sprintf("solve.replan.%d", input.ReplanIndex),
		StepKind:          "replanner",
		TraceParent:       input.TraceParent,
	})
}

// SynthesizeAnswer generates a final answer from existing materials. Recovery
// after visible Solve deltas is buffered so separate answers cannot interleave.
func (s *OperationService) SynthesizeAnswer(
	ctx context.Context,
	input executioncontract.SynthesizeInput,
) (executioncontract.OperationOutput, error) {
	mode := strings.TrimSpace(input.Mode)
	if mode == "" {
		mode = "planned"
	}
	payload := map[string]any{
		"remaining_facts": append([]executioncontract.WorkflowRemainingFacts{}, input.RemainingFacts...),
		"evidence":        append([]executioncontract.WorkflowEvidence{}, input.Evidence...),
		"mode":            mode,
		"source_attempts": append([]executioncontract.WorkflowSourceAttempt{}, input.SourceAttempts...),
	}
	if strings.TrimSpace(input.RecoveryReason) != "" {
		payload["recovery_reason"] = input.RecoveryReason
	}
	return s.ExecuteOperation(ctx, OperationRequest{
		AdmissionSnapshot: input.AdmissionSnapshot.ToDomain(),
		ConversationID:    input.ConversationID,
		Evidence:          input.Evidence,
		Mode:              mode,
		RecoveryReason:    input.RecoveryReason,
		SourceAttempts:    input.SourceAttempts,
		Operation:         executioncontract.WorkflowOperationSynthesize,
		Payload:           payload,
		RequestID:         input.RequestID,
		StepID:            "answer.synthesize",
		StepKind:          "synthesizer",
		Stream:            !input.BufferAnswer,
		TraceParent:       input.TraceParent,
	})
}

type OperationRequest struct {
	PriorEvidence       []executioncontract.WorkflowEvidence      `json:"prior_evidence"`
	PriorSourceAttempts []executioncontract.WorkflowSourceAttempt `json:"prior_source_attempts"`
	AdmissionSnapshot   execution.AgentAdmissionSnapshot          `json:"admission_snapshot"`
	CompletedSteps      []executioncontract.WorkflowCompletedStep `json:"completed_steps"`
	ConversationID      string                                    `json:"conversation_id"`
	CitationStart       int                                       `json:"citation_start"`
	Evidence            []executioncontract.WorkflowEvidence      `json:"evidence"`
	Mode                string                                    `json:"mode"`
	RecoveryReason      string                                    `json:"recovery_reason"`
	SourceAttempts      []executioncontract.WorkflowSourceAttempt `json:"source_attempts"`
	Goal                string                                    `json:"goal"`
	MaxSteps            int                                       `json:"max_steps"`
	MaxRemainingSteps   int                                       `json:"max_remaining_steps"`
	Operation           executioncontract.WorkflowOperation       `json:"operation"`
	Payload             map[string]any                            `json:"payload"`
	Plan                *executioncontract.WorkflowTaskPlan       `json:"plan"`
	RemainingSteps      []executioncontract.WorkflowTaskPlanStep  `json:"remaining_steps"`
	RequestID           string                                    `json:"request_id"`
	ReplanIndex         int                                       `json:"replan_index"`
	StepID              string                                    `json:"step_id"`
	StepKind            string                                    `json:"step_kind"`
	Stream              bool                                      `json:"stream"`
	Step                *executioncontract.WorkflowTaskPlanStep   `json:"step"`
	TraceParent         string                                    `json:"traceparent"`
}

func (s *OperationService) ExecuteOperation(
	ctx context.Context,
	request OperationRequest,
) (result executioncontract.OperationOutput, resultErr error) {
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
		return executioncontract.OperationOutput{}, WorkflowOperationInputError(
			"workflow operation identity is incomplete",
		)
	}
	run, err := s.TemporalActivityRun(ctx, request.RequestID)
	if err != nil {
		return executioncontract.OperationOutput{}, err
	}
	if !s.Options.Configured {
		return s.FailOperation(
			ctx,
			run,
			request,
			"agent_runtime_not_configured",
			errors.New("agent runtime base URL and shared secret are required"),
		)
	}
	if err := execution.ValidateAdmissionSnapshot(request.AdmissionSnapshot); err != nil {
		return s.FailOperation(ctx, run, request, "admission_snapshot_invalid", err)
	}
	run, err = s.BeginWorkflowRun(ctx, run, time.Now().UTC().Truncate(time.Microsecond))
	if err != nil {
		return executioncontract.OperationOutput{}, err
	}
	inputMetadata, err := execution.InputMetadata(run)
	if err != nil {
		return s.FailOperation(ctx, run, request, "execution_input_metadata_invalid", err)
	}
	executionPayload, err := s.LoadExecutionPayload(ctx, run)
	if err != nil {
		return s.FailOperation(
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
		return s.FailOperation(ctx, run, request, "workflow_operation_input_invalid", err)
	}
	limits := LimitsFromAdmissionSnapshot(request.AdmissionSnapshot.AgentLimits)
	limits.MaxTurns = request.AdmissionSnapshot.AgentBudget.MaxModelTurns
	limits.MaxFunctionToolCalls = request.AdmissionSnapshot.AgentBudget.MaxFunctionToolCalls
	limits.MaxPlanSteps = request.AdmissionSnapshot.AgentBudget.MaxPlanSteps
	limits.MaxReplans = request.AdmissionSnapshot.AgentBudget.MaxReplans
	conversationContext, err := WorkflowConversationContextForRun(executionPayload, limits)
	if err != nil {
		return s.FailOperation(ctx, run, request, "context_budget_exceeded", err)
	}
	providerPayload := WorkflowOperationRuntimeRequest(
		run,
		request,
		conversationContext,
		limits,
		s.InvocationAttempt(ctx),
	)
	if s.AgentRuntimeClient == nil {
		return s.FailOperation(ctx, run, request, "agent_runtime_request_failed", errors.New("agent runtime client is not configured"))
	}
	providerRequestSHA256, err := s.AgentRuntimeClient.Prepare(providerPayload)
	if err != nil {
		kind := "workflow_invocation_envelope_invalid"
		var sizeError *execution.OperationPayloadTooLargeError
		if errors.As(err, &sizeError) {
			kind = "workflow_operation_payload_too_large"
		}
		return s.FailOperation(ctx, run, request, kind, err)
	}
	admissionSnapshotSHA256 := execution.HashAdmissionJSON(request.AdmissionSnapshot)
	invocationID := run.RequestID + ":" + request.StepID
	envelope := WorkflowOperationInvocationEnvelope{
		AdmissionSnapshotSHA256: admissionSnapshotSHA256,
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
		return s.FailOperation(ctx, run, request, "workflow_invocation_receipt_failed", err)
	}
	if disposition == execution.AgentInvocationDispositionAmbiguous {
		return executioncontract.OperationOutput{}, executionfailure.ErrorWithDetails(
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
		var replay executioncontract.OperationOutput
		if err := decodeReceiptOutput(receipt.OutputJSON, &replay); err != nil {
			return executioncontract.OperationOutput{}, executionfailure.SanitizedError(
				"workflow_attempt_uncertain",
				err,
				true,
			)
		}
		encodedReplay, err := json.Marshal(replay)
		if err != nil || Sha256Bytes(encodedReplay) != receipt.OutputSHA256 {
			return executioncontract.OperationOutput{}, executionfailure.SanitizedError("workflow_attempt_uncertain", errors.New("receipt output digest differs"), true)
		}
		if err := s.RepairWorkflowOperationReplayProjection(ctx, run, request, receipt, replay); err != nil {
			return executioncontract.OperationOutput{}, executionfailure.SanitizedError(
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
	startedProjection := s.WithInvocationEvidence(ctx, activityprojection.StepProjection{
		Attempt:       s.InvocationAttempt(ctx),
		Run:           run,
		Status:        "started",
		StepID:        request.StepID,
		StepKind:      request.StepKind,
		TaskQueue:     executioncontract.ActivityTaskQueueAgent,
		WorkerID:      s.WorkerID,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: resultRef,
		ParentStepID:  "",
		Payload: map[string]any{
			"operation":                   string(request.Operation),
			"execution_control_release":   strings.TrimSpace(s.Options.DeploymentRelease),
			"agent_capabilities":          execution.AgentCapabilitiesProjectionPayload(request.AdmissionSnapshot.AgentCapabilities),
			"agent_budget":                execution.AgentRuntimeBudgetProjectionPayload(request.AdmissionSnapshot.AgentBudget),
			"tool_contract_fingerprint":   execution.ToolContractFingerprintSnapshotMap(request.AdmissionSnapshot.ToolContractFingerprint),
			"visible_function_tool_names": append([]string{}, request.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames...),
		},
	}, s.InvocationAttempt(ctx))
	if err := s.ProjectStep(ctx, startedProjection); err != nil {
		return executioncontract.OperationOutput{}, err
	}
	response, err := s.CallWorkflowOperationRuntime(
		ctx,
		run,
		request.Operation,
		request.TraceParent,
		providerPayload,
		limits.AgentDeadlineMS,
		request.Stream,
	)
	if err != nil {
		return s.FailOperation(ctx, run, request, WorkflowRuntimeFailureKind(err), err)
	}
	output, err := s.NormalizeOperationResult(ctx, run, request, response)
	if err != nil {
		return executioncontract.OperationOutput{}, err
	}
	if err := s.ProjectBufferedSolveAnswer(ctx, run, request, &output); err != nil {
		return s.FailOperation(ctx, run, request, "workflow_answer_projection_failed", err)
	}
	if err := s.ProjectWorkflowToolResults(ctx, run, request, response.ToolResults, startedProjection); err != nil {
		return s.FailOperation(ctx, run, request, "workflow_tool_projection_failed", err)
	}
	completedAt := time.Now().UTC().Truncate(time.Microsecond)
	var receiptErr error
	if output.Status == "failed" {
		receiptErr = s.Receipts.CompleteFailed(ctx, receipt, output)
	} else {
		receiptErr = s.Receipts.Complete(ctx, receipt, output)
	}
	if err := receiptErr; err != nil {
		return executioncontract.OperationOutput{}, err
	}
	receiptCompleted = true
	if err := s.ProjectOperationCompletion(ctx, run, request, response, output, startedProjection, completedAt); err != nil {
		return executioncontract.OperationOutput{}, err
	}
	return output, nil
}

type WorkflowOperationInvocationEnvelope struct {
	AdmissionSnapshotSHA256 string                              `json:"admission_snapshot_sha256"`
	ExecutionInputSHA256    string                              `json:"execution_input_sha256"`
	InvocationID            string                              `json:"invocation_id"`
	Operation               executioncontract.WorkflowOperation `json:"operation"`
	ProviderRequestSHA256   string                              `json:"provider_request_sha256"`
	RequestID               string                              `json:"request_id"`
	SchemaVersion           string                              `json:"schema_version"`
	StepID                  string                              `json:"step_id"`
}

func ValidateWorkflowOperationRequest(request OperationRequest) error {
	if strings.TrimSpace(request.Goal) == "" {
		return errors.New("workflow operation goal is required")
	}
	switch request.Operation {
	case executioncontract.WorkflowOperationSolve:
		// Solve may run buffered (Stream=false) while the provider gateway rejects
		// streaming requests that declare function tools; the buffered answer is
		// projected as a single delta after completion. Re-enable the strict
		// stream requirement when the gateway defect is fixed.
		if request.StepID != "solve.initial" || request.MaxSteps < 1 ||
			request.MaxSteps > request.AdmissionSnapshot.AgentBudget.MaxPlanSteps {
			return errors.New("solver identity, stream mode, or step budget is invalid")
		}
	case executioncontract.WorkflowOperationExecuteStep:
		if request.Plan == nil || request.Step == nil || request.StepID != WorkflowTaskStepID(request.Step.ID) {
			return errors.New("executor step identity is invalid")
		}
		if request.CitationStart < 1 {
			return errors.New("executor citation_start must be positive")
		}
		if !executioncontract.WorkflowPlanContainsStep(*request.Plan, *request.Step) {
			return errors.New("executor step is not part of the supplied plan")
		}
	case executioncontract.WorkflowOperationReplan:
		if request.Plan == nil || request.ReplanIndex < 1 ||
			request.StepID != fmt.Sprintf("solve.replan.%d", request.ReplanIndex) {
			return errors.New("replanner identity is invalid")
		}
		if request.MaxRemainingSteps < 0 || request.MaxRemainingSteps != request.AdmissionSnapshot.AgentBudget.MaxPlanSteps-len(request.CompletedSteps) {
			return errors.New("replanner remaining-step budget is invalid")
		}
	case executioncontract.WorkflowOperationSynthesize:
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
	request OperationRequest,
	output executioncontract.OperationOutput,
) error {
	if output.Status != "failed" {
		for _, result := range output.ToolResults {
			if result.Status == "failed" && !executioncontract.WorkflowToolFailureRecoverable(result.Failure) {
				return errors.New("tool failure is not a recoverable source failure")
			}
		}
	}
	switch request.Operation {
	case executioncontract.WorkflowOperationExecuteStep:
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
	case executioncontract.WorkflowOperationSolve:
		allowed := WorkflowCandidateSourceSetFromAdmission(request.AdmissionSnapshot)
		if err := ValidateWorkflowOutputToolResults(output.ToolResults, allowed); err != nil {
			return err
		}
		if err := ValidateWorkflowOutputSourceAttempts(output.SourceAttempts, allowed); err != nil {
			return err
		}
		return ValidateWorkflowOutputEvidence(output.Evidence, allowed)
	case executioncontract.WorkflowOperationReplan:
		if len(output.ToolResults) > 0 || len(output.Evidence) > 0 || len(output.SourceAttempts) > 0 {
			return fmt.Errorf("workflow %s operation returned source output", request.Operation)
		}
		return nil
	case executioncontract.WorkflowOperationSynthesize:
		if len(output.Evidence) > 0 || len(output.SourceAttempts) > 0 {
			return errors.New("synthesizer returned admitted evidence or source attempts")
		}
		if len(output.ToolResults) > 0 {
			return errors.New("synthesizer returned retrieval output")
		}
		return nil
	default:
		return fmt.Errorf("unsupported workflow operation %q", request.Operation)
	}
}

func WorkflowCandidateSourceSetFromAdmission(snapshot execution.AgentAdmissionSnapshot) map[executioncontract.WorkflowSource]struct{} {
	allowed := map[executioncontract.WorkflowSource]struct{}{}
	for _, name := range snapshot.AgentCapabilities.VisibleFunctionToolNames {
		switch strings.TrimSpace(name) {
		case activityprojection.WorkflowCampusSearchToolName:
			allowed[executioncontract.WorkflowSourceCampusSearch] = struct{}{}
		case activityprojection.WorkflowPersonalMemoryRecallToolName:
			allowed[executioncontract.WorkflowSourcePersonalMemoryRecall] = struct{}{}
		}
	}
	if snapshot.AgentCapabilities.HostedWebSearch {
		allowed[executioncontract.WorkflowSourceWebSearch] = struct{}{}
	}
	return allowed
}

func WorkflowCandidateSourceSet(
	sources []executioncontract.WorkflowSource,
) map[executioncontract.WorkflowSource]struct{} {
	allowed := make(map[executioncontract.WorkflowSource]struct{}, len(sources))
	for _, source := range sources {
		allowed[source] = struct{}{}
	}
	return allowed
}

func ValidateWorkflowOutputToolResults(
	results []executioncontract.AgentToolResult,
	allowed map[executioncontract.WorkflowSource]struct{},
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
	attempts []executioncontract.WorkflowSourceAttempt,
	allowed map[executioncontract.WorkflowSource]struct{},
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
	evidence []executioncontract.WorkflowEvidence,
	allowed map[executioncontract.WorkflowSource]struct{},
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
) (executioncontract.WorkflowSource, bool) {
	switch strings.TrimSpace(toolName) {
	case activityprojection.WorkflowCampusSearchToolName:
		return executioncontract.WorkflowSourceCampusSearch, true
	case activityprojection.WorkflowPersonalMemoryRecallToolName:
		return executioncontract.WorkflowSourcePersonalMemoryRecall, true
	default:
		return "", false
	}
}

func WorkflowOperationInputError(message string) error {
	return executionfailure.SanitizedError("workflow_operation_input_invalid", errors.New(message), true)
}

func WorkflowTaskStepID(stepID string) string {
	stepID = strings.TrimSpace(stepID)
	if stepID == "" {
		return "task.step.invalid"
	}
	return "task.step." + stepID
}

func WorkflowOperationResultKind(operation executioncontract.WorkflowOperation) string {
	switch operation {
	case executioncontract.WorkflowOperationSolve:
		return "solve_result"
	case executioncontract.WorkflowOperationExecuteStep:
		return "task_step_result"
	case executioncontract.WorkflowOperationReplan:
		return "task_replan"
	case executioncontract.WorkflowOperationSynthesize:
		return "answer_synthesis"
	default:
		return "workflow_operation_result"
	}
}

func WorkflowOperationRuntimeRequest(
	run execution.DurableRun,
	request OperationRequest,
	conversationContext map[string]any,
	limits WorkflowRuntimeLimits,
	activityAttempt int,
) executionapplication.AgentRuntimeRequest {
	return executionapplication.AgentRuntimeRequest{
		RequestID:                run.RequestID,
		ConversationID:           run.ConversationID,
		UserID:                   run.OwnerUserID,
		DeadlineAt:               run.CreatedAt.Add(time.Duration(request.AdmissionSnapshot.AgentLimits.AgentDeadlineMS) * time.Millisecond),
		ActivityAttempt:          activityAttempt,
		Operation:                request.Operation,
		Input:                    request.Payload,
		VisibleFunctionToolNames: append([]string{}, request.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames...),
		Limits:                   executionapplication.RuntimeLimits(limits),
		ModelTargetSHA256:        request.AdmissionSnapshot.ModelTargetSHA256,
		ToolContractFingerprint:  execution.ToolContractFingerprintSnapshotMap(request.AdmissionSnapshot.ToolContractFingerprint),
		PriorEvidence:            request.PriorEvidence,
		PriorSourceAttempts:      request.PriorSourceAttempts,
		ConversationContext:      conversationContext,
		StreamModelAnswer:        request.Stream,
	}
}

func WorkflowOperationOutputFromRuntimeResponse(
	response executionapplication.AgentRuntimeResult,
	operation executioncontract.WorkflowOperation,
	resultRef string,
) (executioncontract.OperationOutput, error) {
	tools, err := WorkflowToolResultsFromRuntimeResponse(response, operation)
	if err != nil {
		return executioncontract.OperationOutput{}, err
	}
	output := executioncontract.OperationOutput{
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
		Usage: executioncontract.AgentUsageSummary{
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
	if operation == executioncontract.WorkflowOperationSynthesize &&
		(len(response.Evidence) > 0 || len(response.SourceAttempts) > 0) {
		return executioncontract.OperationOutput{}, errors.New(
			"synthesis response must not return evidence or source attempts",
		)
	}
	if len(response.Evidence) > 0 {
		if err := decodeOperationValue(response.Evidence, &output.Evidence); err != nil {
			return executioncontract.OperationOutput{}, fmt.Errorf("decode workflow evidence: %w", err)
		}
	}
	if len(response.SourceAttempts) > 0 {
		if err := decodeOperationValue(response.SourceAttempts, &output.SourceAttempts); err != nil {
			return executioncontract.OperationOutput{}, fmt.Errorf("decode workflow source attempts: %w", err)
		}
	}
	if output.Status != "failed" && operation == executioncontract.WorkflowOperationSolve && output.SolveOutcome != "answer" && output.SolveOutcome != "plan" {
		return executioncontract.OperationOutput{}, errors.New("solve outcome is missing or invalid")
	}
	if output.Status != "failed" && output.Replan != nil && (output.Replan.SchemaVersion != "task_replan.v3" || (output.Replan.Decision != "continue" && output.Replan.Decision != "synthesize")) {
		return executioncontract.OperationOutput{}, errors.New("replan schema is invalid")
	}

	return output, nil
}

func WorkflowToolResultsFromRuntimeResponse(response executionapplication.AgentRuntimeResult, operation executioncontract.WorkflowOperation) ([]executioncontract.AgentToolResult, error) {
	results := make([]executioncontract.AgentToolResult, 0, len(response.ToolResults))
	for _, result := range response.ToolResults {
		bounded, err := temporalToolResult(result, operation)
		if err != nil {
			return nil, err
		}
		var failure *executioncontract.ExecutionFailure
		if result.Failure != nil {
			copied := *normalizedRuntimeFailure(result.Failure)
			copied.Detail = ""
			copied.Reason = ""
			copied.Citation = nil
			failure = &copied
		}
		results = append(results, executioncontract.AgentToolResult{StartedAt: CloneOptionalTime(result.StartedAt), CompletedAt: CloneOptionalTime(result.CompletedAt), DurationMS: result.DurationMS, Failure: failure, InvocationID: strings.TrimSpace(result.InvocationID), Result: bounded, Status: strings.TrimSpace(result.Status), ToolName: strings.TrimSpace(result.ToolName)})
	}
	return results, nil
}

const temporalMemoryTextLimit = 4000

func WorkflowOperationResultPayload(
	request OperationRequest,
	output executioncontract.OperationOutput,
	activityAttempt int,
	runtimeRelease string,
) (map[string]any, error) {
	payload := map[string]any{
		"activity_attempt":          activityAttempt,
		"agent_runtime_release":     strings.TrimSpace(output.RuntimeRelease),
		"execution_control_release": strings.TrimSpace(runtimeRelease),
		"operation":                 string(request.Operation),
		"solve_outcome":             output.SolveOutcome,
		"provider_response_id":      output.ProviderResponseID,
		"stage_timing":              execution.CloneAnyMapFromValue(output.StageTiming),
		"status":                    output.Status,
		"terminal_reason":           output.TerminalReason,
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
		// Persist the same JSON object shape that PostgreSQL returns on replay.
		// A struct marshals fields in declaration order, unlike a decoded map.
		encoded, err := json.Marshal(output.Failure)
		if err != nil {
			return nil, err
		}
		var failure map[string]any
		if err := json.Unmarshal(encoded, &failure); err != nil {
			return nil, err
		}
		payload["failure"] = failure
		payload["failure_kind"] = output.Failure.Code
	}
	return payload, nil
}

func (s *OperationService) ProjectWorkflowToolResults(
	ctx context.Context,
	run execution.DurableRun,
	request OperationRequest,
	tools []executionapplication.AgentToolResult,
	identity activityprojection.StepProjection,
	completedAt ...time.Time,
) error {
	projectedAt := time.Now().UTC().Truncate(time.Microsecond)
	if len(completedAt) > 0 {
		projectedAt = completedAt[0]
	}
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
			executioncontract.AgentToolResult{StartedAt: result.StartedAt, CompletedAt: result.CompletedAt},
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
			"invocation_id":  result.InvocationID,
			"operation":      string(request.Operation),
			"parent_step_id": request.StepID,
			"outcome":        BoundedToolOutcome(resultPayload["outcome"]),
			"severity":       severity,
			"tool_name":      toolName,
			"tool_status":    status,
		}
		if result.Failure != nil {
			payload["failure"] = normalizedRuntimeFailure(result.Failure)
		}
		if toolName == activityprojection.WorkflowCampusSearchToolName {
			if searchQuery := strings.TrimSpace(execution.StringValue(result.ArgumentsJSON["search_query"])); searchQuery != "" {
				payload["search_query"] = searchQuery
			}
			if searchGoal := strings.TrimSpace(execution.StringValue(result.ArgumentsJSON["search_goal"])); searchGoal != "" {
				payload["search_goal"] = searchGoal
			}
		}
		if toolName == activityprojection.WorkflowCampusSearchToolName && status == "completed" {
			payload["result"] = execution.CloneAnyMapFromValue(resultPayload)
		}
		projectionClass := ProjectionClassForToolName(toolName)
		if err := s.ProjectStep(ctx, IdentityWithParent(identity, request.StepID, activityprojection.StepProjection{
			Attempt:            identity.Attempt,
			ActivityAttempt:    identity.ActivityAttempt,
			Tool:               projectionClass,
			Run:                run,
			Status:             ToolStepStatus(status),
			StepID:             fmt.Sprintf("sdk_tool.execute.%s.%s", toolName, result.InvocationID),
			StepKind:           "tool",
			TaskQueue:          executioncontract.ActivityTaskQueueForToolTarget(projectionClass),
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
	result executioncontract.AgentToolResult,
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
	identity activityprojection.StepProjection,
	parentStepID string,
	projection activityprojection.StepProjection,
) activityprojection.StepProjection {
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

func (s *OperationService) FailOperation(
	ctx context.Context,
	run execution.DurableRun,
	request OperationRequest,
	failureKind string,
	cause error,
) (executioncontract.OperationOutput, error) {
	summary := executionfailure.Summarize(failureKind)
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
	err := s.ProjectFailureStep(ctx, run, activityprojection.StepFailureProjection{
		FailureKind:   summary.Kind,
		ProjectionRef: activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID),
		ResultKind:    "activity_failure",
		StepID:        request.StepID,
		StepKind:      request.StepKind,
		TaskQueue:     executioncontract.ActivityTaskQueueAgent,
		Payload:       payload,
	}, cause)
	if err != nil {
		return executioncontract.OperationOutput{}, executionfailure.SanitizedError(
			"activity_projection_failed",
			err,
			false,
		)
	}
	return executioncontract.OperationOutput{}, executionfailure.FromSummary(summary, true)
}

// Keep the durable projection useful for local diagnosis without persisting
// provider response bodies or arbitrary error strings.
func AddWorkflowFailureEvidence(payload map[string]any, cause error) {
	failure, ok := payload["failure"].(map[string]any)
	if !ok {
		return
	}
	var e executionapplication.AgentRuntimeFailure
	if !errors.As(cause, &e) {
		return
	}
	if e.Operation != "" {
		failure["operation"] = e.Operation
	}
	if reason := citationdiagnostic.Reason(e.Reason); reason != "" {
		failure["reason"] = reason
	}
	if diagnostic := citationdiagnostic.Normalize(e.Citation); len(diagnostic) > 0 {
		failure["citation"] = diagnostic
	}
	if e.Detail != "" {
		failure["detail"] = e.Detail
	}
	if e.HTTPStatus > 0 {
		failure["http_status"] = e.HTTPStatus
	}
	if e.InvocationID != "" {
		failure["invocation_id"] = e.InvocationID
	}
}

func (s *OperationService) CallWorkflowOperationRuntime(
	ctx context.Context,
	run execution.DurableRun,
	operation executioncontract.WorkflowOperation,
	traceParent string,
	request executionapplication.AgentRuntimeRequest,
	deadlineMS int,
	stream bool,
) (executionapplication.AgentRuntimeResult, error) {
	reserve := 5 * time.Second
	if operation == executioncontract.WorkflowOperationExecuteStep || operation == executioncontract.WorkflowOperationReplan {
		reserve = 30 * time.Second
	}
	timeout := time.Until(run.CreatedAt.Add(time.Duration(deadlineMS)*time.Millisecond).Add(-reserve)) + time.Second
	if timeout <= 0 {
		return executionapplication.AgentRuntimeResult{}, executionapplication.AgentRuntimeFailure{Kind: "agent_deadline_exceeded", Code: "agent_deadline_exceeded", Operation: "workflow." + string(operation)}
	}
	traceContext := telemetry.ExtractTraceParent(ctx, traceParent)
	requestCtx, cancel := context.WithTimeout(traceContext, timeout)
	defer cancel()
	if s == nil || s.AgentRuntimeClient == nil {
		return executionapplication.AgentRuntimeResult{}, AgentRuntimeRequestBuildError{
			Cause: errors.New("agent runtime client is not configured"),
		}
	}
	// Retrieval progress uses SSE independently of the provider's answer transport.
	streamProgress := stream || operation == executioncontract.WorkflowOperationSolve || operation == executioncontract.WorkflowOperationExecuteStep

	execute := func(handle func(executionapplication.AgentRuntimeEvent) error) (executionapplication.AgentRuntimeResult, error) {
		request.RequestID = run.RequestID
		request.Stream = streamProgress
		response, err := s.AgentRuntimeClient.Execute(requestCtx, request, handle)
		if err != nil {
			var requestError *executionapplication.AgentRuntimeRequestError
			if errors.As(err, &requestError) && requestError.Build {
				return executionapplication.AgentRuntimeResult{}, AgentRuntimeRequestBuildError{Cause: requestError}
			}
		}
		return response, err
	}
	if streamProgress {
		return s.ConsumeWorkflowRuntimeStream(ctx, run, operation, func(handle func(executionapplication.AgentRuntimeEvent) error) error {
			_, err := execute(handle)
			return err
		})
	}
	response, err := execute(nil)
	if err != nil {
		return executionapplication.AgentRuntimeResult{}, err
	}
	if strings.TrimSpace(response.RequestID) != strings.TrimSpace(run.RequestID) {
		return executionapplication.AgentRuntimeResult{}, fmt.Errorf("workflow runtime response request_id does not match request")
	}
	return response, nil
}

func (s *OperationService) ConsumeWorkflowRuntimeStream(
	ctx context.Context,
	run execution.DurableRun,
	operation executioncontract.WorkflowOperation,
	consume func(func(executionapplication.AgentRuntimeEvent) error) error,
) (executionapplication.AgentRuntimeResult, error) {
	messageID := run.RequestID + ":answer"
	var completed *executionapplication.AgentRuntimeResult
	streamError := error(nil)
	chunkIndex := 0
	terminalEvent := ""
	solveOutcome := ""
	answerInvalidated := false
	retrievalProjection := newRetrievalStreamProjection(s, run)
	defer retrievalProjection.close(ctx)

	err := consume(func(event executionapplication.AgentRuntimeEvent) error {
		if terminalEvent != "" {
			return fmt.Errorf("workflow runtime stream event %q appears after terminal event %q", event.Event, terminalEvent)
		}
		switch event.Event {
		case "retrieval_status":
			return retrievalProjection.consume(ctx, operation, event.Retrieval)
		case "solve_decision":
			if operation != executioncontract.WorkflowOperationSolve || solveOutcome != "" || chunkIndex > 0 {
				return errors.New("workflow runtime solve decision is out of order")
			}
			decision := event.Decision
			solveOutcome = decision.Outcome
		case "answer_delta":
			if operation == executioncontract.WorkflowOperationExecuteStep {
				return errors.New("executor must not emit answer deltas")
			}
			if answerInvalidated {
				return errors.New("workflow runtime answer delta appears after invalidation")
			}
			delta := event.Delta
			if operation == executioncontract.WorkflowOperationSolve && solveOutcome != "answer" {
				return errors.New("workflow runtime solve answer delta requires an answer decision")
			}
			chunkIndex++
			return s.ProjectWorkflowAnswerDelta(ctx, run, messageID, chunkIndex, delta.Delta)
		case "answer_invalidated":
			if answerInvalidated || chunkIndex == 0 {
				return errors.New("workflow runtime answer invalidation schema or order is invalid")
			}
			answerInvalidated = true
		case "completed", "failed":
			if event.Event == "completed" && answerInvalidated {
				return errors.New("workflow runtime completed after answer invalidation")
			}
			response := event.Result
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
			streamError = event.Failure
			terminalEvent = "error"
		default:
			return fmt.Errorf("workflow runtime stream event %q is not supported", event.Event)
		}
		return nil
	})
	if err != nil {
		return executionapplication.AgentRuntimeResult{}, err
	}
	if streamError != nil {
		return executionapplication.AgentRuntimeResult{}, streamError
	}
	if completed == nil {
		return executionapplication.AgentRuntimeResult{}, errors.New("workflow runtime stream completed without completed event")
	}
	if operation == executioncontract.WorkflowOperationSolve && completed.Status != "failed" {
		if solveOutcome == "" {
			return executionapplication.AgentRuntimeResult{}, errors.New("workflow runtime solve completed without a decision")
		}
		if solveOutcome == "plan" && chunkIndex > 0 {
			return executionapplication.AgentRuntimeResult{}, errors.New("workflow runtime solve plan emitted answer text")
		}
	}
	if chunkIndex > 0 && completed.Status != "failed" {
		if err := s.ProjectWorkflowAnswerCompleted(ctx, run, messageID); err != nil {
			return executionapplication.AgentRuntimeResult{}, err
		}
	}
	return *completed, nil
}

func ValidateWorkflowRuntimeCompletedResponse(
	run execution.DurableRun,
	operation executioncontract.WorkflowOperation,
	solveOutcome string,
	response executionapplication.AgentRuntimeResult,
) error {
	if strings.TrimSpace(response.RequestID) != strings.TrimSpace(run.RequestID) {
		return fmt.Errorf("workflow runtime completed request_id does not match request")
	}
	if strings.TrimSpace(response.Operation) != string(operation) {
		return fmt.Errorf("workflow runtime completed operation %q does not match %q", response.Operation, operation)
	}
	if operation == executioncontract.WorkflowOperationSolve {
		if solveOutcome == "" || strings.TrimSpace(response.SolveOutcome) != solveOutcome {
			return errors.New("workflow runtime solve decision does not match completed outcome")
		}
	}
	return nil
}

func normalizedRuntimeFailure(failure *executioncontract.ExecutionFailure) *executioncontract.ExecutionFailure {
	if failure == nil {
		return nil
	}
	copied := *failure
	copied.Reason = citationdiagnostic.Reason(copied.Reason)
	copied.Citation = citationdiagnostic.Normalize(copied.Citation)
	return &copied
}
