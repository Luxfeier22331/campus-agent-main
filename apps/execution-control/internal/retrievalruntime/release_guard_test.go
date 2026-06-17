package retrievalruntime

import (
	"strings"
	"testing"
)

func TestValidateReleaseMetadataFailsClosedWhenRequiredFieldsMissing(t *testing.T) {
	err := ValidateReleaseMetadata(ReleaseGuardRequest{
		EmbeddingDimensions: 2560,
		EmbeddingModel:      "Qwen3-Embedding-4B",
		EmbeddingProvider:   "openai-compatible",
		Metadata: map[string]any{
			"index_release_id": "r20260615_student_rules",
		},
		Profile: RuntimeProfile{
			Collection:              "student_rules",
			Corpus:                  "regulations",
			DensePrefetchLimit:      20,
			DenseVectorName:         "dense",
			QdrantAliasName:         "student_rules",
			QueryEnabledByDefault:   true,
			RetrievalEnabled:        true,
			RetrievalTopK:           8,
			RRFK:                    60,
			ServingStage:            "query_serving",
			SparsePrefetchLimit:     20,
			SparseVectorName:        "sparse",
			ServingRevisionTracks:   []string{"current-effective", "source-faithful"},
			DocumentSupportLimit:    24,
			DocumentSupportStrategy: "targeted_overfetch",
		},
	})
	if err == nil {
		t.Fatal("query-serving release metadata with missing guard fields must fail closed")
	}
	if !strings.Contains(err.Error(), "missing release metadata fields") ||
		!strings.Contains(err.Error(), "profile_identity_hash") ||
		!strings.Contains(err.Error(), "quality_gate_status") {
		t.Fatalf("error = %v, want missing release metadata field diagnostics", err)
	}
}

func TestValidateReleaseMetadataAcceptsMatchingPassedMetadata(t *testing.T) {
	profile := RuntimeProfile{
		Collection:                "student_rules",
		Corpus:                    "regulations",
		DensePrefetchLimit:        20,
		DenseVectorName:           "dense",
		EmbeddingQueryInstruction: "Given a campus policy or handbook question, retrieve relevant passages that answer the query.",
		QdrantAliasName:           "student_rules",
		QueryEnabledByDefault:     true,
		RetrievalEnabled:          true,
		RetrievalTopK:             8,
		RRFDenseWeight:            1.0,
		RRFK:                      60,
		RRFSparseWeight:           1.0,
		ServingStage:              "query_serving",
		SparsePrefetchLimit:       20,
		SparseVectorName:          "sparse",
		ServingRevisionTracks:     []string{"current-effective", "source-faithful"},
		DocumentSupportLimit:      24,
		DocumentSupportStrategy:   "targeted_overfetch",
	}
	request := ReleaseGuardRequest{
		EmbeddingDimensions: 2560,
		EmbeddingModel:      "Qwen3-Embedding-4B",
		EmbeddingProvider:   "openai-compatible",
		Metadata: map[string]any{
			"chunk_quality_status":                "passed",
			"chunk_policy_version":                profile.ChunkPolicyVersion,
			"cleaning_policy_version":             profile.CleaningPolicyVersion,
			"component_eval_status":               "passed",
			"dense_prefetch_limit":                20,
			"dense_vector_name":                   "dense",
			"embedding_dimensions":                2560,
			"embedding_model":                     "Qwen3-Embedding-4B",
			"embedding_provider":                  "openai-compatible",
			"embedding_query_instruction_hash":    HashText(profile.EmbeddingQueryInstruction),
			"index_release_id":                    "r20260615_student_rules",
			"index_validation_status":             "passed",
			"profile_identity_hash":               ProfileIdentityHash(profile, "openai-compatible", "Qwen3-Embedding-4B", 2560),
			"qrels_coverage_status":               "passed",
			"quality_gate_status":                 "passed",
			"release_admission_status":            "passed",
			"release_metadata_consistency_status": "passed",
			"rrf_dense_weight":                    1.0,
			"rrf_k":                               60,
			"rrf_sparse_weight":                   1.0,
			"sparse_language":                     "none",
			"sparse_model":                        "qdrant/bm25",
			"sparse_provider":                     "qdrant",
			"sparse_prefetch_limit":               20,
			"sparse_tokenizer":                    "multilingual",
			"sparse_vector_name":                  "sparse",
		},
		Profile: profile,
	}
	if err := ValidateReleaseMetadata(request); err != nil {
		t.Fatalf("validate release metadata: %v", err)
	}
}

