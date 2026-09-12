package executionapplication

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type ReconcilerWaker interface {
	Wake()
}

type RunServiceOptions struct {
	AdmissionSnapshotBuilder      execution.AdmissionSnapshotBuilder
	InputLoader                   execution.InputLoader
	InputError                    error
	Namespace                     string
	Now                           func() time.Time
	PersonalMemoryRecallAvailable bool
	PersonalMemoryTimeoutSeconds  float64
	ReconcilerWaker               ReconcilerWaker
	Store                         RunStore
	StoreError                    error
	TaskQueue                     string
}

type RunService struct {
	admissionSnapshotBuilder      execution.AdmissionSnapshotBuilder
	inputLoader                   execution.InputLoader
	inputError                    error
	namespace                     string
	now                           func() time.Time
	personalMemoryRecallAvailable bool
	personalMemoryTimeoutSeconds  float64
	reconcilerWaker               ReconcilerWaker
	store                         RunStore
	storeError                    error
	taskQueue                     string
}

type CreateRunRequest struct {
	TraceParent string
	Wire        contracts.ExecutionRunCreateRequestWire
}

type RequestRunCancellationRequest struct {
	Reason    string
	RequestID string
}

type runCreatePreparationError struct{ cause error }
type runRequestValidationError struct{ cause error }

func (e runCreatePreparationError) Error() string { return e.cause.Error() }
func (e runCreatePreparationError) Unwrap() error { return e.cause }
func (e runRequestValidationError) Error() string { return e.cause.Error() }
func (e runRequestValidationError) Unwrap() error { return e.cause }

func IsRunCreatePreparationError(err error) bool {
	var preparationError runCreatePreparationError
	return errors.As(err, &preparationError)
}

func IsRunRequestValidationError(err error) bool {
	var validationError runRequestValidationError
	return errors.As(err, &validationError)
}

func NewRunService(options RunServiceOptions) *RunService {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	taskQueue := strings.TrimSpace(options.TaskQueue)
	if taskQueue == "" {
		taskQueue = execution.WorkflowTaskQueue
	}
	return &RunService{
		admissionSnapshotBuilder:      options.AdmissionSnapshotBuilder,
		inputLoader:                   options.InputLoader,
		inputError:                    options.InputError,
		namespace:                     strings.TrimSpace(options.Namespace),
		now:                           now,
		personalMemoryRecallAvailable: options.PersonalMemoryRecallAvailable,
		personalMemoryTimeoutSeconds:  options.PersonalMemoryTimeoutSeconds,
		reconcilerWaker:               options.ReconcilerWaker,
		store:                         options.Store,
		storeError:                    options.StoreError,
		taskQueue:                     taskQueue,
	}
}

func (s *RunService) StoreConfigured() bool {
	return s != nil && s.store != nil
}

func (s *RunService) CreateRun(
	ctx context.Context,
	request CreateRunRequest,
) (execution.DurableRunCreateResult, error) {
	if err := request.Wire.Validate(); err != nil {
		return execution.DurableRunCreateResult{}, newRunCreatePreparationError(
			fmt.Errorf("invalid execution run create request: %w", err),
		)
	}
	if err := s.requireStore(); err != nil {
		return execution.DurableRunCreateResult{}, err
	}
	now := s.now().UTC()
	run := durableRunFromCreateRequest(request.Wire, now, s.taskQueue)
	workflowInput, err := s.workflowInputForRun(ctx, run, request)
	if err != nil {
		return execution.DurableRunCreateResult{}, newRunCreatePreparationError(err)
	}
	workflowInputJSON, err := json.Marshal(workflowInput)
	if err != nil {
		return execution.DurableRunCreateResult{}, newRunCreatePreparationError(err)
	}
	requestFingerprint, err := durableRunCreateFingerprint(
		run,
		request.Wire.PersonalMemoryRecallAllowed,
	)
	if err != nil {
		return execution.DurableRunCreateResult{}, newRunCreatePreparationError(err)
	}
	result, err := s.store.CreateRunWithStartIntent(ctx, execution.DurableRunCreateIntent{
		Run:                      run,
		RequestFingerprintSHA256: requestFingerprint,
		WorkflowID:               workflowInput.WorkflowID,
		PayloadSHA256:            workflowInput.PayloadSHA256,
		TaskQueue:                workflowInput.TaskQueue,
		WorkflowInputJSON:        workflowInputJSON,
		CreatedEvent: execution.DurableRunEvent{
			EventID:              run.RequestID + ":run-created",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunCreated,
			OccurredAt:           run.CreatedAt,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": string(execution.DurableRunStatusCreated)},
		},
	})
	if err != nil {
		return execution.DurableRunCreateResult{}, err
	}
	s.wakeReconciler()
	return result, nil
}

func (s *RunService) RequestRunCancellation(
	ctx context.Context,
	request RequestRunCancellationRequest,
) (execution.DurableRun, error) {
	if err := s.requireStore(); err != nil {
		return execution.DurableRun{}, err
	}
	request.RequestID = strings.TrimSpace(request.RequestID)
	request.Reason = strings.TrimSpace(request.Reason)
	if request.RequestID == "" {
		return execution.DurableRun{}, newRunRequestValidationError(errors.New("request_id is required"))
	}
	if request.Reason != "user_requested" {
		return execution.DurableRun{}, newRunRequestValidationError(
			errors.New("cancel reason must be user_requested"),
		)
	}
	requested, err := s.store.RequestRunCancellation(ctx, execution.DurableRunCancellationRequest{
		RequestID: request.RequestID,
		Reason:    request.Reason,
		Now:       s.now().UTC().Truncate(time.Microsecond),
	})
	if err != nil {
		return execution.DurableRun{}, err
	}
	s.wakeReconciler()
	return requested, nil
}

