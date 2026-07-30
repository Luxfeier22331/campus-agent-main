package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type personalMemoryExecutor interface {
	ExecuteCommand(context.Context, memoryruntime.PersonalMemoryCommandRequest) (memoryruntime.PersonalMemoryCommandResult, error)
	AppendConversationTurn(
		context.Context,
		memoryruntime.AppendConversationTurnRequest,
	) (memoryruntime.AppendConversationTurnResult, error)
	HealthCheck(context.Context) error
	Recall(context.Context, memoryruntime.RecallRequest) (memoryruntime.RecallResult, error)
}

type hindsightClient interface {
	BankExists(context.Context, string) (bool, error)
	EnsureBank(context.Context, string, hindsightBankConfig) error
	DeleteBank(context.Context, string) error
	DeleteDocument(context.Context, string, string) error
	HealthCheck(context.Context) error
	RecallMemories(context.Context, string, hindsightRecallRequest) (hindsightRecallResponse, error)
	RetainMemories(context.Context, string, hindsightRetainRequest) (hindsightRetainResponse, error)
}

type hindsightExecutor struct {
	client            hindsightClient
	ownerSalt         string
	recallLimit       int
	recallMaxTokens   int
	contextCharBudget int
}

func newPersonalMemoryExecutor(
	cfg config.Config,
	_ providerConfigResolver,
) (personalMemoryExecutor, error) {
	runtimeName := strings.TrimSpace(cfg.PersonalMemoryRuntime)
	if runtimeName == "" || runtimeName == "hindsight" {
		return newHindsightMemoryExecutor(cfg)
	}
	return nil, fmt.Errorf("unsupported personal memory runtime: %s", runtimeName)
}

func newHindsightMemoryExecutor(cfg config.Config) (personalMemoryExecutor, error) {
	if strings.TrimSpace(cfg.PersonalMemoryBaseURL) == "" {
		return nil, errors.New("HINDSIGHT_API_BASE_URL is required for Hindsight memory runtime")
	}
	if strings.TrimSpace(cfg.PersonalMemoryAPISecret) == "" {
		return nil, errors.New("HINDSIGHT_API_TENANT_API_KEY is required for Hindsight memory runtime")
	}
	if strings.TrimSpace(cfg.PersonalMemoryOwnerSalt) == "" {
		return nil, errors.New("HINDSIGHT_OWNER_SALT is required for Hindsight memory runtime")
	}
	timeout := time.Duration(cfg.PersonalMemoryTimeoutSeconds * float64(time.Second))
	limit := cfg.PersonalMemoryRecallLimit
	if limit <= 0 {
		limit = 8
	}
	recallMaxTokens := cfg.PersonalMemoryRecallMaxTokens
	if recallMaxTokens <= 0 {
		recallMaxTokens = 2500
	}
	contextCharBudget := cfg.PersonalMemoryContextCharBudget
	if contextCharBudget <= 0 {
		contextCharBudget = 2500
	}
	return hindsightExecutor{
		client: newHindsightHTTPClient(hindsightClientOptions{
			apiSecret: cfg.PersonalMemoryAPISecret,
			baseURL:   cfg.PersonalMemoryBaseURL,
			timeout:   timeout,
		}),
		ownerSalt:         strings.TrimSpace(cfg.PersonalMemoryOwnerSalt),
		recallLimit:       limit,
		recallMaxTokens:   recallMaxTokens,
		contextCharBudget: contextCharBudget,
	}, nil
}

func (e hindsightExecutor) HealthCheck(ctx context.Context) error {
	if e.client == nil {
		return errors.New("hindsight client is not configured")
	}
	return e.client.HealthCheck(ctx)
}

