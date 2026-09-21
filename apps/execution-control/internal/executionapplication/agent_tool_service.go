package executionapplication

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

const (
	CampusSearchToolName         = "campus_search"
	PersonalMemoryRecallToolName = "personal_memory_recall"
	CampusSearchResultLimit      = campusdocs.SearchResultLimit
	campusDocsIndexBindingKey    = "campus_docs_index_collection"
)

var ErrCampusSearchUnavailable = errors.New("campus search index is not available")

type AgentToolServiceOptions struct {
	CampusDocsIndexStore      campusdocs.IndexStore
	CampusDocsIndexStoreError error
	CampusDocsSearcher        campusdocs.Searcher
	CampusDocsSearcherError   error
	InputLoader               execution.InputLoader
	InputError                error
	PersonalMemoryExecutor    MemoryExecutor
	PersonalMemoryError       error
	Store                     RunStore
	StoreError                error
}

type AgentToolService struct {
	indexBindingMu            sync.Mutex
	campusDocsIndexStore      campusdocs.IndexStore
	campusDocsIndexStoreError error
	campusDocsSearcher        campusdocs.Searcher
	campusDocsSearcherError   error
	inputLoader               execution.InputLoader
	inputError                error
	personalMemoryExecutor    MemoryExecutor
	personalMemoryError       error
	store                     RunStore
	storeError                error
}

type AgentToolAccessContext struct {
	ExcludedResultRefs []string
	ActivityAttempt    int
	CitationStart      int
	DeadlineAt         time.Time
	InvocationID       string
	RequestID          string
	ResultLimit        int
	UserGoal           string
	WorkflowStepID     string
}

type CampusSearchRequest struct {
	AccessContext AgentToolAccessContext
	SearchQuery   string
	SearchGoal    string
}

type PersonalMemoryRecallRequest struct {
	AccessContext AgentToolAccessContext
	Query         string
}

type agentToolConflictError struct{ cause error }

type campusSearchStageError struct {
	stage string
	cause error
}

func (e campusSearchStageError) Error() string { return e.cause.Error() }
func (e campusSearchStageError) Unwrap() error { return e.cause }

// CampusSearchFailureCode returns a stable, stage-specific code for the
// internal tool transport. It deliberately does not expose provider details.
func CampusSearchFailureCode(err error) string {
	var stageErr campusSearchStageError
	if !errors.As(err, &stageErr) {
		return "campus_search_failed"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "campus_search_" + stageErr.stage + "_timeout"
	}
	return "campus_search_" + stageErr.stage + "_failed"
}

func (agentToolConflictError) Error() string {
	return "agent tool request conflicts with run state"
}

func (e agentToolConflictError) Unwrap() error { return e.cause }

func IsAgentToolConflict(err error) bool {
	var conflict agentToolConflictError
	return errors.As(err, &conflict)
}

func NewAgentToolService(options AgentToolServiceOptions) *AgentToolService {
	return &AgentToolService{
		campusDocsIndexStore:      options.CampusDocsIndexStore,
		campusDocsIndexStoreError: options.CampusDocsIndexStoreError,
		campusDocsSearcher:        options.CampusDocsSearcher,
		campusDocsSearcherError:   options.CampusDocsSearcherError,
		inputLoader:               options.InputLoader,
		inputError:                options.InputError,
		personalMemoryExecutor:    options.PersonalMemoryExecutor,
		personalMemoryError:       options.PersonalMemoryError,
		store:                     options.Store,
		storeError:                options.StoreError,
	}
}

