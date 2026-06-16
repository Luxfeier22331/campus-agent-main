package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExtractMemoryCandidatesActivityRequiresMemoryEnabledGate(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-update-disabled",
		"我之后主要关注保研材料",
		nil,
		now,
	)
	server := NewServer(config.Config{
		ProviderPricingPath:    memoryExtractionPricingCatalogForTest(t),
		TemporalWorkerIdentity: "test:memory-update",
	})
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExtractMemoryCandidatesActivity(
		context.Background(),
		temporalruntime.ExtractMemoryCandidatesActivityInput{
			RequestID: "req-memory-update-disabled",
			RunID:     "run-memory-update-disabled",
			TraceID:   memoryUpdateTraceID("run-memory-update-disabled"),
		},
	)
	if err != nil {
		t.Fatalf("extract memory candidates: %v", err)
	}
	if output.Status != "skipped" || output.SkippedCount != 1 {
		t.Fatalf("extract output = %#v, want skipped", output)
	}
	if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "memory_enabled_unknown" {
		t.Fatalf("skip reasons = %#v", output.SkipReasons)
	}
}

func TestExtractMemoryCandidatesActivityExtractsExplicitUserGoal(t *testing.T) {
	extractor := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/responses" {
			t.Fatalf("provider path = %q, want /responses", request.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode extraction request: %v", err)
		}
		encoded, err := json.Marshal(map[string]any{
			"memory_candidates": []map[string]any{{
				"capability":        "any",
				"canonical_subject": "保研材料",
				"compact_text":      "近期目标: 关注保研材料",
				"confidence":        0.95,
				"memory_type":       "goal",
				"reason_code":       "explicit_long_term_goal",
			}},
		})
		if err != nil {
			t.Fatalf("marshal extraction payload: %v", err)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"id":    "resp_memory_extract_001",
			"model": "gpt-test",
			"output": []map[string]any{{
				"content": []map[string]any{{"text": string(encoded)}},
			}},
			"usage": map[string]any{
				"input_tokens":             10,
				"output_tokens":            12,
				"input_tokens_details":     map[string]any{"cached_tokens": 0},
				"output_tokens_details":    map[string]any{},
				"total_tokens":             22,
				"cached_input_token_count": 0,
			},
		})
	}))
	defer extractor.Close()
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 5, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-update-enabled",
		"我之后主要关注保研材料",
		ptrBool(true),
		now,
	)
	server := NewServer(config.Config{
		ProviderPricingPath:    memoryExtractionPricingCatalogForTest(t),
		TemporalWorkerIdentity: "test:memory-update",
	})
	server.providerConfigResolver = staticProviderConfigResolver{
		"personal_memory_extraction": personalMemoryExtractionProviderConfigSnapshotForTest(extractor.URL),
	}
	server.providerConfigErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExtractMemoryCandidatesActivity(
		context.Background(),
		temporalruntime.ExtractMemoryCandidatesActivityInput{
			RequestID: "req-memory-update-enabled",
			RunID:     "run-memory-update-enabled",
			TraceID:   memoryUpdateTraceID("run-memory-update-enabled"),
		},
	)
	if err != nil {
		t.Fatalf("extract memory candidates: %v", err)
	}
	if output.Status != "completed" || output.CandidateCount != 1 {
		t.Fatalf("extract output = %#v, want one candidate", output)
	}
	candidate := output.Candidates[0]
	if candidate.MemoryType != "goal" ||
		candidate.Capability != "any" ||
		candidate.CanonicalSubject != "保研材料" ||
		candidate.CanonicalKey != "goal:any:保研材料" ||
		candidate.CompactText != "近期目标: 关注保研材料" ||
		candidate.Confidence < 0.9 ||
		candidate.ReasonCode != "explicit_long_term_goal" ||
		candidate.SourceHash == "" {
		t.Fatalf("candidate = %#v", candidate)
	}
}

