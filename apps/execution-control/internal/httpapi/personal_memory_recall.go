package httpapi

import (
	"bytes"
	"context"
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

type personalMemoryExecutor interface {
	HealthCheck(context.Context) error
	EnsureSchema(context.Context) error
	Recall(context.Context, memoryruntime.RecallRequest) (memoryruntime.RecallResult, error)
	Upsert(context.Context, memoryruntime.UpsertRequest) (memoryruntime.UpsertResult, error)
	Disable(context.Context, memoryruntime.DisableRequest) (memoryruntime.UpsertResult, error)
	DisableOwner(context.Context, memoryruntime.DisableOwnerRequest) (memoryruntime.DisableOwnerResult, error)
}

type qdrantPersonalMemoryExecutor struct {
	collection          string
	defaultMaxChars     int
	defaultTopK         int
	embeddingHTTPClient *http.Client
	embeddingRole       providerConfigRole
	configResolver      providerConfigResolver
	httpClient          *http.Client
	qdrantQueryAPIKey   string
	qdrantURL           string
	qdrantWriteAPIKey   string
	scoreThreshold      float64
	timeout             time.Duration
}

func newQdrantPersonalMemoryExecutor(
	cfg config.Config,
	configResolver providerConfigResolver,
) (personalMemoryExecutor, error) {
	qdrantURL := strings.TrimRight(strings.TrimSpace(cfg.QdrantURL), "/")
	if qdrantURL == "" {
		return nil, errors.New("QDRANT_URL is required for personal memory recall")
	}
	parsedQdrantURL, err := url.ParseRequestURI(qdrantURL)
	if err != nil {
		return nil, fmt.Errorf("QDRANT_URL must be a valid http(s) URL: %w", err)
	}
	if parsedQdrantURL.Scheme != "https" {
		return nil, errors.New("QDRANT_URL must use https for authenticated personal memory data-plane")
	}
	if strings.TrimSpace(cfg.QdrantQueryAPIKey) == "" {
		return nil, errors.New("QDRANT_QUERY_API_KEY is required for personal memory recall")
	}
	collection := strings.TrimSpace(cfg.PersonalMemoryCollection)
	if collection == "" {
		collection = "personal_memory_v1"
	}
	topK := cfg.PersonalMemoryTopK
	if topK <= 0 {
		topK = 5
	}
	maxChars := cfg.PersonalMemoryMaxChars
	if maxChars <= 0 {
		maxChars = 1200
	}
	timeout := time.Duration(cfg.QdrantTimeoutSeconds * float64(time.Second))
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	httpClient, err := qdrantTLSHTTPClient(timeout, cfg.QdrantTLSCACertPath)
	if err != nil {
		return nil, err
	}
	return qdrantPersonalMemoryExecutor{
		collection:          collection,
		defaultMaxChars:     maxChars,
		defaultTopK:         topK,
		embeddingHTTPClient: &http.Client{Timeout: timeout},
		embeddingRole:       providerConfigRolePersonalMemoryEmbedding,
		configResolver:      configResolver,
		httpClient:          httpClient,
		qdrantQueryAPIKey:   strings.TrimSpace(cfg.QdrantQueryAPIKey),
		qdrantURL:           qdrantURL,
		qdrantWriteAPIKey:   strings.TrimSpace(cfg.QdrantWriteAPIKey),
		scoreThreshold:      cfg.PersonalMemoryScoreThreshold,
		timeout:             timeout,
	}, nil
}

func (e qdrantPersonalMemoryExecutor) HealthCheck(ctx context.Context) error {
	if err := e.checkQdrantReady(ctx); err != nil {
		return err
	}
	return e.checkCollection(ctx)
}

func (e qdrantPersonalMemoryExecutor) CheckEmbeddingCompatibility(
	ctx context.Context,
	snapshot providerConfigSnapshot,
) error {
	if snapshot.Dimensions <= 0 {
		return errors.New("embedding provider config snapshot dimensions is required")
	}
	if err := e.checkQdrantReady(ctx); err != nil {
		return err
	}
	dimensions, err := e.collectionDenseVectorDimensions(ctx)
	if err != nil {
		return err
	}
	if dimensions != snapshot.Dimensions {
		return fmt.Errorf("qdrant personal memory dense vector size = %d, want %d", dimensions, snapshot.Dimensions)
	}
	return nil
}

func (e qdrantPersonalMemoryExecutor) EnsureSchema(ctx context.Context) error {
	if err := e.checkQdrantReady(ctx); err != nil {
		return err
	}
	if err := e.checkCollection(ctx); err == nil {
		return nil
	} else if !errors.Is(err, errPersonalMemoryCollectionMissing) {
		return err
	}
	return e.createCollection(ctx)
}

var errPersonalMemoryCollectionMissing = errors.New("personal memory collection is missing")

func (e qdrantPersonalMemoryExecutor) checkQdrantReady(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, e.qdrantURL+"/readyz", nil)
	if err != nil {
		return err
	}
	request.Header.Set("api-key", e.qdrantQueryAPIKey)
	response, err := e.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() {
		_ = response.Body.Close()
	}()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("qdrant readyz status %d", response.StatusCode)
	}
	return nil
}

