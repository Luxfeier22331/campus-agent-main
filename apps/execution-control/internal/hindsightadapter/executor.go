package hindsightadapter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"
)

type Options struct {
	APISecret         string
	BaseURL           string
	ContextCharBudget int
	OwnerSalt         string
	RecallLimit       int
	RecallMaxTokens   int
	Timeout           time.Duration
}

type hindsightClient interface {
	GetOperation(context.Context, string, string) (memoryruntime.AppendOperation, error)
	BankExists(context.Context, string) (bool, error)
	EnsureBank(context.Context, string, hindsightBankConfig) error
	CreateMentalModel(context.Context, string, hindsight.CreateMentalModelRequest) error
	DeleteBank(context.Context, string) error
	GetMentalModel(context.Context, string, string) (hindsightProfileModelSnapshot, bool, error)
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

func New(options Options) (executionapplication.MemoryExecutor, error) {
	if strings.TrimSpace(options.BaseURL) == "" {
		return nil, errors.New("HINDSIGHT_API_BASE_URL is required for Hindsight memory runtime")
	}
	if strings.TrimSpace(options.APISecret) == "" {
		return nil, errors.New("HINDSIGHT_API_TENANT_API_KEY is required for Hindsight memory runtime")
	}
	if strings.TrimSpace(options.OwnerSalt) == "" {
		return nil, errors.New("HINDSIGHT_OWNER_SALT is required for Hindsight memory runtime")
	}
	limit := options.RecallLimit
	if limit <= 0 {
		limit = 8
	}
	recallMaxTokens := options.RecallMaxTokens
	if recallMaxTokens <= 0 {
		recallMaxTokens = 2500
	}
	contextCharBudget := options.ContextCharBudget
	if contextCharBudget <= 0 {
		contextCharBudget = 2500
	}
	return hindsightExecutor{
		client: newHindsightHTTPClient(hindsightClientOptions{
			apiSecret: options.APISecret,
			baseURL:   options.BaseURL,
			timeout:   options.Timeout,
		}),
		ownerSalt:         strings.TrimSpace(options.OwnerSalt),
		recallLimit:       limit,
		recallMaxTokens:   recallMaxTokens,
		contextCharBudget: contextCharBudget,
	}, nil
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
	case "memory_add":
		if err := e.ensureBankForWrite(ctx, bankID); err != nil {
			return memoryruntime.PersonalMemoryCommandResult{}, err
		}
		documentID := hindsightProfileDocumentID(request.SubjectID)
		result, err := e.client.RetainMemories(ctx, bankID, hindsightRetainRequest{
			Async: boolPointer(false),
			Items: []hindsightMemoryItem{{
				Content:           strings.TrimSpace(request.Item.Text),
				Context:           "Explicit personal memory supplied by the human user. First-person statements refer to the user, not the assistant. Extract facts about the user.",
				DocumentID:        documentID,
				Metadata:          map[string]string{"source": "manual"},
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
	exists, err := e.client.BankExists(ctx, bankID)
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	if !exists {
		return memoryruntime.RecallResult{}, nil
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
	return memoryruntime.RecallResult{
		ContextBlock: hindsightContextBlock(items, e.contextCharBudget),
	}, nil
}

func (e hindsightExecutor) AppendConversationTurn(
	ctx context.Context,
	request memoryruntime.AppendConversationTurnRequest,
) (memoryruntime.AppendConversationTurnResult, error) {
	if err := memoryruntime.ValidateAppendConversationTurnRequest(request); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	bankID := e.scopedBankIDForGeneration(request.TenantID, request.UserID, request.OwnerGeneration)
	if err := e.ensureBankForWrite(ctx, bankID); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	retainResult, err := e.client.RetainMemories(ctx, bankID, e.conversationRetainRequest(bankID, request))
	if err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	if err := requireHindsightRetainAccepted(retainResult, bankID, 1, false); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	return memoryruntime.AppendConversationTurnResult{AppendedMessageCount: 1}, nil
}

func (e hindsightExecutor) conversationRetainRequest(bankID string, request memoryruntime.AppendConversationTurnRequest) hindsightRetainRequest {
	documentID := e.conversationMessageDocumentID(bankID, request.ThreadID, request.UserMessageID)
	return hindsightRetainRequest{
		Async: boolPointer(false),
		Items: []hindsightMemoryItem{{
			Content:    strings.TrimSpace(request.UserMessage),
			Context:    "Message written by the human user to the campus assistant. First-person statements refer to the user, not the assistant. Extract facts about the user.",
			DocumentID: documentID,
			Metadata: map[string]string{
				"request_id":        strings.TrimSpace(request.RequestID),
				"source":            "user_message",
				"source_message_id": strings.TrimSpace(request.UserMessageID),
				"thread_id":         strings.TrimSpace(request.ThreadID),
			},
			ObservationScopes: [][]string{{"scope:private"}},
			Tags:              hindsightDocumentTags(request.TenantID, bankID, documentID, "conversation"),
			Timestamp:         strings.TrimSpace(request.UserMessageCreatedAt),
			UpdateMode:        "replace",
		}},
	}
}

func (e hindsightExecutor) ensureBankForWrite(ctx context.Context, bankID string) error {
	if e.client == nil {
		return errors.New("hindsight client is not configured")
	}
	bankID = strings.TrimSpace(bankID)
	exists, err := e.client.BankExists(ctx, bankID)
	if err != nil || exists {
		return err
	}
	return e.client.EnsureBank(ctx, bankID, defaultHindsightBankConfig())
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
