package ragruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var ErrInvalidProjection = errors.New("invalid rag runtime projection")

const maxEvidenceExcerptBytes = 1200

type PlanProjection struct {
	SchemaVersion            string                  `json:"schema_version"`
	RunID                    string                  `json:"run_id"`
	StepID                   string                  `json:"step_id"`
	RequestID                string                  `json:"request_id"`
	QueryText                string                  `json:"query_text"`
	QueryMode                string                  `json:"query_mode"`
	VersionQuery             *VersionQueryProjection `json:"version_query,omitempty"`
	Corpus                   string                  `json:"corpus"`
	Collection               string                  `json:"collection"`
	CollectionAlias          string                  `json:"collection_alias"`
	TopK                     int                     `json:"top_k"`
	NoWideningPolicy         bool                    `json:"no_widening_policy"`
	RequiredEvidenceContract string                  `json:"required_evidence_contract"`
	MemoryRef                string                  `json:"memory_ref,omitempty"`
	PlanID                   string                  `json:"plan_id"`
	PayloadSHA256            string                  `json:"payload_sha256"`
	UnsafeDebug              map[string]any          `json:"-"`
}

type VersionQueryProjection struct {
	Mode               string `json:"mode"`
	AsOf               string `json:"as_of,omitempty"`
	VersionID          string `json:"version_id,omitempty"`
	CompareToVersionID string `json:"compare_to_version_id,omitempty"`
}

type RetrievalLookupRequest struct {
	CollectionAlias string `json:"collection_alias"`
	QueryMode       string `json:"query_mode"`
	QueryText       string `json:"query_text"`
	RunID           string `json:"run_id"`
	TopK            int    `json:"top_k"`
}

type RetrievalLookupResult struct {
	CandidateCount int                    `json:"candidate_count"`
	Candidates     []EvidenceRef          `json:"candidates"`
	LookupRef      string                 `json:"lookup_ref"`
	PayloadSHA256  string                 `json:"payload_sha256"`
	QueryLatencyMS int64                  `json:"query_latency_ms"`
	Request        RetrievalLookupRequest `json:"request"`
	SchemaVersion  string                 `json:"schema_version"`
}

type RetrievalRescueResult struct {
	LookupRef     string `json:"lookup_ref"`
	RescueApplied bool   `json:"rescue_applied"`
	RescueReason  string `json:"rescue_reason"`
	RescueRef     string `json:"rescue_ref"`
	RunID         string `json:"run_id"`
	SchemaVersion string `json:"schema_version"`
}

type EvidenceSelectionResult struct {
	CandidateCount          int           `json:"candidate_count"`
	CoverageStatus          string        `json:"coverage_status"`
	EvidenceRef             string        `json:"evidence_ref"`
	PayloadSHA256           string        `json:"payload_sha256"`
	RejectionReasons        []string      `json:"rejection_reasons"`
	RunID                   string        `json:"run_id"`
	SchemaVersion           string        `json:"schema_version"`
	SelectedEvidence        []EvidenceRef `json:"selected_evidence"`
	SupportingEvidenceCount int           `json:"supporting_evidence_count"`
}

type SynthesisPacketProjection struct {
	MemoryContext    []MemoryContextItem `json:"memory_context,omitempty"`
	MemoryRef        string              `json:"memory_ref,omitempty"`
	OutputSchemaID   string              `json:"output_schema_id"`
	PayloadSHA256    string              `json:"payload_sha256"`
	PromptRefs       []string            `json:"prompt_refs"`
	QueryIntent      string              `json:"query_intent"`
	RequestID        string              `json:"request_id"`
	RunID            string              `json:"run_id"`
	SelectedEvidence []EvidenceRef       `json:"selected_evidence"`
	StepID           string              `json:"step_id"`
}

type MemoryContextItem struct {
	Capability  string  `json:"capability"`
	CompactText string  `json:"compact_text"`
	MemoryID    string  `json:"memory_id"`
	MemoryType  string  `json:"memory_type"`
	Score       float64 `json:"score"`
	UpdatedAt   string  `json:"updated_at"`
}