func (s *AgentToolService) CampusSearch(
	ctx context.Context,
	request CampusSearchRequest,
) (map[string]any, error) {
	access := request.AccessContext
	if !access.DeadlineAt.IsZero() {
		var cancel context.CancelFunc
		ctx, cancel = context.WithDeadline(ctx, access.DeadlineAt)
		defer cancel()
	}
	query := campusdocs.SearchQuery{
		RetrievalQuery:     strings.TrimSpace(request.SearchQuery),
		RerankQuery:        strings.TrimSpace(request.SearchGoal),
		ExcludedResultRefs: access.ExcludedResultRefs,
	}
	if query.RerankQuery == "" {
		query.RerankQuery = strings.TrimSpace(access.UserGoal)
	}
	snapshot := &campusdiagnostics.Snapshot{
		EffectiveQuery: campusdiagnostics.Bound(query.RetrievalQuery, 1024),
		RerankQuery:    campusdiagnostics.Bound(query.RerankQuery, 1024), CitationStart: access.CitationStart,
		ResultLimit: access.ResultLimit, Durations: map[string]int64{}, Candidates: []campusdiagnostics.Candidate{},
		FailedStage:       "validation",
		SnapshotTruncated: len([]rune(query.RetrievalQuery)) > 1024 || len([]rune(query.RerankQuery)) > 1024,
	}
	observe := func(phase string) {
		campusdiagnostics.Record(ctx, s.store, campusdiagnostics.Observation{
			RequestID: access.RequestID, InvocationID: access.InvocationID,
			WorkflowStepID: access.WorkflowStepID, ActivityAttempt: access.ActivityAttempt,
			SearchQuery: request.SearchQuery, Phase: phase, At: time.Now(), Snapshot: snapshot,
		})
	}
	finishFailure := func(err error) error {
		if err == nil {
			return nil
		}
		phase := "failed"
		if errors.Is(err, context.Canceled) {
			phase = "canceled"
		}
		observe(phase)
		stage := snapshot.FailedStage
		if stage == "" {
			stage = "unknown"
		}
		return campusSearchStageError{stage: stage, cause: err}
	}
	observe("received")
	ctx = campusdocs.WithSearchObserver(ctx, &campusdocs.SearchObserver{Snapshot: snapshot, Phase: observe})
	run, err := s.validateRun(ctx, request.AccessContext, CampusSearchToolName)
	if err != nil {
		return nil, finishFailure(err)
	}
	snapshot.FailedStage = "index"
	if s.campusDocsIndexStore == nil {
		if s.campusDocsIndexStoreError != nil {
			return nil, finishFailure(s.campusDocsIndexStoreError)
		}
		return nil, finishFailure(errors.New("campus docs index store is not configured"))
	}
	if s.campusDocsSearcherError != nil {
		return nil, finishFailure(s.campusDocsSearcherError)
	}
	if s.campusDocsSearcher == nil {
		return nil, finishFailure(errors.New("campus docs searcher is not configured"))
	}
	s.indexBindingMu.Lock()
	// The run snapshot was loaded before acquiring the service-wide lock. Re-read
	// it here so a concurrent first caller cannot bind against the same empty
	// metadata snapshot.
	run, err = s.store.GetRun(ctx, access.RequestID)
	if err != nil {
		s.indexBindingMu.Unlock()
		return nil, finishFailure(err)
	}
	index, found, err := s.campusDocsIndexStore.CurrentIndex(ctx)
	if err != nil {
		s.indexBindingMu.Unlock()
		return nil, finishFailure(err)
	}
	if !found {
		s.indexBindingMu.Unlock()
		return nil, finishFailure(ErrCampusSearchUnavailable)
	}
	boundCollection := execution.StringValue(run.Metadata[campusDocsIndexBindingKey])
	if boundCollection != "" && boundCollection != index.Collection {
		s.indexBindingMu.Unlock()
		return nil, newAgentToolConflict(fmt.Errorf(
			"campus docs index binding changed during run: bound=%s current=%s",
			boundCollection,
			index.Collection,
		))
	}
	if boundCollection == "" {
		metadata := execution.CloneAnyMapFromValue(run.Metadata)
		metadata[campusDocsIndexBindingKey] = index.Collection
		if err := s.store.ReplaceRunMetadata(ctx, run.RequestID, metadata); err != nil {
			s.indexBindingMu.Unlock()
			return nil, err
		}
	}
	s.indexBindingMu.Unlock()
	snapshot.Retrieval = &campusdiagnostics.RetrievalMeta{Collection: index.Collection}
	observe("index_loaded")
	results, err := s.campusDocsSearcher.Search(
		ctx,
		index,
		query,
		request.AccessContext.ResultLimit,
	)
	if err != nil {
		return nil, finishFailure(err)
	}
	snapshot.FailedStage = ""
	observe("completed")
	return campusdocs.EncodeSearchResult(results, request.AccessContext.CitationStart), nil
}

func (s *AgentToolService) PersonalMemoryRecall(
	ctx context.Context,
	request PersonalMemoryRecallRequest,
) (map[string]any, error) {
	run, err := s.validateRun(ctx, request.AccessContext, PersonalMemoryRecallToolName)
	if err != nil {
		return nil, err
	}
	intent, err := s.store.GetWorkflowStartIntent(ctx, run.RequestID)
	if err != nil {
		return nil, err
	}
	workflowInput, err := execution.DecodeAndValidateWorkflowStartInput(intent, run)
	if err != nil {
		return nil, newAgentToolConflict(err)
	}
	if !execution.ContainsString(
		workflowInput.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames,
		PersonalMemoryRecallToolName,
	) {
		return nil, newAgentToolConflict(errors.New("personal memory recall is not available for this run"))
	}
	payload, err := s.loadExecutionPayload(ctx, run)
	if err != nil {
		return nil, err
	}
	recallRequest, err := recallRequestForRun(run, payload)
	if err != nil {
		return nil, newAgentToolConflict(err)
	}
	recallRequest.UserGoal = strings.TrimSpace(request.Query)
	if s.personalMemoryError != nil {
		return nil, s.personalMemoryError
	}
	if s.personalMemoryExecutor == nil {
		return nil, errors.New("personal memory executor is not configured")
	}
	result, err := s.personalMemoryExecutor.Recall(ctx, recallRequest)
	if err != nil {
		return nil, err
	}
	memoryText := strings.TrimSpace(result.ContextBlock)
	outcome := "no_match"
	if memoryText != "" {
		outcome = "matched"
	}
	return map[string]any{
		"memory_text": memoryText,
		"outcome":     outcome,
	}, nil
}

