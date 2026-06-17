package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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
	Recall(context.Context, memoryruntime.RecallRequest) (memoryruntime.RecallResult, error)
	UpsertProfileMemoryItem(
		context.Context,
		memoryruntime.UpsertProfileMemoryItemRequest,
	) (memoryruntime.ProfileMemoryItemResult, error)
}

type hindsightClient interface {
	DeleteBank(context.Context, string) error
	DeleteDocument(context.Context, string, string) error
	HealthCheck(context.Context) error
	RecallMemories(context.Context, string, hindsightRecallRequest) (hindsightRecallResponse, error)
	RetainMemories(context.Context, string, hindsightRetainRequest) error
}

type hindsightExecutor struct {
	client       hindsightClient
	ownerSalt    string
	recallLimit  int
	recallMaxLen int
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

type hindsightMemoryItem struct {
	Content    string            `json:"content"`
	Context    string            `json:"context,omitempty"`
	DocumentID string            `json:"document_id,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	Tags       []string          `json:"tags,omitempty"`
	UpdateMode string            `json:"update_mode,omitempty"`
}

type hindsightRecallRequest struct {
	Budget    string   `json:"budget,omitempty"`
	MaxTokens int      `json:"max_tokens,omitempty"`
	Query     string   `json:"query"`
	Tags      []string `json:"tags,omitempty"`
	TagsMatch string   `json:"tags_match,omitempty"`
	Trace     bool     `json:"trace,omitempty"`
	Types     []string `json:"types,omitempty"`
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
	maxLen := cfg.PersonalMemoryRecallMaxChars
	if maxLen <= 0 {
		maxLen = 2500
	}
	return hindsightExecutor{
		client: newHindsightHTTPClient(hindsightClientOptions{
			apiSecret: cfg.PersonalMemoryAPISecret,
			baseURL:   cfg.PersonalMemoryBaseURL,
			timeout:   timeout,
		}),
		ownerSalt:    strings.TrimSpace(cfg.PersonalMemoryOwnerSalt),
		recallLimit:  limit,
		recallMaxLen: maxLen,
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
	response, err := e.client.RecallMemories(ctx, bankID, hindsightRecallRequest{
		Budget:    "mid",
		MaxTokens: e.recallMaxLen,
		Query:     strings.TrimSpace(request.UserGoal),
		Tags:      []string{"scope:private"},
		TagsMatch: "all_strict",
		Trace:     false,
		Types:     []string{"experience", "world"},
	})
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	items := hindsightContextItems(response.Results, request.RequestedCapability)
	result := memoryruntime.RecallResult{
		ContextBlock:  hindsightContextBlock(items, e.recallMaxLen),
		Items:         items,
		MemoryRef:     temporalProjectionRef(request.RunID, "memory/recall"),
		Provider:      "hindsight",
		RetrievalMode: "recall",
		RunID:         request.RunID,
		SchemaVersion: "memory_recall_result_v1",
		ThreadID:      request.ThreadID,
		UserID:        bankID,
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
	documentID := e.conversationDocumentID(bankID, request.ThreadID)
	content, err := encodeHindsightConversationTurn(request)
	if err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	if err := e.client.RetainMemories(ctx, bankID, hindsightRetainRequest{
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
			UpdateMode: "append",
		}},
	}); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	return memoryruntime.FinalizeAppendConversationTurnResult(memoryruntime.AppendConversationTurnResult{
		AppendedMessageCount: 2,
		RunID:                request.RunID,
		SchemaVersion:        "memory_conversation_append_result_v1",
		Status:               "completed",
		ThreadID:             request.ThreadID,
		UserID:               bankID,
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
	documentID := hindsightProfileDocumentID(request.MemoryID)
	if err := e.client.RetainMemories(ctx, bankID, hindsightRetainRequest{
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

func (c hindsightHTTPClient) HealthCheck(ctx context.Context) error {
	_, response, err := c.client.MonitoringAPI.HealthEndpointHealthGet(ctx).Execute()
	if err != nil {
		return err
	}
	return requireHindsightSuccess(response, "health")
}

func (c hindsightHTTPClient) RetainMemories(
	ctx context.Context,
	bankID string,
	request hindsightRetainRequest,
) error {
	payload := hindsight.RetainRequest{
		Async:        request.Async,
		DocumentTags: append([]string{}, request.DocumentTags...),
		Items:        make([]hindsight.MemoryItem, 0, len(request.Items)),
	}
	for _, item := range request.Items {
		payload.Items = append(payload.Items, toHindsightSDKMemoryItem(item))
	}
	_, response, err := c.client.MemoryAPI.
		RetainMemories(ctx, strings.TrimSpace(bankID)).
		RetainRequest(payload).
		Execute()
	if err != nil {
		return err
	}
	return requireHindsightSuccess(response, "retain memories")
}

func (c hindsightHTTPClient) RecallMemories(
	ctx context.Context,
	bankID string,
	request hindsightRecallRequest,
) (hindsightRecallResponse, error) {
	payload := hindsight.NewRecallRequest(strings.TrimSpace(request.Query))
	if strings.TrimSpace(request.Budget) != "" {
		budget := hindsight.Budget(strings.TrimSpace(request.Budget))
		payload.Budget = &budget
	}
	if request.MaxTokens > 0 {
		maxTokens := int32(request.MaxTokens)
		payload.MaxTokens = &maxTokens
	}
	trace := request.Trace
	payload.Trace = &trace
	payload.Tags = append([]string{}, request.Tags...)
	if strings.TrimSpace(request.TagsMatch) != "" {
		tagsMatch := strings.TrimSpace(request.TagsMatch)
		payload.TagsMatch = &tagsMatch
	}
	payload.Types = append([]string{}, request.Types...)
	responseBody, response, err := c.client.MemoryAPI.
		RecallMemories(ctx, strings.TrimSpace(bankID)).
		RecallRequest(*payload).
		Execute()
	if err != nil {
		return hindsightRecallResponse{}, err
	}
	if err := requireHindsightSuccess(response, "recall memories"); err != nil {
		return hindsightRecallResponse{}, err
	}
	return fromHindsightSDKRecallResponse(responseBody), nil
}

func (c hindsightHTTPClient) DeleteDocument(ctx context.Context, bankID string, documentID string) error {
	_, response, err := c.client.DocumentsAPI.
		DeleteDocument(ctx, strings.TrimSpace(bankID), strings.TrimSpace(documentID)).
		Execute()
	if err != nil {
		return err
	}
	return requireHindsightSuccess(response, "delete document")
}

func (c hindsightHTTPClient) DeleteBank(ctx context.Context, bankID string) error {
	_, response, err := c.client.BanksAPI.
		DeleteBank(ctx, strings.TrimSpace(bankID)).
		Execute()
	if err != nil {
		return err
	}
	return requireHindsightSuccess(response, "delete bank")
}

func requireHindsightSuccess(response *http.Response, operation string) error {
	if response == nil {
		return fmt.Errorf("hindsight %s returned no response", operation)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode > http.StatusAccepted {
		return fmt.Errorf("hindsight %s failed with status %d", operation, response.StatusCode)
	}
	return nil
}

func toHindsightSDKMemoryItem(item hindsightMemoryItem) hindsight.MemoryItem {
	output := hindsight.MemoryItem{
		Content:  strings.TrimSpace(item.Content),
		Metadata: copyStringMap(item.Metadata),
		Tags:     append([]string{}, item.Tags...),
	}
	if strings.TrimSpace(item.Context) != "" {
		output.SetContext(strings.TrimSpace(item.Context))
	}
	if strings.TrimSpace(item.DocumentID) != "" {
		output.SetDocumentId(strings.TrimSpace(item.DocumentID))
	}
	if strings.TrimSpace(item.UpdateMode) != "" {
		output.SetUpdateMode(strings.TrimSpace(item.UpdateMode))
	}
	return output
}

func fromHindsightSDKRecallResponse(response *hindsight.RecallResponse) hindsightRecallResponse {
	if response == nil {
		return hindsightRecallResponse{}
	}
	results := make([]hindsightRecallResult, 0, len(response.Results))
	for _, item := range response.Results {
		results = append(results, hindsightRecallResult{
			DocumentID:    item.GetDocumentId(),
			ID:            strings.TrimSpace(item.Id),
			MentionedAt:   item.GetMentionedAt(),
			Metadata:      copyStringMap(item.Metadata),
			OccurredEnd:   item.GetOccurredEnd(),
			OccurredStart: item.GetOccurredStart(),
			Tags:          append([]string{}, item.Tags...),
			Text:          strings.TrimSpace(item.Text),
			Type:          item.GetType(),
		})
	}
	return hindsightRecallResponse{Results: results}
}

func encodeHindsightConversationTurn(request memoryruntime.AppendConversationTurnRequest) (string, error) {
	turns := []hindsightConversationTurn{
		{Content: strings.TrimSpace(request.UserMessage), Role: "user"},
		{Content: strings.TrimSpace(request.AssistantMessage), Role: "assistant"},
	}
	encoded, err := json.Marshal(turns)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func hindsightContextItems(
	results []hindsightRecallResult,
	capability string,
) []memoryruntime.ContextItem {
	items := make([]memoryruntime.ContextItem, 0, len(results))
	for _, result := range results {
		if strings.TrimSpace(result.ID) == "" || strings.TrimSpace(result.Text) == "" {
			continue
		}
		updatedAt := firstNonEmpty(result.OccurredEnd, result.OccurredStart, result.MentionedAt)
		if updatedAt == "" {
			continue
		}
		memoryType := defaultString(strings.TrimSpace(result.Type), "experience")
		items = append(items, memoryruntime.ContextItem{
			Capability:  capability,
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
		"context_char_budget": cfg.PersonalMemoryRecallMaxChars,
		"data_plane":          "hindsight_self_host",
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