type GroundingVerificationResult struct {
	ClaimSupportCount int      `json:"claim_support_count"`
	GroundingRef      string   `json:"grounding_ref"`
	RunID             string   `json:"run_id"`
	SchemaVersion     string   `json:"schema_version"`
	SourceRefs        []string `json:"source_refs"`
	UnsupportedFields []string `json:"unsupported_fields"`
	Verdict           string   `json:"verdict"`
}

type FinalizationPacket struct {
	AnswerText   string   `json:"answer_text"`
	Confidence   string   `json:"confidence"`
	GroundingRef string   `json:"grounding_ref"`
	RunID        string   `json:"run_id"`
	SourceRefs   []string `json:"source_refs"`
	SynthesisRef string   `json:"synthesis_ref"`
}

type EvidenceRef struct {
	ChunkID   string  `json:"chunk_id"`
	Excerpt   string  `json:"excerpt"`
	Score     float64 `json:"score"`
	SourceID  string  `json:"source_id"`
	SourceRef string  `json:"source_ref"`
	SpanRef   string  `json:"span_ref"`
	Title     string  `json:"title"`
}

func ValidatePlanProjection(plan PlanProjection) error {
	if err := requireFields(map[string]string{
		"run_id":           plan.RunID,
		"step_id":          plan.StepID,
		"request_id":       plan.RequestID,
		"query_text":       plan.QueryText,
		"query_mode":       plan.QueryMode,
		"corpus":           plan.Corpus,
		"collection":       plan.Collection,
		"collection_alias": plan.CollectionAlias,
		"plan_id":          plan.PlanID,
		"payload_sha256":   plan.PayloadSHA256,
	}); err != nil {
		return err
	}
	if plan.TopK <= 0 {
		return fmt.Errorf("%w: top_k must be positive", ErrInvalidProjection)
	}
	if err := validateQueryMode(plan.QueryMode, plan.VersionQuery); err != nil {
		return err
	}
	if !isSHA256Hex(plan.PayloadSHA256) {
		return fmt.Errorf("%w: payload_sha256 must be lowercase sha256 hex", ErrInvalidProjection)
	}
	return rejectUnsafeDebug(plan.UnsafeDebug)
}

func validateQueryMode(queryMode string, versionQuery *VersionQueryProjection) error {
	switch queryMode {
	case "current", "historical", "as_of", "compare", "freshness_sensitive", "live_assisted":
	default:
		return fmt.Errorf("%w: unsupported query_mode %q", ErrInvalidProjection, queryMode)
	}
	if versionQuery == nil {
		if queryMode == "historical" || queryMode == "as_of" || queryMode == "compare" {
			return fmt.Errorf("%w: version_query is required for %s query_mode", ErrInvalidProjection, queryMode)
		}
		return nil
	}
	mode := strings.TrimSpace(versionQuery.Mode)
	if mode == "" {
		return fmt.Errorf("%w: version_query.mode is required", ErrInvalidProjection)
	}
	if mode != queryMode {
		return fmt.Errorf("%w: version_query.mode must match query_mode", ErrInvalidProjection)
	}
	switch mode {
	case "current", "freshness_sensitive", "live_assisted":
		if versionQuery.AsOf != "" || versionQuery.VersionID != "" || versionQuery.CompareToVersionID != "" {
			return fmt.Errorf("%w: version_query fields are not allowed for %s query_mode", ErrInvalidProjection, mode)
		}
	case "historical":
		if strings.TrimSpace(versionQuery.VersionID) == "" {
			return fmt.Errorf("%w: version_query.version_id is required for historical query_mode", ErrInvalidProjection)
		}
		if versionQuery.AsOf != "" || versionQuery.CompareToVersionID != "" {
			return fmt.Errorf("%w: unsupported version_query fields for historical query_mode", ErrInvalidProjection)
		}
	case "as_of":
		if strings.TrimSpace(versionQuery.AsOf) == "" {
			return fmt.Errorf("%w: version_query.as_of is required for as_of query_mode", ErrInvalidProjection)
		}
		if versionQuery.VersionID != "" || versionQuery.CompareToVersionID != "" {
			return fmt.Errorf("%w: unsupported version_query fields for as_of query_mode", ErrInvalidProjection)
		}
	case "compare":
		if strings.TrimSpace(versionQuery.VersionID) == "" || strings.TrimSpace(versionQuery.CompareToVersionID) == "" {
			return fmt.Errorf("%w: version_query.version_id and compare_to_version_id are required for compare query_mode", ErrInvalidProjection)
		}
		if versionQuery.AsOf != "" {
			return fmt.Errorf("%w: version_query.as_of is not allowed for compare query_mode", ErrInvalidProjection)
		}
	default:
		return fmt.Errorf("%w: unsupported version_query.mode %q", ErrInvalidProjection, mode)
	}
	return nil
}

