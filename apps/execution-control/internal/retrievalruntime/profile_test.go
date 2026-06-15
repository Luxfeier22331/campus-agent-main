package retrievalruntime

import (
	"path/filepath"
	"testing"
)

func TestLoadRuntimeProfileUsesCollectionAliasAndHybridSettings(t *testing.T) {
	profile, err := LoadRuntimeProfile(
		filepath.Join("..", "..", "..", "..", "configs", "ingestion"),
		"regulations",
		"student_rules",
	)
	if err != nil {
		t.Fatalf("load runtime profile: %v", err)
	}

	if profile.QdrantAliasName != "student_rules" {
		t.Fatalf("alias = %q, want student_rules", profile.QdrantAliasName)
	}
	if profile.DenseVectorName != "dense" {
		t.Fatalf("dense vector = %q, want dense", profile.DenseVectorName)
	}
	if profile.SparseVectorName != "sparse" {
		t.Fatalf("sparse vector = %q, want sparse", profile.SparseVectorName)
	}
	if profile.DensePrefetchLimit != 20 || profile.SparsePrefetchLimit != 20 {
		t.Fatalf(
			"prefetch = dense %d sparse %d, want 20/20",
			profile.DensePrefetchLimit,
			profile.SparsePrefetchLimit,
		)
	}
	if !profile.RetrievalEnabled || !profile.QueryEnabledByDefault {
		t.Fatalf("query serving flags = retrieval %v query %v, want both true", profile.RetrievalEnabled, profile.QueryEnabledByDefault)
	}
}

func TestBuildDenseQueryTextAppliesEmbeddingInstruction(t *testing.T) {
	got := BuildDenseQueryText("学生请假手续", "Given a campus policy question, retrieve relevant passages.")
	want := "Instruct: Given a campus policy question, retrieve relevant passages.\nQuery: 学生请假手续"
	if got != want {
		t.Fatalf("dense query text = %q, want %q", got, want)
	}
}
