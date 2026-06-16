package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	zep "github.com/getzep/zep-go/v3"
	zepclient "github.com/getzep/zep-go/v3/client"
	"github.com/getzep/zep-go/v3/core"
	"github.com/getzep/zep-go/v3/option"
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

type zepClient interface {
	AddGraphData(context.Context, *zep.AddDataRequest) (*zep.Episode, error)
	AddThreadMessages(
		context.Context,
		string,
		*zep.AddThreadMessagesRequest,
	) (*zep.AddThreadMessagesResponse, error)
	DeleteEpisode(context.Context, string) error
	DeleteUser(context.Context, string) error
	EnsureThread(context.Context, string, string) error
	EnsureUser(context.Context, string) error
	HealthCheck(context.Context) error
	SearchGraph(context.Context, *zep.GraphSearchQuery) (*zep.GraphSearchResults, error)
}

type zepMemoryExecutor struct {
	assistantName string
	client        zepClient
	maxChars      int
	projectSalt   string
	userName      string
}

type zepSDKClient struct {
	client *zepclient.Client
}

func newZepMemoryExecutor(cfg config.Config) (personalMemoryExecutor, error) {
	if strings.TrimSpace(cfg.ZepAPIKey) == "" || strings.TrimSpace(cfg.ZepBaseURL) == "" {
		if strings.TrimSpace(cfg.RuntimeProfile) == "local" {
			return nil, errors.New("ZEP_API_KEY and ZEP_BASE_URL are required for local Zep memory runtime")
		}
		return nil, errors.New("ZEP_API_KEY and ZEP_BASE_URL are required for deployed Zep memory runtime")
	}
	timeout := time.Duration(cfg.ZepTimeoutSeconds * float64(time.Second))
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	maxChars := cfg.ZepRecallMaxChars
	if maxChars <= 0 {
		maxChars = 2500
	}
	return zepMemoryExecutor{
		assistantName: defaultString(strings.TrimSpace(cfg.ZepAssistantName), "校园助理"),
		client: zepSDKClient{client: zepclient.NewClient(
			option.WithAPIKey(strings.TrimSpace(cfg.ZepAPIKey)),
			option.WithBaseURL(strings.TrimRight(strings.TrimSpace(cfg.ZepBaseURL), "/")),
			option.WithHTTPClient(&http.Client{Timeout: timeout}),
			option.WithMaxAttempts(1),
		)},
		maxChars:    maxChars,
		projectSalt: strings.TrimSpace(cfg.ZepProjectSalt),
		userName:    defaultString(strings.TrimSpace(cfg.ZepUserName), "学生"),
	}, nil
}

func (e zepMemoryExecutor) HealthCheck(ctx context.Context) error {
	if e.client == nil {
		return errors.New("zep client is not configured")
	}
	return e.client.HealthCheck(ctx)
}

func (e zepMemoryExecutor) Recall(
	ctx context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	userID := e.scopedUserID(request.TenantID, request.UserID)
	if err := e.client.EnsureUser(ctx, userID); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	scope := zep.GraphSearchScopeAuto
	returnRawResults := true
	maxChars := e.maxChars
	searchResult, err := e.client.SearchGraph(ctx, &zep.GraphSearchQuery{
		MaxCharacters:    &maxChars,
		Query:            trimZepSearchQuery(request.UserGoal),
		ReturnRawResults: &returnRawResults,
		Scope:            &scope,
		UserID:           &userID,
	})
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	result := memoryruntime.RecallResult{
		ContextBlock:  stringFromPtr(searchResult.GetContext()),
		Items:         zepContextItems(searchResult, request.RequestedCapability),
		MemoryRef:     temporalProjectionRef(request.RunID, "memory/recall"),
		RunID:         request.RunID,
		SchemaVersion: "memory_recall_result_v1",
		UserID:        userID,
	}
	return memoryruntime.FinalizeRecallResult(result)
}