func ValidateEvidenceSelection(result EvidenceSelectionResult) error {
	if err := requireFields(map[string]string{
		"run_id":          result.RunID,
		"evidence_ref":    result.EvidenceRef,
		"coverage_status": result.CoverageStatus,
		"payload_sha256":  result.PayloadSHA256,
	}); err != nil {
		return err
	}
	if !isSHA256Hex(result.PayloadSHA256) {
		return fmt.Errorf("%w: payload_sha256 must be lowercase sha256 hex", ErrInvalidProjection)
	}
	if len(result.SelectedEvidence) == 0 {
		return fmt.Errorf("%w: selected_evidence is required", ErrInvalidProjection)
	}
	for index, ref := range result.SelectedEvidence {
		if err := validateEvidenceRef(index, ref); err != nil {
			return err
		}
	}
	return nil
}

func ValidateSynthesisPacket(packet SynthesisPacketProjection) error {
	if err := requireFields(map[string]string{
		"run_id":           packet.RunID,
		"step_id":          packet.StepID,
		"request_id":       packet.RequestID,
		"query_intent":     packet.QueryIntent,
		"output_schema_id": packet.OutputSchemaID,
		"payload_sha256":   packet.PayloadSHA256,
	}); err != nil {
		return err
	}
	if !isSHA256Hex(packet.PayloadSHA256) {
		return fmt.Errorf("%w: payload_sha256 must be lowercase sha256 hex", ErrInvalidProjection)
	}
	if len(packet.PromptRefs) == 0 {
		return fmt.Errorf("%w: prompt_refs is required", ErrInvalidProjection)
	}
	for index, ref := range packet.PromptRefs {
		if strings.TrimSpace(ref) == "" {
			return fmt.Errorf("%w: prompt_refs[%d] is required", ErrInvalidProjection, index)
		}
	}
	if len(packet.SelectedEvidence) == 0 {
		return fmt.Errorf("%w: selected_evidence is required", ErrInvalidProjection)
	}
	for index, ref := range packet.SelectedEvidence {
		if err := validateEvidenceRef(index, ref); err != nil {
			return err
		}
	}
	return nil
}

func HashProjection(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func requireFields(fields map[string]string) error {
	for field, value := range fields {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s is required", ErrInvalidProjection, field)
		}
	}
	return nil
}

func validateEvidenceRef(index int, evidence EvidenceRef) error {
	if err := requireFields(map[string]string{
		"source_id":  evidence.SourceID,
		"chunk_id":   evidence.ChunkID,
		"span_ref":   evidence.SpanRef,
		"excerpt":    evidence.Excerpt,
		"source_ref": evidence.SourceRef,
	}); err != nil {
		return fmt.Errorf("%w: selected_evidence[%d]: %v", ErrInvalidProjection, index, err)
	}
	if len([]byte(evidence.Excerpt)) > maxEvidenceExcerptBytes {
		return fmt.Errorf("%w: selected_evidence[%d].excerpt exceeds limit", ErrInvalidProjection, index)
	}
	return nil
}

func rejectUnsafeDebug(value map[string]any) error {
	for key := range value {
		normalized := strings.ToLower(strings.TrimSpace(key))
		if normalized == "" {
			continue
		}
		if strings.Contains(normalized, "raw_prompt") ||
			strings.Contains(normalized, "provider_trace") ||
			strings.Contains(normalized, "authorization") ||
			strings.Contains(normalized, "api_key") ||
			strings.Contains(normalized, "secret") ||
			strings.Contains(normalized, "raw_source") ||
			strings.Contains(normalized, "source_body") {
			return fmt.Errorf("%w: unsafe debug key %q", ErrInvalidProjection, key)
		}
	}
	return nil
}

func isSHA256Hex(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return false
	}
	return true
}
