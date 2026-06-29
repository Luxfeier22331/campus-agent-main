package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type personalMemoryExecutor interface {
	AppendConversationTurn(
		context.Context,
		memoryruntime.AppendConversationTurnRequest,
	) (memoryruntime.AppendConversationTurnResult, error)
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
		memoryruntime.PersonalMemoryOperationStatusRequest,
	) (memoryruntime.PersonalMemoryOperationStatusResult, error)
	Recall(context.Context, memoryruntime.RecallRequest) (memoryruntime.RecallResult, error)
	UpsertProfileMemoryItem(
		context.Context,
		memoryruntime.UpsertProfileMemoryItemRequest,
	) (memoryruntime.ProfileMemoryItemResult, error)
}

type hindsightClient interface {
	DeleteBank(context.Context, string) error
	DeleteDocument(context.Context, string, string) error
	EnsureBank(context.Context, string) error
	HealthCheck(context.Context) error
	OperationStatus(context.Context, string, string) (hindsightOperationStatus, error)
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

type hindsightHTTPClient struct {
	apiSecret string
	baseURL   string
	client    *hindsight.APIClient
}

type hindsightClientOptions struct {
	apiSecret string
	baseURL   string
	timeout   time.Duration
}

type hindsightRetainRequest struct {
	Async        *bool                 `json:"async,omitempty"`
	DocumentTags []string              `json:"document_tags,omitempty"`
	Items        []hindsightMemoryItem `json:"items"`
}

type hindsightRetainResponse struct {
	Async        bool
	ItemsCount   int
	OperationID  string
	OperationIDs []string
	Success      bool
}

type hindsightOperationStatus struct {
	ChildOperations []hindsightChildOperationStatus `json:"child_operations,omitempty"`
	CompletedAt     string                          `json:"completed_at,omitempty"`
	CreatedAt       string                          `json:"created_at,omitempty"`
	ErrorMessage    string                          `json:"error_message,omitempty"`
	NextRetryAt     string                          `json:"next_retry_at,omitempty"`
	OperationID     string                          `json:"operation_id"`
	OperationType   string                          `json:"operation_type,omitempty"`
	Progress        map[string]any                  `json:"progress,omitempty"`
	ResultMetadata  map[string]any                  `json:"result_metadata,omitempty"`
	RetryCount      *int                            `json:"retry_count,omitempty"`
	Status          string                          `json:"status"`
	UpdatedAt       string                          `json:"updated_at,omitempty"`
}

type hindsightChildOperationStatus struct {
	ErrorMessage  string `json:"error_message,omitempty"`
	ItemsCount    *int   `json:"items_count,omitempty"`
	OperationID   string `json:"operation_id"`
	Status        string `json:"status"`
	SubBatchIndex *int   `json:"sub_batch_index,omitempty"`
}

type hindsightMemoryItem struct {
	Content    string            `json:"content"`
	Context    string            `json:"context,omitempty"`
	DocumentID string            `json:"document_id,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	Tags       []string          `json:"tags,omitempty"`
	Timestamp  string            `json:"timestamp,omitempty"`
	UpdateMode string            `json:"update_mode,omitempty"`
}

type hindsightRecallRequest struct {
	Budget         string   `json:"budget,omitempty"`
	MaxTokens      int      `json:"max_tokens,omitempty"`
	Query          string   `json:"query"`
	QueryTimestamp string   `json:"query_timestamp,omitempty"`
	Tags           []string `json:"tags,omitempty"`
	TagsMatch      string   `json:"tags_match,omitempty"`
	Trace          bool     `json:"trace,omitempty"`
	Types          []string `json:"types,omitempty"`
}

type hindsightRecallResponse struct {
	Results []hindsightRecallResult `json:"results"`
}

type hindsightRecallResult struct {
	DocumentID    string            `json:"document_id,omitempty"`
	ID            string            `json:"id"`
	MentionedAt   string            `json:"mentioned_at,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	OccurredEnd   string            `json:"occurred_end,omitempty"`
	OccurredStart string            `json:"occurred_start,omitempty"`
	Tags          []string          `json:"tags,omitempty"`
	Text          string            `json:"text"`
	Type          string            `json:"type,omitempty"`
}

type hindsightConversationTurn struct {
	Content string `json:"content"`
	Role    string `json:"role"`
}

func newHindsightHTTPClient(options hindsightClientOptions) hindsightHTTPClient {
	timeout := options.timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	baseURL := strings.TrimRight(strings.TrimSpace(options.baseURL), "/")
	apiSecret := strings.TrimSpace(options.apiSecret)
	return hindsightHTTPClient{
		apiSecret: apiSecret,
		baseURL:   baseURL,
		client:    hindsight.NewAPIClientWithTimeout(baseURL, apiSecret, timeout),
	}
}

func hindsightRetainMission() string {
	return strings.Join([]string{
		"Store only durable private student-assistant memory that helps future campus conversations.",
		"Prefer user-declared preferences, recurring academic planning needs, campus context, aliases, and stable constraints.",
		"Do not treat memory as authoritative policy or source truth.",
	}, " ")
}

func hindsightRetainCustomInstructions() string {
	return strings.Join([]string{
		"Extract concise facts useful for future campus assistant personalization.",
		"Keep facts private to the scoped user bank.",
		"Do not store credentials, tokens, raw account identifiers, authentication data, medical/legal/financial secrets, or exact transcript text unless explicitly declared by the user as durable preference/context.",
		"Do not extract facts that conflict with official campus policy/source truth; memory may personalize routing and wording but must not override verified sources.",
	}, " ")
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

func (e hindsightExecutor) OperationStatus(
	ctx context.Context,
	request memoryruntime.PersonalMemoryOperationStatusRequest,
) (memoryruntime.PersonalMemoryOperationStatusResult, error) {
	if err := memoryruntime.ValidatePersonalMemoryOperationStatusRequest(request); err != nil {
		return memoryruntime.PersonalMemoryOperationStatusResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	status, err := e.client.OperationStatus(ctx, bankID, request.OperationID)
	if err != nil {
		return memoryruntime.PersonalMemoryOperationStatusResult{}, err
	}
	return memoryruntime.FinalizePersonalMemoryOperationStatusResult(
		memoryruntime.PersonalMemoryOperationStatusResult{
			ChildOperations: operationStatusChildren(status.ChildOperations),
			CompletedAt:     status.CompletedAt,
			CreatedAt:       status.CreatedAt,
			ErrorMessage:    status.ErrorMessage,
			NextRetryAt:     status.NextRetryAt,
			OperationID:     status.OperationID,
			OperationType:   status.OperationType,
			Progress:        status.Progress,
			ResultMetadata:  status.ResultMetadata,
			RetryCount:      status.RetryCount,
			SchemaVersion:   "memory_operation_status_result_v1",
			Status:          status.Status,
			UpdatedAt:       status.UpdatedAt,
			UserID:          strings.TrimSpace(request.UserID),
		},
	)
}

func (e hindsightExecutor) Recall(
	ctx context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.client.EnsureBank(ctx, bankID); err != nil {
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
		Types:          []string{"experience", "world"},
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
	if err := e.client.EnsureBank(ctx, bankID); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	documentID := e.conversationDocumentID(bankID, request.ThreadID)
	content, err := encodeHindsightConversationTurn(request)
	if err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	retainResponse, err := e.client.RetainMemories(ctx, bankID, hindsightRetainRequest{
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
	if strings.TrimSpace(retainResponse.OperationID) == "" && len(retainResponse.OperationIDs) == 0 {
		return memoryruntime.AppendConversationTurnResult{}, errors.New(
			"hindsight async retain returned no operation id",
		)
	}
	return memoryruntime.FinalizeAppendConversationTurnResult(memoryruntime.AppendConversationTurnResult{
		AppendedMessageCount:  appendedHindsightConversationTurnCount(request),
		HindsightOperationID:  strings.TrimSpace(retainResponse.OperationID),
		HindsightOperationIDs: append([]string{}, retainResponse.OperationIDs...),
		RunID:                 request.RunID,
		SchemaVersion:         "memory_conversation_append_result_v1",
		Status:                "accepted",
		ThreadID:              request.ThreadID,
		UserID:                strings.TrimSpace(request.UserID),
	})
}

func hindsightRecallQuery(request memoryruntime.RecallRequest) string {
	query := strings.TrimSpace(request.UserGoal)
	if len(request.SessionSlots) == 0 {
		return query
	}
	keys := make([]string, 0, len(request.SessionSlots))
	for key, value := range request.SessionSlots {
		if strings.TrimSpace(key) != "" && strings.TrimSpace(value) != "" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return query
	}
	var builder strings.Builder
	builder.WriteString(query)
	builder.WriteString("\n\n已确认上下文:")
	for _, key := range keys {
		builder.WriteString("\n- ")
		builder.WriteString(strings.TrimSpace(key))
		builder.WriteString(": ")
		builder.WriteString(strings.TrimSpace(request.SessionSlots[key]))
	}
	return builder.String()
}

func (e hindsightExecutor) UpsertProfileMemoryItem(
	ctx context.Context,
	request memoryruntime.UpsertProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	if err := memoryruntime.ValidateUpsertProfileMemoryItemRequest(request); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	bankID := e.scopedBankID(request.TenantID, request.UserID)
	if err := e.client.EnsureBank(ctx, bankID); err != nil {
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

func encodeHindsightConversationTurn(request memoryruntime.AppendConversationTurnRequest) (string, error) {
	turns := []hindsightConversationTurn{
		{Content: strings.TrimSpace(request.UserMessage), Role: "user"},
	}
	if !request.IgnoreAssistantForGraph {
		turns = append(turns, hindsightConversationTurn{
			Content: strings.TrimSpace(request.AssistantMessage),
			Role:    "assistant",
		})
	}
	encoded, err := json.Marshal(turns)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func appendedHindsightConversationTurnCount(request memoryruntime.AppendConversationTurnRequest) int {
	if request.IgnoreAssistantForGraph {
		return 1
	}
	return 2
}

func hindsightContextItems(
	results []hindsightRecallResult,
	tool string,
	limit int,
) []memoryruntime.ContextItem {
	items := make([]memoryruntime.ContextItem, 0, len(results))
	for _, result := range results {
		if limit > 0 && len(items) >= limit {
			break
		}
		if strings.TrimSpace(result.ID) == "" || strings.TrimSpace(result.Text) == "" {
			continue
		}
		updatedAt := firstNonEmpty(result.OccurredEnd, result.OccurredStart, result.MentionedAt)
		if updatedAt == "" {
			continue
		}
		memoryType := defaultString(strings.TrimSpace(result.Type), "experience")
		items = append(items, memoryruntime.ContextItem{
			Tool:        tool,
			CompactText: strings.TrimSpace(result.Text),
			MemoryID:    strings.TrimSpace(result.ID),
			MemoryType:  memoryType,
			UpdatedAt:   updatedAt,
		})
	}
	return items
}

func hindsightContextBlock(items []memoryruntime.ContextItem, maxChars int) string {
	if len(items) == 0 || maxChars <= 0 {
		return ""
	}
	var builder strings.Builder
	header := "用户记忆:\n"
	builder.WriteString(header)
	usedChars := len([]rune(header))
	usedChars = writeHindsightContextLine(&builder, usedChars, maxChars, "相关事实:\n")
	for _, item := range items {
		usedChars = writeHindsightContextLine(&builder, usedChars, maxChars, "- "+strings.TrimSpace(item.CompactText)+"\n")
	}
	return strings.TrimSpace(builder.String())
}

func writeHindsightContextLine(builder *strings.Builder, usedChars int, maxChars int, line string) int {
	lineChars := len([]rune(line))
	if usedChars+lineChars > maxChars {
		return usedChars
	}
	builder.WriteString(line)
	return usedChars + lineChars
}

func hindsightDocumentTags(tenantID string, bankID string, documentID string, itemType string) []string {
	return []string{
		"scope:private",
		"type:" + strings.TrimSpace(itemType),
		"tenant:" + strings.TrimSpace(tenantID),
		"user:" + strings.TrimSpace(bankID),
		"session:" + strings.TrimSpace(documentID),
	}
}

func hindsightProfileTags(tenantID string, bankID string) []string {
	return []string{
		"scope:private",
		"type:profile",
		"tenant:" + strings.TrimSpace(tenantID),
		"user:" + strings.TrimSpace(bankID),
	}
}

func hindsightProfileDocumentID(memoryID string) string {
	return "profile:" + strings.TrimSpace(memoryID)
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

func boolPointer(value bool) *bool {
	return &value
}

func copyStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func copyAnyMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