func (e zepMemoryExecutor) AppendConversationTurn(
	ctx context.Context,
	request memoryruntime.AppendConversationTurnRequest,
) (memoryruntime.AppendConversationTurnResult, error) {
	if err := memoryruntime.ValidateAppendConversationTurnRequest(request); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	userID := e.scopedUserID(request.TenantID, request.UserID)
	threadID := e.scopedThreadID(userID, request.ThreadID)
	if err := e.client.EnsureUser(ctx, userID); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	if err := e.client.EnsureThread(ctx, threadID, userID); err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	userName := e.userName
	assistantName := e.assistantName
	createdAt := time.Now().UTC().Format(time.RFC3339)
	messages := []*zep.Message{
		{
			Content:   request.UserMessage,
			CreatedAt: &createdAt,
			Name:      &userName,
			Role:      zep.RoleTypeUserRole,
		},
		{
			Content:   request.AssistantMessage,
			CreatedAt: &createdAt,
			Name:      &assistantName,
			Role:      zep.RoleTypeAssistantRole,
		},
	}
	ignoreRoles := []zep.RoleType{}
	if request.IgnoreAssistantForGraph {
		ignoreRoles = append(ignoreRoles, zep.RoleTypeAssistantRole)
	}
	response, err := e.client.AddThreadMessages(ctx, threadID, &zep.AddThreadMessagesRequest{
		IgnoreRoles: ignoreRoles,
		Messages:    messages,
	})
	if err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	return memoryruntime.FinalizeAppendConversationTurnResult(memoryruntime.AppendConversationTurnResult{
		AppendedMessageCount: len(messages),
		MessageUUIDs:         response.GetMessageUUIDs(),
		RunID:                request.RunID,
		SchemaVersion:        "memory_conversation_append_result_v1",
		Status:               "completed",
		ThreadID:             request.ThreadID,
		UserID:               userID,
	})
}

func (e zepMemoryExecutor) UpsertProfileMemoryItem(
	ctx context.Context,
	request memoryruntime.UpsertProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	if err := memoryruntime.ValidateUpsertProfileMemoryItemRequest(request); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	userID := e.scopedUserID(request.TenantID, request.UserID)
	if err := e.client.EnsureUser(ctx, userID); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	sourceDescription := "campus-agent explicit profile memory"
	episode, err := e.client.AddGraphData(ctx, &zep.AddDataRequest{
		CreatedAt:         stringPtr(strings.TrimSpace(request.UpdatedAt)),
		Data:              request.CompactText,
		Metadata:          zepProfileMemoryMetadata(request),
		SourceDescription: &sourceDescription,
		Type:              zep.GraphDataTypeText,
		UserID:            &userID,
	})
	if err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	return memoryruntime.FinalizeProfileMemoryItemResult(memoryruntime.ProfileMemoryItemResult{
		EpisodeUUID:   episode.GetUUID(),
		MemoryID:      request.MemoryID,
		SchemaVersion: "memory_profile_item_result_v1",
		Status:        "active",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
		UserID:        request.UserID,
	})
}

