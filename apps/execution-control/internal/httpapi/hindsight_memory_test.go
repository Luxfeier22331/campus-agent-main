package httpapi

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func TestHindsightAppendCompletedTurnRetainsConversationDocument(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{
		client:            client,
		ownerSalt:         "test-salt",
		recallLimit:       8,
		recallMaxTokens:   2500,
		contextCharBudget: 2500,
	}

	result, err := executor.AppendConversationTurn(context.Background(), memoryruntime.AppendConversationTurnRequest{
		AssistantMessage:        "好的，我会结合保研材料准备这个目标。",
		IgnoreAssistantForGraph: true,
		UserMessageCreatedAt:    "2026-06-16T10:03:04Z",
		RunID:                   "run-hindsight-append",
		TenantID:                "tenant-main",
		ThreadID:                "conv-hindsight-append",
		UserID:                  "user-executor",
		UserMessage:             "我之后主要关注保研材料",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
	if client.retainedBankID != wantBankID {
		t.Fatalf("bank id = %q, want %q", client.retainedBankID, wantBankID)
	}
	assertMemoryDefenseBankEnsured(t, client, wantBankID)
	wantDocumentID := "conversation:1bc60525b25178205e174cdc146d0e59"
	if len(client.retainedItems) != 1 {
		t.Fatalf("retained item count = %d, want 1", len(client.retainedItems))
	}
	item := client.retainedItems[0]
	if item.DocumentID != wantDocumentID {
		t.Fatalf("document id = %q, want %q", item.DocumentID, wantDocumentID)
	}
	if !client.retainedAsync {
		t.Fatal("append retain async = false, want true")
	}
	if item.Context != "campus assistant completed conversation turn" {
		t.Fatalf("context = %q", item.Context)
	}
	if item.Timestamp != "2026-06-16T10:03:04Z" {
		t.Fatalf("timestamp = %q, want occurred_at", item.Timestamp)
	}
	if item.Metadata["run_id"] != "run-hindsight-append" ||
		item.Metadata["thread_id"] != "conv-hindsight-append" ||
		item.Metadata["source"] != "completed_turn" {
		t.Fatalf("metadata = %#v", item.Metadata)
	}
	if !strings.Contains(item.Content, `"role":"user"`) ||
		strings.Contains(item.Content, `"role":"assistant"`) ||
		!strings.Contains(item.Content, "我之后主要关注保研材料") ||
		strings.Contains(item.Content, "好的，我会结合保研材料准备这个目标。") {
		t.Fatalf("content = %q", item.Content)
	}
	for _, wantTag := range []string{
		"scope:private",
		"type:conversation",
		"tenant:tenant-main",
		"user:" + wantBankID,
		"session:" + wantDocumentID,
	} {
		if !containsString(item.Tags, wantTag) {
			t.Fatalf("tags = %#v, want %q", item.Tags, wantTag)
		}
	}
	if result.AppendedMessageCount != 1 ||
		result.Status != "accepted" ||
		result.ThreadID != "conv-hindsight-append" ||
		result.UserID != "user-executor" ||
		result.OperationID != "op-retain-001" ||
		result.OperationStatusRef != "projection://runs/run-hindsight-append/memory/operations/op-retain-001" ||
		result.RuntimeDocumentRef != "projection://runs/run-hindsight-append/memory/documents/conversation%3A1bc60525b25178205e174cdc146d0e59" ||
		result.PayloadSHA256 == "" {
		t.Fatalf("append result = %#v", result)
	}
}

func TestHindsightRecallQueryIncludesConfirmedSessionSlots(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{
		client:            client,
		ownerSalt:         "test-salt",
		recallLimit:       5,
		recallMaxTokens:   2500,
		contextCharBudget: 2500,
	}

	_, err := executor.Recall(context.Background(), memoryruntime.RecallRequest{
		QueryTimestamp: "2026-06-16T10:03:04Z",
		RequestedTool:  "knowledge_query",
		RunID:          "run-hindsight-recall-slots",
		SessionSlots: map[string]string{
			"target_year": "2026",
			"topic":       "保研材料",
		},
		TenantID: "tenant-main",
		ThreadID: "conv-hindsight-recall-slots",
		UserGoal: "我应该怎么准备？",
		UserID:   "user-executor",
	})
	if err != nil {
		t.Fatalf("recall: %v", err)
	}
	wantQuery := "我应该怎么准备？\n\n已确认上下文:\n- target_year: 2026\n- topic: 保研材料"
	if client.recallRequest.Query != wantQuery {
		t.Fatalf("query = %q, want %q", client.recallRequest.Query, wantQuery)
	}
	if client.recallRequest.QueryTimestamp != "2026-06-16T10:03:04Z" {
		t.Fatalf("query timestamp = %q", client.recallRequest.QueryTimestamp)
	}
}

func TestHindsightRecallUsesBankRecallAndProjectsBoundedFactsOnly(t *testing.T) {
	client := &fakeHindsightClient{
		recallResponse: hindsightRecallResponse{
			Results: []hindsightRecallResult{{
				ID:          "fact-001",
				Text:        "用户主要关注保研材料",
				Type:        "experience",
				OccurredEnd: "2026-06-16T10:00:00Z",
			}},
		},
	}
	executor := hindsightExecutor{
		client:            client,
		ownerSalt:         "test-salt",
		recallLimit:       5,
		recallMaxTokens:   2500,
		contextCharBudget: 2500,
	}

	result, err := executor.Recall(context.Background(), memoryruntime.RecallRequest{
		QueryTimestamp: "2026-06-16T10:03:04Z",
		RequestedTool:  "knowledge_query",
		RunID:          "run-hindsight-recall",
		TenantID:       "tenant-main",
		ThreadID:       "conv-hindsight-recall",
		UserGoal:       "我如何准备保研材料？",
		UserID:         "user-executor",
	})
	if err != nil {
		t.Fatalf("recall: %v", err)
	}
	wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
	if client.recallBankID != wantBankID {
		t.Fatalf("recall bank id = %q, want %q", client.recallBankID, wantBankID)
	}
	assertMemoryDefenseBankEnsured(t, client, wantBankID)
	if client.recallRequest.Query != "我如何准备保研材料？" ||
		client.recallRequest.Budget != "mid" ||
		client.recallRequest.MaxTokens != 2500 ||
		client.recallRequest.Trace {
		t.Fatalf("recall request = %#v", client.recallRequest)
	}
	if client.recallRequest.TagsMatch != "all_strict" ||
		!containsString(client.recallRequest.Tags, "scope:private") {
		t.Fatalf("recall tag filter = %#v match=%q", client.recallRequest.Tags, client.recallRequest.TagsMatch)
	}
	for _, wantType := range []string{"experience", "observation", "world"} {
		if !containsString(client.recallRequest.Types, wantType) {
			t.Fatalf("recall types = %#v, want %q", client.recallRequest.Types, wantType)
		}
	}
	if len(result.Items) != 1 ||
		result.Items[0].MemoryID != "fact-001" ||
		result.Items[0].MemoryType != "experience" ||
		result.Items[0].UpdatedAt != "2026-06-16T10:00:00Z" {
		t.Fatalf("items = %#v", result.Items)
	}
	if len(result.RecentMessages) != 0 {
		t.Fatalf("recent messages = %#v, want none in sanitized projection", result.RecentMessages)
	}
	if !strings.Contains(result.ContextBlock, "用户主要关注保研材料") ||
		strings.Contains(result.ContextBlock, "最近对话") {
		t.Fatalf("context block = %q", result.ContextBlock)
	}
	if result.Provider != "hindsight" || result.RetrievalMode != "recall" {
		t.Fatalf("runtime source = provider %q mode %q", result.Provider, result.RetrievalMode)
	}
	if result.UserID != "user-executor" {
		t.Fatalf("result user id = %q, want product user id", result.UserID)
	}
}

func TestHindsightRecallAppliesRecallLimitBeforeProjection(t *testing.T) {
	client := &fakeHindsightClient{
		recallResponse: hindsightRecallResponse{
			Results: []hindsightRecallResult{
				{ID: "fact-001", Text: "第一条记忆", Type: "experience", OccurredEnd: "2026-06-16T10:00:00Z"},
				{ID: "fact-002", Text: "第二条记忆", Type: "experience", OccurredEnd: "2026-06-16T10:01:00Z"},
				{ID: "fact-003", Text: "第三条记忆", Type: "experience", OccurredEnd: "2026-06-16T10:02:00Z"},
			},
		},
	}
	executor := hindsightExecutor{
		client:            client,
		ownerSalt:         "test-salt",
		recallLimit:       2,
		recallMaxTokens:   2500,
		contextCharBudget: 2500,
	}

	result, err := executor.Recall(context.Background(), memoryruntime.RecallRequest{
		QueryTimestamp: "2026-06-16T10:03:04Z",
		RequestedTool:  "knowledge_query",
		RunID:          "run-hindsight-recall-limit",
		TenantID:       "tenant-main",
		ThreadID:       "conv-hindsight-recall-limit",
		UserGoal:       "我如何准备保研材料？",
		UserID:         "user-executor",
	})
	if err != nil {
		t.Fatalf("recall: %v", err)
	}
	if len(result.Items) != 2 || result.SelectedMemoryCount != 2 {
		t.Fatalf("items = %#v count=%d, want 2 items", result.Items, result.SelectedMemoryCount)
	}
	if result.Items[0].MemoryID != "fact-001" || result.Items[1].MemoryID != "fact-002" {
		t.Fatalf("items = %#v, want first two recall results", result.Items)
	}
	if strings.Contains(result.ContextBlock, "第三条记忆") {
		t.Fatalf("context block includes item past recall limit: %q", result.ContextBlock)
	}
}

func TestHindsightOperationStatusProjectsSanitizedStatus(t *testing.T) {
	client := &fakeHindsightClient{
		operationStatusResponse: hindsightOperationStatusResponse{
			CompletedAt:    "2026-06-16T10:02:00Z",
			CreatedAt:      "2026-06-16T10:00:00Z",
			OperationID:    "op-retain-001",
			OperationType:  "retain",
			ResultMetadata: map[string]any{"documents_processed": float64(1), "raw": "not projected verbatim"},
			Status:         "completed",
			UpdatedAt:      "2026-06-16T10:02:00Z",
		},
	}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.OperationStatus(context.Background(), memoryruntime.OperationStatusRequest{
		OperationID: "op-retain-001",
		RunID:       "run-operation-status",
		TenantID:    "tenant-main",
		UserID:      "user-executor",
	})
	if err != nil {
		t.Fatalf("operation status: %v", err)
	}
	wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
	if client.operationStatusBankID != wantBankID {
		t.Fatalf("bank id = %q, want %q", client.operationStatusBankID, wantBankID)
	}
	assertMemoryDefenseBankEnsured(t, client, wantBankID)
	if result.OperationID != "op-retain-001" ||
		result.OperationType != "retain" ||
		result.Status != "completed" ||
		result.UserID != "user-executor" ||
		result.ErrorKind != "" ||
		result.OperationRef != "projection://runs/run-operation-status/memory/operations/op-retain-001" ||
		result.ResultMetadataHash == "" ||
		result.PayloadSHA256 == "" {
		t.Fatalf("operation status result = %#v", result)
	}
	if result.ResultMetadataShape["documents_processed"] == nil || result.ResultMetadataShape["raw"] == nil {
		t.Fatalf("result metadata shape = %#v", result.ResultMetadataShape)
	}
}

func TestHindsightListOperationsProjectsSanitizedOperationLifecycle(t *testing.T) {
	client := &fakeHindsightClient{
		listOperationsResponse: hindsightOperationListResponse{
			Limit:  20,
			Offset: 0,
			Operations: []hindsightOperationItem{{
				CreatedAt:     "2026-06-16T10:00:00Z",
				ErrorMessage:  "provider timeout",
				ItemsCount:    2,
				OperationID:   "op-retain-001",
				OperationType: "retain",
				RetryCount:    1,
				Status:        "failed",
				UpdatedAt:     "2026-06-16T10:02:00Z",
			}},
			Total: 1,
		},
	}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.ListOperations(context.Background(), memoryruntime.OperationListRequest{
		ExcludeParents: true,
		Limit:          20,
		OperationType:  "retain",
		RunID:          "run-operation-list",
		Status:         "failed",
		TenantID:       "tenant-main",
		UserID:         "user-executor",
	})
	if err != nil {
		t.Fatalf("operation list: %v", err)
	}
	wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
	if client.listOperationsBankID != wantBankID {
		t.Fatalf("bank id = %q, want %q", client.listOperationsBankID, wantBankID)
	}
	assertMemoryDefenseBankEnsured(t, client, wantBankID)
	if !client.listOperationsRequest.ExcludeParents ||
		client.listOperationsRequest.Limit != 20 ||
		client.listOperationsRequest.OperationType != "retain" ||
		client.listOperationsRequest.Status != "failed" {
		t.Fatalf("list request = %#v", client.listOperationsRequest)
	}
	if result.SchemaVersion != "memory_operation_list_result_v1" ||
		result.UserID != "user-executor" ||
		result.Total != 1 ||
		result.PayloadSHA256 == "" ||
		len(result.Items) != 1 {
		t.Fatalf("list result = %#v", result)
	}
	item := result.Items[0]
	if item.OperationID != "op-retain-001" ||
		item.ErrorKind != "operation_error" ||
		item.OperationRef != "projection://runs/run-operation-list/memory/operations/op-retain-001" ||
		item.OperationType != "retain" ||
		item.Status != "failed" ||
		item.RetryCount != 1 {
		t.Fatalf("operation item = %#v", item)
	}
}

func TestHindsightOperationActionsProjectSanitizedRefs(t *testing.T) {
	for _, tc := range []struct {
		name       string
		action     string
		runID      string
		invoke     func(context.Context, hindsightExecutor, memoryruntime.OperationActionRequest) (memoryruntime.OperationActionResult, error)
		assertCall func(*testing.T, *fakeHindsightClient, string)
	}{{
		name:   "cancel",
		action: "cancel",
		runID:  "run-operation-cancel",
		invoke: func(ctx context.Context, executor hindsightExecutor, request memoryruntime.OperationActionRequest) (memoryruntime.OperationActionResult, error) {
			return executor.CancelOperation(ctx, request)
		},
		assertCall: func(t *testing.T, client *fakeHindsightClient, bankID string) {
			t.Helper()
			if client.cancelOperationBankID != bankID || client.cancelOperationID != "op-retain-001" {
				t.Fatalf("cancel call bank=%q operation=%q", client.cancelOperationBankID, client.cancelOperationID)
			}
		},
	}, {
		name:   "retry",
		action: "retry",
		runID:  "run-operation-retry",
		invoke: func(ctx context.Context, executor hindsightExecutor, request memoryruntime.OperationActionRequest) (memoryruntime.OperationActionResult, error) {
			return executor.RetryOperation(ctx, request)
		},
		assertCall: func(t *testing.T, client *fakeHindsightClient, bankID string) {
			t.Helper()
			if client.retryOperationBankID != bankID || client.retryOperationID != "op-retain-001" {
				t.Fatalf("retry call bank=%q operation=%q", client.retryOperationBankID, client.retryOperationID)
			}
		},
	}} {
		t.Run(tc.name, func(t *testing.T) {
			client := &fakeHindsightClient{
				operationActionResponse: hindsightOperationActionResponse{
					Message:     tc.action + "ed",
					OperationID: "op-retain-001",
					Success:     true,
				},
			}
			executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

			result, err := tc.invoke(context.Background(), executor, memoryruntime.OperationActionRequest{
				OperationID: "op-retain-001",
				RunID:       tc.runID,
				TenantID:    "tenant-main",
				UserID:      "user-executor",
			})
			if err != nil {
				t.Fatalf("%s operation: %v", tc.action, err)
			}
			wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
			tc.assertCall(t, client, wantBankID)
			assertMemoryDefenseBankEnsured(t, client, wantBankID)
			if result.SchemaVersion != "memory_operation_action_result_v1" ||
				result.Action != tc.action ||
				result.OperationID != "op-retain-001" ||
				result.OperationRef != "projection://runs/"+tc.runID+"/memory/operations/op-retain-001" ||
				result.Status != "accepted" ||
				!result.Success ||
				result.UserID != "user-executor" ||
				result.PayloadSHA256 == "" {
				t.Fatalf("action result = %#v", result)
			}
			encoded, err := json.Marshal(result)
			if err != nil {
				t.Fatalf("marshal action result: %v", err)
			}
			if strings.Contains(string(encoded), "message") {
				t.Fatalf("action result leaked vendor message: %s", encoded)
			}
		})
	}
}

func TestHindsightReflectProjectsBasedOnFactsWithoutTrace(t *testing.T) {
	client := &fakeHindsightClient{
		reflectResponse: hindsightReflectResponse{
			BasedOnMemories: []hindsightReflectFact{{
				ID:          "fact-reflect-001",
				Text:        "用户倾向先看结论",
				Type:        "observation",
				OccurredEnd: "2026-06-16T10:02:00Z",
			}},
			StructuredOutput: map[string]any{"preference": "conclusion_first"},
			Text:             "用户偏好先给结论。",
			Usage:            memoryruntime.TokenUsage{InputTokens: 10, OutputTokens: 6, TotalTokens: 16},
		},
	}
	executor := hindsightExecutor{
		client:            client,
		ownerSalt:         "test-salt",
		recallMaxTokens:   2500,
		contextCharBudget: 2500,
	}

	result, err := executor.Reflect(context.Background(), memoryruntime.ReflectRequest{
		Context:        "只归纳回答风格",
		IncludeBasedOn: true,
		Query:          "总结用户回答偏好",
		RunID:          "run-hindsight-reflect",
		TenantID:       "tenant-main",
		ThreadID:       "conv-hindsight-reflect",
		UserID:         "user-executor",
	})
	if err != nil {
		t.Fatalf("reflect: %v", err)
	}
	wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
	if client.reflectBankID != wantBankID {
		t.Fatalf("bank id = %q, want %q", client.reflectBankID, wantBankID)
	}
	assertMemoryDefenseBankEnsured(t, client, wantBankID)
	if client.reflectRequest.Query != "总结用户回答偏好" ||
		client.reflectRequest.Context != "只归纳回答风格" ||
		!client.reflectRequest.IncludeFacts ||
		client.reflectRequest.TagsMatch != "all_strict" {
		t.Fatalf("reflect request = %#v", client.reflectRequest)
	}
	if result.Text != "用户偏好先给结论。" ||
		result.Status != "completed" ||
		result.UserID != "user-executor" ||
		result.Provider != "hindsight" ||
		result.ReflectRef != "projection://runs/run-hindsight-reflect/memory/reflect" ||
		result.PayloadSHA256 == "" {
		t.Fatalf("reflect result = %#v", result)
	}
	if len(result.BasedOnMemoryItems) != 1 ||
		result.BasedOnMemoryItems[0].MemoryID != "fact-reflect-001" ||
		result.BasedOnMemoryItems[0].MemoryType != "observation" {
		t.Fatalf("based on items = %#v", result.BasedOnMemoryItems)
	}
	if result.Usage.TotalTokens != 16 || result.StructuredOutput["preference"] != "conclusion_first" {
		t.Fatalf("usage=%#v structured=%#v", result.Usage, result.StructuredOutput)
	}
}

func TestHindsightContextBlockRespectsRuneBudget(t *testing.T) {
	items := []memoryruntime.ContextItem{{
		Tool:        "knowledge_query",
		CompactText: "保研材料",
		MemoryID:    "fact-001",
		MemoryType:  "experience",
		UpdatedAt:   "2026-06-16T10:00:00Z",
	}}

	block := hindsightContextBlock(items, 18)
	if block != "用户记忆:\n相关事实:" {
		t.Fatalf("context block = %q, want Chinese memory within rune budget", block)
	}
}

func TestHindsightUpsertProfileMemoryItemRetainsProfileDocument(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.UpsertProfileMemoryItem(context.Background(), memoryruntime.UpsertProfileMemoryItemRequest{
		CanonicalSubject: "answer_style",
		CompactText:      "answer_style: 先给结论",
		MemoryID:         "mem_01HQ",
		TenantID:         "tenant-main",
		UpdatedAt:        "2026-06-16T10:00:00Z",
		UserID:           "user_01HQ",
	})
	if err != nil {
		t.Fatalf("profile upsert: %v", err)
	}
	wantBankID := "hindsight_bank_69d871a105ee9ae68b68093cedf42613"
	wantDocumentID := "profile:mem_01HQ"
	if client.retainedBankID != wantBankID {
		t.Fatalf("bank id = %q, want %q", client.retainedBankID, wantBankID)
	}
	assertMemoryDefenseBankEnsured(t, client, wantBankID)
	if len(client.retainedItems) != 1 {
		t.Fatalf("retained item count = %d, want 1", len(client.retainedItems))
	}
	item := client.retainedItems[0]
	if item.DocumentID != wantDocumentID ||
		item.Content != "answer_style: 先给结论" ||
		item.Context != "explicit profile memory" ||
		item.Timestamp != "2026-06-16T10:00:00Z" ||
		item.Metadata["canonical_subject"] != "answer_style" ||
		item.Metadata["memory_id"] != "mem_01HQ" {
		t.Fatalf("profile item = %#v", item)
	}
	if client.retainedAsync {
		t.Fatal("profile upsert async = true, want sync confirmation")
	}
	for _, wantTag := range []string{"scope:private", "type:profile", "tenant:tenant-main", "user:" + wantBankID} {
		if !containsString(item.Tags, wantTag) {
			t.Fatalf("tags = %#v, want %q", item.Tags, wantTag)
		}
	}
	if result.EpisodeUUID != wantDocumentID || result.Status != "active" || result.PayloadSHA256 == "" {
		t.Fatalf("result = %#v", result)
	}
}

func TestHindsightDeleteProfileMemoryItemDeletesProfileDocument(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.DeleteProfileMemoryItem(context.Background(), memoryruntime.DisableProfileMemoryItemRequest{
		EpisodeUUID: "profile:mem_01HQ",
		MemoryID:    "mem_01HQ",
		TenantID:    "tenant-main",
		UpdatedAt:   "2026-06-16T11:00:00Z",
		UserID:      "user_01HQ",
	})
	if err != nil {
		t.Fatalf("profile delete: %v", err)
	}
	wantBankID := "hindsight_bank_69d871a105ee9ae68b68093cedf42613"
	if client.deletedDocumentBankID != wantBankID || client.deletedDocumentID != "profile:mem_01HQ" {
		t.Fatalf("deleted document bank=%q doc=%q", client.deletedDocumentBankID, client.deletedDocumentID)
	}
	assertMemoryDefenseBankEnsured(t, client, wantBankID)
	if result.Status != "disabled" || result.EpisodeUUID != "profile:mem_01HQ" {
		t.Fatalf("result = %#v", result)
	}
}

func TestHindsightDeleteProfileMemoryOwnerDeletesUserBank(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}

	result, err := executor.DeleteProfileMemoryOwner(context.Background(), memoryruntime.DisableProfileMemoryOwnerRequest{
		TenantID:  "tenant-main",
		UpdatedAt: "2026-06-16T12:00:00Z",
		UserID:    "user-executor",
	})
	if err != nil {
		t.Fatalf("owner delete: %v", err)
	}
	wantBankID := "hindsight_bank_951609b8dfa813820b216c9ef9e76465"
	if client.deletedBankID != wantBankID {
		t.Fatalf("deleted bank id = %q, want %q", client.deletedBankID, wantBankID)
	}
	if result.Status != "disabled" || result.UserID != "user-executor" {
		t.Fatalf("result = %#v", result)
	}
}

func TestNewPersonalMemoryExecutorCreatesHindsightExecutor(t *testing.T) {
	executor, err := newPersonalMemoryExecutor(config.Config{
		PersonalMemoryAPISecret:       "hindsight-secret",
		PersonalMemoryBaseURL:         "http://hindsight-api:8000",
		PersonalMemoryOwnerSalt:       "owner-salt",
		PersonalMemoryRecallLimit:     8,
		PersonalMemoryRecallMaxTokens: 2500,
		PersonalMemoryRuntime:         "hindsight",
		PersonalMemoryTimeoutSeconds:  10,
	}, nil)
	if err != nil {
		t.Fatalf("new personal memory executor: %v", err)
	}
	if _, ok := executor.(hindsightExecutor); !ok {
		t.Fatalf("executor type = %T, want hindsightExecutor", executor)
	}
}

func TestNewPersonalMemoryExecutorRejectsRetiredPredecessorRuntime(t *testing.T) {
	_, err := newPersonalMemoryExecutor(config.Config{
		PersonalMemoryAPISecret:       "zep-secret",
		PersonalMemoryBaseURL:         "http://zep-ce-api:8000",
		PersonalMemoryOwnerSalt:       "owner-salt",
		PersonalMemoryRecallLimit:     8,
		PersonalMemoryRecallMaxTokens: 2500,
		PersonalMemoryRuntime:         "zep_ce",
		PersonalMemoryTimeoutSeconds:  10,
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "unsupported personal memory runtime") {
		t.Fatalf("error = %v, want retired runtime rejection", err)
	}
}

type fakeHindsightClient struct {
	cancelOperationBankID   string
	cancelOperationID       string
	deletedBankID           string
	deletedDocumentBankID   string
	deletedDocumentID       string
	ensuredBankConfig       hindsightBankConfig
	ensuredBankID           string
	listOperationsBankID    string
	listOperationsRequest   hindsightOperationListRequest
	listOperationsResponse  hindsightOperationListResponse
	operationActionResponse hindsightOperationActionResponse
	operationStatusBankID   string
	operationStatusResponse hindsightOperationStatusResponse
	recallBankID            string
	recallRequest           hindsightRecallRequest
	recallResponse          hindsightRecallResponse
	reflectBankID           string
	reflectRequest          hindsightReflectRequest
	reflectResponse         hindsightReflectResponse
	retryOperationBankID    string
	retryOperationID        string
	retainedAsync           bool
	retainedBankID          string
	retainedItems           []hindsightMemoryItem
}

func (f *fakeHindsightClient) EnsureBank(_ context.Context, bankID string, cfg hindsightBankConfig) error {
	f.ensuredBankID = bankID
	f.ensuredBankConfig = cfg
	return nil
}

func (f *fakeHindsightClient) HealthCheck(context.Context) error {
	return nil
}

func (f *fakeHindsightClient) RetainMemories(
	_ context.Context,
	bankID string,
	request hindsightRetainRequest,
) (hindsightRetainResponse, error) {
	f.retainedBankID = bankID
	if request.Async != nil {
		f.retainedAsync = *request.Async
	}
	f.retainedItems = append([]hindsightMemoryItem{}, request.Items...)
	operationID := ""
	if request.Async != nil && *request.Async {
		operationID = "op-retain-001"
	}
	return hindsightRetainResponse{
		Async:       f.retainedAsync,
		BankID:      bankID,
		ItemsCount:  len(request.Items),
		OperationID: operationID,
		Success:     true,
	}, nil
}

func (f *fakeHindsightClient) RecallMemories(
	_ context.Context,
	bankID string,
	request hindsightRecallRequest,
) (hindsightRecallResponse, error) {
	f.recallBankID = bankID
	f.recallRequest = request
	return f.recallResponse, nil
}

func (f *fakeHindsightClient) Reflect(
	_ context.Context,
	bankID string,
	request hindsightReflectRequest,
) (hindsightReflectResponse, error) {
	f.reflectBankID = bankID
	f.reflectRequest = request
	return f.reflectResponse, nil
}

func (f *fakeHindsightClient) OperationStatus(
	_ context.Context,
	bankID string,
	operationID string,
) (hindsightOperationStatusResponse, error) {
	f.operationStatusBankID = bankID
	if f.operationStatusResponse.OperationID == "" {
		f.operationStatusResponse.OperationID = operationID
	}
	return f.operationStatusResponse, nil
}

func (f *fakeHindsightClient) ListOperations(
	_ context.Context,
	bankID string,
	request hindsightOperationListRequest,
) (hindsightOperationListResponse, error) {
	f.listOperationsBankID = bankID
	f.listOperationsRequest = request
	return f.listOperationsResponse, nil
}

func (f *fakeHindsightClient) CancelOperation(
	_ context.Context,
	bankID string,
	operationID string,
) (hindsightOperationActionResponse, error) {
	f.cancelOperationBankID = bankID
	f.cancelOperationID = operationID
	if f.operationActionResponse.OperationID == "" {
		f.operationActionResponse.OperationID = operationID
	}
	return f.operationActionResponse, nil
}

func (f *fakeHindsightClient) RetryOperation(
	_ context.Context,
	bankID string,
	operationID string,
) (hindsightOperationActionResponse, error) {
	f.retryOperationBankID = bankID
	f.retryOperationID = operationID
	if f.operationActionResponse.OperationID == "" {
		f.operationActionResponse.OperationID = operationID
	}
	return f.operationActionResponse, nil
}

func (f *fakeHindsightClient) DeleteDocument(_ context.Context, bankID string, documentID string) error {
	f.deletedDocumentBankID = bankID
	f.deletedDocumentID = documentID
	return nil
}

func (f *fakeHindsightClient) DeleteBank(_ context.Context, bankID string) error {
	f.deletedBankID = bankID
	return nil
}

func boolPtr(value bool) *bool {
	return &value
}

func assertMemoryDefenseBankEnsured(t *testing.T, client *fakeHindsightClient, bankID string) {
	t.Helper()
	if client.ensuredBankID != bankID {
		t.Fatalf("ensured bank id = %q, want %q", client.ensuredBankID, bankID)
	}
	defense := client.ensuredBankConfig.MemoryDefense
	if !defense.Enabled || len(defense.Rules) != 1 ||
		defense.Rules[0].On != "sensitive_data" ||
		defense.Rules[0].Action != "redact" {
		t.Fatalf("memory defense config = %#v, want sensitive_data redact", defense)
	}
}