func (e qdrantPersonalMemoryExecutor) checkCollection(ctx context.Context) error {
	dimensions, distance, err := e.collectionVectorSchema(ctx)
	if err != nil {
		return err
	}
	embeddingDimensions, err := e.embeddingDimensionsForSchema(ctx)
	if err != nil {
		return err
	}
	if dimensions != embeddingDimensions {
		return fmt.Errorf("qdrant personal memory dense vector size = %d, want %d", dimensions, embeddingDimensions)
	}
	if !strings.EqualFold(strings.TrimSpace(distance), "cosine") {
		return fmt.Errorf("qdrant personal memory dense vector distance = %q, want Cosine", distance)
	}
	return nil
}

func (e qdrantPersonalMemoryExecutor) collectionDenseVectorDimensions(ctx context.Context) (int, error) {
	dimensions, _, err := e.collectionVectorSchema(ctx)
	return dimensions, err
}

func (e qdrantPersonalMemoryExecutor) collectionVectorSchema(ctx context.Context) (int, string, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		e.qdrantURL+"/collections/"+url.PathEscape(e.collection),
		nil,
	)
	if err != nil {
		return 0, "", err
	}
	request.Header.Set("api-key", e.qdrantQueryAPIKey)
	response, err := e.httpClient.Do(request)
	if err != nil {
		return 0, "", err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return 0, "", errPersonalMemoryCollectionMissing
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return 0, "", fmt.Errorf("qdrant personal memory collection status %d", response.StatusCode)
	}
	var payload struct {
		Result struct {
			Config struct {
				Params struct {
					Vectors map[string]struct {
						Distance string `json:"distance"`
						Size     int    `json:"size"`
					} `json:"vectors"`
				} `json:"params"`
			} `json:"config"`
		} `json:"result"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return 0, "", fmt.Errorf("parse qdrant personal memory collection: %w", err)
	}
	dense, ok := payload.Result.Config.Params.Vectors["dense"]
	if !ok {
		return 0, "", errors.New("qdrant personal memory collection missing dense vector")
	}
	return dense.Size, dense.Distance, nil
}

func (e qdrantPersonalMemoryExecutor) createCollection(ctx context.Context) error {
	embeddingDimensions, err := e.embeddingDimensionsForSchema(ctx)
	if err != nil {
		return err
	}
	body := map[string]any{
		"vectors": map[string]any{
			"dense": map[string]any{
				"size":     embeddingDimensions,
				"distance": "Cosine",
			},
		},
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPut,
		e.qdrantURL+"/collections/"+url.PathEscape(e.collection),
		bytes.NewReader(encoded),
	)
	if err != nil {
		return err
	}
	request.Header.Set("api-key", e.qdrantWriteAPIKey)
	request.Header.Set("content-type", "application/json")
	response, err := e.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("qdrant personal memory collection create status %d", response.StatusCode)
	}
	return nil
}

func (e qdrantPersonalMemoryExecutor) Recall(
	ctx context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallResult{}, err
	}
	embedding, err := e.embedMemoryQuery(ctx, request)
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	points, err := e.queryMemoryPoints(ctx, request, embedding)
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	items := e.memoryItemsFromPoints(points)
	result := memoryruntime.RecallResult{
		Items:         items,
		MemoryRef:     temporalProjectionRef(request.RunID, "memory/recall"),
		RunID:         request.RunID,
		SchemaVersion: "memory_recall_result_v1",
	}
	return memoryruntime.FinalizeRecallResult(result)
}

func (e qdrantPersonalMemoryExecutor) Upsert(
	ctx context.Context,
	request memoryruntime.UpsertRequest,
) (memoryruntime.UpsertResult, error) {
	if err := memoryruntime.ValidateUpsertRequest(request); err != nil {
		return memoryruntime.UpsertResult{}, err
	}
	if strings.TrimSpace(e.qdrantWriteAPIKey) == "" {
		return memoryruntime.UpsertResult{}, errors.New("QDRANT_WRITE_API_KEY is required for personal memory indexing")
	}
	embedding, err := e.embedMemoryText(ctx, request.CompactText)
	if err != nil {
		return memoryruntime.UpsertResult{}, err
	}
	pointID := memoryruntime.PointID(request.UserID, request.MemoryID)
	payload := map[string]any{
		"memory_id":    strings.TrimSpace(request.MemoryID),
		"user_id":      strings.TrimSpace(request.UserID),
		"tenant_id":    strings.TrimSpace(request.TenantID),
		"memory_type":  strings.TrimSpace(request.MemoryType),
		"capability":   strings.TrimSpace(request.Capability),
		"status":       strings.TrimSpace(request.Status),
		"source":       strings.TrimSpace(request.Source),
		"compact_text": strings.TrimSpace(request.CompactText),
		"updated_at":   strings.TrimSpace(request.UpdatedAt),
	}
	body := map[string]any{
		"points": []map[string]any{{
			"id":      pointID,
			"payload": payload,
			"vector": map[string]any{
				"dense": embedding,
			},
		}},
	}
	if err := e.writeQdrant(ctx, http.MethodPut, "/points?wait=true", body); err != nil {
		return memoryruntime.UpsertResult{}, err
	}
	return memoryruntime.NormalizeUpsertResult(request), nil
}

func (e qdrantPersonalMemoryExecutor) Disable(
	ctx context.Context,
	request memoryruntime.DisableRequest,
) (memoryruntime.UpsertResult, error) {
	if err := memoryruntime.ValidateDisableRequest(request); err != nil {
		return memoryruntime.UpsertResult{}, err
	}
	if strings.TrimSpace(e.qdrantWriteAPIKey) == "" {
		return memoryruntime.UpsertResult{}, errors.New("QDRANT_WRITE_API_KEY is required for personal memory indexing")
	}
	pointID := memoryruntime.PointID(request.UserID, request.MemoryID)
	body := map[string]any{
		"payload": map[string]any{
			"status":     "disabled",
			"updated_at": strings.TrimSpace(request.UpdatedAt),
		},
		"points": []string{pointID},
	}
	if err := e.writeQdrant(ctx, http.MethodPost, "/points/payload?wait=true", body); err != nil {
		return memoryruntime.UpsertResult{}, err
	}
	return memoryruntime.UpsertResult{
		MemoryID:      strings.TrimSpace(request.MemoryID),
		PointID:       pointID,
		SchemaVersion: "personal_memory_upsert_result_v1",
		Status:        "disabled",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
	}, nil
}

func (e qdrantPersonalMemoryExecutor) DisableOwner(
	ctx context.Context,
	request memoryruntime.DisableOwnerRequest,
) (memoryruntime.DisableOwnerResult, error) {
	if err := memoryruntime.ValidateDisableOwnerRequest(request); err != nil {
		return memoryruntime.DisableOwnerResult{}, err
	}
	if strings.TrimSpace(e.qdrantWriteAPIKey) == "" {
		return memoryruntime.DisableOwnerResult{}, errors.New("QDRANT_WRITE_API_KEY is required for personal memory indexing")
	}
	filter := map[string]any{
		"must": []map[string]any{
			qdrantMatchCondition("user_id", strings.TrimSpace(request.UserID)),
			qdrantMatchCondition("status", "active"),
		},
	}
	if tenantID := strings.TrimSpace(request.TenantID); tenantID != "" {
		filter["must"] = append(filter["must"].([]map[string]any), qdrantMatchCondition("tenant_id", tenantID))
	}
	body := map[string]any{
		"payload": map[string]any{
			"status":     "disabled",
			"updated_at": strings.TrimSpace(request.UpdatedAt),
		},
		"filter": filter,
	}
	if err := e.writeQdrant(ctx, http.MethodPost, "/points/payload?wait=true", body); err != nil {
		return memoryruntime.DisableOwnerResult{}, err
	}
	return memoryruntime.DisableOwnerResult{
		SchemaVersion: "personal_memory_owner_disable_result_v1",
		Status:        "disabled",
		UpdatedAt:     strings.TrimSpace(request.UpdatedAt),
		UserID:        strings.TrimSpace(request.UserID),
	}, nil
}

func (e qdrantPersonalMemoryExecutor) embedMemoryQuery(
	ctx context.Context,
	request memoryruntime.RecallRequest,
) ([]float64, error) {
	if e.embeddingHTTPClient == nil {
		return nil, errors.New("embedding HTTP client is not configured")
	}
	queryText := strings.TrimSpace(request.UserGoal)
	if len(request.SessionSlots) > 0 {
		slotParts := make([]string, 0, len(request.SessionSlots))
		for key, value := range request.SessionSlots {
			if strings.TrimSpace(value) != "" {
				slotParts = append(slotParts, strings.TrimSpace(key)+":"+strings.TrimSpace(value))
			}
		}
		if len(slotParts) > 0 {
			queryText = queryText + "\n" + strings.Join(slotParts, "\n")
		}
	}
	return e.embedMemoryText(ctx, queryText)
}

func (e qdrantPersonalMemoryExecutor) embedMemoryText(ctx context.Context, text string) ([]float64, error) {
	embeddingConfig, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]any{
		"model":      embeddingConfig.Model,
		"input":      strings.TrimSpace(text),
		"dimensions": embeddingConfig.Dimensions,
	})
	if err != nil {
		return nil, err
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(embeddingConfig.BaseURL, "/")+"/embeddings",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("authorization", "Bearer "+embeddingConfig.APIKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := e.embeddingHTTPClient.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("embedding provider status %d", response.StatusCode)
	}
	var payload struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse embedding response: %w", err)
	}
	if len(payload.Data) == 0 || len(payload.Data[0].Embedding) == 0 {
		return nil, errors.New("embedding response did not contain embedding")
	}
	if embeddingConfig.Dimensions > 0 && len(payload.Data[0].Embedding) != embeddingConfig.Dimensions {
		return nil, fmt.Errorf("embedding dimension = %d, want %d", len(payload.Data[0].Embedding), embeddingConfig.Dimensions)
	}
	return payload.Data[0].Embedding, nil
}

func (e qdrantPersonalMemoryExecutor) resolveEmbeddingProviderConfig(
	ctx context.Context,
) (providerConfigSnapshot, error) {
	role := e.embeddingRole
	if role == "" {
		role = providerConfigRolePersonalMemoryEmbedding
	}
	if e.configResolver != nil {
		return e.configResolver.ResolveActiveProviderConfig(ctx, role)
	}
	return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
}

func (e qdrantPersonalMemoryExecutor) embeddingDimensionsForSchema(ctx context.Context) (int, error) {
	snapshot, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return 0, err
	}
	return snapshot.Dimensions, nil
}

func (e qdrantPersonalMemoryExecutor) writeQdrant(
	ctx context.Context,
	method string,
	pathAndQuery string,
	body map[string]any,
) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(e.collection) + pathAndQuery
	httpRequest, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	httpRequest.Header.Set("api-key", e.qdrantWriteAPIKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := e.httpClient.Do(httpRequest)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("qdrant personal memory write status %d", response.StatusCode)
	}
	return nil
}

func (e qdrantPersonalMemoryExecutor) queryMemoryPoints(
	ctx context.Context,
	request memoryruntime.RecallRequest,
	embedding []float64,
) ([]qdrantPoint, error) {
	filter := map[string]any{
		"must": []map[string]any{
			qdrantMatchCondition("user_id", strings.TrimSpace(request.UserID)),
			qdrantMatchCondition("status", "active"),
		},
		"should": []map[string]any{
			qdrantMatchCondition("capability", strings.TrimSpace(request.RequestedCapability)),
			qdrantMatchCondition("capability", "any"),
		},
	}
	if tenantID := strings.TrimSpace(request.TenantID); tenantID != "" {
		filter["must"] = append(filter["must"].([]map[string]any), qdrantMatchCondition("tenant_id", tenantID))
	}
	body := map[string]any{
		"limit":        e.defaultTopK,
		"with_payload": true,
		"with_vector":  false,
		"using":        "dense",
		"query":        embedding,
		"filter":       filter,
	}
	if e.scoreThreshold > 0 {
		body["score_threshold"] = e.scoreThreshold
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(e.collection) + "/points/query"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("api-key", e.qdrantQueryAPIKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := e.httpClient.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("qdrant personal memory query status %d", response.StatusCode)
	}
	var payload struct {
		Result struct {
			Points []qdrantPoint `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant personal memory response: %w", err)
	}
	return payload.Result.Points, nil
}