func TestExtractMemoryCandidatesActivitySkipsInstitutionalFact(t *testing.T) {
	extractor := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		encoded, err := json.Marshal(map[string]any{
			"memory_candidates": []map[string]any{{
				"capability":        "knowledge",
				"canonical_subject": "国家奖学金",
				"compact_text":      "制度事实: 国家奖学金每年评审一次",
				"confidence":        0.98,
				"memory_type":       "profile",
				"reason_code":       "institutional_fact",
			}},
		})
		if err != nil {
			t.Fatalf("marshal extraction payload: %v", err)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"id":     "resp_memory_extract_fact",
			"model":  "gpt-test",
			"output": []map[string]any{{"content": []map[string]any{{"text": string(encoded)}}}},
			"usage": map[string]any{
				"input_tokens":          10,
				"output_tokens":         12,
				"input_tokens_details":  map[string]any{"cached_tokens": 0},
				"output_tokens_details": map[string]any{},
			},
		})
	}))
	defer extractor.Close()
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 5, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-update-fact",
		"国家奖学金每年评审一次",
		ptrBool(true),
		now,
	)
	server := NewServer(config.Config{
		ProviderPricingPath:    memoryExtractionPricingCatalogForTest(t),
		TemporalWorkerIdentity: "test:memory-update",
	})
	server.providerConfigResolver = staticProviderConfigResolver{
		"personal_memory_extraction": personalMemoryExtractionProviderConfigSnapshotForTest(extractor.URL),
	}
	server.providerConfigErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExtractMemoryCandidatesActivity(
		context.Background(),
		temporalruntime.ExtractMemoryCandidatesActivityInput{
			RequestID: "req-memory-update-fact",
			RunID:     "run-memory-update-fact",
			TraceID:   memoryUpdateTraceID("run-memory-update-fact"),
		},
	)
	if err != nil {
		t.Fatalf("extract memory candidates: %v", err)
	}
	if output.Status != "skipped" || output.SkippedCount != 1 {
		t.Fatalf("extract output = %#v, want skipped", output)
	}
	if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "institutional_fact" {
		t.Fatalf("skip reasons = %#v", output.SkipReasons)
	}
}

func TestExtractMemoryCandidatesActivityRejectsTraceMismatchForTerminalRun(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 6, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-update-trace-mismatch",
		"我之后主要关注保研材料",
		ptrBool(true),
		now,
	)
	server := NewServer(config.Config{
		ProviderPricingPath:    memoryExtractionPricingCatalogForTest(t),
		TemporalWorkerIdentity: "test:memory-update",
	})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExtractMemoryCandidatesActivity(
		context.Background(),
		temporalruntime.ExtractMemoryCandidatesActivityInput{
			RequestID: "req-memory-update-trace-mismatch",
			RunID:     "run-memory-update-trace-mismatch",
			TraceID:   "trace-memory-update-wrong",
		},
	)
	if err == nil {
		t.Fatal("expected trace mismatch error, got nil")
	}
	if got := err.Error(); got == "" || got == "run run-memory-update-trace-mismatch is already terminal: completed" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUpsertInferredMemoryActivityWritesActiveInferredProjectionWithoutText(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 10, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-upsert-enabled",
		"我之后主要关注保研材料",
		ptrBool(true),
		now,
	)
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-update"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.UpsertInferredMemoryActivity(
		context.Background(),
		temporalruntime.UpsertInferredMemoryActivityInput{
			Candidates: []temporalruntime.MemoryCandidate{{
				Capability:       "any",
				CanonicalKey:     "goal:any:保研材料",
				CanonicalSubject: "保研材料",
				CompactText:      "近期目标: 关注保研材料",
				Confidence:       0.95,
				MemoryType:       "goal",
				ReasonCode:       "explicit_long_term_goal",
				SourceHash:       strings.Repeat("a", 64),
			}},
			RequestID: "req-memory-upsert-enabled",
			RunID:     "run-memory-upsert-enabled",
			TraceID:   memoryUpdateTraceID("run-memory-upsert-enabled"),
		},
	)
	if err != nil {
		t.Fatalf("upsert inferred memory: %v", err)
	}
	if output.Status != "completed" ||
		output.UpsertedCount != 1 ||
		output.CreatedCount != 1 ||
		output.RefreshedCount != 0 ||
		output.MergedCount != 0 {
		t.Fatalf("upsert output = %#v, want completed", output)
	}
	if executor.seenUpsert.Source != "inferred" ||
		executor.seenUpsert.Status != "active" ||
		executor.seenUpsert.CanonicalKey != "goal:any:保研材料" ||
		executor.seenUpsert.CanonicalSubject != "保研材料" ||
		executor.seenUpsert.ReasonCode != "explicit_long_term_goal" ||
		len(executor.seenUpsert.SourceHashes) != 1 ||
		executor.seenUpsert.MemoryType != "goal" ||
		executor.seenUpsert.CompactText != "近期目标: 关注保研材料" {
		t.Fatalf("upsert request = %#v", executor.seenUpsert)
	}
	if executor.seenUpsert.MemoryID == "" || strings.Contains(executor.seenUpsert.MemoryID, strings.Repeat("a", 16)) {
		t.Fatalf("memory id must be stable canonical identity, got %#v", executor.seenUpsert.MemoryID)
	}
	results, err := store.ListStepResults(context.Background(), "run-memory-upsert-enabled")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("step results = %#v, want one", results)
	}
	payload := results[0].SanitizedPayload
	if _, exists := payload["compact_text"]; exists {
		t.Fatalf("memory update projection leaked compact_text: %#v", payload)
	}
	if payload["upserted_count"] != 1.0 && payload["upserted_count"] != 1 {
		t.Fatalf("projection payload = %#v", payload)
	}
	if payload["created_count"] != 1.0 && payload["created_count"] != 1 {
		t.Fatalf("projection payload = %#v, want created_count", payload)
	}
}

