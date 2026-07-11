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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

type qdrantMetadataVersionResolver struct {
	httpClient        *http.Client
	initErr           error
	qdrantQueryAPIKey string
	qdrantURL         string
}

func newQdrantMetadataVersionResolver(cfg config.Config) knowledgeVersionResolver {
	qdrantURL := strings.TrimRight(strings.TrimSpace(cfg.QdrantURL), "/")
	if qdrantURL == "" || strings.TrimSpace(cfg.QdrantQueryAPIKey) == "" {
		return qdrantMetadataVersionResolver{}
	}
	timeout := time.Duration(cfg.QdrantTimeoutSeconds * float64(time.Second))
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	parsedQdrantURL, err := url.ParseRequestURI(qdrantURL)
	if err != nil {
		return qdrantMetadataVersionResolver{initErr: fmt.Errorf("QDRANT_URL must be a valid http(s) URL: %w", err)}
	}
	if parsedQdrantURL.Scheme != "http" && parsedQdrantURL.Scheme != "https" {
		return qdrantMetadataVersionResolver{initErr: errors.New("QDRANT_URL must use http or https")}
	}
	if parsedQdrantURL.Scheme == "http" && strings.TrimSpace(cfg.RuntimeMode) != "local" {
		return qdrantMetadataVersionResolver{initErr: errors.New("QDRANT_URL must use https for authenticated Qdrant data-plane")}
	}
	httpClient, err := qdrantHTTPClient(parsedQdrantURL.Scheme, timeout, cfg.QdrantTLSCACertPath)
	if err != nil {
		return qdrantMetadataVersionResolver{initErr: err}
	}
	return qdrantMetadataVersionResolver{
		httpClient:        httpClient,
		qdrantQueryAPIKey: strings.TrimSpace(cfg.QdrantQueryAPIKey),
		qdrantURL:         qdrantURL,
	}
}

func (resolver qdrantMetadataVersionResolver) ResolveKnowledgeVersion(
	ctx context.Context,
	request retrievalruntime.SearchRequest,
) (retrievalruntime.ResolvedVersion, error) {
	if strings.TrimSpace(request.VersionQuery.Mode) == "current" {
		return retrievalruntime.ResolveSearchVersion(request, nil)
	}
	records, err := resolver.versionRecords(ctx, request)
	if err != nil {
		return retrievalruntime.ResolvedVersion{}, err
	}
	return retrievalruntime.ResolveSearchVersion(request, records)
}

func (resolver qdrantMetadataVersionResolver) versionRecords(
	ctx context.Context,
	request retrievalruntime.SearchRequest,
) ([]retrievalruntime.VersionRecord, error) {
	if resolver.initErr != nil {
		return nil, resolver.initErr
	}
	if resolver.httpClient == nil || resolver.qdrantURL == "" || resolver.qdrantQueryAPIKey == "" {
		return nil, errors.New("knowledge version registry is not configured")
	}
	collection := strings.TrimSpace(request.CollectionAlias)
	if collection == "" {
		profile, err := retrievalruntime.LoadServingConfig("", request.Corpus, request.Collection)
		if err != nil {
			return nil, err
		}
		collection = profile.QdrantAliasName
	}
	metadata, err := resolver.readQdrantCollectionMetadata(ctx, collection)
	if err != nil {
		return nil, err
	}
	records, err := knowledgeVersionRecordsFromMetadata(metadata)
	if err != nil || len(records) > 0 {
		return records, err
	}
	samples, err := resolver.readQdrantVersionRecordSamples(ctx, collection)
	if err != nil {
		return nil, err
	}
	records, err = knowledgeVersionRecordsFromSamples(samples)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, errors.New("knowledge version registry has no version records")
	}
	return records, nil
}

func (resolver qdrantMetadataVersionResolver) readQdrantCollectionMetadata(
	ctx context.Context,
	collectionName string,
) (map[string]any, error) {
	endpoint := resolver.qdrantURL + "/collections/" + url.PathEscape(collectionName)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("api-key", resolver.qdrantQueryAPIKey)
	response, err := resolver.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("qdrant collection metadata status %d", response.StatusCode)
	}
	var payload struct {
		Result struct {
			Metadata map[string]any `json:"metadata"`
			Payload  map[string]any `json:"payload"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant collection metadata response: %w", err)
	}
	if len(payload.Result.Metadata) > 0 {
		return payload.Result.Metadata, nil
	}
	return payload.Result.Payload, nil
}

func (resolver qdrantMetadataVersionResolver) readQdrantVersionRecordSamples(
	ctx context.Context,
	collectionName string,
) ([]map[string]any, error) {
	body, err := json.Marshal(map[string]any{
		"limit":        64,
		"with_payload": true,
		"with_vector":  false,
	})
	if err != nil {
		return nil, err
	}
	endpoint := resolver.qdrantURL + "/collections/" + url.PathEscape(collectionName) + "/points/scroll"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("api-key", resolver.qdrantQueryAPIKey)
	request.Header.Set("content-type", "application/json")
	response, err := resolver.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("qdrant version registry scroll status %d", response.StatusCode)
	}
	var payload struct {
		Result struct {
			Points []qdrantPoint `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant version registry response: %w", err)
	}
	result := make([]map[string]any, 0, len(payload.Result.Points))
	for _, point := range payload.Result.Points {
		if len(point.Payload) > 0 {
			result = append(result, point.Payload)
		}
	}
	return result, nil
}

func knowledgeVersionRecordsFromMetadata(metadata map[string]any) ([]retrievalruntime.VersionRecord, error) {
	rawRecords, exists := metadata["version_records"]
	if !exists {
		return nil, nil
	}
	encoded, err := json.Marshal(rawRecords)
	if err != nil {
		return nil, err
	}
	var records []retrievalruntime.VersionRecord
	if err := json.Unmarshal(encoded, &records); err != nil {
		return nil, fmt.Errorf("decode version records: %w", err)
	}
	return records, nil
}

func knowledgeVersionRecordsFromSamples(samples []map[string]any) ([]retrievalruntime.VersionRecord, error) {
	byID := map[string]retrievalruntime.VersionRecord{}
	for _, sample := range samples {
		records, err := knowledgeVersionRecordsFromMetadata(sample)
		if err != nil {
			return nil, err
		}
		if len(records) == 0 {
			records = []retrievalruntime.VersionRecord{knowledgeVersionRecordFromPayload(sample)}
		}
		for _, record := range records {
			if strings.TrimSpace(record.VersionID) != "" {
				byID[record.VersionID] = record
			}
		}
	}
	result := make([]retrievalruntime.VersionRecord, 0, len(byID))
	for _, record := range byID {
		result = append(result, record)
	}
	return result, nil
}

func knowledgeVersionRecordFromPayload(payload map[string]any) retrievalruntime.VersionRecord {
	return retrievalruntime.VersionRecord{
		Collection:    firstNonEmptyText(payload["collection"]),
		Corpus:        firstNonEmptyText(payload["corpus"]),
		EffectiveFrom: firstNonEmptyText(payload["effective_from"], payload["version_effective_from"]),
		EffectiveTo:   firstNonEmptyText(payload["effective_to"], payload["version_effective_to"]),
		IsCurrent:     optionalBoolFromAny(payload["is_current"]),
		VersionID:     firstNonEmptyText(payload["version_id"]),
		Visibility:    firstNonEmptyText(payload["visibility"], payload["visibility_level"]),
	}
}