func (e zepMemoryExecutor) DeleteProfileMemoryItem(
	ctx context.Context,
	request memoryruntime.DisableProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	if err := memoryruntime.ValidateDisableProfileMemoryItemRequest(request); err != nil {
		return memoryruntime.ProfileMemoryItemResult{}, err
	}
	if err := e.client.DeleteEpisode(ctx, request.EpisodeUUID); err != nil {
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

func (e zepMemoryExecutor) DeleteProfileMemoryOwner(
	ctx context.Context,
	request memoryruntime.DisableProfileMemoryOwnerRequest,
) (memoryruntime.ProfileMemoryOwnerDisableResult, error) {
	if err := memoryruntime.ValidateDisableProfileMemoryOwnerRequest(request); err != nil {
		return memoryruntime.ProfileMemoryOwnerDisableResult{}, err
	}
	userID := e.scopedUserID(request.TenantID, request.UserID)
	if err := e.client.DeleteUser(ctx, userID); err != nil && !isZepNotFound(err) {
		return memoryruntime.ProfileMemoryOwnerDisableResult{}, err
	}
	return memoryruntime.FinalizeProfileMemoryOwnerDisableResult(memoryruntime.ProfileMemoryOwnerDisableResult{
		SchemaVersion: "memory_profile_owner_disable_result_v1",
		Status:        "disabled",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
		UserID:        strings.TrimSpace(request.UserID),
	})
}

func (e zepMemoryExecutor) scopedUserID(tenantID string, userID string) string {
	userID = strings.TrimSpace(userID)
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return userID
	}
	if strings.TrimSpace(e.projectSalt) == "" {
		return tenantID + ":" + userID
	}
	sum := sha256.Sum256([]byte(e.projectSalt + ":" + tenantID + ":" + userID))
	return "zep_user_" + hex.EncodeToString(sum[:])[:32]
}

func (e zepMemoryExecutor) scopedThreadID(scopedUserID string, threadID string) string {
	scopedUserID = strings.TrimSpace(scopedUserID)
	threadID = strings.TrimSpace(threadID)
	if strings.TrimSpace(e.projectSalt) == "" {
		return scopedUserID + ":" + threadID
	}
	sum := sha256.Sum256([]byte(e.projectSalt + ":" + scopedUserID + ":" + threadID))
	return "zep_thread_" + hex.EncodeToString(sum[:])[:32]
}

func (c zepSDKClient) HealthCheck(ctx context.Context) error {
	if c.client == nil {
		return errors.New("zep client is not configured")
	}
	_, err := c.client.Project.Get(ctx)
	return err
}

func (c zepSDKClient) EnsureUser(ctx context.Context, userID string) error {
	_, err := c.client.User.Get(ctx, userID)
	if err == nil {
		return nil
	}
	if !isZepNotFound(err) {
		return err
	}
	_, err = c.client.User.Add(ctx, &zep.CreateUserRequest{UserID: userID})
	return err
}

func (c zepSDKClient) EnsureThread(ctx context.Context, threadID string, userID string) error {
	_, err := c.client.Thread.Get(ctx, threadID, nil)
	if err == nil {
		return nil
	}
	if !isZepNotFound(err) {
		return err
	}
	_, err = c.client.Thread.Create(ctx, &zep.CreateThreadRequest{
		ThreadID: threadID,
		UserID:   userID,
	})
	return err
}

func (c zepSDKClient) SearchGraph(
	ctx context.Context,
	query *zep.GraphSearchQuery,
) (*zep.GraphSearchResults, error) {
	return c.client.Graph.Search(ctx, query)
}

func (c zepSDKClient) AddGraphData(
	ctx context.Context,
	request *zep.AddDataRequest,
) (*zep.Episode, error) {
	return c.client.Graph.Add(ctx, request)
}

func (c zepSDKClient) DeleteEpisode(ctx context.Context, episodeUUID string) error {
	_, err := c.client.Graph.Episode.Delete(ctx, episodeUUID)
	return err
}

func (c zepSDKClient) DeleteUser(ctx context.Context, userID string) error {
	_, err := c.client.User.Delete(ctx, userID)
	return err
}

func (c zepSDKClient) AddThreadMessages(
	ctx context.Context,
	threadID string,
	request *zep.AddThreadMessagesRequest,
) (*zep.AddThreadMessagesResponse, error) {
	return c.client.Thread.AddMessages(ctx, threadID, request)
}

func zepContextItems(results *zep.GraphSearchResults, capability string) []memoryruntime.ContextItem {
	if results == nil {
		return nil
	}
	items := make([]memoryruntime.ContextItem, 0, len(results.GetEdges()))
	for _, edge := range results.GetEdges() {
		if strings.TrimSpace(edge.GetFact()) == "" || strings.TrimSpace(edge.GetUUID()) == "" {
			continue
		}
		items = append(items, memoryruntime.ContextItem{
			Capability:  capability,
			CompactText: edge.GetFact(),
			MemoryID:    edge.GetUUID(),
			MemoryType:  "edge",
			Score:       floatFromPtr(edge.GetScore()),
			UpdatedAt:   firstNonEmptyText(edge.GetValidAt(), edge.GetCreatedAt()),
		})
	}
	return items
}

func trimZepSearchQuery(value string) string {
	query := strings.TrimSpace(value)
	runes := []rune(query)
	if len(runes) <= 400 {
		return query
	}
	return string(runes[:400])
}

func isZepNotFound(err error) bool {
	var apiError *core.APIError
	if errors.As(err, &apiError) {
		return apiError.StatusCode == http.StatusNotFound
	}
	return strings.Contains(strings.ToLower(err.Error()), "404")
}

func stringFromPtr(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func floatFromPtr(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func stringPtr(value string) *string {
	return &value
}

func zepProfileMemoryMetadata(
	request memoryruntime.UpsertProfileMemoryItemRequest,
) map[string]interface{} {
	return map[string]interface{}{
		"canonical_subject": strings.TrimSpace(request.CanonicalSubject),
		"memory_id":         strings.TrimSpace(request.MemoryID),
		"source":            "explicit_profile_memory",
		"tenant_id":         strings.TrimSpace(request.TenantID),
	}
}

func CheckPersonalMemoryRuntime(ctx context.Context, cfg config.Config) error {
	executor, err := newZepMemoryExecutor(cfg)
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
		"context_char_budget": cfg.ZepRecallMaxChars,
		"data_plane":          "zep_user_graph",
		"thread_owner":        "execution-control",
	}
}

func zepConfigError(cfg config.Config) string {
	if strings.TrimSpace(cfg.ZepAPIKey) == "" {
		return "ZEP_API_KEY is required"
	}
	if strings.TrimSpace(cfg.ZepBaseURL) == "" {
		return "ZEP_BASE_URL is required"
	}
	return ""
}

func zepProjectSaltConfigured(cfg config.Config) bool {
	return strings.TrimSpace(cfg.ZepProjectSalt) != ""
}