func TestUpsertInferredMemoryActivityRefreshesExistingCanonicalMemory(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 11, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-upsert-refresh",
		"我之后主要关注推免材料",
		ptrBool(true),
		now,
	)
	executor := &fakePersonalMemoryExecutor{
		resolveResult: memoryruntime.ResolveCandidateResult{
			Action: "refresh",
			Existing: &memoryruntime.MemoryRecord{
				Capability:       "any",
				CanonicalKey:     "goal:any:保研材料",
				CanonicalSubject: "保研材料",
				CompactText:      "近期目标: 关注保研材料",
				MemoryID:         "mem_existing_goal",
				MemoryType:       "goal",
				SourceHashes:     []string{strings.Repeat("a", 64)},
				Status:           "active",
			},
		},
	}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-update"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.UpsertInferredMemoryActivity(
		context.Background(),
		temporalruntime.UpsertInferredMemoryActivityInput{
			Candidates: []temporalruntime.MemoryCandidate{{
				Capability:       "any",
				CanonicalKey:     "goal:any:保研材料",
				CanonicalSubject: "保研材料",
				CompactText:      "近期目标: 关注推免材料",
				Confidence:       0.96,
				MemoryType:       "goal",
				ReasonCode:       "explicit_long_term_goal",
				SourceHash:       strings.Repeat("b", 64),
			}},
			RequestID: "req-memory-upsert-refresh",
			RunID:     "run-memory-upsert-refresh",
			TraceID:   memoryUpdateTraceID("run-memory-upsert-refresh"),
		},
	)
	if err != nil {
		t.Fatalf("upsert inferred memory: %v", err)
	}
	if output.Status != "completed" ||
		output.UpsertedCount != 1 ||
		output.CreatedCount != 0 ||
		output.RefreshedCount != 1 {
		t.Fatalf("upsert output = %#v, want refreshed existing memory", output)
	}
	if executor.seenUpsert.MemoryID != "mem_existing_goal" {
		t.Fatalf("upsert memory id = %q, want existing memory id", executor.seenUpsert.MemoryID)
	}
	if len(executor.seenUpsert.SourceHashes) != 2 {
		t.Fatalf("source hashes = %#v, want accumulated hashes", executor.seenUpsert.SourceHashes)
	}
	if executor.seenUpsert.MergeCount != 1 {
		t.Fatalf("merge count = %d, want incremented refresh count", executor.seenUpsert.MergeCount)
	}
}

