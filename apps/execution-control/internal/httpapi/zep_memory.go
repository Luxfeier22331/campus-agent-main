package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

var errZepCENotFound = errors.New("zep ce resource not found")

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

type zepCEClient interface {
	AddSessionMemory(context.Context, string, []zepCEMessage) error
	CreateSession(context.Context, string, string) error
	CreateUser(context.Context, string) error
	DeleteSessionMemory(context.Context, string) error
	DeleteUser(context.Context, string) error
	GetSession(context.Context, string) error
	GetUser(context.Context, string) error
	HealthCheck(context.Context) error
	SearchSessions(context.Context, zepCESessionSearchQuery, int) ([]zepCESessionSearchResult, error)
}

type zepCEExecutor struct {
	client       zepCEClient
	ownerSalt    string
	recallLimit  int
	recallMaxLen int
}

type zepCEHTTPClient struct {
	apiSecret string
	baseURL   string
	client    *http.Client
}

type zepCEClientOptions struct {
	apiSecret string
	baseURL   string
	timeout   time.Duration
}

type zepCECreateUserRequest struct {
	UserID string `json:"user_id"`
}

type zepCECreateSessionRequest struct {
	Metadata  map[string]any `json:"metadata"`
	SessionID string         `json:"session_id"`
	UserID    *string        `json:"user_id,omitempty"`
}

type zepCEAddMemoryRequest struct {
	Messages []zepCEMessage `json:"messages"`
}

type zepCEMessage struct {
	Content  string         `json:"content"`
	Metadata map[string]any `json:"metadata,omitempty"`
	Role     string         `json:"role"`
	RoleType string         `json:"role_type"`
}

type zepCESessionSearchQuery struct {
	SessionIDs []string `json:"session_ids,omitempty"`
	Text       string   `json:"text"`
	UserID     string   `json:"user_id,omitempty"`
}

type zepCESessionSearchResponse struct {
	Results []zepCESessionSearchResult `json:"results"`
}

type zepCESessionSearchResult struct {
	Fact *zepCEFact `json:"fact"`
}

type zepCEFact struct {
	CreatedAt string   `json:"created_at"`
	Fact      string   `json:"fact"`
	Rating    *float64 `json:"rating,omitempty"`
	UUID      string   `json:"uuid"`
}

func newZepCEHTTPClient(options zepCEClientOptions) zepCEHTTPClient {
	timeout := options.timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return zepCEHTTPClient{
		apiSecret: strings.TrimSpace(options.apiSecret),
		baseURL:   strings.TrimRight(strings.TrimSpace(options.baseURL), "/"),
		client:    &http.Client{Timeout: timeout},
	}
}

func newPersonalMemoryExecutor(
	cfg config.Config,
	_ providerConfigResolver,
) (personalMemoryExecutor, error) {
	runtimeName := strings.TrimSpace(cfg.PersonalMemoryRuntime)
	if runtimeName == "" || runtimeName == "zep_ce" {
		return newZepCEMemoryExecutor(cfg)
	}
	return nil, fmt.Errorf("unsupported personal memory runtime: %s", runtimeName)
}