func (e hindsightExecutor) ExecuteCommand(
	ctx context.Context,
	request memoryruntime.PersonalMemoryCommandRequest,
) (memoryruntime.PersonalMemoryCommandResult, error) {
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(request); err != nil {
		return memoryruntime.PersonalMemoryCommandResult{}, err
	}
	bankID := e.scopedBankIDForGeneration(request.TenantID, request.UserID, request.OwnerGeneration)
	switch request.CommandKind {
	case "owner_transition":
		return memoryruntime.PersonalMemoryCommandResult{CommandID: request.CommandID, Status: "succeeded"}, nil
	case "owner_erase":
		retiredGeneration := request.OwnerGeneration - 1
		if retiredGeneration < 1 {
			retiredGeneration = 1
		}
		if err := e.client.DeleteBank(ctx, e.scopedBankIDForGeneration(request.TenantID, request.UserID, retiredGeneration)); err != nil {
			return memoryruntime.PersonalMemoryCommandResult{}, err
		}
		exists, err := e.client.BankExists(ctx, e.scopedBankIDForGeneration(request.TenantID, request.UserID, retiredGeneration))
		if err != nil {
			return memoryruntime.PersonalMemoryCommandResult{}, err
		}
		if exists {
			return memoryruntime.PersonalMemoryCommandResult{}, errors.New("hindsight retired bank still exists after delete")
		}
	case "item_upsert":
		if err := e.ensureBank(ctx, bankID); err != nil {
			return memoryruntime.PersonalMemoryCommandResult{}, err
		}
		documentID := hindsightProfileDocumentID(request.SubjectID)
		result, err := e.client.RetainMemories(ctx, bankID, hindsightRetainRequest{
			Async: boolPointer(false),
			Items: []hindsightMemoryItem{{
				Content:           strings.TrimSpace(request.Item.Key) + ": " + strings.TrimSpace(request.Item.Value),
				Context:           "explicit profile memory",
				DocumentID:        documentID,
				Metadata:          map[string]string{"canonical_subject": strings.TrimSpace(request.Item.Key), "memory_id": strings.TrimSpace(request.SubjectID), "source": "explicit_profile_memory"},
				ObservationScopes: [][]string{{"scope:private"}},
				Tags:              hindsightProfileTags(request.TenantID, bankID),
				Timestamp:         strings.TrimSpace(request.SourceUpdatedAt),
				UpdateMode:        "replace",
			}},
		})
		if err != nil {
			return memoryruntime.PersonalMemoryCommandResult{}, err
		}
		if err := requireHindsightRetainAccepted(result, bankID, 1, false); err != nil {
			return memoryruntime.PersonalMemoryCommandResult{}, err
		}
	case "item_delete":
		if err := e.client.DeleteDocument(ctx, bankID, hindsightProfileDocumentID(request.SubjectID)); err != nil {
			return memoryruntime.PersonalMemoryCommandResult{}, err
		}
	case "conversation_prune", "conversation_delete":
		for _, sourceMessageID := range request.SourceMessageIDs {
			documentID := e.conversationMessageDocumentID(bankID, request.SubjectID, sourceMessageID)
			if err := e.client.DeleteDocument(ctx, bankID, documentID); err != nil {
				return memoryruntime.PersonalMemoryCommandResult{}, err
			}
		}
	default:
		return memoryruntime.PersonalMemoryCommandResult{}, fmt.Errorf("unsupported personal memory command %q", request.CommandKind)
	}
	return memoryruntime.PersonalMemoryCommandResult{CommandID: request.CommandID, Status: "succeeded"}, nil
}

func (e hindsightExecutor) Recall(
	ctx context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	bankID := e.scopedBankIDForGeneration(request.TenantID, request.UserID, request.OwnerGeneration)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	response, err := e.client.RecallMemories(ctx, bankID, hindsightRecallRequest{
		Budget:             "mid",
		MaxTokens:          e.recallMaxTokens,
		PreferObservations: true,
		Query:              hindsightRecallQuery(request),
		QueryTimestamp:     strings.TrimSpace(request.QueryTimestamp),
		Tags:               []string{"scope:private"},
		TagsMatch:          "all_strict",
		Trace:              false,
		Types:              []string{"experience", "observation", "world"},
	})
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	items := hindsightContextItems(response.Results, e.recallLimit)
	result := memoryruntime.RecallResult{
		ContextBlock:  hindsightContextBlock(items, e.contextCharBudget),
		Items:         items,
		MemoryRef:     temporalProjectionRef(request.RunID, "memory/recall"),
		Provider:      "hindsight",
		RetrievalMode: "recall",
		RunID:         request.RunID,
		SchemaVersion: "memory_recall_result_v1",
		ThreadID:      request.ThreadID,
		UserID:        strings.TrimSpace(request.UserID),
	}
	return memoryruntime.FinalizeRecallResult(result)
}

func (e hindsightExecutor) AppendConversationTurn(
	ctx context.Context,
	request memoryruntime.AppendConversationTurnRequest,
) (memoryruntime.AppendConversationTurnResult, error) {
	if err := memoryruntime.ValidateAppendConversationTurnRequest(request); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	bankID := e.scopedBankIDForGeneration(request.TenantID, request.UserID, request.OwnerGeneration)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	documentID := e.conversationMessageDocumentID(bankID, request.ThreadID, request.UserMessageID)
	retainResult, err := e.client.RetainMemories(ctx, bankID, hindsightRetainRequest{
		Async: boolPointer(false),
		Items: []hindsightMemoryItem{{
			Content:    strings.TrimSpace(request.UserMessage),
			Context:    "campus assistant user message",
			DocumentID: documentID,
			Metadata: map[string]string{
				"run_id":            strings.TrimSpace(request.RunID),
				"source":            "user_message",
				"source_message_id": strings.TrimSpace(request.UserMessageID),
				"thread_id":         strings.TrimSpace(request.ThreadID),
			},
			ObservationScopes: [][]string{{"scope:private"}},
			Tags:              hindsightDocumentTags(request.TenantID, bankID, documentID, "conversation"),
			Timestamp:         strings.TrimSpace(request.UserMessageCreatedAt),
			UpdateMode:        "replace",
		}},
	})
	if err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	if err := requireHindsightRetainAccepted(retainResult, bankID, 1, false); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	return memoryruntime.FinalizeAppendConversationTurnResult(memoryruntime.AppendConversationTurnResult{
		AppendedMessageCount: 1,
		RunID:                request.RunID,
		SchemaVersion:        "memory_conversation_append_result_v2",
		Status:               "completed",
		ThreadID:             request.ThreadID,
		UserID:               strings.TrimSpace(request.UserID),
	})
}

