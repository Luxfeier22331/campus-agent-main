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
	AppendConversationTurn(
		context.Context,
		memoryruntime.AppendConversationTurnRequest,
	) (memoryruntime.AppendConversationTurnResult, error)
	CancelOperation(
		context.Context,
		memoryruntime.OperationActionRequest,
	) (memoryruntime.OperationActionResult, error)
	DeleteProfileMemoryOwner(
		context.Context,
		memoryruntime.DisableProfileMemoryOwnerRequest,
	) (memoryruntime.ProfileMemoryOwnerDisableResult, error)
	DeleteProfileMemoryItem(
		context.Context,
		memoryruntime.DisableProfileMemoryItemRequest,
	) (memoryruntime.ProfileMemoryItemResult, error)
	HealthCheck(context.Context) error
	OperationStatus(
		context.Context,
		memoryruntime.OperationStatusRequest,
	) (memoryruntime.OperationStatusResult, error)
	Recall(context.Context, memoryruntime.RecallRequest) (memoryruntime.RecallResult, error)
	Reflect(context.Context, memoryruntime.ReflectRequest) (memoryruntime.ReflectResult, error)
	ListOperations(
		context.Context,
		memoryruntime.OperationListRequest,
	) (memoryruntime.OperationListResult, error)
	RetryOperation(
		context.Context,
		memoryruntime.OperationActionRequest,
	) (memoryruntime.OperationActionResult, error)
	UpsertProfileMemoryItem(
		context.Context,
		memoryruntime.UpsertProfileMemoryItemRequest,
	) (memoryruntime.ProfileMemoryItemResult, error)
}