func (s *AgentToolService) validateRun(
	ctx context.Context,
	access AgentToolAccessContext,
	toolName string,
) (execution.DurableRun, error) {
	if s == nil || s.store == nil {
		if s != nil && s.storeError != nil {
			return execution.DurableRun{}, s.storeError
		}
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.store.GetRun(ctx, strings.TrimSpace(access.RequestID))
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status != execution.DurableRunStatusRunning {
		return execution.DurableRun{}, newAgentToolConflict(errors.New("agent tool run is not running"))
	}
	steps, err := s.store.ListRunSteps(ctx, run.RequestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	step, latestAttempt, ok := latestWorkflowOperationStep(steps, access.WorkflowStepID)
	if !ok {
		return execution.DurableRun{}, newAgentToolConflict(
			errors.New("executor step admission projection is unavailable"),
		)
	}
	if latestAttempt != access.ActivityAttempt {
		return execution.DurableRun{}, newAgentToolConflict(
			errors.New("workflow tool activity_attempt does not match its executor attempt"),
		)
	}
	if !execution.ContainsString(
		stringSliceFromAny(step.SanitizedPayload["visible_function_tool_names"]),
		toolName,
	) {
		return execution.DurableRun{}, newAgentToolConflict(
			errors.New("agent tool is not admitted for this run"),
		)
	}
	return run, nil
}

func (s *AgentToolService) loadExecutionPayload(
	ctx context.Context,
	run execution.DurableRun,
) (map[string]any, error) {
	if s.inputLoader == nil {
		cause := s.inputError
		if cause == nil {
			cause = errors.New("execution input loader is not configured")
		}
		return nil, execution.NewInputError(
			"load",
			"execution_input_not_configured",
			false,
			cause,
		)
	}
	wire, err := s.inputLoader.Load(ctx, run)
	if err != nil {
		return nil, err
	}
	return execution.PayloadMap(wire), nil
}

func latestWorkflowOperationStep(
	steps []execution.RunStepProjection,
	stepID string,
) (execution.RunStepProjection, int, bool) {
	var latest execution.RunStepProjection
	latestAttempt := 0
	found := false
	stepID = strings.TrimSpace(stepID)
	for _, step := range steps {
		if step.StepID != stepID || step.Status != "started" {
			continue
		}
		if step.StepKind != "executor" && step.StepKind != "solver" {
			continue
		}
		attempt := step.ActivityAttempt
		if attempt <= 0 {
			attempt, _ = execution.PositiveIntValue(step.SanitizedPayload["activity_attempt"])
		}
		if attempt <= 0 {
			continue
		}
		if !found || attempt > latestAttempt ||
			(attempt == latestAttempt && step.UpdatedAt.After(latest.UpdatedAt)) {
			latest = step
			latestAttempt = attempt
			found = true
		}
	}
	return latest, latestAttempt, found
}

func recallRequestForRun(
	run execution.DurableRun,
	payload map[string]any,
) (memoryruntime.RecallRequest, error) {
	if payload == nil {
		return memoryruntime.RecallRequest{}, errors.New("execution input is required")
	}
	userGoal := strings.TrimSpace(execution.OptionalStringFromAny(payload["user_goal"]))
	if userGoal == "" {
		return memoryruntime.RecallRequest{}, errors.New("memory recall user_goal is required")
	}
	userID := execution.FirstNonEmptyText(
		execution.NestedAny(payload, "actor", "user_id"),
		execution.NestedAny(payload, "context", "actor", "user_id"),
		run.OwnerUserID,
	)
	generation, ok := exactInt64Value(execution.NestedAny(payload, "context", "memory", "owner_generation"))
	if !ok || generation < 1 {
		return memoryruntime.RecallRequest{}, errors.New("memory owner generation is required")
	}
	queryTimestamp := strings.TrimSpace(execution.OptionalStringFromAny(
		execution.NestedAny(payload, "context", "conversation", "current_user_message", "created_at"),
	))
	request := memoryruntime.RecallRequest{
		OwnerGeneration: generation,
		QueryTimestamp:  queryTimestamp,
		RequestID:       run.RequestID,
		TenantID: execution.FirstNonEmptyText(
			payload["tenant_id"],
			execution.NestedAny(payload, "context", "tenant_id"),
		),
		ThreadID: run.ConversationID,
		UserGoal: userGoal,
		UserID:   userID,
	}
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallRequest{}, err
	}
	return request, nil
}

func exactInt64Value(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		converted := int64(typed)
		return converted, typed == float64(converted)
	case json.Number:
		converted, err := typed.Int64()
		return converted, err == nil
	default:
		return 0, false
	}
}

func stringSliceFromAny(value any) []string {
	var result []string
	switch typed := value.(type) {
	case []string:
		return append(result, typed...)
	case []any:
		for _, item := range typed {
			if text, ok := item.(string); ok {
				result = append(result, text)
			}
		}
	}
	return result
}

func newAgentToolConflict(cause error) error {
	return agentToolConflictError{cause: cause}
}
