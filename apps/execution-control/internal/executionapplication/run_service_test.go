package executionapplication

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

var applicationTestNow = time.Date(2026, 9, 4, 1, 2, 3, 0, time.UTC)

type applicationTestInputLoader struct {
	wire contracts.ExecutionPayloadWire
}

func (loader applicationTestInputLoader) Load(
	context.Context,
	execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	return loader.wire, nil
}

type applicationTestAdmissionBuilder struct {
	personalMemoryRecallAvailable bool
}

func (builder *applicationTestAdmissionBuilder) BuildAgentAdmissionSnapshot(
	_ context.Context,
	personalMemoryRecallAvailable bool,
) (execution.AgentAdmissionSnapshot, error) {
	builder.personalMemoryRecallAvailable = personalMemoryRecallAvailable
	return validApplicationTestAdmissionSnapshot(personalMemoryRecallAvailable), nil
}

type applicationTestWaker struct{ count int }

func (waker *applicationTestWaker) Wake() { waker.count++ }

type applicationTestIndexStore struct{}

func (applicationTestIndexStore) CurrentIndex(
	context.Context,
) (campusdocs.Index, bool, error) {
	return campusdocs.Index{Collection: "campus_docs_" + strings.Repeat("a", 64)}, true, nil
}

type switchingApplicationTestIndexStore struct {
	collections []string
	index       int
}

func (store *switchingApplicationTestIndexStore) CurrentIndex(context.Context) (campusdocs.Index, bool, error) {
	collection := store.collections[store.index]
	if store.index < len(store.collections)-1 {
		store.index++
	}
	return campusdocs.Index{Collection: collection}, true, nil
}

type applicationTestSearcher struct{ query campusdocs.SearchQuery }

func (searcher *applicationTestSearcher) Search(
	_ context.Context,
	_ campusdocs.Index,
	query campusdocs.SearchQuery,
	_ int,
) ([]campusdocs.SearchResultItem, error) {
	searcher.query = query
	return []campusdocs.SearchResultItem{}, nil
}

type applicationTestMemoryExecutor struct {
	request memoryruntime.RecallRequest
}

func (*applicationTestMemoryExecutor) ExecuteCommand(
	context.Context,
	memoryruntime.PersonalMemoryCommandRequest,
) (memoryruntime.PersonalMemoryCommandResult, error) {
	return memoryruntime.PersonalMemoryCommandResult{}, nil
}

func (*applicationTestMemoryExecutor) AppendConversationTurn(
	context.Context,
	memoryruntime.AppendConversationTurnRequest,
) (memoryruntime.AppendConversationTurnResult, error) {
	return memoryruntime.AppendConversationTurnResult{}, nil
}

func (executor *applicationTestMemoryExecutor) Recall(
	_ context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	executor.request = request
	return memoryruntime.RecallResult{ContextBlock: " remembered context "}, nil
}

func TestDurableRunFromCreateRequestPersistsOnlyInputReferenceMetadata(t *testing.T) {
	wire := contracts.ExecutionRunCreateRequestWire{
		ConversationID: "conversation-v3-metadata-001",
		RequestID:      "request-v3-metadata-001",
		OwnerUserID:    "user-v3-metadata-001",
		Surface:        "campus-web",
		Metadata: contracts.ExecutionRunMetadataWire{
			ExecutionContractVersion: contracts.ExecutionContractVersion,
			ExecutionInputRef:        "app-api://execution-inputs/request-v3-metadata-001",
			ExecutionInputSHA256:     strings.Repeat("a", 64),
		},
	}
	run := durableRunFromCreateRequest(
		wire,
		applicationTestNow,
		execution.WorkflowTaskQueue,
	)
	if len(run.Metadata) != 3 {
		t.Fatalf("metadata fields = %#v, want exactly three input reference fields", run.Metadata)
	}
	want := map[string]any{
		"execution_contract_version": contracts.ExecutionContractVersion,
		"execution_input_ref":        "app-api://execution-inputs/request-v3-metadata-001",
		"execution_input_sha256":     strings.Repeat("a", 64),
	}
	for key, value := range want {
		if run.Metadata[key] != value {
			t.Fatalf("metadata[%q] = %#v, want %#v", key, run.Metadata[key], value)
		}
	}
	if _, exists := run.Metadata["execution_payload"]; exists {
		t.Fatalf("metadata must not contain raw execution payload: %#v", run.Metadata)
	}
}

