package retrievalruntime

import (
	"path/filepath"
	"testing"
)

func TestLoadServingConfigUsesCollectionAliasAndHybridSettings(t *testing.T) {
	config, err := LoadServingConfig(
		filepath.Join("..", "..", "..", "..", "configs", "ingestion"),
		"regulations",
		"student_rules",
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
	if !config.RetrievalEnabled || !config.QueryEnabledByDefault {
		t.Fatalf("query serving flags = retrieval %v query %v, want both true", config.RetrievalEnabled, config.QueryEnabledByDefault)
	}
	if len(config.ServingVisibilityLevels) != 1 || config.ServingVisibilityLevels[0] != "public" {
		t.Fatalf("serving visibility levels = %#v, want public", config.ServingVisibilityLevels)
	}
}

func TestLoadServingConfigReadsInstitutionalServingPolicy(t *testing.T) {
	config, err := LoadServingConfig(
		filepath.Join("..", "..", "..", "..", "configs", "ingestion"),
		"regulations",
		"institutional_rules",
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

func TestLoadServingConfigAllowsIntentScopedQueryableCollections(t *testing.T) {
	config, err := LoadServingConfig(
		filepath.Join("..", "..", "..", "..", "configs", "ingestion"),
		"official_web",
		"fresh_news",
	)
	if err != nil {
		t.Fatalf("load serving config: %v", err)
	}

	if !config.RetrievalEnabled {
		t.Fatal("fresh_news must remain retrieval-enabled for policy-admitted live lookup")
	}
	if config.QueryEnabledByDefault {
		t.Fatal("fresh_news must not be a default query scope")
	}
	if config.QdrantAliasName != "official_web_fresh_news" {
		t.Fatalf("alias = %q, want official_web_fresh_news", config.QdrantAliasName)
	}
}

func TestBuildDenseQueryTextAppliesEmbeddingInstruction(t *testing.T) {
	got := BuildDenseQueryText("学生请假手续", "Given a campus policy question, retrieve relevant passages.")
	want := "Instruct: Given a campus policy question, retrieve relevant passages.\nQuery: 学生请假手续"
	if got != want {
		t.Fatalf("dense query text = %q, want %q", got, want)
	}
}
