package retrievalruntime

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultDensePrefetchLimit  = 20
	DefaultSparsePrefetchLimit = 20
	DefaultDenseVectorName     = "dense"
	DefaultSparseVectorName    = "sparse"
)

type ServingConfig struct {
	Collection                string
	Corpus                    string
	DensePrefetchLimit        int
	DenseVectorName           string
	EmbeddingQueryInstruction string
	EmbeddingDimensions       int
	EmbeddingModel            string
	EmbeddingProvider         string
	EmbeddingVectorName       string
	RetrievalEnabled          bool
	ServingRevisionTracks     []string
	ServingStage              string
	ServingVisibilityLevels   []string
	ServingVisibilityScopes   []string
	SparsePrefetchLimit       int
	SparseVectorName          string
}

type servingConfigPayload struct {
	Collection                string `json:"collection"`
	Corpus                    string `json:"corpus"`
	DensePrefetchLimit        int    `json:"dense_prefetch_limit"`
	EmbeddingQueryInstruction string `json:"embedding_query_instruction"`
	EmbeddingProfile          struct {
		DenseVectorName string `json:"dense_vector_name"`
		Dimensions      int    `json:"dimensions"`
		Model           string `json:"model"`
		Provider        string `json:"provider"`
	} `json:"embedding_profile"`
	QdrantDenseVectorName   string   `json:"qdrant_dense_vector_name"`
	QdrantSparseVectorName  string   `json:"qdrant_sparse_vector_name"`
	RetrievalEnabled        bool     `json:"retrieval_enabled"`
	ServingRevisionTracks   []string `json:"serving_revision_tracks"`
	ServingStage            string   `json:"serving_stage"`
	ServingVisibilityLevels []string `json:"serving_visibility_levels"`
	ServingVisibilityScopes []string `json:"serving_visibility_scopes"`
	SparsePrefetchLimit     int      `json:"sparse_prefetch_limit"`
}

func LoadServingConfigPath(configRoot string, relativePath string) (ServingConfig, error) {
	root := strings.TrimSpace(configRoot)
	if root == "" {
		root = defaultServingConfigRoot()
	}
	relativePath = filepath.Clean(strings.TrimSpace(relativePath))
	if relativePath == "." || filepath.IsAbs(relativePath) || strings.Contains(relativePath, "..") {
		return ServingConfig{}, fmt.Errorf("serving config path %q is invalid", relativePath)
	}
	path := filepath.Join(root, relativePath)
	body, err := os.ReadFile(path)
	if err != nil {
		return ServingConfig{}, fmt.Errorf("read serving config %s: %w", relativePath, err)
	}
	var payload servingConfigPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return ServingConfig{}, fmt.Errorf("parse serving config %s: %w", relativePath, err)
	}
	config := ServingConfig{
		Collection:                strings.TrimSpace(payload.Collection),
		Corpus:                    strings.TrimSpace(payload.Corpus),
		DensePrefetchLimit:        defaultPositive(payload.DensePrefetchLimit, DefaultDensePrefetchLimit),
		DenseVectorName:           defaultString(payload.QdrantDenseVectorName, DefaultDenseVectorName),
		EmbeddingQueryInstruction: strings.TrimSpace(payload.EmbeddingQueryInstruction),
		EmbeddingDimensions:       payload.EmbeddingProfile.Dimensions,
		EmbeddingModel:            strings.TrimSpace(payload.EmbeddingProfile.Model),
		EmbeddingProvider:         strings.TrimSpace(payload.EmbeddingProfile.Provider),
		EmbeddingVectorName:       strings.TrimSpace(payload.EmbeddingProfile.DenseVectorName),
		RetrievalEnabled:          payload.RetrievalEnabled,
		ServingRevisionTracks:     normalizeStringSlice(payload.ServingRevisionTracks),
		ServingStage:              strings.TrimSpace(payload.ServingStage),
		ServingVisibilityLevels:   normalizeStringSlice(payload.ServingVisibilityLevels),
		ServingVisibilityScopes:   normalizeStringSlice(payload.ServingVisibilityScopes),
		SparsePrefetchLimit:       defaultPositive(payload.SparsePrefetchLimit, DefaultSparsePrefetchLimit),
		SparseVectorName:          defaultString(payload.QdrantSparseVectorName, DefaultSparseVectorName),
	}
	if err := validateServingConfig(config, relativePath); err != nil {
		return ServingConfig{}, err
	}
	return config, nil
}

func BuildDenseQueryText(queryText string, instruction string) string {
	query := strings.TrimSpace(queryText)
	normalizedInstruction := strings.TrimSpace(instruction)
	if normalizedInstruction == "" {
		return query
	}
	return "Instruct: " + normalizedInstruction + "\nQuery: " + query
}

func defaultServingConfigRoot() string {
	for _, candidate := range []string{
		filepath.Join("configs", "ingestion"),
		filepath.Join("..", "..", "configs", "ingestion"),
		filepath.Join("..", "..", "..", "configs", "ingestion"),
		filepath.Join("..", "..", "..", "..", "configs", "ingestion"),
	} {
		if stat, err := os.Stat(candidate); err == nil && stat.IsDir() {
			return candidate
		}
	}
	return filepath.Join("configs", "ingestion")
}

func validateServingConfig(config ServingConfig, relativePath string) error {
	if config.Corpus == "" || config.Collection == "" {
		return fmt.Errorf("serving config %s corpus and collection are required", relativePath)
	}
	if config.ServingStage != "query_serving" {
		return fmt.Errorf("serving config %s is not query_serving", relativePath)
	}
	if !config.RetrievalEnabled {
		return fmt.Errorf("serving config %s retrieval is disabled", relativePath)
	}
	if config.DenseVectorName == "" || config.SparseVectorName == "" {
		return fmt.Errorf("serving config %s qdrant vector names are required", relativePath)
	}
	if config.EmbeddingProvider == "" || config.EmbeddingModel == "" || config.EmbeddingDimensions <= 0 {
		return fmt.Errorf("serving config %s embedding_profile is required", relativePath)
	}
	if config.EmbeddingVectorName != config.DenseVectorName {
		return fmt.Errorf(
			"serving config %s embedding_profile dense_vector_name must match qdrant_dense_vector_name",
			relativePath,
		)
	}
	if len(config.ServingVisibilityLevels) == 0 {
		return fmt.Errorf("serving config %s serving_visibility_levels is required", relativePath)
	}
	for _, level := range config.ServingVisibilityLevels {
		switch level {
		case "public", "restricted":
		default:
			return fmt.Errorf("serving config %s has unsupported serving visibility level %q", relativePath, level)
		}
	}
	if containsString(config.ServingVisibilityLevels, "restricted") &&
		len(config.ServingVisibilityScopes) == 0 {
		return fmt.Errorf("serving config %s serving_visibility_scopes is required", relativePath)
	}
	return nil
}

func defaultPositive(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func defaultString(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	return fallback
}

func normalizeStringSlice(values []string) []string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
