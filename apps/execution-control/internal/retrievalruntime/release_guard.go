package retrievalruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const (
	DefaultSparseProvider  = "qdrant"
	DefaultSparseModel     = "qdrant/bm25"
	DefaultSparseTokenizer = "multilingual"
	DefaultSparseLanguage  = "none"
)

var requiredReleaseMetadataFields = []string{
	"index_release_id",
	"index_validation_status",
	"embedding_provider",
	"embedding_model",
	"embedding_dimensions",
	"sparse_provider",
	"sparse_model",
	"sparse_tokenizer",
	"sparse_language",
	"cleaning_policy_version",
	"chunk_policy_version",
	"dense_vector_name",
	"sparse_vector_name",
	"dense_prefetch_limit",
	"sparse_prefetch_limit",
	"rrf_k",
	"rrf_dense_weight",
	"rrf_sparse_weight",
	"embedding_query_instruction_hash",
	"profile_identity_hash",
	"quality_gate_status",
	"chunk_quality_status",
	"qrels_coverage_status",
	"release_metadata_consistency_status",
}

var requiredRegulationReleaseMetadataFields = []string{
	"release_admission_status",
	"component_eval_status",
}

type ReleaseGuardRequest struct {
	EmbeddingDimensions int
	EmbeddingModel      string
	EmbeddingProvider   string
	Metadata            map[string]any
	Profile             RuntimeProfile
}

type ReleaseGuardSamplesRequest struct {
	EmbeddingDimensions int
	EmbeddingModel      string
	EmbeddingProvider   string
	MetadataSamples     []map[string]any
	Profile             RuntimeProfile
}

func ValidateReleaseMetadata(request ReleaseGuardRequest) error {
	if !requiresReleaseMetadata(request.Profile) {
		return nil
	}
	if len(request.Metadata) == 0 {
		return fmt.Errorf("missing release metadata for query-serving alias %s", request.Profile.QdrantAliasName)
	}
	missing := missingReleaseMetadataFields(request)
	if len(missing) > 0 {
		return fmt.Errorf("missing release metadata fields: %s", strings.Join(missing, ", "))
	}
	mismatches := releaseMetadataMismatches(request)
	if len(mismatches) > 0 {
		return fmt.Errorf(
			"release metadata drift for %s/%s: %s",
			request.Profile.QdrantAliasName,
			textFromMetadata(request.Metadata["index_release_id"]),
			strings.Join(mismatches, "; "),
		)
	}
	return nil
}

func ValidateReleaseMetadataSamples(request ReleaseGuardSamplesRequest) error {
	if !requiresReleaseMetadata(request.Profile) {
		return nil
	}
	if len(request.MetadataSamples) == 0 {
		return fmt.Errorf("missing release metadata for query-serving alias %s", request.Profile.QdrantAliasName)
	}
	for index, sample := range request.MetadataSamples {
		err := ValidateReleaseMetadata(ReleaseGuardRequest{
			EmbeddingDimensions: request.EmbeddingDimensions,
			EmbeddingModel:      request.EmbeddingModel,
			EmbeddingProvider:   request.EmbeddingProvider,
			Metadata:            sample,
			Profile:             request.Profile,
		})
		if err != nil {
			return fmt.Errorf("sample %d: %w", index+1, err)
		}
	}
	if consistencyError := releaseMetadataConsistencyError(request.MetadataSamples); consistencyError != "" {
		return fmt.Errorf("%s", consistencyError)
	}
	return nil
}

func ProfileIdentityHash(
	profile RuntimeProfile,
	embeddingProvider string,
	embeddingModel string,
	embeddingDimensions int,
) string {
	entries := []pythonReprEntry{
		{key: "chunk_policy_version", value: profile.ChunkPolicyVersion},
		{key: "cleaning_policy_version", value: profile.CleaningPolicyVersion},
		{key: "collection", value: profile.Collection},
		{key: "corpus", value: profile.Corpus},
		{key: "dense_prefetch_limit", value: profile.DensePrefetchLimit},
		{key: "dense_vector_name", value: profile.DenseVectorName},
		{key: "embedding_dimensions", value: embeddingDimensions},
		{key: "embedding_model", value: strings.TrimSpace(embeddingModel)},
		{key: "embedding_provider", value: strings.TrimSpace(embeddingProvider)},
		{key: "embedding_query_instruction_hash", value: HashText(profile.EmbeddingQueryInstruction)},
		{key: "query_enabled_by_default", value: profile.QueryEnabledByDefault},
		{key: "reranker_adoption_evidence_id", value: ""},
		{key: "reranker_enabled_by_default", value: profile.RerankerEnabledByDefault},
		{key: "reranker_profile_version", value: ""},
		{key: "reranker_top_n", value: 0},
		{key: "rrf_dense_weight", value: profile.RRFDenseWeight},
		{key: "rrf_k", value: profile.RRFK},
		{key: "rrf_sparse_weight", value: profile.RRFSparseWeight},
		{key: "serving_stage", value: profile.ServingStage},
		{key: "sparse_language", value: DefaultSparseLanguage},
		{key: "sparse_model", value: DefaultSparseModel},
		{key: "sparse_prefetch_limit", value: profile.SparsePrefetchLimit},
		{key: "sparse_provider", value: DefaultSparseProvider},
		{key: "sparse_tokenizer", value: DefaultSparseTokenizer},
		{key: "sparse_vector_name", value: profile.SparseVectorName},
	}
	sort.Slice(entries, func(left int, right int) bool {
		return entries[left].key < entries[right].key
	})
	return HashText(pythonTupleOfTuplesRepr(entries))
}

