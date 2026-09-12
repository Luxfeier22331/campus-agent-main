package outboundadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/embedding"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
)

// campusDocsEmbedder resolves the current vector-space identity before cache
// lookup. Neither Search nor the portable cache receives provider credentials.
type campusDocsEmbedder struct {
	resolver   runtimeConfigResolver
	httpClient *http.Client
	cache      *embedding.Cache
}

func (client *campusDocsEmbedder) Embed(ctx context.Context, input embedding.Request) ([]float64, error) {
	if client.resolver == nil {
		return nil, errors.New("model config resolver is not configured")
	}
	config, err := client.resolver.ResolveRuntimeConfig(ctx, "campus_docs_embedding")
	if err != nil {
		return nil, err
	}
	baseURL, err := modelconfigclient.NormalizeBaseURL(config.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("embedding provider base url: %w", err)
	}
	input.Provider, input.BaseURL, input.Model = config.Provider, baseURL, config.Model
	origin, _ := url.Parse(baseURL)
	meta := &campusdiagnostics.EmbeddingMeta{Provider: input.Provider, Model: input.Model, Dimensions: input.Dimensions, InstructionVersion: input.InstructionVersion, ServiceOrigin: origin.Scheme + "://" + origin.Host}
	campusdocs.SearchObservation(ctx).Snapshot.Embedding = meta
	ctx = embedding.WithObservation(ctx, func(o embedding.CacheObservation) {
		meta.CacheOutcome, meta.CacheWaitMs, meta.EstimatedSavedMs = o.Outcome, o.WaitMs, o.EstimatedSavedMs
	})
	return client.cache.Embed(ctx, input, &embeddingHTTPProvider{httpClient: client.httpClient, apiKey: config.APIKey})
}

type embeddingHTTPProvider struct {
	httpClient *http.Client
	apiKey     string
}

func (provider *embeddingHTTPProvider) Embed(ctx context.Context, input embedding.Request) ([]float64, error) {
	body, err := json.Marshal(map[string]any{
		"model": input.Model, "input": input.Input, "dimensions": input.Dimensions,
	})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, input.BaseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+provider.apiKey)
	request.Header.Set("content-type", "application/json")
	response, err := provider.httpClient.Do(request)
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
	// Dimension/finite checks belong to the cache's load boundary, including bypass.
	return payload.Data[0].Embedding, nil
}