func TestValidateReleaseMetadataFailsClosedOnProfileIdentityDrift(t *testing.T) {
	profile := RuntimeProfile{
		Collection:            "curriculum_plan",
		Corpus:                "curriculum",
		DensePrefetchLimit:    20,
		DenseVectorName:       "dense",
		QdrantAliasName:       "curriculum_plan",
		QueryEnabledByDefault: true,
		RetrievalEnabled:      true,
		RetrievalTopK:         5,
		RRFDenseWeight:        1.0,
		RRFK:                  60,
		RRFSparseWeight:       1.0,
		ServingStage:          "query_serving",
		SparsePrefetchLimit:   20,
		SparseVectorName:      "sparse",
	}
	err := ValidateReleaseMetadata(ReleaseGuardRequest{
		EmbeddingDimensions: 2560,
		EmbeddingModel:      "Qwen3-Embedding-4B",
		EmbeddingProvider:   "openai-compatible",
		Metadata: map[string]any{
			"chunk_quality_status":                "passed",
			"chunk_policy_version":                profile.ChunkPolicyVersion,
			"cleaning_policy_version":             profile.CleaningPolicyVersion,
			"dense_prefetch_limit":                20,
			"dense_vector_name":                   "dense",
			"embedding_dimensions":                2560,
			"embedding_model":                     "Qwen3-Embedding-4B",
			"embedding_provider":                  "openai-compatible",
			"embedding_query_instruction_hash":    HashText(profile.EmbeddingQueryInstruction),
			"index_release_id":                    "r20260615_curriculum_plan",
			"index_validation_status":             "passed",
			"profile_identity_hash":               "stale-profile-identity",
			"qrels_coverage_status":               "passed",
			"quality_gate_status":                 "passed",
			"release_metadata_consistency_status": "passed",
			"rrf_dense_weight":                    1.0,
			"rrf_k":                               60,
			"rrf_sparse_weight":                   1.0,
			"sparse_language":                     "none",
			"sparse_model":                        "qdrant/bm25",
			"sparse_prefetch_limit":               20,
			"sparse_provider":                     "qdrant",
			"sparse_tokenizer":                    "multilingual",
			"sparse_vector_name":                  "sparse",
		},
		Profile: profile,
	})
	if err == nil {
		t.Fatal("profile identity drift must fail closed")
	}
	if !strings.Contains(err.Error(), "profile_identity_hash") {
		t.Fatalf("error = %v, want profile_identity_hash diagnostic", err)
	}
}