type hindsightClient interface {
	CancelOperation(context.Context, string, string) (hindsightOperationActionResponse, error)
	EnsureBank(context.Context, string, hindsightBankConfig) error
	DeleteBank(context.Context, string) error
	DeleteDocument(context.Context, string, string) error
	HealthCheck(context.Context) error
	ListOperations(
		context.Context,
		string,
		hindsightOperationListRequest,
	) (hindsightOperationListResponse, error)
	OperationStatus(context.Context, string, string) (hindsightOperationStatusResponse, error)
	RecallMemories(context.Context, string, hindsightRecallRequest) (hindsightRecallResponse, error)
	Reflect(context.Context, string, hindsightReflectRequest) (hindsightReflectResponse, error)
	RetainMemories(context.Context, string, hindsightRetainRequest) (hindsightRetainResponse, error)
	RetryOperation(context.Context, string, string) (hindsightOperationActionResponse, error)
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
		return nil, errors.New("PERSONAL_MEMORY_BASE_URL is required for Hindsight memory runtime")
	}
	if strings.TrimSpace(cfg.PersonalMemoryAPISecret) == "" {
		return nil, errors.New("PERSONAL_MEMORY_API_SECRET is required for Hindsight memory runtime")
	}
	if strings.TrimSpace(cfg.PersonalMemoryOwnerSalt) == "" {
		return nil, errors.New("PERSONAL_MEMORY_OWNER_SALT is required for Hindsight memory runtime")
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

func (e hindsightExecutor) Recall(
	ctx context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	response, err := e.client.RecallMemories(ctx, bankID, hindsightRecallRequest{
		Budget:         "mid",
		MaxTokens:      e.recallMaxTokens,
		Query:          hindsightRecallQuery(request),
		QueryTimestamp: strings.TrimSpace(request.QueryTimestamp),
		Tags:           []string{"scope:private"},
		TagsMatch:      "all_strict",
		Trace:          false,
		Types:          []string{"experience", "observation", "world"},
	})
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	items := hindsightContextItems(response.Results, request.RequestedTool, e.recallLimit)
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
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	documentID := e.conversationDocumentID(bankID, request.ThreadID)
	content, err := encodeHindsightConversationTurn(request)
	if err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	retainResult, err := e.client.RetainMemories(ctx, bankID, hindsightRetainRequest{
		Async:        boolPointer(true),
		DocumentTags: hindsightDocumentTags(request.TenantID, bankID, documentID, "conversation"),
		Items: []hindsightMemoryItem{{
			Content:    content,
			Context:    "campus assistant completed conversation turn",
			DocumentID: documentID,
			Metadata: map[string]string{
				"run_id":    strings.TrimSpace(request.RunID),
				"source":    "completed_turn",
				"thread_id": strings.TrimSpace(request.ThreadID),
			},
			Tags:       hindsightDocumentTags(request.TenantID, bankID, documentID, "conversation"),
			Timestamp:  strings.TrimSpace(request.UserMessageCreatedAt),
			UpdateMode: "append",
		}},
	})
	if err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	operationID := strings.TrimSpace(retainResult.OperationID)
	if operationID == "" && len(retainResult.OperationIDs) > 0 {
		operationID = strings.TrimSpace(retainResult.OperationIDs[0])
	}
	if operationID == "" {
		return memoryruntime.AppendConversationTurnResult{}, errors.New(
			"hindsight async retain returned no operation id",
		)
	}
	return memoryruntime.FinalizeAppendConversationTurnResult(memoryruntime.AppendConversationTurnResult{
		AppendedMessageCount:  appendedHindsightConversationTurnCount(request),
		HindsightOperationID:  operationID,
		HindsightOperationIDs: append([]string{}, retainResult.OperationIDs...),
		OperationID:           operationID,
		OperationStatusRef:    memoryOperationProjectionRef(request.RunID, operationID),
		RuntimeDocumentRef:    memoryDocumentProjectionRef(request.RunID, documentID),
		RunID:                 request.RunID,
		SchemaVersion:         "memory_conversation_append_result_v1",
		Status:                "accepted",
		ThreadID:              request.ThreadID,
		UserID:                strings.TrimSpace(request.UserID),
	})
}

func (e hindsightExecutor) OperationStatus(
	ctx context.Context,
	request memoryruntime.OperationStatusRequest,
) (memoryruntime.OperationStatusResult, error) {
	if err := memoryruntime.ValidateOperationStatusRequest(request); err != nil {
		return memoryruntime.OperationStatusResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.OperationStatusResult{}, err
	}
	response, err := e.client.OperationStatus(ctx, bankID, strings.TrimSpace(request.OperationID))
	if err != nil {
		return memoryruntime.OperationStatusResult{}, err
	}
	resultMetadataHash := ""
	if len(response.ResultMetadata) > 0 {
		hash, err := memoryruntime.HashProjection(response.ResultMetadata)
		if err != nil {
			return memoryruntime.OperationStatusResult{}, err
		}
		resultMetadataHash = hash
	}
	return memoryruntime.FinalizeOperationStatusResult(memoryruntime.OperationStatusResult{
		CompletedAt:         response.CompletedAt,
		CreatedAt:           response.CreatedAt,
		ErrorKind:           hindsightOperationErrorKind(response.ErrorMessage),
		OperationID:         strings.TrimSpace(response.OperationID),
		OperationRef:        memoryOperationProjectionRef(request.RunID, response.OperationID),
		OperationType:       response.OperationType,
		ResultMetadataHash:  resultMetadataHash,
		ResultMetadataShape: resultMetadataShape(response.ResultMetadata),
		RetryCount:          response.RetryCount,
		RunID:               strings.TrimSpace(request.RunID),
		SchemaVersion:       "memory_operation_status_result_v1",
		Status:              strings.TrimSpace(response.Status),
		UpdatedAt:           response.UpdatedAt,
		UserID:              strings.TrimSpace(request.UserID),
	})
}

func (e hindsightExecutor) ListOperations(
	ctx context.Context,
	request memoryruntime.OperationListRequest,
) (memoryruntime.OperationListResult, error) {
	if err := memoryruntime.ValidateOperationListRequest(request); err != nil {
		return memoryruntime.OperationListResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.OperationListResult{}, err
	}
	response, err := e.client.ListOperations(ctx, bankID, hindsightOperationListRequest{
		ExcludeParents: request.ExcludeParents,
		Limit:          request.Limit,
		Offset:         request.Offset,
		OperationType:  request.OperationType,
		Status:         request.Status,
	})
	if err != nil {
		return memoryruntime.OperationListResult{}, err
	}
	items := make([]memoryruntime.OperationListItem, 0, len(response.Operations))
	for _, operation := range response.Operations {
		items = append(items, memoryruntime.OperationListItem{
			CreatedAt:     operation.CreatedAt,
			ErrorKind:     hindsightOperationErrorKind(operation.ErrorMessage),
			ItemsCount:    operation.ItemsCount,
			OperationID:   operation.OperationID,
			OperationRef:  memoryOperationProjectionRef(request.RunID, operation.OperationID),
			OperationType: operation.OperationType,
			RetryCount:    operation.RetryCount,
			Status:        operation.Status,
			UpdatedAt:     operation.UpdatedAt,
		})
	}
	return memoryruntime.FinalizeOperationListResult(memoryruntime.OperationListResult{
		Items:         items,
		Limit:         response.Limit,
		Offset:        response.Offset,
		RunID:         strings.TrimSpace(request.RunID),
		SchemaVersion: "memory_operation_list_result_v1",
		Total:         response.Total,
		UserID:        strings.TrimSpace(request.UserID),
	})
}

func (e hindsightExecutor) CancelOperation(
	ctx context.Context,
	request memoryruntime.OperationActionRequest,
) (memoryruntime.OperationActionResult, error) {
	return e.operationAction(ctx, request, "cancel")
}

func (e hindsightExecutor) RetryOperation(
	ctx context.Context,
	request memoryruntime.OperationActionRequest,
) (memoryruntime.OperationActionResult, error) {
	return e.operationAction(ctx, request, "retry")
}

func (e hindsightExecutor) operationAction(
	ctx context.Context,
	request memoryruntime.OperationActionRequest,
	action string,
) (memoryruntime.OperationActionResult, error) {
	if err := memoryruntime.ValidateOperationActionRequest(request); err != nil {
		return memoryruntime.OperationActionResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.OperationActionResult{}, err
	}
	var response hindsightOperationActionResponse
	var err error
	switch action {
	case "cancel":
		response, err = e.client.CancelOperation(ctx, bankID, strings.TrimSpace(request.OperationID))
	case "retry":
		response, err = e.client.RetryOperation(ctx, bankID, strings.TrimSpace(request.OperationID))
	default:
		return memoryruntime.OperationActionResult{}, fmt.Errorf("unsupported memory operation action: %s", action)
	}
	if err != nil {
		return memoryruntime.OperationActionResult{}, err
	}
	return memoryruntime.FinalizeOperationActionResult(memoryruntime.OperationActionResult{
		Action:        action,
		OperationID:   response.OperationID,
		OperationRef:  memoryOperationProjectionRef(request.RunID, response.OperationID),
		RunID:         strings.TrimSpace(request.RunID),
		SchemaVersion: "memory_operation_action_result_v1",
		Status:        "accepted",
		Success:       response.Success,
		UserID:        strings.TrimSpace(request.UserID),
	})
}

func (e hindsightExecutor) Reflect(
	ctx context.Context,
	request memoryruntime.ReflectRequest,
) (memoryruntime.ReflectResult, error) {
	if err := memoryruntime.ValidateReflectRequest(request); err != nil {
		return memoryruntime.ReflectResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.ReflectResult{}, err
	}
	response, err := e.client.Reflect(ctx, bankID, hindsightReflectRequest{
		Budget:       "mid",
		Context:      strings.TrimSpace(request.Context),
		FactTypes:    []string{"experience", "observation", "world"},
		IncludeFacts: request.IncludeBasedOn,
		MaxTokens:    e.recallMaxTokens,
		Query:        hindsightReflectQuery(request),
		Tags:         []string{"scope:private"},
		TagsMatch:    "all_strict",
	})
	if err != nil {
		return memoryruntime.ReflectResult{}, err
	}
	return memoryruntime.FinalizeReflectResult(memoryruntime.ReflectResult{
		BasedOnMemoryItems: hindsightReflectContextItems(response.BasedOnMemories),
		Provider:           "hindsight",
		ReflectRef:         temporalProjectionRef(request.RunID, "memory/reflect"),
		RunID:              strings.TrimSpace(request.RunID),
		SchemaVersion:      "memory_reflect_result_v1",
		Status:             "completed",
		StructuredOutput:   copyAnyMap(response.StructuredOutput),
		Text:               strings.TrimSpace(response.Text),
		ThreadID:           strings.TrimSpace(request.ThreadID),
		Usage:              response.Usage,
		UserID:             strings.TrimSpace(request.UserID),
	})
}

func (e hindsightExecutor) UpsertProfileMemoryItem(
	ctx context.Context,
	request memoryruntime.UpsertProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	if err := memoryruntime.ValidateUpsertProfileMemoryItemRequest(request); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	documentID := hindsightProfileDocumentID(request.MemoryID)
	if _, err := e.client.RetainMemories(ctx, bankID, hindsightRetainRequest{
		Async:        boolPointer(false),
		DocumentTags: hindsightProfileTags(request.TenantID, bankID),
		Items: []hindsightMemoryItem{{
			Content:    strings.TrimSpace(request.CompactText),
			Context:    "explicit profile memory",
			DocumentID: documentID,
			Metadata: map[string]string{
				"canonical_subject": strings.TrimSpace(request.CanonicalSubject),
				"memory_id":         strings.TrimSpace(request.MemoryID),
				"source":            "explicit_profile_memory",
				"tenant_id":         strings.TrimSpace(request.TenantID),
			},
			Tags:       hindsightProfileTags(request.TenantID, bankID),
			Timestamp:  strings.TrimSpace(request.UpdatedAt),
			UpdateMode: "replace",
		}},
	}); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	return memoryruntime.FinalizeProfileMemoryItemResult(memoryruntime.ProfileMemoryItemResult{
		EpisodeUUID:   documentID,
		MemoryID:      strings.TrimSpace(request.MemoryID),
		SchemaVersion: "memory_profile_item_result_v1",
		Status:        "active",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
		UserID:        strings.TrimSpace(request.UserID),
	})
}

func (e hindsightExecutor) DeleteProfileMemoryItem(
	ctx context.Context,
	request memoryruntime.DisableProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	if err := memoryruntime.ValidateDisableProfileMemoryItemRequest(request); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.ensureBank(ctx, bankID); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	documentID := strings.TrimSpace(request.EpisodeUUID)
	if err := e.client.DeleteDocument(ctx, bankID, documentID); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	return memoryruntime.FinalizeProfileMemoryItemResult(memoryruntime.ProfileMemoryItemResult{
		EpisodeUUID:   documentID,
		MemoryID:      strings.TrimSpace(request.MemoryID),
		SchemaVersion: "memory_profile_item_result_v1",
		Status:        "disabled",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
		UserID:        strings.TrimSpace(request.UserID),
	})
}

func (e hindsightExecutor) DeleteProfileMemoryOwner(
	ctx context.Context,
	request memoryruntime.DisableProfileMemoryOwnerRequest,
) (memoryruntime.ProfileMemoryOwnerDisableResult, error) {
	if err := memoryruntime.ValidateDisableProfileMemoryOwnerRequest(request); err != nil {
		return memoryruntime.ProfileMemoryOwnerDisableResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.client.DeleteBank(ctx, bankID); err != nil {
		return memoryruntime.ProfileMemoryOwnerDisableResult{}, err
	}
	return memoryruntime.FinalizeProfileMemoryOwnerDisableResult(memoryruntime.ProfileMemoryOwnerDisableResult{
		SchemaVersion: "memory_profile_owner_disable_result_v1",
		Status:        "disabled",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
		UserID:        strings.TrimSpace(request.UserID),
	})
}

func (e hindsightExecutor) ensureBank(ctx context.Context, bankID string) error {
	if e.client == nil {
		return errors.New("hindsight client is not configured")
	}
	return e.client.EnsureBank(ctx, strings.TrimSpace(bankID), defaultHindsightBankConfig())
}

func hindsightOperationErrorKind(message string) string {
	if strings.TrimSpace(message) == "" {
		return ""
	}
	return "operation_error"
}

func defaultHindsightBankConfig() hindsightBankConfig {
	return hindsightBankConfig{
		MemoryDefense: hindsightMemoryDefenseConfig{
			Enabled: true,
			Rules: []hindsightMemoryDefenseRule{{
				On:     "sensitive_data",
				Action: "redact",
			}},
		},
	}
}

func (e hindsightExecutor) scopedBankID(tenantID string, userID string) string {
	sum := sha256.Sum256([]byte(
		strings.TrimSpace(e.ownerSalt) + ":" + strings.TrimSpace(tenantID) + ":" + strings.TrimSpace(userID),
	))
	return "hindsight_bank_" + hex.EncodeToString(sum[:])[:32]
}

func (e hindsightExecutor) conversationDocumentID(bankID string, threadID string) string {
	sum := sha256.Sum256([]byte(
		strings.TrimSpace(e.ownerSalt) + ":" + strings.TrimSpace(bankID) + ":" + strings.TrimSpace(threadID),
	))
	return "conversation:" + hex.EncodeToString(sum[:])[:32]
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
		return "PERSONAL_MEMORY_BASE_URL is required"
	}
	if strings.TrimSpace(cfg.PersonalMemoryAPISecret) == "" {
		return "PERSONAL_MEMORY_API_SECRET is required"
	}
	if strings.TrimSpace(cfg.PersonalMemoryOwnerSalt) == "" {
		return "PERSONAL_MEMORY_OWNER_SALT is required"
	}
	return ""
}

func personalMemoryOwnerSaltConfigured(cfg config.Config) bool {
	return strings.TrimSpace(cfg.PersonalMemoryOwnerSalt) != ""
}
