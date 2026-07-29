package httpapi

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func knowledgeServingConfigSnapshotFromRuntime(
	config retrievalruntime.ServingConfig,
) temporalruntime.KnowledgeServingConfigSnapshot {
	return temporalruntime.KnowledgeServingConfigSnapshot{
		Collection:                config.Collection,
		Corpus:                    config.Corpus,
		DensePrefetchLimit:        config.DensePrefetchLimit,
		DenseVectorName:           config.DenseVectorName,
		EmbeddingQueryInstruction: config.EmbeddingQueryInstruction,
		EmbeddingDimensions:       config.EmbeddingDimensions,
		EmbeddingModel:            config.EmbeddingModel,
		EmbeddingProvider:         config.EmbeddingProvider,
		EmbeddingVectorName:       config.EmbeddingVectorName,
		RetrievalEnabled:          config.RetrievalEnabled,
		ServingRevisionTracks:     append([]string{}, config.ServingRevisionTracks...),
		ServingStage:              config.ServingStage,
		ServingVisibilityLevels:   append([]string{}, config.ServingVisibilityLevels...),
		ServingVisibilityScopes:   append([]string{}, config.ServingVisibilityScopes...),
		SparsePrefetchLimit:       config.SparsePrefetchLimit,
		SparseVectorName:          config.SparseVectorName,
	}
}

func knowledgeServingConfigFromSnapshot(
	snapshot temporalruntime.KnowledgeServingConfigSnapshot,
) retrievalruntime.ServingConfig {
	return retrievalruntime.ServingConfig{
		Collection:                snapshot.Collection,
		Corpus:                    snapshot.Corpus,
		DensePrefetchLimit:        snapshot.DensePrefetchLimit,
		DenseVectorName:           snapshot.DenseVectorName,
		EmbeddingQueryInstruction: snapshot.EmbeddingQueryInstruction,
		EmbeddingDimensions:       snapshot.EmbeddingDimensions,
		EmbeddingModel:            snapshot.EmbeddingModel,
		EmbeddingProvider:         snapshot.EmbeddingProvider,
		EmbeddingVectorName:       snapshot.EmbeddingVectorName,
		RetrievalEnabled:          snapshot.RetrievalEnabled,
		ServingRevisionTracks:     append([]string{}, snapshot.ServingRevisionTracks...),
		ServingStage:              snapshot.ServingStage,
		ServingVisibilityLevels:   append([]string{}, snapshot.ServingVisibilityLevels...),
		ServingVisibilityScopes:   append([]string{}, snapshot.ServingVisibilityScopes...),
		SparsePrefetchLimit:       snapshot.SparsePrefetchLimit,
		SparseVectorName:          snapshot.SparseVectorName,
	}
}

func validateDocumentScopeAdmission(target temporalruntime.DocumentScope) error {
	if strings.TrimSpace(target.Scope) == "" || target.Scope != strings.TrimSpace(target.Scope) ||
		strings.TrimSpace(target.Corpus) == "" || target.Corpus != strings.TrimSpace(target.Corpus) ||
		strings.TrimSpace(target.Description) == "" || target.Description != strings.TrimSpace(target.Description) ||
		strings.TrimSpace(target.Collection) == "" || target.Collection != strings.TrimSpace(target.Collection) ||
		len([]rune(target.Scope)) > 256 || len([]rune(target.Description)) > 512 {
		return errors.New("document scope identity is invalid")
	}
	if strings.TrimSpace(target.ReleaseID) == "" || target.ReleaseID != strings.TrimSpace(target.ReleaseID) ||
		strings.TrimSpace(target.QdrantCollection) == "" ||
		target.QdrantCollection != strings.TrimSpace(target.QdrantCollection) {
		return errors.New("document scope release identity is invalid")
	}
	path := filepath.ToSlash(filepath.Clean(strings.TrimSpace(target.ServingConfigPath)))
	if path != target.ServingConfigPath || filepath.IsAbs(path) || filepath.Base(path) != "serving-config.json" ||
		strings.Contains(path, "..") {
		return errors.New("document scope serving config path is invalid")
	}
	if target.CandidateTopK <= 0 || target.CandidateTopK > 20 {
		return errors.New("document scope candidate_top_k is invalid")
	}
	if target.MaxEvidenceSections <= 0 || target.MaxEvidenceSections > retrievalruntime.MaxSearchEvidence {
		return errors.New("document scope max_evidence_sections is invalid")
	}
	serving := target.ServingConfig
	if target.ServingConfigSHA256 == "" || !lowercaseSHA256Pattern.MatchString(target.ServingConfigSHA256) ||
		hashAdmissionJSON(serving) != target.ServingConfigSHA256 {
		return errors.New("document scope serving config hash mismatch")
	}
	if serving.Collection != target.Collection || strings.TrimSpace(serving.Corpus) == "" ||
		serving.ServingStage != "query_serving" ||
		!serving.RetrievalEnabled || serving.DensePrefetchLimit <= 0 || serving.SparsePrefetchLimit <= 0 ||
		strings.TrimSpace(serving.DenseVectorName) == "" || strings.TrimSpace(serving.SparseVectorName) == "" ||
		strings.TrimSpace(serving.EmbeddingProvider) == "" || strings.TrimSpace(serving.EmbeddingModel) == "" ||
		serving.EmbeddingDimensions <= 0 || serving.EmbeddingVectorName != serving.DenseVectorName ||
		len(serving.ServingVisibilityLevels) == 0 {
		return errors.New("document scope serving config is invalid")
	}
	return nil
}

