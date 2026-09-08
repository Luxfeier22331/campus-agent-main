package executionapplication

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

const (
	CampusSearchToolName         = "campus_search"
	PersonalMemoryRecallToolName = "personal_memory_recall"
	CampusSearchResultLimit      = campusdocs.SearchResultLimit
)

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
	ActivityAttempt int
	CitationStart   int
	InvocationID    string
	RequestID       string
	ResultLimit     int
	UserGoal        string
	WorkflowStepID  string
}

type CampusSearchRequest struct {
	AccessContext AgentToolAccessContext
	SearchQuery   string
}

type PersonalMemoryRecallRequest struct {
	AccessContext AgentToolAccessContext
	Query         string
}

type agentToolConflictError struct{ cause error }

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
	if _, err := s.validateRun(ctx, request.AccessContext, CampusSearchToolName); err != nil {
		return nil, err
	}
	if s.campusDocsIndexStore == nil {
		if s.campusDocsIndexStoreError != nil {
			return nil, s.campusDocsIndexStoreError
		}
		return nil, errors.New("campus docs index store is not configured")
	}
	if s.campusDocsSearcherError != nil {
		return nil, s.campusDocsSearcherError
	}
	if s.campusDocsSearcher == nil {
		return nil, errors.New("campus docs searcher is not configured")
	}
	index, found, err := s.campusDocsIndexStore.CurrentIndex(ctx)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, errors.New("campus docs current index is not available")
	}
	results, err := s.campusDocsSearcher.Search(
		ctx,
		index,
		campusSearchRetrievalQuery(request.AccessContext.UserGoal, request.SearchQuery),
		request.AccessContext.ResultLimit,
	)
	if err != nil {
		return nil, err
	}
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
		if step.StepID != stepID || step.StepKind != "executor" || step.Status != "started" {
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
	sequence, ok := exactInt64Value(execution.NestedAny(payload, "context", "memory", "owner_sequence"))
	if !ok || sequence < 0 {
		return memoryruntime.RecallRequest{}, errors.New("memory owner sequence is required")
	}
	queryTimestamp := strings.TrimSpace(execution.OptionalStringFromAny(
		execution.NestedAny(payload, "context", "conversation", "current_user_message", "created_at"),
	))
	request := memoryruntime.RecallRequest{
		OwnerGeneration: generation,
		OwnerSequence:   sequence,
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

func campusSearchRetrievalQuery(userGoal string, searchQuery string) string {
	userGoal = strings.TrimSpace(userGoal)
	searchQuery = strings.TrimSpace(searchQuery)
	if searchQuery == userGoal {
		return userGoal
	}
	return userGoal + "\n检索表达：" + searchQuery
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
