package runtimeapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	finalization "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/finalization"
	operation "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/runtimeapi/codec"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/runtimeprojection"
	"github.com/jackc/pgx/v5"
	"io"
	"net/http"
	"strings"
	"time"
)

// Server transports typed Runtime operations to their Control owners.
type Server struct {
	SharedSecret   string
	ActivityStore  executionapplication.StepProjectionStore
	Input          RuntimeInputPort
	Invocation     RuntimeInvocationPort
	Projection     RuntimeProjectionPort
	Boundary       operation.RuntimeResultBoundary
	Finalization   *finalization.FinalizationService
	Store          executionapplication.RuntimePayloadStore
	MetadataWriter interface {
		ReplaceRunMetadata(context.Context, string, map[string]any) error
	}
}

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func serveAction[T, R any](w http.ResponseWriter, r *http.Request, handler func(context.Context, T) (R, error)) {
	var in T
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, execution.MaxAgentOperationPayloadBytes))
	if err := decoder.Decode(&in); err != nil {
		respond(w, 400, map[string]string{"code": "invalid_request"})
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		respond(w, 400, map[string]string{"code": "invalid_request"})
		return
	}
	out, err := handler(r.Context(), in)
	if err != nil {
		respondError(w, err)
		return
	}
	respond(w, 200, out)
}
func respondError(w http.ResponseWriter, err error) {
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
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.SharedSecret == "" || r.Header.Get("x-agent-runtime-auth") != s.SharedSecret {
		respond(w, 401, map[string]string{"code": "unauthorized"})
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, execution.MaxAgentOperationPayloadBytes))
	if err != nil {
		respond(w, 400, map[string]string{"code": "invalid_request"})
		return
	}
	var envelope struct {
		RequestID string                             `json:"request_id"`
		Activity  executioncontract.ActivityMetadata `json:"activity"`
	}
	if err = json.Unmarshal(body, &envelope); err != nil || envelope.RequestID == "" {
		respond(w, 400, map[string]string{"code": "invalid_request"})
		return
	}
	ctx, err := runtimeprojection.BindActivity(r.Context(), s.ActivityStore, envelope.RequestID, envelope.Activity)
	if err != nil {
		respondError(w, err)
		return
	}
	r = r.WithContext(ctx)
	r.Body = io.NopCloser(bytes.NewReader(body))
	switch strings.TrimPrefix(r.URL.Path, "/internal/agent-runtime/") {
	case "terminal":
		serveAction(w, r, s.handleTerminal)
	case "payload/get":
		serveAction(w, r, s.handlePayloadGet)
	case "payload/put":
		serveAction(w, r, s.handlePayloadPut)
	case "prepare":
		serveAction(w, r, s.handlePrepare)
	case "invocation/get":
		serveAction(w, r, s.handleInvocationGet)
	case "invocation/begin":
		serveAction(w, r, s.handleInvocationBegin)
	case "invocation/complete":
		serveAction(w, r, s.handleInvocationComplete)
	case "project":
		serveAction(w, r, s.handleProject)
	case "answer/completed":
		serveAction(w, r, s.handleAnswerCompleted)
	case "answer/delta":
		serveAction(w, r, s.handleAnswerDelta)
	case "retrieval/status":
		serveAction(w, r, s.handleRetrievalStatus)
	case "collection/bind":
		serveAction(w, r, s.handleCollectionBind)
	case "finalize":
		serveAction(w, r, s.handleFinalize)
	default:
		respond(w, 404, map[string]string{"code": "unknown_runtime_action"})
	}
}

func (s *Server) handleTerminal(ctx context.Context, in TerminalRequest) (*RuntimeAcknowledgement, error) {
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
		return &RuntimeAcknowledgement{}, err
	}
	_, err := s.Finalization.FinalizeExecutionFailure(ctx, executioncontract.FailureInput{RequestID: in.RequestID, Stage: terminal.Stage, FailureKind: terminal.Code, FailedAt: time.Now().UTC()})
	return &RuntimeAcknowledgement{}, err
}

