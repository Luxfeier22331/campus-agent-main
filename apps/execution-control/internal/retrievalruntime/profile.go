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

type RuntimeProfile struct {
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
	SparsePrefetchLimit       int
	SparseVectorName          string
}

type runtimeProfilePayload struct {
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
	SparsePrefetchLimit       int      `json:"sparse_prefetch_limit"`
}

func LoadRuntimeProfile(configRoot string, corpus string, collection string) (RuntimeProfile, error) {
	root := strings.TrimSpace(configRoot)
	if root == "" {
		root = defaultRuntimeProfileRoot()
	}
	path := filepath.Join(root, strings.TrimSpace(corpus), strings.TrimSpace(collection), "runtime-profile.json")
	body, err := os.ReadFile(path)
	if err != nil {
		return RuntimeProfile{}, fmt.Errorf("read runtime profile %s/%s: %w", corpus, collection, err)
	}
	var payload runtimeProfilePayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return RuntimeProfile{}, fmt.Errorf("parse runtime profile %s/%s: %w", corpus, collection, err)
	}
	profile := RuntimeProfile{
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
		SparsePrefetchLimit:       defaultPositive(payload.SparsePrefetchLimit, DefaultSparsePrefetchLimit),
		SparseVectorName:          defaultString(payload.QdrantSparseVectorName, DefaultSparseVectorName),
	}
	if err := validateRuntimeProfile(profile, corpus, collection); err != nil {
		return RuntimeProfile{}, err
	}
	return profile, nil
}

func BuildDenseQueryText(queryText string, instruction string) string {
	query := strings.TrimSpace(queryText)
	normalizedInstruction := strings.TrimSpace(instruction)
	if normalizedInstruction == "" {
		return query
	}
	return "Instruct: " + normalizedInstruction + "\nQuery: " + query
}

func defaultRuntimeProfileRoot() string {
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

func validateRuntimeProfile(profile RuntimeProfile, corpus string, collection string) error {
	if profile.Corpus != strings.TrimSpace(corpus) || profile.Collection != strings.TrimSpace(collection) {
		return fmt.Errorf(
			"runtime profile scope mismatch: got %s/%s want %s/%s",
			profile.Corpus,
			profile.Collection,
			corpus,
			collection,
		)
	}
	if profile.ServingStage != "query_serving" {
		return fmt.Errorf("runtime profile %s/%s is not query_serving", corpus, collection)
	}
	if !profile.RetrievalEnabled {
		return fmt.Errorf("runtime profile %s/%s retrieval is disabled", corpus, collection)
	}
	if !profile.QueryEnabledByDefault {
		return fmt.Errorf("runtime profile %s/%s is not query enabled by default", corpus, collection)
	}
	if profile.QdrantAliasName == "" {
		return fmt.Errorf("runtime profile %s/%s qdrant_alias_name is required", corpus, collection)
	}
	if profile.DenseVectorName == "" || profile.SparseVectorName == "" {
		return fmt.Errorf("runtime profile %s/%s qdrant vector names are required", corpus, collection)
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