func TestRunServiceCreatesRunAndStartIntentBeforeWakingReconciler(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	builder := &applicationTestAdmissionBuilder{}
	waker := &applicationTestWaker{}
	wire := applicationTestCreateRequest("request-application-create", false)
	service := NewRunService(RunServiceOptions{
		AdmissionSnapshotBuilder:     builder,
		InputLoader:                  applicationTestInputLoader{wire: applicationTestPayload(wire)},
		Namespace:                    "campus-agent-test",
		Now:                          func() time.Time { return applicationTestNow },
		PersonalMemoryTimeoutSeconds: 10,
		ReconcilerWaker:              waker,
		Store:                        store,
		TaskQueue:                    execution.WorkflowTaskQueue,
	})

	result, err := service.CreateRun(context.Background(), CreateRunRequest{
		TraceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		Wire:        wire,
	})
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if !result.Created || result.Run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("create result = %#v", result)
	}
	intent, err := store.GetWorkflowStartIntent(context.Background(), wire.RequestID)
	if err != nil {
		t.Fatalf("get workflow start intent: %v", err)
	}
	input, err := execution.DecodeAndValidateWorkflowStartInput(intent, result.Run)
	if err != nil {
		t.Fatalf("decode persisted workflow input: %v", err)
	}
	if input.Namespace != "campus-agent-test" || input.PersonalMemoryTimeoutSeconds != 10 ||
		input.TraceParent == "" {
		t.Fatalf("workflow input = %#v", input)
	}
	if builder.personalMemoryRecallAvailable {
		t.Fatal("personal memory recall was admitted for a request that did not allow it")
	}
	for _, field := range []string{"agent_limits_sha256", "agent_capabilities_sha256", "agent_budget_sha256", "tool_contract_fingerprint_sha256"} {
		if strings.Contains(string(intent.WorkflowInputJSON), field) {
			t.Fatalf("new workflow input contains retired field %s", field)
		}
	}
	for name, mutate := range map[string]func(*execution.AgentAdmissionSnapshot){
		"limits": func(s *execution.AgentAdmissionSnapshot) { s.AgentLimits.MaxOutputTokens++ },
		"capabilities": func(s *execution.AgentAdmissionSnapshot) {
			s.AgentCapabilities.HostedWebSearch = !s.AgentCapabilities.HostedWebSearch
		},
		"budget": func(s *execution.AgentAdmissionSnapshot) { s.AgentBudget.MaxModelTurns++ },
		"tool contract": func(s *execution.AgentAdmissionSnapshot) {
			s.ToolContractFingerprint.ToolsSHA256 = "sha256:" + strings.Repeat("f", 64)
		},
	} {
		t.Run(name, func(t *testing.T) {
			changed := input
			mutate(&changed.AdmissionSnapshot)
			if execution.SHA256JSONRef(changed.AdmissionSnapshot) == input.AdmissionSnapshotSHA256 {
				t.Fatal("top-level hash did not cover snapshot mutation")
			}
			changedIntent := intent
			encoded, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			changedIntent.WorkflowInputJSON = encoded
			if _, err := execution.DecodeAndValidateWorkflowStartInput(changedIntent, result.Run); err == nil {
				t.Fatal("workflow accepted mutation with stale top-level hash")
			}
		})
	}
	if waker.count != 1 {
		t.Fatalf("reconciler wake count = %d, want 1", waker.count)
	}
}

func TestAgentToolServiceOwnsCampusSearchRunValidationAndRetrievalQuery(t *testing.T) {
	store, run, _ := applicationTestRunningRun(t, false)
	searcher := &applicationTestSearcher{}
	service := NewAgentToolService(AgentToolServiceOptions{
		CampusDocsIndexStore: applicationTestIndexStore{},
		CampusDocsSearcher:   searcher,
		Store:                store,
	})
	result, err := service.CampusSearch(context.Background(), CampusSearchRequest{
		AccessContext: AgentToolAccessContext{
			ActivityAttempt: 1,
			CitationStart:   1,
			InvocationID:    "tool-campus-search-1",
			RequestID:       run.RequestID,
			ResultLimit:     5,
			UserGoal:        "我想知道本科生转专业需要满足什么条件",
			WorkflowStepID:  "task.step.step.lookup",
		},
		SearchQuery: "本科生转专业申请条件",
	})
	if err != nil {
		t.Fatalf("CampusSearch returned error: %v", err)
	}
	if result["outcome"] != "no_match" {
		t.Fatalf("campus search result = %#v", result)
	}
	if !reflect.DeepEqual(searcher.query, campusdocs.SearchQuery{RetrievalQuery: "本科生转专业申请条件", RerankQuery: "我想知道本科生转专业需要满足什么条件"}) {
		t.Fatalf("search query = %#v", searcher.query)
	}
	if _, err := service.CampusSearch(context.Background(), CampusSearchRequest{
		AccessContext: AgentToolAccessContext{
			ActivityAttempt: 2,
			RequestID:       run.RequestID,
			WorkflowStepID:  "task.step.step.lookup",
		},
	}); !IsAgentToolConflict(err) {
		t.Fatalf("stale attempt error = %v, want run conflict", err)
	}
}