func newZepCEMemoryExecutor(cfg config.Config) (personalMemoryExecutor, error) {
	if strings.TrimSpace(cfg.PersonalMemoryBaseURL) == "" {
		return nil, errors.New("PERSONAL_MEMORY_BASE_URL is required for Zep CE memory runtime")
	}
	if strings.TrimSpace(cfg.PersonalMemoryAPISecret) == "" {
		return nil, errors.New("PERSONAL_MEMORY_API_SECRET is required for Zep CE memory runtime")
	}
	if strings.TrimSpace(cfg.PersonalMemoryOwnerSalt) == "" {
		return nil, errors.New("PERSONAL_MEMORY_OWNER_SALT is required for Zep CE memory runtime")
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
	return zepCEExecutor{
		client: newZepCEHTTPClient(zepCEClientOptions{
			apiSecret: cfg.PersonalMemoryAPISecret,
			baseURL:   cfg.PersonalMemoryBaseURL,
			timeout:   timeout,
		}),
		ownerSalt:    strings.TrimSpace(cfg.PersonalMemoryOwnerSalt),
		recallLimit:  limit,
		recallMaxLen: maxLen,
	}, nil
}

func (e zepCEExecutor) HealthCheck(ctx context.Context) error {
	if e.client == nil {
		return errors.New("zep ce client is not configured")
	}
	return e.client.HealthCheck(ctx)
}

func (e zepCEExecutor) Recall(
	ctx context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	userID := e.scopedUserID(request.TenantID, request.UserID)
	if err := e.ensureUser(ctx, userID); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	results, err := e.client.SearchSessions(ctx, zepCESessionSearchQuery{
		Text:   trimZepCESearchQuery(request.UserGoal),
		UserID: userID,
	}, e.recallLimit)
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	items := zepCEContextItems(results, request.RequestedCapability)
	result := memoryruntime.RecallResult{
		ContextBlock:  zepCEContextBlock(items, e.recallMaxLen),
		Items:         items,
		MemoryRef:     temporalProjectionRef(request.RunID, "memory/recall"),
		RunID:         request.RunID,
		SchemaVersion: "memory_recall_result_v1",
		UserID:        userID,
	}
	return memoryruntime.FinalizeRecallResult(result)
}

func (e zepCEExecutor) AppendConversationTurn(
	ctx context.Context,
	request memoryruntime.AppendConversationTurnRequest,
) (memoryruntime.AppendConversationTurnResult, error) {
	if err := memoryruntime.ValidateAppendConversationTurnRequest(request); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	userID := e.scopedUserID(request.TenantID, request.UserID)
	sessionID := e.scopedThreadID(userID, request.ThreadID)
	if err := e.ensureUser(ctx, userID); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	if err := e.ensureSession(ctx, sessionID, userID); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	messages := []zepCEMessage{{
		Content:  strings.TrimSpace(request.UserMessage),
		Role:     "user",
		RoleType: "user",
	}}
	if !request.IgnoreAssistantForGraph {
		messages = append(messages, zepCEMessage{
			Content:  strings.TrimSpace(request.AssistantMessage),
			Role:     "assistant",
			RoleType: "assistant",
		})
	}
	if err := e.client.AddSessionMemory(ctx, sessionID, messages); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	return memoryruntime.FinalizeAppendConversationTurnResult(memoryruntime.AppendConversationTurnResult{
		AppendedMessageCount: len(messages),
		RunID:                request.RunID,
		SchemaVersion:        "memory_conversation_append_result_v1",
		Status:               "completed",
		ThreadID:             request.ThreadID,
		UserID:               userID,
	})
}

func (e zepCEExecutor) UpsertProfileMemoryItem(
	ctx context.Context,
	request memoryruntime.UpsertProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	if err := memoryruntime.ValidateUpsertProfileMemoryItemRequest(request); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	userID := e.scopedUserID(request.TenantID, request.UserID)
	sessionID := zepCEProfileSessionID(userID, request.MemoryID)
	if err := e.ensureUser(ctx, userID); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	if err := e.ensureSession(ctx, sessionID, userID); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	if err := e.client.AddSessionMemory(ctx, sessionID, []zepCEMessage{{
		Content:  strings.TrimSpace(request.CompactText),
		Role:     "user",
		RoleType: "user",
		Metadata: map[string]any{
			"canonical_subject": strings.TrimSpace(request.CanonicalSubject),
			"memory_id":         strings.TrimSpace(request.MemoryID),
			"source":            "explicit_profile_memory",
			"tenant_id":         strings.TrimSpace(request.TenantID),
		},
	}}); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	return memoryruntime.FinalizeProfileMemoryItemResult(memoryruntime.ProfileMemoryItemResult{
		EpisodeUUID:   sessionID,
		MemoryID:      strings.TrimSpace(request.MemoryID),
		SchemaVersion: "memory_profile_item_result_v1",
		Status:        "active",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
		UserID:        strings.TrimSpace(request.UserID),
	})
}

func (e zepCEExecutor) DeleteProfileMemoryItem(
	ctx context.Context,
	request memoryruntime.DisableProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	if err := memoryruntime.ValidateDisableProfileMemoryItemRequest(request); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	if err := e.client.DeleteSessionMemory(ctx, strings.TrimSpace(request.EpisodeUUID)); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	return memoryruntime.FinalizeProfileMemoryItemResult(memoryruntime.ProfileMemoryItemResult{
		EpisodeUUID:   strings.TrimSpace(request.EpisodeUUID),
		MemoryID:      strings.TrimSpace(request.MemoryID),
		SchemaVersion: "memory_profile_item_result_v1",
		Status:        "disabled",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
		UserID:        strings.TrimSpace(request.UserID),
	})
}

func (e zepCEExecutor) DeleteProfileMemoryOwner(
	ctx context.Context,
	request memoryruntime.DisableProfileMemoryOwnerRequest,
) (memoryruntime.ProfileMemoryOwnerDisableResult, error) {
	if err := memoryruntime.ValidateDisableProfileMemoryOwnerRequest(request); err != nil {
		return memoryruntime.ProfileMemoryOwnerDisableResult{}, err
	}
	userID := e.scopedUserID(request.TenantID, request.UserID)
	if err := e.client.DeleteUser(ctx, userID); err != nil && !errors.Is(err, errZepCENotFound) {
		return memoryruntime.ProfileMemoryOwnerDisableResult{}, err
	}
	return memoryruntime.FinalizeProfileMemoryOwnerDisableResult(memoryruntime.ProfileMemoryOwnerDisableResult{
		SchemaVersion: "memory_profile_owner_disable_result_v1",
		Status:        "disabled",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
		UserID:        strings.TrimSpace(request.UserID),
	})
}

func (e zepCEExecutor) ensureUser(ctx context.Context, userID string) error {
	err := e.client.GetUser(ctx, userID)
	if err == nil {
		return nil
	}
	if !errors.Is(err, errZepCENotFound) {
		return err
	}
	return e.client.CreateUser(ctx, userID)
}

func (e zepCEExecutor) ensureSession(ctx context.Context, sessionID string, userID string) error {
	err := e.client.GetSession(ctx, sessionID)
	if err == nil {
		return nil
	}
	if !errors.Is(err, errZepCENotFound) {
		return err
	}
	return e.client.CreateSession(ctx, sessionID, userID)
}

func (e zepCEExecutor) scopedUserID(tenantID string, userID string) string {
	sum := sha256.Sum256([]byte(
		strings.TrimSpace(e.ownerSalt) + ":" + strings.TrimSpace(tenantID) + ":" + strings.TrimSpace(userID),
	))
	return "zep_user_" + hex.EncodeToString(sum[:])[:32]
}

func (e zepCEExecutor) scopedThreadID(scopedUserID string, threadID string) string {
	sum := sha256.Sum256([]byte(
		strings.TrimSpace(e.ownerSalt) + ":" + strings.TrimSpace(scopedUserID) + ":" + strings.TrimSpace(threadID),
	))
	return "zep_thread_" + hex.EncodeToString(sum[:])[:32]
}

func (c zepCEHTTPClient) HealthCheck(ctx context.Context) error {
	return c.do(ctx, http.MethodGet, "/healthz", nil, nil)
}

func (c zepCEHTTPClient) GetUser(ctx context.Context, userID string) error {
	return c.do(ctx, http.MethodGet, "/api/v2/users/"+url.PathEscape(userID), nil, nil)
}

func (c zepCEHTTPClient) CreateUser(ctx context.Context, userID string) error {
	return c.do(ctx, http.MethodPost, "/api/v2/users", zepCECreateUserRequest{UserID: userID}, nil)
}

func (c zepCEHTTPClient) DeleteUser(ctx context.Context, userID string) error {
	return c.do(ctx, http.MethodDelete, "/api/v2/users/"+url.PathEscape(userID), nil, nil)
}

func (c zepCEHTTPClient) GetSession(ctx context.Context, sessionID string) error {
	return c.do(ctx, http.MethodGet, "/api/v2/sessions/"+url.PathEscape(sessionID), nil, nil)
}

func (c zepCEHTTPClient) CreateSession(ctx context.Context, sessionID string, userID string) error {
	return c.do(ctx, http.MethodPost, "/api/v2/sessions", zepCECreateSessionRequest{
		Metadata:  map[string]any{},
		SessionID: sessionID,
		UserID:    stringPtr(userID),
	}, nil)
}

func (c zepCEHTTPClient) AddSessionMemory(ctx context.Context, sessionID string, messages []zepCEMessage) error {
	return c.do(
		ctx,
		http.MethodPost,
		"/api/v2/sessions/"+url.PathEscape(sessionID)+"/memory",
		zepCEAddMemoryRequest{Messages: messages},
		nil,
	)
}

func (c zepCEHTTPClient) DeleteSessionMemory(ctx context.Context, sessionID string) error {
	return c.do(ctx, http.MethodDelete, "/api/v2/sessions/"+url.PathEscape(sessionID)+"/memory", nil, nil)
}

func (c zepCEHTTPClient) SearchSessions(
	ctx context.Context,
	query zepCESessionSearchQuery,
	limit int,
) ([]zepCESessionSearchResult, error) {
	path := "/api/v2/sessions/search"
	if limit > 0 {
		path += fmt.Sprintf("?limit=%d", limit)
	}
	var response zepCESessionSearchResponse
	if err := c.do(ctx, http.MethodPost, path, query, &response); err != nil {
		return nil, err
	}
	return response.Results, nil
}

func (c zepCEHTTPClient) do(ctx context.Context, method string, path string, body any, output any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Api-Key "+c.apiSecret)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return errZepCENotFound
	}
	if response.StatusCode < http.StatusOK || response.StatusCode > http.StatusAccepted {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		return fmt.Errorf("zep ce request failed: method=%s path=%s status=%d body=%q", method, path, response.StatusCode, string(raw))
	}
	if output == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(output)
}

