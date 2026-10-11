package runtimeapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	finalization "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/finalization"
	operation "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/operation"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionfailure"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	"time"
)

// Server exposes control-owned persistence and projections to the Runtime Worker.
// It never performs a model request or invokes a domain tool.
type Server struct {
	SharedSecret   string
	Operations     *operation.OperationService
	Finalization   *finalization.FinalizationService
	Store          executionapplication.RuntimePayloadStore
	MetadataWriter interface {
		ReplaceRunMetadata(context.Context, string, map[string]any) error
	}
	Receipts executionapplication.ReceiptStore
}
type input struct {
	CompletedAt     time.Time                  `json:"completed_at"`
	RequestID       string                     `json:"request_id"`
	Ref             string                     `json:"ref"`
	Payload         json.RawMessage            `json:"payload"`
	Operation       operation.OperationRequest `json:"operation_request"`
	InvocationID    string                     `json:"invocation_id"`
	InputSHA256     string                     `json:"input_sha256"`
	Sequence        int                        `json:"sequence"`
	Delta           string                     `json:"delta"`
	Collection      string                     `json:"collection"`
	RetrievalStatus string                     `json:"retrieval_status"`
}
type prepared struct {
	Request operation.OperationRequest `json:"operation_request"`
	Wire    map[string]any             `json:"wire"`
}

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.SharedSecret == "" || r.Header.Get("x-agent-runtime-auth") != s.SharedSecret {
		respond(w, 401, map[string]string{"code": "unauthorized"})
		return
	}
	var in input
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, execution.MaxAgentOperationPayloadBytes)).Decode(&in); err != nil || in.RequestID == "" {
		respond(w, 400, map[string]string{"code": "invalid_request"})
		return
	}
	ctx := r.Context()
	action := strings.TrimPrefix(r.URL.Path, "/internal/agent-runtime/")
	out, err := s.handle(ctx, action, in)
	if err != nil {
		status := http.StatusServiceUnavailable
		code, retryable := "runtime_control_failed", true
		var failure *executionfailure.Error
		if errors.As(err, &failure) {
			code, retryable = failure.Code, !failure.Permanent
			if failure.Permanent {
				status = http.StatusUnprocessableEntity
			}
		}
		if errors.Is(err, pgx.ErrNoRows) {
			status = 404
		}
		if errors.Is(err, execution.ErrAgentInvocationConflict) {
			status = 409
		}
		respond(w, status, map[string]any{"code": code, "retryable": retryable})
		return
	}
	respond(w, 200, out)
}
func (s *Server) handle(ctx context.Context, action string, in input) (any, error) {
	switch action {
	case "terminal":
		var terminal struct {
			Code     string `json:"code"`
			Stage    string `json:"stage"`
			Canceled bool   `json:"canceled"`
		}
		if err := json.Unmarshal(in.Payload, &terminal); err != nil {
			return nil, err
		}
		if terminal.Canceled {
			_, err := s.Finalization.FinalizeCancellation(ctx, executioncontract.CancellationInput{RequestID: in.RequestID, Reason: "user_requested", CanceledAt: time.Now().UTC()})
			return map[string]any{}, err
		}
		_, err := s.Finalization.FinalizeExecutionFailure(ctx, executioncontract.FailureInput{RequestID: in.RequestID, Stage: terminal.Stage, FailureKind: terminal.Code, FailedAt: time.Now().UTC()})
		return map[string]any{}, err
	case "payload/get":
		payload, err := s.Store.GetRuntimePayload(ctx, in.RequestID, in.Ref)
		return map[string]any{"payload": payload}, err
	case "payload/put":
		return map[string]any{}, s.Store.PutRuntimePayload(ctx, in.RequestID, in.Ref, in.Payload)
	case "prepare":
		req := in.Operation
		if req.RequestID != in.RequestID {
			return nil, errors.New("runtime request identity mismatch")
		}
		wire, err := s.Operations.PrepareRuntimeOperation(ctx, req)
		if err != nil {
			return nil, err
		}
		value := prepared{Request: req, Wire: outboundadapter.RuntimeRequestPayload(wire)}
		payload, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		if err = s.Store.PutRuntimePayload(ctx, in.RequestID, in.Ref, payload); err != nil {
			return nil, err
		}
		run, err := s.Operations.RunProjectionStore.GetRun(ctx, in.RequestID)
		if err != nil {
			return nil, err
		}
		executionPayload, err := s.Operations.LoadExecutionPayload(ctx, run)
		if err != nil {
			return nil, err
		}
		executionPayload["user_id"] = run.OwnerUserID
		return map[string]any{"prepared": value, "tool_context": executionPayload, "created_at": run.CreatedAt}, err
	case "invocation/get":
		receipt, err := s.Receipts.GetAgentInvocationReceipt(ctx, in.InvocationID)
		if errors.Is(err, execution.ErrAgentInvocationNotFound) {
			return map[string]any{"disposition": "new"}, nil
		}
		if err != nil {
			return nil, err
		}
		if receipt.RequestID != in.RequestID || receipt.InputSHA256 != in.InputSHA256 {
			return nil, execution.ErrAgentInvocationConflict
		}
		disposition := "ambiguous"
		if receipt.State == execution.AgentInvocationReceiptStateCompleted || receipt.State == execution.AgentInvocationReceiptStateFailed {
			disposition = "replay"
		}
		return map[string]any{"disposition": disposition, "output": receipt.OutputJSON}, nil
	case "invocation/begin":
		if _, err := s.Operations.TemporalActivityRun(ctx, in.RequestID); err != nil {
			return nil, err
		}
		receipt, disposition, err := executionapplication.NewReceiptService(s.Receipts).Begin(ctx, in.InvocationID, in.RequestID, in.InputSHA256)
		return map[string]any{"disposition": disposition, "output": receipt.OutputJSON}, err
	case "invocation/complete":
		receipt, err := s.Receipts.GetAgentInvocationReceipt(ctx, in.InvocationID)
		if err != nil {
			return nil, err
		}
		if receipt.RequestID != in.RequestID {
			return nil, errors.New("invocation belongs to another run")
		}
		return map[string]any{}, executionapplication.NewReceiptService(s.Receipts).Complete(ctx, receipt, in.Payload)
	case "project":
		var result executionapplication.AgentRuntimeResult
		var err error
		result, err = outboundadapter.DecodeAgentRuntimeResponse(200, bytes.NewReader(in.Payload), false, nil)
		if err != nil {
			return nil, err
		}
		data, err := s.Store.GetRuntimePayload(ctx, in.RequestID, in.Ref)
		if err != nil {
			return nil, err
		}
		var prep prepared
		if err = json.Unmarshal(data, &prep); err != nil {
			return nil, err
		}
		if in.CompletedAt.IsZero() {
			return nil, errors.New("completed_at is required")
		}
		run, err := s.Operations.TemporalActivityRun(ctx, in.RequestID)
		if err != nil {
			return nil, err
		}
		if result.RequestID != in.RequestID || result.Operation != string(prep.Request.Operation) {
			return nil, errors.New("runtime result identity mismatch")
		}
		output, err := s.Operations.NormalizeOperationResult(ctx, run, prep.Request, result)
		if err != nil {
			return nil, err
		}
		// Store the completed input before any projection writes. Retries only repair
		// these writes; they never claim another model invocation.
		completion, err := json.Marshal(struct {
			Payload     json.RawMessage `json:"payload"`
			CompletedAt time.Time       `json:"completed_at"`
		}{in.Payload, in.CompletedAt})
		if err != nil {
			return nil, err
		}
		if err := s.Store.PutRuntimePayload(ctx, in.RequestID, in.Ref+":completion", completion); err != nil {
			return nil, err
		}
		prep.Request.Stream = result.AnswerStarted
		if !result.AnswerStarted && output.Status == "completed" && output.SolveOutcome == "answer" {
			output.AnswerStarted = true
		}
		encoded, err := json.Marshal(output)
		if err != nil {
			return nil, err
		}
		if err := s.Store.PutRuntimePayload(ctx, in.RequestID, in.Ref+":output", encoded); err != nil {
			return nil, err
		}
		steps, err := s.Operations.RunProjectionStore.ListRunSteps(ctx, in.RequestID)
		if err != nil {
			return nil, err
		}
		step, found := operation.WorkflowOperationReplayStep(steps, prep.Request.StepID)
		if !found {
			return nil, errors.New("runtime stage projection missing")
		}
		identity := activityprojection.StepProjection{Run: run, Attempt: 1, ActivityAttempt: 1, PreserveAttempt: true, StartedAt: step.StartedAt, TaskQueue: step.TaskQueue, WorkerID: step.WorkerID}
		if err := s.Operations.ProjectBufferedSolveAnswer(ctx, run, prep.Request, &output); err != nil {
			return nil, err
		}
		if err := s.Operations.ProjectWorkflowToolResults(ctx, run, prep.Request, result.ToolResults, identity, in.CompletedAt); err != nil {
			return nil, err
		}
		if err := s.Operations.ProjectOperationCompletion(ctx, run, prep.Request, result, output, identity, in.CompletedAt); err != nil {
			return nil, err
		}
		return map[string]any{"ref": in.Ref + ":output"}, nil

	case "answer/completed":
		run, err := s.Operations.TemporalActivityRun(ctx, in.RequestID)
		if err != nil {
			return nil, err
		}
		return map[string]any{}, s.Operations.ProjectWorkflowAnswerCompleted(ctx, run, in.InvocationID)
	case "answer/delta":
		run, err := s.Operations.TemporalActivityRun(ctx, in.RequestID)
		if err != nil {
			return nil, err
		}
		return map[string]any{}, s.Operations.ProjectWorkflowAnswerDelta(ctx, run, in.InvocationID, in.Sequence, in.Delta)
	case "retrieval/status":
		run, err := s.Operations.TemporalActivityRun(ctx, in.RequestID)
		if err != nil {
			return nil, err
		}
		if in.InvocationID == "" || !execution.ValidRetrievalStatus("campus", in.RetrievalStatus) {
			return nil, errors.New("invalid retrieval status")
		}
		err = s.Operations.AppendRunEvent(ctx, execution.DurableRunEvent{
			EventID:   in.RequestID + ":retrieval:" + in.InvocationID + ":" + in.RetrievalStatus,
			RequestID: run.RequestID, ConversationID: run.ConversationID,
			EventType: execution.DurableRunEventTypeRunRetrievalStatus, Visibility: execution.DurableRunEventVisibilityBrowser,
			OccurredAt: time.Now().UTC(), PayloadSchemaVersion: "run-retrieval-status-v1",
			Payload: map[string]any{"source": "campus", "status": in.RetrievalStatus},
		})
		return map[string]any{}, err
	case "collection/bind":
		run, err := s.Operations.TemporalActivityRun(ctx, in.RequestID)
		if err != nil {
			return nil, err
		}
		bound := execution.StringValue(run.Metadata["campus_docs_index_collection"])
		if bound != "" && bound != in.Collection {
			return nil, execution.ErrAgentInvocationConflict
		}
		if bound == "" {
			metadata := execution.CloneAnyMapFromValue(run.Metadata)
			metadata["campus_docs_index_collection"] = in.Collection
			err = s.MetadataWriter.ReplaceRunMetadata(ctx, in.RequestID, metadata)
		}
		return map[string]any{}, err
	case "finalize":
		data, err := s.Store.GetRuntimePayload(ctx, in.RequestID, in.Ref)
		if err != nil {
			return nil, err
		}
		var out executioncontract.OperationOutput
		if err = json.Unmarshal(data, &out); err != nil {
			return nil, err
		}
		_, err = s.Finalization.WriteWorkflowFinalization(ctx, executioncontract.FinalizationInput{RequestID: in.RequestID, WorkflowResult: out, AdmissionSnapshot: executioncontract.AdmissionFromDomain(in.Operation.AdmissionSnapshot)})
		return map[string]any{}, err
	default:
		return nil, errors.New("unknown runtime control action")
	}
}