func TestValidateReleaseMetadataSamplesRejectsInconsistentReleaseMetadata(t *testing.T) {
	profile := RuntimeProfile{
		ChunkPolicyVersion:        "student_rules_semantic_v3",
		CleaningPolicyVersion:     "student_rules_cleaning_v1",
		Collection:                "student_rules",
		Corpus:                    "regulations",
		DensePrefetchLimit:        20,
		DenseVectorName:           "dense",
		EmbeddingQueryInstruction: "Given a campus policy or handbook question, retrieve relevant passages that answer the query.",
		QdrantAliasName:           "student_rules",
		QueryEnabledByDefault:     true,
		RetrievalEnabled:          true,
		RetrievalTopK:             8,
		RRFDenseWeight:            1.0,
		RRFK:                      60,
		RRFSparseWeight:           1.0,
		ServingStage:              "query_serving",
		SparsePrefetchLimit:       20,
		SparseVectorName:          "sparse",
	}
	first := releaseMetadataFixtureForTest(profile, "r20260615_student_rules")
	second := releaseMetadataFixtureForTest(profile, "r20260615_student_rules")
	second["profile_identity_hash"] = "stale-profile-identity"
	err := ValidateReleaseMetadataSamples(ReleaseGuardSamplesRequest{
		EmbeddingDimensions: 2560,
		EmbeddingModel:      "Qwen3-Embedding-4B",
		EmbeddingProvider:   "openai-compatible",
		MetadataSamples:     []map[string]any{first, second},
		Profile:             profile,
	})
	if err == nil {
		t.Fatal("inconsistent release metadata samples must fail closed")
	}
	if !strings.Contains(err.Error(), "sample 2") || !strings.Contains(err.Error(), "profile_identity_hash") {
		t.Fatalf("error = %v, want sample profile_identity_hash diagnostic", err)
	}
}

func TestProfileIdentityHashMatchesPythonReleaseGuardReference(t *testing.T) {
	profile := RuntimeProfile{
		ChunkPolicyVersion:        "student_rules_semantic_v3",
		CleaningPolicyVersion:     "student_rules_cleaning_v1",
		Collection:                "student_rules",
		Corpus:                    "regulations",
		DensePrefetchLimit:        20,
		DenseVectorName:           "dense",
		EmbeddingQueryInstruction: "Given a campus policy or handbook question, retrieve relevant passages that answer the query.",
		QueryEnabledByDefault:     true,
		RRFDenseWeight:            1.0,
		RRFK:                      60,
		RRFSparseWeight:           1.0,
		ServingStage:              "query_serving",
		SparsePrefetchLimit:       20,
		SparseVectorName:          "sparse",
	}
	got := ProfileIdentityHash(profile, "openai-compatible", "Qwen3-Embedding-4B", 2560)
	want := "017046b6b1ce90b45be2d26a6d83169c02c0d8a95f9fc707befd16b24d18df6d"
	if got != want {
		t.Fatalf("profile identity hash = %s, want %s", got, want)
	}
}

func releaseMetadataFixtureForTest(profile RuntimeProfile, releaseID string) map[string]any {
	return map[string]any{
		"chunk_policy_version":                profile.ChunkPolicyVersion,
		"chunk_quality_status":                "passed",
		"cleaning_policy_version":             profile.CleaningPolicyVersion,
		"component_eval_status":               "passed",
		"dense_prefetch_limit":                profile.DensePrefetchLimit,
		"dense_vector_name":                   profile.DenseVectorName,
		"embedding_dimensions":                2560,
		"embedding_model":                     "Qwen3-Embedding-4B",
		"embedding_provider":                  "openai-compatible",
		"embedding_query_instruction_hash":    HashText(profile.EmbeddingQueryInstruction),
		"index_release_id":                    releaseID,
		"index_validation_status":             "passed",
		"profile_identity_hash":               ProfileIdentityHash(profile, "openai-compatible", "Qwen3-Embedding-4B", 2560),
		"qrels_coverage_status":               "passed",
		"quality_gate_status":                 "passed",
		"release_admission_status":            "passed",
		"release_metadata_consistency_status": "passed",
		"rrf_dense_weight":                    profile.RRFDenseWeight,
		"rrf_k":                               profile.RRFK,
		"rrf_sparse_weight":                   profile.RRFSparseWeight,
		"sparse_language":                     "none",
		"sparse_model":                        "qdrant/bm25",
		"sparse_prefetch_limit":               profile.SparsePrefetchLimit,
		"sparse_provider":                     "qdrant",
		"sparse_tokenizer":                    "multilingual",
		"sparse_vector_name":                  profile.SparseVectorName,
	}
}
