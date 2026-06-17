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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

type ragVersionResolver interface {
	ResolveRAGVersionQuery(
		context.Context,
		ragruntime.PlanProjection,
	) (ragruntime.ResolvedVersionQueryProjection, error)
}

type qdrantMetadataVersionResolver struct {
	httpClient        *http.Client
	initErr           error
	qdrantQueryAPIKey string
	qdrantURL         string
}

func newQdrantMetadataVersionResolver(cfg config.Config) ragVersionResolver {
	qdrantURL := strings.TrimRight(strings.TrimSpace(cfg.QdrantURL), "/")
	if qdrantURL == "" || strings.TrimSpace(cfg.QdrantQueryAPIKey) == "" {
		return qdrantMetadataVersionResolver{}
	}
	timeout := time.Duration(cfg.QdrantTimeoutSeconds * float64(time.Second))
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	httpClient, err := qdrantTLSHTTPClient(timeout, cfg.QdrantTLSCACertPath)
	if err != nil {
		return qdrantMetadataVersionResolver{initErr: err}
	}
	return qdrantMetadataVersionResolver{
		httpClient:        httpClient,
		qdrantQueryAPIKey: strings.TrimSpace(cfg.QdrantQueryAPIKey),
		qdrantURL:         qdrantURL,
	}
}

func (resolver qdrantMetadataVersionResolver) versionRecords(
	ctx context.Context,
	plan ragruntime.PlanProjection,
) ([]ragruntime.VersionRecord, error) {
	if resolver.initErr != nil {
		return nil, resolver.initErr
	}
	if resolver.httpClient == nil ||
		strings.TrimSpace(resolver.qdrantURL) == "" ||
		strings.TrimSpace(resolver.qdrantQueryAPIKey) == "" {
		return nil, errors.New("rag version registry is not configured")
	}
	collection := firstNonEmptyText(plan.CollectionAlias, plan.QdrantAliasName, plan.Collection)
	if collection == "" {
		return nil, errors.New("rag version registry requires collection alias")
	}
	metadata, err := resolver.readQdrantCollectionMetadata(ctx, collection)
	if err != nil {
		return nil, err
	}
	records, err := versionRecordsFromMetadata(metadata)
	if err != nil {
		return nil, err
	}
	if len(records) > 0 {
		return records, nil
	}
	samples, err := resolver.readQdrantVersionRecordSamples(ctx, collection)
	if err != nil {
		return nil, err
	}
	records, err = versionRecordsFromMetadataSamples(samples)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, errors.New("rag version registry has no version_records")
	}
	return records, nil
}

func (resolver qdrantMetadataVersionResolver) ResolveRAGVersionQuery(
	ctx context.Context,
	plan ragruntime.PlanProjection,
) (ragruntime.ResolvedVersionQueryProjection, error) {
	if strings.TrimSpace(plan.QueryMode) == "" || strings.TrimSpace(plan.QueryMode) == "current" {
		return ragruntime.ResolveVersionQuery(plan, nil)
	}
	records, err := resolver.versionRecords(ctx, plan)
	if err != nil {
		return ragruntime.ResolvedVersionQueryProjection{}, err
	}
	return ragruntime.ResolveVersionQuery(plan, records)
}

func (resolver qdrantMetadataVersionResolver) readQdrantCollectionMetadata(
	ctx context.Context,
	collectionName string,
) (map[string]any, error) {
	endpoint := strings.TrimRight(resolver.qdrantURL, "/") + "/collections/" + url.PathEscape(collectionName)
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
	responseBody, err := io.ReadAll(response.Body)
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
	if err := json.Unmarshal(responseBody, &payload); err != nil {
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
	endpoint := strings.TrimRight(resolver.qdrantURL, "/") + "/collections/" +
		url.PathEscape(collectionName) + "/points/scroll"
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
		return nil, fmt.Errorf("parse qdrant version registry scroll response: %w", err)
	}
	samples := make([]map[string]any, 0, len(payload.Result.Points))
	for _, point := range payload.Result.Points {
		if len(point.Payload) > 0 {
			samples = append(samples, point.Payload)
		}
	}
	return samples, nil
}

func versionRecordsFromMetadata(metadata map[string]any) ([]ragruntime.VersionRecord, error) {
	if len(metadata) == 0 {
		return nil, nil
	}
	rawRecords, exists := metadata["version_records"]
	if !exists {
		return nil, nil
	}
	encoded, err := json.Marshal(rawRecords)
	if err != nil {
		return nil, fmt.Errorf("encode version_records: %w", err)
	}
	var records []ragruntime.VersionRecord
	if err := json.Unmarshal(encoded, &records); err != nil {
		return nil, fmt.Errorf("decode version_records: %w", err)
	}
	return records, nil
}

func versionRecordsFromMetadataSamples(samples []map[string]any) ([]ragruntime.VersionRecord, error) {
	recordsByID := map[string]ragruntime.VersionRecord{}
	for _, sample := range samples {
		if records, err := versionRecordsFromMetadata(sample); err != nil {
			return nil, err
		} else if len(records) > 0 {
			for _, record := range records {
				if strings.TrimSpace(record.VersionID) != "" {
					recordsByID[record.VersionID] = record
				}
			}
			continue
		}
		record := versionRecordFromPayload(sample)
		if strings.TrimSpace(record.VersionID) != "" {
			recordsByID[record.VersionID] = record
		}
	}
	records := make([]ragruntime.VersionRecord, 0, len(recordsByID))
	for _, record := range recordsByID {
		records = append(records, record)
	}
	return records, nil
}

func versionRecordFromPayload(payload map[string]any) ragruntime.VersionRecord {
	return ragruntime.VersionRecord{
		Collection:    firstNonEmptyText(payload["collection"]),
		Corpus:        firstNonEmptyText(payload["corpus"]),
		DocumentID:    firstNonEmptyText(payload["document_id"]),
		EffectiveFrom: firstNonEmptyText(payload["effective_from"], payload["version_effective_from"]),
		EffectiveTo:   firstNonEmptyText(payload["effective_to"], payload["version_effective_to"]),
		IsCurrent:     optionalBoolFromAny(payload["is_current"]),
		RevisionTrack: firstNonEmptyText(payload["revision_track"]),
		VersionID:     firstNonEmptyText(payload["version_id"]),
		VersionLabel:  firstNonEmptyText(payload["version_label"]),
		Visibility:    firstNonEmptyText(payload["visibility"], payload["visibility_level"]),
	}
}

func resolvePlanVersionQuery(
	ctx context.Context,
	resolver ragVersionResolver,
	plan ragruntime.PlanProjection,
) (ragruntime.PlanProjection, error) {
	if resolver == nil {
		resolver = qdrantMetadataVersionResolver{}
	}
	resolved, err := resolver.ResolveRAGVersionQuery(ctx, plan)
	if err != nil {
		return ragruntime.PlanProjection{}, err
	}
	plan.ResolvedVersionQuery = &resolved
	hash, err := ragruntime.HashProjection(plan)
	if err != nil {
		return ragruntime.PlanProjection{}, err
	}
	plan.PayloadSHA256 = hash
	if err := ragruntime.ValidatePlanProjection(plan); err != nil {
		return ragruntime.PlanProjection{}, err
	}
	return plan, nil
}
