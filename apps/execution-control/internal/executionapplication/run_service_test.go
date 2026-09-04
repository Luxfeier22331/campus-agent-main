package executionapplication

import (
	"context"
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

type applicationTestSearcher struct{ query string }

func (searcher *applicationTestSearcher) Search(
	_ context.Context,
	_ campusdocs.Index,
	query string,
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
			RequestID:       run.RequestID,
			ResultLimit:     5,
			UserGoal:        "我想知道本科生转专业需要满足什么条件",
		},
		SearchQuery: "本科生转专业申请条件",
	})
	if err != nil {
		t.Fatalf("CampusSearch returned error: %v", err)
	}
	if result["outcome"] != "no_match" {
		t.Fatalf("campus search result = %#v", result)
	}
	if searcher.query != "我想知道本科生转专业需要满足什么条件\n检索表达：本科生转专业申请条件" {
		t.Fatalf("retrieval query = %q", searcher.query)
	}
	if _, err := service.CampusSearch(context.Background(), CampusSearchRequest{
		AccessContext: AgentToolAccessContext{
			ActivityAttempt: 2,
			RequestID:       run.RequestID,
		},
	}); !IsAgentToolConflict(err) {
		t.Fatalf("stale attempt error = %v, want run conflict", err)
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
			RequestID:       run.RequestID,
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
		executor.request.OwnerGeneration != 2 ||
		executor.request.OwnerSequence != 7 {
		t.Fatalf("recall request = %#v", executor.request)
	}
}

func TestCampusSearchRetrievalQueryUsesUserGoalAndSearchExpression(t *testing.T) {
	for _, test := range []struct {
		name        string
		userGoal    string
		searchQuery string
		want        string
	}{
		{
			name:        "same expression",
			userGoal:    "本科生转专业条件",
			searchQuery: "本科生转专业条件",
			want:        "本科生转专业条件",
		},
		{
			name:        "focused expression",
			userGoal:    "我想知道本科生转专业需要满足什么条件",
			searchQuery: "本科生转专业申请条件",
			want:        "我想知道本科生转专业需要满足什么条件\n检索表达：本科生转专业申请条件",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := campusSearchRetrievalQuery(test.userGoal, test.searchQuery); got != test.want {
				t.Fatalf("retrieval query = %q, want %q", got, test.want)
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
	strategy := execution.ExecutionStrategyForAdmission(personalMemoryRecallAvailable)
	if _, err := store.UpsertRunStep(context.Background(), execution.RunStepProjection{
		StepID:               "agent.primary",
		RequestID:            wire.RequestID,
		ConversationID:       wire.ConversationID,
		StepKind:             "agent",
		Status:               "running",
		ActivityAttempt:      1,
		TaskQueue:            "campus-agent.activity.agent.v3",
		WorkerID:             "test:agent:001",
		StartedAt:            applicationTestNow.Add(3 * time.Second),
		UpdatedAt:            applicationTestNow.Add(3 * time.Second),
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload: map[string]any{
			"visible_function_tool_names": strategy.VisibleFunctionToolNames,
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
	strategy := execution.ExecutionStrategyForAdmission(personalMemoryRecallAvailable)
	toolContract := execution.ToolContractFingerprintSnapshot{
		FunctionSchemaSHA256: "sha256:" + strings.Repeat("b", 64),
		SchemaVersion:        execution.ToolContractFingerprintSchemaVersion,
		ToolsSHA256:          "sha256:" + strings.Repeat("c", 64),
	}
	return execution.AgentAdmissionSnapshot{
		AgentLimits:                   limits,
		AgentLimitsSHA256:             execution.HashAdmissionJSON(limits),
		ExecutionStrategy:             strategy,
		ExecutionStrategySHA256:       execution.HashAdmissionJSON(strategy),
		PrimaryAgentTargetSHA256:      strings.Repeat("d", 64),
		ToolContractFingerprint:       toolContract,
		ToolContractFingerprintSHA256: execution.HashAdmissionJSON(toolContract),
	}
}