func (s *Server) handlePayloadGet(ctx context.Context, in PayloadGetRequest) (*PayloadResponse, error) {
	payload, err := s.Store.GetRuntimePayload(ctx, in.RequestID, in.Ref)
	return &PayloadResponse{Payload: payload}, err
}

func (s *Server) handlePayloadPut(ctx context.Context, in PayloadPutRequest) (*RuntimeAcknowledgement, error) {
	return &RuntimeAcknowledgement{}, s.Store.PutRuntimePayload(ctx, in.RequestID, in.Ref, in.Payload)
}

func (s *Server) handlePrepare(ctx context.Context, in PrepareRequest) (*PrepareResponse, error) {
	req := in.Operation
	if req.RequestID != in.RequestID {
		return nil, errors.New("runtime request identity mismatch")
	}
	wire, err := s.Input.PrepareRuntimeOperation(ctx, req)
	if err != nil {
		return nil, err
	}
	value := PreparedOperation{Request: req, Wire: codec.RuntimeRequestPayload(wire)}
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if err = s.Store.PutRuntimePayload(ctx, in.RequestID, in.Ref, payload); err != nil {
		return nil, err
	}
	executionPayload, createdAt, err := s.Input.LoadToolContext(ctx, in.RequestID)

	return &PrepareResponse{Prepared: value, ToolContext: executionPayload, CreatedAt: createdAt}, err
}

func (s *Server) handleInvocationGet(ctx context.Context, in InvocationGetRequest) (executionapplication.RuntimeInvocationResult, error) {
	return s.Invocation.Get(ctx, executionapplication.RuntimeInvocationRequest{RequestID: in.RequestID, InvocationID: in.InvocationID, InputSHA256: in.InputSHA256})

}

func (s *Server) handleInvocationBegin(ctx context.Context, in InvocationBeginRequest) (executionapplication.RuntimeInvocationResult, error) {
	return s.Invocation.Begin(ctx, executionapplication.RuntimeInvocationRequest{RequestID: in.RequestID, InvocationID: in.InvocationID, InputSHA256: in.InputSHA256})

}

func (s *Server) handleInvocationComplete(ctx context.Context, in InvocationCompleteRequest) (executionapplication.RuntimeInvocationResult, error) {
	return s.Invocation.Complete(ctx, executionapplication.RuntimeInvocationRequest{RequestID: in.RequestID, Payload: in.Payload, InvocationID: in.InvocationID})

}

func (s *Server) handleProject(ctx context.Context, in ProjectRequest) (*ProjectionResponse, error) {
	var result executionapplication.AgentRuntimeResult
	var err error
	result, err = codec.DecodeResult(in.Payload)
	if err != nil {
		return nil, err
	}
	data, err := s.Store.GetRuntimePayload(ctx, in.RequestID, in.Ref)
	if err != nil {
		return nil, err
	}
	var prep PreparedOperation
	if err = json.Unmarshal(data, &prep); err != nil {
		return nil, err
	}
	if in.CompletedAt.IsZero() {
		return nil, errors.New("completed_at is required")
	}
	run, err := s.Projection.TemporalActivityRun(ctx, in.RequestID)
	if err != nil {
		return nil, err
	}
	if result.RequestID != in.RequestID || result.Operation != string(prep.Request.Operation) {
		return nil, errors.New("runtime result identity mismatch")
	}
	output, err := s.Boundary.AcceptOperationResult(run, prep.Request, result)
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
	steps, err := s.Projection.ListRunSteps(ctx, in.RequestID)
	if err != nil {
		return nil, err
	}
	step, found := operation.WorkflowOperationReplayStep(steps, prep.Request.StepID)
	if !found {
		return nil, errors.New("runtime stage projection missing")
	}

	attempts, err := s.Projection.ListStepAttempts(ctx, in.RequestID)
	if err != nil {
		return nil, err
	}
	var attempt execution.StepAttemptProjection
	for _, candidate := range attempts {
		if candidate.StepID == step.StepID && candidate.Attempt >= attempt.Attempt {
			attempt = candidate
		}
	}
	identity := activityprojection.StepProjection{Run: run, Attempt: attempt.Attempt, ActivityAttempt: attempt.ActivityAttempt, ActivityID: attempt.ActivityID, ActivityType: attempt.ActivityType, WorkflowID: attempt.WorkflowID, TemporalRunID: attempt.TemporalRunID, ScheduledAt: attempt.ScheduledAt, ScheduleToStartMS: attempt.ScheduleToStartMS, PreserveAttempt: true, StartedAt: step.StartedAt, TaskQueue: step.TaskQueue, WorkerID: step.WorkerID}

	if err := s.Projection.ProjectBufferedSolveAnswer(ctx, run, prep.Request, &output); err != nil {
		return nil, err
	}
	if err := s.Projection.ProjectWorkflowToolResults(ctx, run, prep.Request, result.ToolResults, identity, in.CompletedAt); err != nil {
		return nil, err
	}
	if err := s.Projection.ProjectOperationCompletion(ctx, run, prep.Request, result, output, identity, in.CompletedAt); err != nil {
		return nil, err
	}
	return &ProjectionResponse{Ref: in.Ref + ":output"}, nil

}