func (s *RunService) workflowInputForRun(
	ctx context.Context,
	run execution.DurableRun,
	request CreateRunRequest,
) (execution.WorkflowStartInput, error) {
	inputMetadata, err := execution.InputMetadata(run)
	if err != nil {
		return execution.WorkflowStartInput{}, err
	}
	if err := s.requireInput(ctx, run); err != nil {
		return execution.WorkflowStartInput{}, err
	}
	personalMemoryRecallAvailable := request.Wire.PersonalMemoryRecallAllowed &&
		s.personalMemoryRecallAvailable
	if s.admissionSnapshotBuilder == nil {
		return execution.WorkflowStartInput{}, execution.NewDependencyNotReadyError(
			errors.New("agent admission snapshot builder is not configured"),
		)
	}
	admissionSnapshot, err := s.admissionSnapshotBuilder.BuildAgentAdmissionSnapshot(
		ctx,
		personalMemoryRecallAvailable,
	)
	if err != nil {
		return execution.WorkflowStartInput{}, err
	}
	workflowInput := execution.WorkflowStartInput{
		DeadlineAt:                   run.CreatedAt.Add(time.Duration(admissionSnapshot.AgentLimits.AgentDeadlineMS) * time.Millisecond),
		AdmissionSnapshot:            admissionSnapshot,
		AdmissionSnapshotSHA256:      execution.SHA256JSONRef(admissionSnapshot),
		ConversationID:               run.ConversationID,
		Namespace:                    s.namespace,
		PayloadSHA256:                inputMetadata.ExecutionInputSHA256,
		PersonalMemoryTimeoutSeconds: s.personalMemoryTimeoutSeconds,
		RequestID:                    run.RequestID,
		TaskQueue:                    s.taskQueue,
		TraceParent:                  strings.TrimSpace(request.TraceParent),
		WorkflowID:                   "campus-agent.chat." + run.RequestID,
	}
	if workflowInput.TaskQueue != execution.WorkflowTaskQueue {
		return execution.WorkflowStartInput{}, errors.New("execution task queue is not v3")
	}
	return workflowInput, nil
}

func (s *RunService) requireInput(ctx context.Context, run execution.DurableRun) error {
	if s.inputLoader == nil {
		cause := s.inputError
		if cause == nil {
			cause = errors.New("execution input loader is not configured")
		}
		return execution.NewInputError(
			"load",
			"execution_input_not_configured",
			false,
			cause,
		)
	}
	_, err := s.inputLoader.Load(ctx, run)
	return err
}

func (s *RunService) requireStore() error {
	if s == nil || s.store == nil {
		if s != nil && s.storeError != nil {
			return s.storeError
		}
		return execution.ErrRunProjectionStoreNotConfigured
	}
	return nil
}

func (s *RunService) wakeReconciler() {
	if s != nil && s.reconcilerWaker != nil {
		s.reconcilerWaker.Wake()
	}
}

func durableRunFromCreateRequest(
	wire contracts.ExecutionRunCreateRequestWire,
	now time.Time,
	taskQueue string,
) execution.DurableRun {
	return execution.DurableRun{
		RequestID:       wire.RequestID,
		ConversationID:  wire.ConversationID,
		OwnerUserID:     wire.OwnerUserID,
		Surface:         wire.Surface,
		Status:          execution.DurableRunStatusCreated,
		TaskQueue:       taskQueue,
		CreatedAt:       now,
		UpdatedAt:       now,
		RuntimeVersions: execution.CloneAnyMap(wire.RuntimeVersions),
		Metadata: map[string]any{
			"execution_contract_version": wire.Metadata.ExecutionContractVersion,
			"execution_input_ref":        wire.Metadata.ExecutionInputRef,
			"execution_input_sha256":     wire.Metadata.ExecutionInputSHA256,
		},
	}
}

func durableRunCreateFingerprint(
	run execution.DurableRun,
	personalMemoryRecallAllowed bool,
) (string, error) {
	canonical := struct {
		ConversationID              string         `json:"conversation_id"`
		Metadata                    map[string]any `json:"metadata"`
		OwnerUserID                 string         `json:"owner_user_id"`
		PersonalMemoryRecallAllowed bool           `json:"personal_memory_recall_allowed"`
		RequestID                   string         `json:"request_id"`
		RuntimeVersions             map[string]any `json:"runtime_versions"`
		Surface                     string         `json:"surface"`
	}{
		ConversationID:              run.ConversationID,
		Metadata:                    execution.CloneAnyMap(run.Metadata),
		OwnerUserID:                 run.OwnerUserID,
		PersonalMemoryRecallAllowed: personalMemoryRecallAllowed,
		RequestID:                   run.RequestID,
		RuntimeVersions:             execution.CloneAnyMap(run.RuntimeVersions),
		Surface:                     run.Surface,
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return "", fmt.Errorf("encode execution run fingerprint: %w", err)
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func newRunCreatePreparationError(cause error) error {
	return runCreatePreparationError{cause: cause}
}

func newRunRequestValidationError(cause error) error {
	return runRequestValidationError{cause: cause}
}