func (e qdrantPersonalMemoryExecutor) memoryItemsFromPoints(points []qdrantPoint) []memoryruntime.ContextItem {
	items := make([]memoryruntime.ContextItem, 0, len(points))
	usedChars := 0
	for _, point := range points {
		item, ok := memoryItemFromQdrantPoint(point)
		if !ok {
			continue
		}
		itemChars := len([]rune(item.CompactText))
		if e.defaultMaxChars > 0 && usedChars+itemChars > e.defaultMaxChars {
			break
		}
		usedChars += itemChars
		items = append(items, item)
	}
	return items
}

func memoryItemFromQdrantPoint(point qdrantPoint) (memoryruntime.ContextItem, bool) {
	payload := point.Payload
	if len(payload) == 0 {
		return memoryruntime.ContextItem{}, false
	}
	item := memoryruntime.ContextItem{
		Capability:  strings.TrimSpace(optionalStringFromAny(payload["capability"])),
		CompactText: strings.TrimSpace(optionalStringFromAny(payload["compact_text"])),
		MemoryID:    strings.TrimSpace(optionalStringFromAny(payload["memory_id"])),
		MemoryType:  strings.TrimSpace(optionalStringFromAny(payload["memory_type"])),
		Score:       point.Score,
		UpdatedAt:   strings.TrimSpace(optionalStringFromAny(payload["updated_at"])),
	}
	return item, item.MemoryID != "" && item.CompactText != ""
}