func documentScopesAgentPayload(targets []temporalruntime.DocumentScope) []map[string]any {
	if len(targets) == 0 {
		return nil
	}
	payload := make([]map[string]any, 0, len(targets))
	for _, target := range targets {
		payload = append(payload, map[string]any{
			"description": target.Description,
			"scope":       target.Scope,
		})
	}
	return payload
}

func documentScopesAdmissionProjectionPayload(
	targets []temporalruntime.DocumentScope,
) []map[string]any {
	if len(targets) == 0 {
		return nil
	}
	payload := make([]map[string]any, 0, len(targets))
	for _, target := range targets {
		payload = append(payload, map[string]any{
			"candidate_top_k":       target.CandidateTopK,
			"collection":            target.Collection,
			"corpus":                target.Corpus,
			"description":           target.Description,
			"max_evidence_sections": target.MaxEvidenceSections,
			"qdrant_collection":     target.QdrantCollection,
			"release_id":            target.ReleaseID,
			"serving_config":        knowledgeServingConfigSnapshotMap(target.ServingConfig),
			"serving_config_path":   target.ServingConfigPath,
			"serving_config_sha256": target.ServingConfigSHA256,
			"scope":                 target.Scope,
		})
	}
	return payload
}

func knowledgeServingConfigSnapshotMap(
	snapshot temporalruntime.KnowledgeServingConfigSnapshot,
) map[string]any {
	return map[string]any{
		"collection":                  snapshot.Collection,
		"corpus":                      snapshot.Corpus,
		"dense_prefetch_limit":        snapshot.DensePrefetchLimit,
		"dense_vector_name":           snapshot.DenseVectorName,
		"embedding_dimensions":        snapshot.EmbeddingDimensions,
		"embedding_model":             snapshot.EmbeddingModel,
		"embedding_provider":          snapshot.EmbeddingProvider,
		"embedding_query_instruction": snapshot.EmbeddingQueryInstruction,
		"embedding_vector_name":       snapshot.EmbeddingVectorName,
		"retrieval_enabled":           snapshot.RetrievalEnabled,
		"serving_revision_tracks":     append([]string{}, snapshot.ServingRevisionTracks...),
		"serving_stage":               snapshot.ServingStage,
		"serving_visibility_levels":   append([]string{}, snapshot.ServingVisibilityLevels...),
		"serving_visibility_scopes":   append([]string{}, snapshot.ServingVisibilityScopes...),
		"sparse_prefetch_limit":       snapshot.SparsePrefetchLimit,
		"sparse_vector_name":          snapshot.SparseVectorName,
	}
}

func documentScopeAdmissionFromProjection(
	value any,
	wantTarget string,
) (temporalruntime.DocumentScope, error) {
	for _, raw := range anyListFromProjection(value) {
		item := cloneAnyMapFromMetadata(raw)
		if strings.TrimSpace(stringValue(item["scope"])) != strings.TrimSpace(wantTarget) {
			continue
		}
		serving := cloneAnyMapFromMetadata(item["serving_config"])
		target := temporalruntime.DocumentScope{
			CandidateTopK:       intFromAny(item["candidate_top_k"]),
			Collection:          strings.TrimSpace(stringValue(item["collection"])),
			Corpus:              strings.TrimSpace(stringValue(item["corpus"])),
			Description:         strings.TrimSpace(stringValue(item["description"])),
			MaxEvidenceSections: intFromAny(item["max_evidence_sections"]),
			QdrantCollection:    strings.TrimSpace(stringValue(item["qdrant_collection"])),
			ReleaseID:           strings.TrimSpace(stringValue(item["release_id"])),
			ServingConfigPath:   strings.TrimSpace(stringValue(item["serving_config_path"])),
			ServingConfigSHA256: strings.TrimSpace(stringValue(item["serving_config_sha256"])),
			Scope:               strings.TrimSpace(stringValue(item["scope"])),
			ServingConfig: temporalruntime.KnowledgeServingConfigSnapshot{
				Collection:                strings.TrimSpace(stringValue(serving["collection"])),
				Corpus:                    strings.TrimSpace(stringValue(serving["corpus"])),
				DensePrefetchLimit:        intFromAny(serving["dense_prefetch_limit"]),
				DenseVectorName:           strings.TrimSpace(stringValue(serving["dense_vector_name"])),
				EmbeddingDimensions:       intFromAny(serving["embedding_dimensions"]),
				EmbeddingModel:            strings.TrimSpace(stringValue(serving["embedding_model"])),
				EmbeddingProvider:         strings.TrimSpace(stringValue(serving["embedding_provider"])),
				EmbeddingQueryInstruction: strings.TrimSpace(stringValue(serving["embedding_query_instruction"])),
				EmbeddingVectorName:       strings.TrimSpace(stringValue(serving["embedding_vector_name"])),
				RetrievalEnabled:          optionalBoolFromAny(serving["retrieval_enabled"]),
				ServingRevisionTracks:     stringSliceFromAny(serving["serving_revision_tracks"]),
				ServingStage:              strings.TrimSpace(stringValue(serving["serving_stage"])),
				ServingVisibilityLevels:   stringSliceFromAny(serving["serving_visibility_levels"]),
				ServingVisibilityScopes:   stringSliceFromAny(serving["serving_visibility_scopes"]),
				SparsePrefetchLimit:       intFromAny(serving["sparse_prefetch_limit"]),
				SparseVectorName:          strings.TrimSpace(stringValue(serving["sparse_vector_name"])),
			},
		}
		if err := validateDocumentScopeAdmission(target); err != nil {
			return temporalruntime.DocumentScope{}, err
		}
		return target, nil
	}
	return temporalruntime.DocumentScope{}, fmt.Errorf(
		"document scope %s is not in the admitted scope snapshot",
		strings.TrimSpace(wantTarget),
	)
}

func anyListFromProjection(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	default:
		return nil
	}
}
