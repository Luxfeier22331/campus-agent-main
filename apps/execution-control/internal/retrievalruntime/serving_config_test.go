package retrievalruntime

import (
	"path/filepath"
	"testing"
)

func TestLoadServingConfigUsesCollectionAliasAndHybridSettings(t *testing.T) {
	config, err := LoadServingConfigPath(
		filepath.Join("..", "..", "..", "..", "configs", "ingestion"),
		filepath.Join("regulations", "student_rules", "serving-config.json"),
	)
	if err != nil {
		t.Fatalf("load serving config: %v", err)
	}

	if config.QdrantAliasName != "student_rules" {
		t.Fatalf("alias = %q, want student_rules", config.QdrantAliasName)
	}
	if config.DenseVectorName != "dense" {
		t.Fatalf("dense vector = %q, want dense", config.DenseVectorName)
	}
	if config.SparseVectorName != "sparse" {
		t.Fatalf("sparse vector = %q, want sparse", config.SparseVectorName)
	}
	if config.DensePrefetchLimit != 20 || config.SparsePrefetchLimit != 20 {
		t.Fatalf(
			"prefetch = dense %d sparse %d, want 20/20",
			config.DensePrefetchLimit,
			config.SparsePrefetchLimit,
		)
	}
	if config.EmbeddingProvider != "openai-compatible" ||
		config.EmbeddingModel != "Qwen3-Embedding-4B" ||
		config.EmbeddingDimensions != 2560 ||
		config.EmbeddingVectorName != "dense" {
		t.Fatalf("embedding profile = %#v", config)
	}
	if !config.RetrievalEnabled {
		t.Fatal("retrieval must be enabled")
	}
	if len(config.ServingVisibilityLevels) != 1 || config.ServingVisibilityLevels[0] != "public" {
		t.Fatalf("serving visibility levels = %#v, want public", config.ServingVisibilityLevels)
	}
}

func TestLoadServingConfigReadsInstitutionalServingPolicy(t *testing.T) {
	config, err := LoadServingConfigPath(
		filepath.Join("..", "..", "..", "..", "configs", "ingestion"),
		filepath.Join("regulations", "institutional_rules", "serving-config.json"),
	)
	if err != nil {
		t.Fatalf("load serving config: %v", err)
	}

	if len(config.ServingVisibilityLevels) != 2 ||
		config.ServingVisibilityLevels[0] != "public" ||
		config.ServingVisibilityLevels[1] != "restricted" {
		t.Fatalf("serving visibility levels = %#v, want public + restricted", config.ServingVisibilityLevels)
	}
	if len(config.ServingVisibilityScopes) != 1 || config.ServingVisibilityScopes[0] != "campus" {
		t.Fatalf("serving visibility scopes = %#v, want campus", config.ServingVisibilityScopes)
	}
}

func TestLoadServingConfigRejectsUnpublishedOfficialWebCollections(t *testing.T) {
	_, err := LoadServingConfigPath(
		filepath.Join("..", "..", "..", "..", "configs", "ingestion"),
		filepath.Join("official_web", "fresh_news", "serving-config.json"),
	)
	if err == nil {
		t.Fatal("fresh_news must not load as query-serving before official-web RAG publish is complete")
	}
}

func TestBuildDenseQueryTextAppliesEmbeddingInstruction(t *testing.T) {
	got := BuildDenseQueryText("学生请假手续", "Given a campus policy question, retrieve relevant passages.")
	want := "Instruct: Given a campus policy question, retrieve relevant passages.\nQuery: 学生请假手续"
	if got != want {
		t.Fatalf("dense query text = %q, want %q", got, want)
	}
}