func zepCEContextItems(
	results []zepCESessionSearchResult,
	capability string,
) []memoryruntime.ContextItem {
	items := make([]memoryruntime.ContextItem, 0, len(results))
	for _, result := range results {
		if result.Fact == nil ||
			strings.TrimSpace(result.Fact.UUID) == "" ||
			strings.TrimSpace(result.Fact.Fact) == "" ||
			strings.TrimSpace(result.Fact.CreatedAt) == "" {
			continue
		}
		items = append(items, memoryruntime.ContextItem{
			Capability:  capability,
			CompactText: strings.TrimSpace(result.Fact.Fact),
			MemoryID:    strings.TrimSpace(result.Fact.UUID),
			MemoryType:  "fact",
			Score:       floatFromPtr(result.Fact.Rating),
			UpdatedAt:   strings.TrimSpace(result.Fact.CreatedAt),
		})
	}
	return items
}

func zepCEContextBlock(items []memoryruntime.ContextItem, maxChars int) string {
	if len(items) == 0 || maxChars <= 0 {
		return ""
	}
	var builder strings.Builder
	header := "个人记忆:\n"
	builder.WriteString(header)
	usedChars := len([]rune(header))
	for _, item := range items {
		line := "- " + strings.TrimSpace(item.CompactText) + "\n"
		lineChars := len([]rune(line))
		if usedChars+lineChars > maxChars {
			break
		}
		builder.WriteString(line)
		usedChars += lineChars
	}
	return strings.TrimSpace(builder.String())
}

func trimZepCESearchQuery(value string) string {
	query := strings.TrimSpace(value)
	runes := []rune(query)
	if len(runes) <= 400 {
		return query
	}
	return string(runes[:400])
}

func zepCEProfileSessionID(userID string, memoryID string) string {
	return "profile:" + strings.TrimSpace(userID) + ":" + strings.TrimSpace(memoryID)
}

func stringPtr(value string) *string {
	return &value
}

func floatFromPtr(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func CheckPersonalMemoryRuntime(ctx context.Context, cfg config.Config) error {
	executor, err := newZepCEMemoryExecutor(cfg)
	if err != nil {
		return err
	}
	return executor.HealthCheck(ctx)
}

func EnsurePersonalMemoryRuntime(ctx context.Context, cfg config.Config) error {
	return CheckPersonalMemoryRuntime(ctx, cfg)
}

func zepConfigSummary(cfg config.Config) map[string]any {
	return map[string]any{
		"context_char_budget": cfg.PersonalMemoryRecallMaxChars,
		"data_plane":          "zep_ce_self_host",
		"thread_owner":        "execution-control",
	}
}

func zepConfigError(cfg config.Config) string {
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