func (e hindsightExecutor) ensureBank(ctx context.Context, bankID string) error {
	if e.client == nil {
		return errors.New("hindsight client is not configured")
	}
	return e.client.EnsureBank(ctx, strings.TrimSpace(bankID), defaultHindsightBankConfig())
}

func defaultHindsightBankConfig() hindsightBankConfig {
	return hindsightBankConfig{
		EnableAutoConsolidation: true,
		EnableObservations:      true,
		MemoryDefense: hindsightMemoryDefenseConfig{
			Enabled: true,
			Rules: []hindsightMemoryDefenseRule{{
				On:     "sensitive_data",
				Action: "redact",
			}},
		},
	}
}

func requireHindsightRetainAccepted(
	result hindsightRetainResponse,
	bankID string,
	itemCount int,
	async bool,
) error {
	if !result.Success {
		return errors.New("hindsight retain returned success=false")
	}
	if strings.TrimSpace(result.BankID) != strings.TrimSpace(bankID) {
		return fmt.Errorf("hindsight retain bank_id=%q, want %q", result.BankID, bankID)
	}
	if result.ItemsCount != itemCount {
		return fmt.Errorf("hindsight retain items_count=%d, want %d", result.ItemsCount, itemCount)
	}
	if result.Async != async {
		return fmt.Errorf("hindsight retain async=%t, want %t", result.Async, async)
	}
	return nil
}

func (e hindsightExecutor) scopedBankIDForGeneration(tenantID string, userID string, generation int64) string {
	return scopedHindsightBankID(e.ownerSalt, tenantID, userID, generation)
}

func scopedHindsightBankID(ownerSalt string, tenantID string, userID string, generation int64) string {
	if generation < 1 {
		generation = 1
	}
	sum := sha256.Sum256([]byte(
		fmt.Sprintf("%s:%s:%s:%d", strings.TrimSpace(ownerSalt), strings.TrimSpace(tenantID), strings.TrimSpace(userID), generation),
	))
	return "hindsight_bank_" + hex.EncodeToString(sum[:])[:32]
}

func (e hindsightExecutor) conversationMessageDocumentID(bankID string, threadID string, sourceMessageID string) string {
	conversationSum := sha256.Sum256([]byte(
		strings.TrimSpace(e.ownerSalt) + ":" + strings.TrimSpace(bankID) + ":" + strings.TrimSpace(threadID),
	))
	messageSum := sha256.Sum256([]byte(
		strings.TrimSpace(e.ownerSalt) + ":" + strings.TrimSpace(bankID) + ":" + strings.TrimSpace(sourceMessageID),
	))
	return "conversation:" + hex.EncodeToString(conversationSum[:])[:32] + ":message:" + hex.EncodeToString(messageSum[:])[:32]
}

func CheckPersonalMemoryRuntime(ctx context.Context, cfg config.Config) error {
	executor, err := newHindsightMemoryExecutor(cfg)
	if err != nil {
		return err
	}
	return executor.HealthCheck(ctx)
}

func EnsurePersonalMemoryRuntime(ctx context.Context, cfg config.Config) error {
	return CheckPersonalMemoryRuntime(ctx, cfg)
}

func hindsightConfigSummary(cfg config.Config) map[string]any {
	return map[string]any{
		"context_char_budget": cfg.PersonalMemoryContextCharBudget,
		"data_plane":          "hindsight_self_host",
		"recall_max_tokens":   cfg.PersonalMemoryRecallMaxTokens,
		"thread_owner":        "execution-control",
	}
}

func hindsightConfigError(cfg config.Config) string {
	if strings.TrimSpace(cfg.PersonalMemoryBaseURL) == "" {
		return "HINDSIGHT_API_BASE_URL is required"
	}
	if strings.TrimSpace(cfg.PersonalMemoryAPISecret) == "" {
		return "HINDSIGHT_API_TENANT_API_KEY is required"
	}
	if strings.TrimSpace(cfg.PersonalMemoryOwnerSalt) == "" {
		return "HINDSIGHT_OWNER_SALT is required"
	}
	return ""
}

func personalMemoryOwnerSaltConfigured(cfg config.Config) bool {
	return strings.TrimSpace(cfg.PersonalMemoryOwnerSalt) != ""
}