func TestUpsertInferredMemoryActivityMergesSemanticDuplicateWithProviderOutput(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 11, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-upsert-merge",
		"我之后主要关注推免材料",
		ptrBool(true),
		now,
	)
	executor := &fakePersonalMemoryExecutor{
		resolveResult: memoryruntime.ResolveCandidateResult{
			Action: "merge",
			Existing: &memoryruntime.MemoryRecord{
				Capability:       "any",
				CanonicalKey:     "goal:any:保研材料",
				CanonicalSubject: "保研材料",
				CompactText:      "近期目标: 关注保研材料",
				MemoryID:         "mem_existing_goal",
				MemoryType:       "goal",
				SourceHashes:     []string{strings.Repeat("a", 64)},
				Status:           "active",
			},
		},
	}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-update"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	server.memoryExtraction = fakeMemoryExtractionExecutor{
		mergeResult: memoryMergeResult{
			CompactText: "近期目标: 关注保研/推免材料",
			Confidence:  0.97,
			ReasonCode:  "explicit_long_term_goal",
		},
	}
	server.memoryExtractionErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.UpsertInferredMemoryActivity(
		context.Background(),
		temporalruntime.UpsertInferredMemoryActivityInput{
			Candidates: []temporalruntime.MemoryCandidate{{
				Capability:       "any",
				CanonicalKey:     "goal:any:推免材料",
				CanonicalSubject: "推免材料",
				CompactText:      "近期目标: 关注推免材料",
				Confidence:       0.96,
				MemoryType:       "goal",
				ReasonCode:       "explicit_long_term_goal",
				SourceHash:       strings.Repeat("b", 64),
			}},
			RequestID: "req-memory-upsert-merge",
			RunID:     "run-memory-upsert-merge",
			TraceID:   memoryUpdateTraceID("run-memory-upsert-merge"),
		},
	)
	if err != nil {
		t.Fatalf("upsert inferred memory: %v", err)
	}
	if output.Status != "completed" ||
		output.UpsertedCount != 1 ||
		output.MergedCount != 1 {
		t.Fatalf("upsert output = %#v, want merged existing memory", output)
	}
	if executor.seenUpsert.CompactText != "近期目标: 关注保研/推免材料" {
		t.Fatalf("merged compact_text = %q", executor.seenUpsert.CompactText)
	}
	if executor.seenUpsert.Confidence != 0.97 {
		t.Fatalf("merged confidence = %v", executor.seenUpsert.Confidence)
	}
}

func TestUpsertInferredMemoryActivitySkipsLowConfidenceCandidate(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 12, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-upsert-low-confidence",
		"我可能之后看看保研材料",
		ptrBool(true),
		now,
	)
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-update"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.UpsertInferredMemoryActivity(
		context.Background(),
		temporalruntime.UpsertInferredMemoryActivityInput{
			Candidates: []temporalruntime.MemoryCandidate{{
				Capability:  "any",
				CompactText: "近期目标: 关注保研材料",
				Confidence:  0.7,
				MemoryID:    "inf_low_confidence",
				MemoryType:  "goal",
				ReasonCode:  "explicit_long_term_goal",
				SourceHash:  strings.Repeat("b", 64),
			}},
			RequestID: "req-memory-upsert-low-confidence",
			RunID:     "run-memory-upsert-low-confidence",
			TraceID:   memoryUpdateTraceID("run-memory-upsert-low-confidence"),
		},
	)
	if err != nil {
		t.Fatalf("upsert inferred memory: %v", err)
	}
	if output.Status != "skipped" || output.UpsertedCount != 0 || output.SkippedCount != 1 {
		t.Fatalf("upsert output = %#v, want skipped low confidence", output)
	}
	if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "low_confidence" {
		t.Fatalf("skip reasons = %#v", output.SkipReasons)
	}
	if executor.seenUpsert.MemoryID != "" {
		t.Fatalf("low confidence candidate must not upsert: %#v", executor.seenUpsert)
	}
}