func (s *Server) handleAnswerCompleted(ctx context.Context, in AnswerCompletedRequest) (*RuntimeAcknowledgement, error) {
	run, err := s.Projection.TemporalActivityRun(ctx, in.RequestID)
	if err != nil {
		return nil, err
	}
	return &RuntimeAcknowledgement{}, s.Projection.ProjectWorkflowAnswerCompleted(ctx, run, in.InvocationID)
}

func (s *Server) handleAnswerDelta(ctx context.Context, in AnswerDeltaRequest) (*RuntimeAcknowledgement, error) {
	run, err := s.Projection.TemporalActivityRun(ctx, in.RequestID)
	if err != nil {
		return nil, err
	}
	return &RuntimeAcknowledgement{}, s.Projection.ProjectWorkflowAnswerDelta(ctx, run, in.InvocationID, in.Sequence, in.Delta)
}

func (s *Server) handleRetrievalStatus(ctx context.Context, in RetrievalStatusRequest) (*RuntimeAcknowledgement, error) {
	run, err := s.Projection.TemporalActivityRun(ctx, in.RequestID)
	if err != nil {
		return nil, err
	}
	if in.InvocationID == "" || !execution.ValidRetrievalStatus("campus", in.RetrievalStatus) {
		return nil, errors.New("invalid retrieval status")
	}
	err = s.Projection.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:   in.RequestID + ":retrieval:" + in.InvocationID + ":" + in.RetrievalStatus,
		RequestID: run.RequestID, ConversationID: run.ConversationID,
		EventType: execution.DurableRunEventTypeRunRetrievalStatus, Visibility: execution.DurableRunEventVisibilityBrowser,
		OccurredAt: time.Now().UTC(), PayloadSchemaVersion: "run-retrieval-status-v1",
		Payload: map[string]any{"source": "campus", "status": in.RetrievalStatus},
	})
	return &RuntimeAcknowledgement{}, err
}

func (s *Server) handleCollectionBind(ctx context.Context, in CollectionBindRequest) (*RuntimeAcknowledgement, error) {
	run, err := s.Projection.TemporalActivityRun(ctx, in.RequestID)
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
	return &RuntimeAcknowledgement{}, err
}

func (s *Server) handleFinalize(ctx context.Context, in FinalizeRequest) (*RuntimeAcknowledgement, error) {
	data, err := s.Store.GetRuntimePayload(ctx, in.RequestID, in.Ref)
	if err != nil {
		return nil, err
	}
	var out executioncontract.OperationOutput
	if err = json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	_, err = s.Finalization.WriteWorkflowFinalization(ctx, executioncontract.FinalizationInput{RequestID: in.RequestID, WorkflowResult: out, AdmissionSnapshot: executioncontract.AdmissionFromDomain(in.Operation.AdmissionSnapshot)})
	return &RuntimeAcknowledgement{}, err
}