func HashText(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func missingReleaseMetadataFields(request ReleaseGuardRequest) []string {
	fields := append([]string{}, requiredReleaseMetadataFields...)
	if requiresRegulationTargetReleaseProof(request.Profile) {
		fields = append(fields, requiredRegulationReleaseMetadataFields...)
	}
	missing := make([]string, 0)
	for _, field := range fields {
		if _, ok := request.Metadata[field]; !ok {
			missing = append(missing, field)
		}
	}
	return missing
}

func releaseMetadataConsistencyError(samples []map[string]any) string {
	if len(samples) <= 1 {
		return ""
	}
	baseline := samples[0]
	fields := append([]string{}, requiredReleaseMetadataFields...)
	fields = append(fields, requiredRegulationReleaseMetadataFields...)
	mismatches := make([]string, 0)
	for index, sample := range samples[1:] {
		for _, field := range fields {
			if !metadataValuesMatch(sample[field], baseline[field]) {
				mismatches = append(mismatches, fmt.Sprintf("sample %d: inconsistent release metadata field %s", index+2, field))
			}
		}
	}
	return strings.Join(mismatches, "; ")
}

func releaseMetadataMismatches(request ReleaseGuardRequest) []string {
	expected := map[string]any{
		"chunk_quality_status":                "passed",
		"chunk_policy_version":                request.Profile.ChunkPolicyVersion,
		"cleaning_policy_version":             request.Profile.CleaningPolicyVersion,
		"dense_prefetch_limit":                request.Profile.DensePrefetchLimit,
		"dense_vector_name":                   request.Profile.DenseVectorName,
		"embedding_dimensions":                request.EmbeddingDimensions,
		"embedding_model":                     strings.TrimSpace(request.EmbeddingModel),
		"embedding_provider":                  strings.TrimSpace(request.EmbeddingProvider),
		"embedding_query_instruction_hash":    HashText(request.Profile.EmbeddingQueryInstruction),
		"index_validation_status":             "passed",
		"profile_identity_hash":               ProfileIdentityHash(request.Profile, request.EmbeddingProvider, request.EmbeddingModel, request.EmbeddingDimensions),
		"qrels_coverage_status":               "passed",
		"quality_gate_status":                 "passed",
		"release_metadata_consistency_status": "passed",
		"rrf_dense_weight":                    request.Profile.RRFDenseWeight,
		"rrf_k":                               request.Profile.RRFK,
		"rrf_sparse_weight":                   request.Profile.RRFSparseWeight,
		"sparse_language":                     DefaultSparseLanguage,
		"sparse_model":                        DefaultSparseModel,
		"sparse_prefetch_limit":               request.Profile.SparsePrefetchLimit,
		"sparse_provider":                     DefaultSparseProvider,
		"sparse_tokenizer":                    DefaultSparseTokenizer,
		"sparse_vector_name":                  request.Profile.SparseVectorName,
	}
	if requiresRegulationTargetReleaseProof(request.Profile) {
		expected["release_admission_status"] = "passed"
		expected["component_eval_status"] = "passed"
	}
	mismatches := make([]string, 0)
	keys := make([]string, 0, len(expected))
	for key := range expected {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		actual := request.Metadata[key]
		expectedValue := expected[key]
		if !metadataValuesMatch(actual, expectedValue) {
			mismatches = append(mismatches, fmt.Sprintf("%s=%s expected %s", key, metadataValueForDiagnostic(actual), metadataValueForDiagnostic(expectedValue)))
		}
	}
	return mismatches
}

func requiresReleaseMetadata(profile RuntimeProfile) bool {
	return strings.TrimSpace(profile.ServingStage) == "query_serving" || profile.QueryEnabledByDefault
}

func requiresRegulationTargetReleaseProof(profile RuntimeProfile) bool {
	return profile.Corpus == "regulations" &&
		(profile.Collection == "student_rules" || profile.Collection == "institutional_rules") &&
		requiresReleaseMetadata(profile)
}

func metadataValuesMatch(actual any, expected any) bool {
	switch expectedValue := expected.(type) {
	case int:
		return intFromMetadata(actual) == expectedValue
	case float64:
		return floatFromMetadata(actual) == expectedValue
	case bool:
		return boolFromMetadata(actual) == expectedValue
	default:
		return textFromMetadata(actual) == textFromMetadata(expected)
	}
}

func textFromMetadata(value any) string {
	return strings.TrimSpace(fmt.Sprint(value))
}

func intFromMetadata(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(typed))
		return parsed
	default:
		return 0
	}
}

func floatFromMetadata(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

func boolFromMetadata(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1" || normalized == "yes"
	default:
		return false
	}
}

func metadataValueForDiagnostic(value any) string {
	if value == nil {
		return "<nil>"
	}
	return fmt.Sprintf("%#v", value)
}

type pythonReprEntry struct {
	key   string
	value any
}

func pythonTupleOfTuplesRepr(entries []pythonReprEntry) string {
	parts := make([]string, 0, len(entries))
	for _, entry := range entries {
		parts = append(parts, "("+pythonStringRepr(entry.key)+", "+pythonValueRepr(entry.value)+")")
	}
	return "(" + strings.Join(parts, ", ") + ")"
}

func pythonValueRepr(value any) string {
	switch typed := value.(type) {
	case string:
		return pythonStringRepr(typed)
	case bool:
		if typed {
			return "True"
		}
		return "False"
	case int:
		return strconv.Itoa(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', 1, 64)
	default:
		return pythonStringRepr(fmt.Sprint(typed))
	}
}

func pythonStringRepr(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "\\'") + "'"
}