func TestUpsertInferredMemoryActivitySkipsForbiddenCandidate(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 14, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-upsert-forbidden",
		"我的 token 是 abc",
		ptrBool(true),
		now,
	)
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-update"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.UpsertInferredMemoryActivity(
		context.Background(),
		temporalruntime.UpsertInferredMemoryActivityInput{
			Candidates: []temporalruntime.MemoryCandidate{{
				Capability:  "any",
				CompactText: "token: abc",
				Confidence:  0.99,
				MemoryID:    "inf_forbidden",
				MemoryType:  "profile",
				ReasonCode:  "stable_profile",
				SourceHash:  strings.Repeat("c", 64),
			}},
			RequestID: "req-memory-upsert-forbidden",
			RunID:     "run-memory-upsert-forbidden",
			TraceID:   memoryUpdateTraceID("run-memory-upsert-forbidden"),
		},
	)
	if err != nil {
		t.Fatalf("upsert inferred memory: %v", err)
	}
	if output.Status != "skipped" || output.SkippedCount != 1 {
		t.Fatalf("upsert output = %#v, want skipped forbidden payload", output)
	}
	if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "forbidden_payload" {
		t.Fatalf("skip reasons = %#v", output.SkipReasons)
	}
	if executor.seenUpsert.MemoryID != "" {
		t.Fatalf("forbidden candidate must not upsert: %#v", executor.seenUpsert)
	}
}

func createMemoryUpdateRunForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	userGoal string,
	memoryEnabled *bool,
	now time.Time,
) {
	t.Helper()
	contextProjection := map[string]any{
		"actor": map[string]any{"user_id": "user-executor"},
	}
	if memoryEnabled != nil {
		contextProjection["memory"] = map[string]any{"enabled": *memoryEnabled}
	}
	_, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:          runID,
		ConversationID: "conv-" + runID,
		TurnID:         "turn-" + runID,
		RequestID:      "req-" + runID,
		TraceID:        "trace-" + runID,
		OwnerUserID:    "user-executor",
		Surface:        "public-chat-web",
		Lane:           execution.DurableLaneDefault,
		Status:         execution.DurableRunStatusCompleted,
		TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
		CreatedAt:      now,
		UpdatedAt:      now,
		CompletedAt:    now,
		Metadata: map[string]any{
			"execution_payload": map[string]any{
				"context":    contextProjection,
				"request_id": "req-" + runID,
				"trace":      map[string]any{"trace_id": "trace-" + runID},
				"user_goal":  userGoal,
			},
		},
	})
	if err != nil {
		t.Fatalf("create memory update run: %v", err)
	}
}

func ptrBool(value bool) *bool {
	return &value
}

func memoryUpdateTraceID(runID string) string {
	return "trace-" + runID
}

func memoryExtractionPricingCatalogForTest(t *testing.T) string {
	t.Helper()
	return writeRAGPricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-test",
			"input_microusd_per_1k_tokens":100,
			"cached_input_microusd_per_1k_tokens":10,
			"output_microusd_per_1k_tokens":200
		}]
	}`)
}

type fakeMemoryExtractionExecutor struct {
	mergeResult memoryMergeResult
}

func (f fakeMemoryExtractionExecutor) ExtractMemoryCandidates(
	context.Context,
	execution.DurableRun,
	map[string]any,
) (memoryExtractionResult, error) {
	return memoryExtractionResult{}, nil
}

func (f fakeMemoryExtractionExecutor) MergeMemoryCandidate(
	context.Context,
	memoryruntime.MemoryRecord,
	memoryruntime.ResolveCandidateRequest,
) (memoryMergeResult, error) {
	return f.mergeResult, nil
}

func (fakeMemoryExtractionExecutor) HealthCheck(context.Context) error {
	return nil
}