func TestCampusSearchFailureCodePreservesExecutionStage(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want string
	}{
		{name: "retrieval timeout", err: campusSearchStageError{stage: "retrieval", cause: context.DeadlineExceeded}, want: "campus_search_retrieval_timeout"},
		{name: "rerank failure", err: campusSearchStageError{stage: "rerank", cause: errors.New("provider failed")}, want: "campus_search_rerank_failed"},
		{name: "unknown", err: errors.New("unclassified"), want: "campus_search_failed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := CampusSearchFailureCode(test.err); got != test.want {
				t.Fatalf("CampusSearchFailureCode() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestAgentToolServiceRejectsIndexChangeWithinRun(t *testing.T) {
	store, run, _ := applicationTestRunningRun(t, false)
	indexStore := &switchingApplicationTestIndexStore{collections: []string{
		"campus_docs_" + strings.Repeat("a", 64),
		"campus_docs_" + strings.Repeat("b", 64),
	}}
	service := NewAgentToolService(AgentToolServiceOptions{
		CampusDocsIndexStore: indexStore,
		CampusDocsSearcher:   &applicationTestSearcher{},
		Store:                store,
	})
	access := AgentToolAccessContext{
		ActivityAttempt: 1, CitationStart: 1, InvocationID: "tool-index-race-1",
		RequestID: run.RequestID, ResultLimit: 5, UserGoal: "查校务信息", WorkflowStepID: "task.step.step.lookup",
	}
	if _, err := service.CampusSearch(context.Background(), CampusSearchRequest{AccessContext: access, SearchQuery: "第一次"}); err != nil {
		t.Fatalf("first search failed: %v", err)
	}
	access.InvocationID = "tool-index-race-2"
	if _, err := service.CampusSearch(context.Background(), CampusSearchRequest{AccessContext: access, SearchQuery: "第二次"}); !IsAgentToolConflict(err) {
		t.Fatalf("second search error = %v, want index binding conflict", err)
	}
}

func TestAgentToolServiceSerializesConcurrentFirstIndexBinding(t *testing.T) {
	store, run, _ := applicationTestRunningRun(t, false)
	indexStore := &switchingApplicationTestIndexStore{collections: []string{
		"campus_docs_" + strings.Repeat("a", 64),
		"campus_docs_" + strings.Repeat("b", 64),
	}}
	service := NewAgentToolService(AgentToolServiceOptions{
		CampusDocsIndexStore: indexStore,
		CampusDocsSearcher:   &applicationTestSearcher{},
		Store:                store,
	})
	base := AgentToolAccessContext{
		ActivityAttempt: 1, CitationStart: 1, RequestID: run.RequestID, ResultLimit: 5,
		UserGoal: "查校务信息", WorkflowStepID: "task.step.step.lookup",
	}
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func(index int) {
			access := base
			access.InvocationID = "tool-index-concurrent-" + string(rune('1'+index))
			_, err := service.CampusSearch(context.Background(), CampusSearchRequest{AccessContext: access, SearchQuery: "并发检索"})
			errs <- err
		}(i)
	}
	var success, conflicts int
	for i := 0; i < 2; i++ {
		if err := <-errs; err == nil {
			success++
		} else if IsAgentToolConflict(err) {
			conflicts++
		} else {
			t.Fatalf("concurrent search error = %v", err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("concurrent binding outcomes success=%d conflicts=%d, want 1/1", success, conflicts)
	}
}

func TestAgentToolServiceBuildsPersonalMemoryRecallFromFrozenRunInput(t *testing.T) {
	store, run, inputLoader := applicationTestRunningRun(t, true)
	executor := &applicationTestMemoryExecutor{}
	service := NewAgentToolService(AgentToolServiceOptions{
		InputLoader:            inputLoader,
		PersonalMemoryExecutor: executor,
		Store:                  store,
	})
	result, err := service.PersonalMemoryRecall(context.Background(), PersonalMemoryRecallRequest{
		AccessContext: AgentToolAccessContext{
			ActivityAttempt: 1,
			InvocationID:    "tool-memory-recall-1",
			RequestID:       run.RequestID,
			WorkflowStepID:  "task.step.step.lookup",
		},
		Query: "新的记忆查询",
	})
	if err != nil {
		t.Fatalf("PersonalMemoryRecall returned error: %v", err)
	}
	if result["outcome"] != "matched" || result["memory_text"] != "remembered context" {
		t.Fatalf("personal memory result = %#v", result)
	}
	if executor.request.RequestID != run.RequestID ||
		executor.request.ThreadID != run.ConversationID ||
		executor.request.UserID != run.OwnerUserID ||
		executor.request.UserGoal != "新的记忆查询" ||
		executor.request.OwnerGeneration != 2 {
		t.Fatalf("recall request = %#v", executor.request)
	}
}

func TestCampusSearchSeparatesRetrievalExpressionAndUserGoal(t *testing.T) {
	for _, test := range []struct {
		name        string
		userGoal    string
		searchQuery string
		searchGoal  string
	}{
		{
			name:        "same expression",
			userGoal:    "本科生转专业条件",
			searchQuery: "本科生转专业条件",
		},
		{
			name:        "focused expression",
			userGoal:    "我想知道本科生转专业需要满足什么条件",
			searchQuery: "本科生转专业申请条件",
		},
		{
			name:        "focused rerank goal",
			userGoal:    "访学有哪些项目，费用和申请条件是什么",
			searchQuery: "访学 资助 收费",
			searchGoal:  "访学项目的费用与资助",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, run, _ := applicationTestRunningRun(t, false)
			searcher := &applicationTestSearcher{}
			service := NewAgentToolService(AgentToolServiceOptions{Store: store, CampusDocsIndexStore: applicationTestIndexStore{}, CampusDocsSearcher: searcher})
			_, err := service.CampusSearch(t.Context(), CampusSearchRequest{
				AccessContext: AgentToolAccessContext{RequestID: run.RequestID, UserGoal: " " + test.userGoal + " ", ResultLimit: 5, ActivityAttempt: 1, CitationStart: 1, InvocationID: "tool-campus-search-1", WorkflowStepID: "task.step.step.lookup"},
				SearchQuery:   " " + test.searchQuery + " ",
				SearchGoal:    " " + test.searchGoal + " ",
			})
			if err != nil {
				t.Fatal(err)
			}
			wantGoal := test.searchGoal
			if wantGoal == "" {
				wantGoal = test.userGoal
			}
			if searcher.query.RetrievalQuery != test.searchQuery || searcher.query.RerankQuery != wantGoal {
				t.Fatalf("search queries = %#v", searcher.query)
			}
		})
	}
}

func applicationTestCreateRequest(
	requestID string,
	personalMemoryRecallAllowed bool,
) contracts.ExecutionRunCreateRequestWire {
	return contracts.ExecutionRunCreateRequestWire{
		ConversationID:              "conversation-" + requestID,
		RequestID:                   requestID,
		OwnerUserID:                 "user-application-test",
		PersonalMemoryRecallAllowed: personalMemoryRecallAllowed,
		Surface:                     "campus-web",
		RuntimeVersions:             map[string]any{"contract": "test"},
		Metadata: contracts.ExecutionRunMetadataWire{
			ExecutionContractVersion: contracts.ExecutionContractVersion,
			ExecutionInputRef:        "app-api://execution-inputs/" + requestID,
			ExecutionInputSHA256:     strings.Repeat("a", 64),
		},
	}
}

func applicationTestPayload(
	wire contracts.ExecutionRunCreateRequestWire,
) contracts.ExecutionPayloadWire {
	return contracts.ExecutionPayloadWire{
		ExecutionContractVersion: contracts.ExecutionContractVersion,
		ResponseContract:         contracts.ResponseContract,
		UserGoal:                 "原始用户目标",
		ConversationID:           wire.ConversationID,
		TenantID:                 "tenant-application-test",
		RequestID:                wire.RequestID,
		Context: map[string]any{
			"actor": map[string]any{
				"user_id": wire.OwnerUserID,
			},
			"memory": map[string]any{
				"owner_generation": int64(2),
				"owner_sequence":   int64(7),
			},
			"conversation": map[string]any{
				"current_user_message": map[string]any{
					"created_at": applicationTestNow.Format(time.RFC3339),
				},
			},
		},
	}
}

func applicationTestRunningRun(
	t *testing.T,
	personalMemoryRecallAvailable bool,
) (*executionpersistence.InMemoryRunProjectionStore, execution.DurableRun, execution.InputLoader) {
	t.Helper()
	requestID := "request-application-campus-search"
	if personalMemoryRecallAvailable {
		requestID = "request-application-memory-recall"
	}
	wire := applicationTestCreateRequest(requestID, personalMemoryRecallAvailable)
	inputLoader := applicationTestInputLoader{wire: applicationTestPayload(wire)}
	store := executionpersistence.NewInMemoryRunProjectionStore()
	service := NewRunService(RunServiceOptions{
		AdmissionSnapshotBuilder:      &applicationTestAdmissionBuilder{},
		InputLoader:                   inputLoader,
		Now:                           func() time.Time { return applicationTestNow },
		PersonalMemoryRecallAvailable: personalMemoryRecallAvailable,
		Store:                         store,
	})
	result, err := service.CreateRun(context.Background(), CreateRunRequest{Wire: wire})
	if err != nil {
		t.Fatalf("create application test run: %v", err)
	}
	for index, status := range []execution.DurableRunStatus{
		execution.DurableRunStatusQueued,
		execution.DurableRunStatusAdmitted,
		execution.DurableRunStatusRunning,
	} {
		if _, err := store.TransitionRun(
			context.Background(),
			wire.RequestID,
			status,
			"",
			applicationTestNow.Add(time.Duration(index+1)*time.Second),
		); err != nil {
			t.Fatalf("transition application test run to %s: %v", status, err)
		}
	}
	capabilities := execution.AgentCapabilitiesForAdmission(personalMemoryRecallAvailable, true)
	if _, err := store.UpsertRunStep(context.Background(), execution.RunStepProjection{
		StepID:               "task.step.step.lookup",
		RequestID:            wire.RequestID,
		ConversationID:       wire.ConversationID,
		StepKind:             "executor",
		Status:               "started",
		ActivityAttempt:      1,
		TaskQueue:            "campus-agent.activity.agent.v3",
		WorkerID:             "test:agent:001",
		StartedAt:            applicationTestNow.Add(3 * time.Second),
		UpdatedAt:            applicationTestNow.Add(3 * time.Second),
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload: map[string]any{
			"visible_function_tool_names": capabilities.VisibleFunctionToolNames,
		},
	}); err != nil {
		t.Fatalf("upsert application test agent step: %v", err)
	}
	run, err := store.GetRun(context.Background(), result.Run.RequestID)
	if err != nil {
		t.Fatalf("get running application test run: %v", err)
	}
	return store, run, inputLoader
}

func validApplicationTestAdmissionSnapshot(
	personalMemoryRecallAvailable bool,
) execution.AgentAdmissionSnapshot {
	limits := execution.AgentRuntimeLimitsSnapshot{
		AgentDeadlineMS:       1,
		ContextCharLimit:      1,
		CurrentInputCharLimit: 1,
		MaxOutputTokens:       1,
	}
	capabilities := execution.AgentCapabilitiesForAdmission(personalMemoryRecallAvailable, true)
	budget := execution.AgentRuntimeBudgetSnapshot{
		MaxFunctionToolCalls: 8,
		MaxModelTurns:        8,
		MaxPlanSteps:         6,
		MaxReplans:           3,
		SchemaVersion:        execution.AgentRuntimeBudgetSchemaVersion,
	}
	toolContract := execution.ToolContractFingerprintSnapshot{
		FunctionSchemaSHA256: "sha256:" + strings.Repeat("b", 64),
		SchemaVersion:        execution.ToolContractFingerprintSchemaVersion,
		ToolsSHA256:          "sha256:" + strings.Repeat("c", 64),
	}
	return execution.AgentAdmissionSnapshot{
		AgentLimits:             limits,
		AgentCapabilities:       capabilities,
		AgentBudget:             budget,
		ModelTargetSHA256:       strings.Repeat("d", 64),
		ToolContractFingerprint: toolContract,
	}
}

type missingApplicationTestIndexStore struct{}

func (missingApplicationTestIndexStore) CurrentIndex(context.Context) (campusdocs.Index, bool, error) {
	return campusdocs.Index{}, false, nil
}

func TestCampusSearchReportsMissingIndexAsUnavailable(t *testing.T) {
	store, run, _ := applicationTestRunningRun(t, false)
	service := NewAgentToolService(AgentToolServiceOptions{
		CampusDocsIndexStore: missingApplicationTestIndexStore{},
		CampusDocsSearcher:   &applicationTestSearcher{},
		Store:                store,
	})
	_, err := service.CampusSearch(context.Background(), CampusSearchRequest{
		AccessContext: AgentToolAccessContext{
			ActivityAttempt: 1, CitationStart: 1, InvocationID: "missing-index",
			RequestID: run.RequestID, ResultLimit: 5, UserGoal: "查校务信息",
			WorkflowStepID: "task.step.step.lookup",
		},
		SearchQuery: "夜宵时间",
	})
	if !errors.Is(err, ErrCampusSearchUnavailable) {
		t.Fatalf("missing index error = %v, want unavailable", err)
	}
}
