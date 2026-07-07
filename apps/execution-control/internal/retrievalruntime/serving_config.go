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
	DefaultRRFK                = 60
	DefaultRetrievalTopK       = 3
	DefaultDenseVectorName     = "dense"
	DefaultSparseVectorName    = "sparse"
)

type ServingConfig struct {
	ChunkPolicyVersion        string
	CleaningPolicyVersion     string
	Collection                string
	Corpus                    string
	CurrentOnly               bool
	DensePrefetchLimit        int
	DenseVectorName           string
	DocumentSupportLimit      int
	DocumentSupportStrategy   string
	EmbeddingQueryInstruction string
	QdrantAliasName           string
	QueryEnabledByDefault     bool
	RerankerEnabledByDefault  bool
	RetrievalEnabled          bool
	RetrievalTopK             int
	RRFDenseWeight            float64
	RRFK                      int
	RRFSparseWeight           float64
	ServingRevisionTracks     []string
	ServingStage              string
	ServingVisibilityLevels   []string
	ServingVisibilityScopes   []string
	SparsePrefetchLimit       int
	SparseVectorName          string
}

type servingConfigPayload struct {
	ChunkPolicyVersion        string   `json:"chunk_profile_version"`
	CleaningPolicyVersion     string   `json:"cleaning_policy_version"`
	Collection                string   `json:"collection"`
	Corpus                    string   `json:"corpus"`
	CurrentOnly               bool     `json:"current_only"`
	DensePrefetchLimit        int      `json:"dense_prefetch_limit"`
	DocumentSupportLimit      int      `json:"document_support_limit"`
	DocumentSupportStrategy   string   `json:"document_support_strategy"`
	EmbeddingQueryInstruction string   `json:"embedding_query_instruction"`
	QdrantAliasName           string   `json:"qdrant_alias_name"`
	QdrantDenseVectorName     string   `json:"qdrant_dense_vector_name"`
	QdrantSparseVectorName    string   `json:"qdrant_sparse_vector_name"`
	QueryEnabledByDefault     bool     `json:"query_enabled_by_default"`
	RerankerEnabledByDefault  bool     `json:"reranker_enabled_by_default"`
	RetrievalEnabled          bool     `json:"retrieval_enabled"`
	RetrievalTopK             int      `json:"retrieval_top_k"`
	RRFDenseWeight            float64  `json:"rrf_dense_weight"`
	RRFK                      int      `json:"rrf_k"`
	RRFSparseWeight           float64  `json:"rrf_sparse_weight"`
	ServingRevisionTracks     []string `json:"serving_revision_tracks"`
	ServingStage              string   `json:"serving_stage"`
	ServingVisibilityLevels   []string `json:"serving_visibility_levels"`
	ServingVisibilityScopes   []string `json:"serving_visibility_scopes"`
	SparsePrefetchLimit       int      `json:"sparse_prefetch_limit"`
}

func LoadServingConfig(configRoot string, corpus string, collection string) (ServingConfig, error) {
	root := strings.TrimSpace(configRoot)
	if root == "" {
		root = defaultServingConfigRoot()
	}
	path := filepath.Join(root, strings.TrimSpace(corpus), strings.TrimSpace(collection), "serving-config.json")
	body, err := os.ReadFile(path)
	if err != nil {
		return ServingConfig{}, fmt.Errorf("read serving config %s/%s: %w", corpus, collection, err)
	}
	var payload servingConfigPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return ServingConfig{}, fmt.Errorf("parse serving config %s/%s: %w", corpus, collection, err)
	}
	config := ServingConfig{
		ChunkPolicyVersion:        strings.TrimSpace(payload.ChunkPolicyVersion),
		CleaningPolicyVersion:     strings.TrimSpace(payload.CleaningPolicyVersion),
		Collection:                strings.TrimSpace(payload.Collection),
		Corpus:                    strings.TrimSpace(payload.Corpus),
		CurrentOnly:               payload.CurrentOnly,
		DensePrefetchLimit:        defaultPositive(payload.DensePrefetchLimit, DefaultDensePrefetchLimit),
		DenseVectorName:           defaultString(payload.QdrantDenseVectorName, DefaultDenseVectorName),
		DocumentSupportLimit:      defaultPositive(payload.DocumentSupportLimit, 24),
		DocumentSupportStrategy:   defaultString(payload.DocumentSupportStrategy, "followup_query"),
		EmbeddingQueryInstruction: strings.TrimSpace(payload.EmbeddingQueryInstruction),
		QdrantAliasName:           strings.TrimSpace(payload.QdrantAliasName),
		QueryEnabledByDefault:     payload.QueryEnabledByDefault,
		RerankerEnabledByDefault:  payload.RerankerEnabledByDefault,
		RetrievalEnabled:          payload.RetrievalEnabled,
		RetrievalTopK:             defaultPositive(payload.RetrievalTopK, DefaultRetrievalTopK),
		RRFDenseWeight:            defaultPositiveFloat(payload.RRFDenseWeight, 1.0),
		RRFK:                      defaultPositive(payload.RRFK, DefaultRRFK),
		RRFSparseWeight:           defaultPositiveFloat(payload.RRFSparseWeight, 1.0),
		ServingRevisionTracks:     normalizeStringSlice(payload.ServingRevisionTracks),
		ServingStage:              strings.TrimSpace(payload.ServingStage),
		ServingVisibilityLevels:   normalizeStringSlice(payload.ServingVisibilityLevels),
		ServingVisibilityScopes:   normalizeStringSlice(payload.ServingVisibilityScopes),
		SparsePrefetchLimit:       defaultPositive(payload.SparsePrefetchLimit, DefaultSparsePrefetchLimit),
		SparseVectorName:          defaultString(payload.QdrantSparseVectorName, DefaultSparseVectorName),
	}
	if err := validateServingConfig(config, corpus, collection); err != nil {
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

func validateServingConfig(config ServingConfig, corpus string, collection string) error {
	if config.Corpus != strings.TrimSpace(corpus) || config.Collection != strings.TrimSpace(collection) {
		return fmt.Errorf(
			"serving config scope mismatch: got %s/%s want %s/%s",
			config.Corpus,
			config.Collection,
			corpus,
			collection,
		)
	}
	if config.ServingStage != "query_serving" {
		return fmt.Errorf("serving config %s/%s is not query_serving", corpus, collection)
	}
	if !config.RetrievalEnabled {
		return fmt.Errorf("serving config %s/%s retrieval is disabled", corpus, collection)
	}
	if config.QdrantAliasName == "" {
		return fmt.Errorf("serving config %s/%s qdrant_alias_name is required", corpus, collection)
	}
	if config.DenseVectorName == "" || config.SparseVectorName == "" {
		return fmt.Errorf("serving config %s/%s qdrant vector names are required", corpus, collection)
	}
	if len(config.ServingVisibilityLevels) == 0 {
		return fmt.Errorf("serving config %s/%s serving_visibility_levels is required", corpus, collection)
	}
	for _, level := range config.ServingVisibilityLevels {
		switch level {
		case "public", "restricted":
		default:
			return fmt.Errorf("serving config %s/%s has unsupported serving visibility level %q", corpus, collection, level)
		}
	}
	if containsString(config.ServingVisibilityLevels, "restricted") && len(config.ServingVisibilityScopes) == 0 {
		return fmt.Errorf("serving config %s/%s serving_visibility_scopes is required for restricted visibility", corpus, collection)
	}
	return nil
}

func defaultPositive(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func defaultPositiveFloat(value float64, fallback float64) float64 {
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
