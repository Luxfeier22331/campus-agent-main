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
	SchemaVersion            string                           `json:"schema_version"`
	RunID                    string                           `json:"run_id"`
	StepID                   string                           `json:"step_id"`
	RequestID                string                           `json:"request_id"`
	QueryText                string                           `json:"query_text"`
	QueryMode                string                           `json:"query_mode"`
	VersionQuery             *VersionQueryProjection          `json:"version_query,omitempty"`
	Corpus                   string                           `json:"corpus"`
	Collection               string                           `json:"collection"`
	CollectionAlias          string                           `json:"collection_alias"`
	TopK                     int                              `json:"top_k"`
	NoWideningPolicy         bool                             `json:"no_widening_policy"`
	RequiredEvidenceContract string                           `json:"required_evidence_contract"`
	ResolvedVersionQuery     *ResolvedVersionQueryProjection  `json:"resolved_version_query,omitempty"`
	MemoryRef                string                           `json:"memory_ref,omitempty"`
	QueryRewrite             *QueryRewriteProjection          `json:"query_rewrite,omitempty"`
	PreviousEvidenceReuse    *PreviousEvidenceReuseProjection `json:"previous_evidence_reuse,omitempty"`
	PlanID                   string                           `json:"plan_id"`
	PayloadSHA256            string                           `json:"payload_sha256"`
	RuntimeProfileID         string                           `json:"runtime_profile_id,omitempty"`
	QdrantAliasName          string                           `json:"qdrant_alias_name,omitempty"`
	RetrievalAccess          RetrievalAccessProjection        `json:"retrieval_access"`
	AdmittedScopes           []ScopeProjection                `json:"admitted_scopes,omitempty"`
	SourceTrustPolicy        SourceTrustPolicy                `json:"source_trust_policy,omitempty"`
	Budget                   PlanBudgetProjection             `json:"budget,omitempty"`
	Steps                    []RetrievalStepProjection        `json:"steps,omitempty"`
	UnsafeDebug              map[string]any                   `json:"-"`
}

type ScopeProjection struct {
	Corpus     string `json:"corpus"`
	Collection string `json:"collection"`
}

type SourceTrustPolicy struct {
	MinimumTier string `json:"minimum_tier"`
}

type PlanBudgetProjection struct {
	MaxReplans int `json:"max_replans"`
	MaxSteps   int `json:"max_steps"`
}

type RetrievalStepProjection struct {
	Budget           StepBudgetProjection   `json:"budget"`
	DependsOnStepIDs []string               `json:"depends_on_step_ids,omitempty"`
	ExpectedOutput   string                 `json:"expected_output"`
	QueryText        string                 `json:"query_text"`
	RunStepID        string                 `json:"run_step_id"`
	Scope            ScopeProjection        `json:"scope"`
	Selector         StepSelectorProjection `json:"selector,omitempty"`
	Stage            string                 `json:"stage"`
	StepID           string                 `json:"step_id"`
	StepType         string                 `json:"step_type"`
}

type StepBudgetProjection struct {
	TimeoutMS int `json:"timeout_ms,omitempty"`
	TopK      int `json:"top_k"`
}

type StepSelectorProjection struct {
	TargetDocumentIDs    []string `json:"target_document_ids,omitempty"`
	TargetVersionIDs     []string `json:"target_version_ids,omitempty"`
	TargetRevisionTrack  string   `json:"target_revision_track,omitempty"`
	PreferredDocumentIDs []string `json:"preferred_document_ids,omitempty"`
	EntityKeys           []string `json:"entity_keys,omitempty"`
}

type QueryRewriteProjection struct {
	StandaloneQueryHash  string                      `json:"standalone_query_hash"`
	ResolutionState      string                      `json:"resolution_state"`
	AmbiguityReason      string                      `json:"ambiguity_reason,omitempty"`
	FollowupReference    FollowupReferenceProjection `json:"followup_reference,omitempty"`
	RequiresNewRetrieval bool                        `json:"requires_new_retrieval"`
}

type FollowupReferenceProjection struct {
	Type string   `json:"type"`
	IDs  []string `json:"ids,omitempty"`
}

type PreviousEvidenceReuseProjection struct {
	Decision             string                        `json:"decision"`
	EvidenceIDs          []string                      `json:"evidence_ids,omitempty"`
	PreferredDocumentIDs []string                      `json:"preferred_document_ids,omitempty"`
	VersionIDs           []string                      `json:"version_ids,omitempty"`
	ProofRefs            []PreviousEvidenceContextItem `json:"proof_refs,omitempty"`
}

type VersionQueryProjection struct {
	Mode               string `json:"mode"`
	AsOf               string `json:"as_of,omitempty"`
	VersionID          string `json:"version_id,omitempty"`
	CompareToVersionID string `json:"compare_to_version_id,omitempty"`
}

type RetrievalAccessProjection struct {
	EntitlementGroups       []string `json:"entitlement_groups,omitempty"`
	PolicyProjectionVersion string   `json:"policy_projection_version"`
	VisibilityLevel         string   `json:"visibility_level"`
	VisibilityScope         string   `json:"visibility_scope,omitempty"`
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
	MemoryContext           []MemoryContextItem           `json:"memory_context,omitempty"`
	MemoryContextBlock      string                        `json:"memory_context_block,omitempty"`
	MemoryRef               string                        `json:"memory_ref,omitempty"`
	OutputSchemaID          string                        `json:"output_schema_id"`
	PayloadSHA256           string                        `json:"payload_sha256"`
	PreviousEvidenceContext []PreviousEvidenceContextItem `json:"previous_evidence_context,omitempty"`
	PromptRefs              []string                      `json:"prompt_refs"`
	QueryIntent             string                        `json:"query_intent"`
	RequestID               string                        `json:"request_id"`
	RunID                   string                        `json:"run_id"`
	SelectedEvidence        []EvidenceRef                 `json:"selected_evidence"`
	StepID                  string                        `json:"step_id"`
}

type PreviousEvidenceContextItem struct {
	AccessScope  string `json:"access_scope"`
	Collection   string `json:"collection,omitempty"`
	ContentHash  string `json:"content_hash"`
	DocumentID   string `json:"document_id,omitempty"`
	EvidenceID   string `json:"evidence_id"`
	SectionTitle string `json:"section_title,omitempty"`
	SnapshotID   string `json:"snapshot_id,omitempty"`
	Snippet      string `json:"snippet,omitempty"`
	SourceID     string `json:"source_id"`
	Title        string `json:"title,omitempty"`
	VersionID    string `json:"version_id,omitempty"`
}

type MemoryContextItem struct {
	Tool        string  `json:"tool"`
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
	VerificationKind  string   `json:"verification_kind"`
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
	Anchor          string  `json:"anchor,omitempty"`
	CanonicalURL    string  `json:"canonical_url,omitempty"`
	ChunkID         string  `json:"chunk_id"`
	DocumentID      string  `json:"document_id,omitempty"`
	Excerpt         string  `json:"excerpt"`
	IsAnswerBearing bool    `json:"is_answer_bearing,omitempty"`
	IsCurrent       bool    `json:"is_current,omitempty"`
	LatestURL       string  `json:"latest_url,omitempty"`
	RevisionTrack   string  `json:"revision_track,omitempty"`
	RootUnitID      string  `json:"root_unit_id,omitempty"`
	Score           float64 `json:"score"`
	SourceChannel   string  `json:"source_channel,omitempty"`
	SourceID        string  `json:"source_id"`
	SourceRef       string  `json:"source_ref"`
	SourceUnitKey   string  `json:"source_unit_key,omitempty"`
	SourceUnitKind  string  `json:"source_unit_kind,omitempty"`
	SpanRef         string  `json:"span_ref"`
	Title           string  `json:"title"`
	VersionID       string  `json:"version_id,omitempty"`
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
	for index, step := range plan.Steps {
		if err := validateRetrievalStepProjection(index, step); err != nil {
			return err
		}
	}
	if err := validateQueryMode(plan.QueryMode, plan.VersionQuery); err != nil {
		return err
	}
	if err := validateQueryRewrite(plan.QueryRewrite); err != nil {
		return err
	}
	if err := validatePreviousEvidenceReuse(plan.PreviousEvidenceReuse); err != nil {
		return err
	}
	if err := validateRetrievalAccess(plan.RetrievalAccess); err != nil {
		return err
	}
	if !isSHA256Hex(plan.PayloadSHA256) {
		return fmt.Errorf("%w: payload_sha256 must be lowercase sha256 hex", ErrInvalidProjection)
	}
	return rejectUnsafeDebug(plan.UnsafeDebug)
}

func validateRetrievalAccess(access RetrievalAccessProjection) error {
	if strings.TrimSpace(access.PolicyProjectionVersion) == "" {
		return fmt.Errorf("%w: retrieval_access.policy_projection_version is required", ErrInvalidProjection)
	}
	level := strings.TrimSpace(access.VisibilityLevel)
	switch level {
	case "public":
		return nil
	case "restricted":
		if strings.TrimSpace(access.VisibilityScope) == "" {
			return fmt.Errorf("%w: retrieval_access.visibility_scope is required for restricted access", ErrInvalidProjection)
		}
		if len(normalizeProjectionStrings(access.EntitlementGroups)) == 0 {
			return fmt.Errorf("%w: retrieval_access.entitlement_groups is required for restricted access", ErrInvalidProjection)
		}
		return nil
	default:
		return fmt.Errorf("%w: retrieval_access.visibility_level is unsupported", ErrInvalidProjection)
	}
}

func validateQueryRewrite(rewrite *QueryRewriteProjection) error {
	if rewrite == nil {
		return nil
	}
	if !isSHA256Ref(rewrite.StandaloneQueryHash) {
		return fmt.Errorf("%w: query_rewrite.standalone_query_hash must be sha256:<hex>", ErrInvalidProjection)
	}
	switch rewrite.ResolutionState {
	case "resolved", "ambiguous", "unresolved":
	default:
		return fmt.Errorf("%w: query_rewrite.resolution_state is unsupported", ErrInvalidProjection)
	}
	if rewrite.ResolutionState != "resolved" && strings.TrimSpace(rewrite.AmbiguityReason) == "" {
		return fmt.Errorf("%w: query_rewrite.ambiguity_reason is required", ErrInvalidProjection)
	}
	if strings.TrimSpace(rewrite.FollowupReference.Type) == "" {
		return fmt.Errorf("%w: query_rewrite.followup_reference.type is required", ErrInvalidProjection)
	}
	return nil
}

func validatePreviousEvidenceReuse(reuse *PreviousEvidenceReuseProjection) error {
	if reuse == nil {
		return nil
	}
	switch strings.TrimSpace(reuse.Decision) {
	case "not_available", "not_reused_new_question", "contextual_anchor_for_new_retrieval":
		for index, ref := range reuse.ProofRefs {
			if err := validatePreviousEvidenceContextItem(index, ref); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("%w: previous_evidence_reuse.decision is unsupported", ErrInvalidProjection)
	}
}

func validateRetrievalStepProjection(index int, step RetrievalStepProjection) error {
	if err := requireFields(map[string]string{
		fmt.Sprintf("steps[%d].step_id", index):          step.StepID,
		fmt.Sprintf("steps[%d].run_step_id", index):      step.RunStepID,
		fmt.Sprintf("steps[%d].step_type", index):        step.StepType,
		fmt.Sprintf("steps[%d].stage", index):            step.Stage,
		fmt.Sprintf("steps[%d].query_text", index):       step.QueryText,
		fmt.Sprintf("steps[%d].scope.corpus", index):     step.Scope.Corpus,
		fmt.Sprintf("steps[%d].scope.collection", index): step.Scope.Collection,
		fmt.Sprintf("steps[%d].expected_output", index):  step.ExpectedOutput,
	}); err != nil {
		return err
	}
	if step.Budget.TopK <= 0 {
		return fmt.Errorf("%w: steps[%d].budget.top_k must be positive", ErrInvalidProjection, index)
	}
	return nil
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
	for index, ref := range packet.PreviousEvidenceContext {
		if err := validatePreviousEvidenceContextItem(index, ref); err != nil {
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

func normalizeProjectionStrings(values []string) []string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized
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

func validatePreviousEvidenceContextItem(index int, evidence PreviousEvidenceContextItem) error {
	if err := requireFields(map[string]string{
		"evidence_id":  evidence.EvidenceID,
		"source_id":    evidence.SourceID,
		"content_hash": evidence.ContentHash,
		"access_scope": evidence.AccessScope,
	}); err != nil {
		return fmt.Errorf("%w: previous_evidence_context[%d]: %v", ErrInvalidProjection, index, err)
	}
	if strings.TrimSpace(evidence.VersionID) == "" && strings.TrimSpace(evidence.SnapshotID) == "" {
		return fmt.Errorf("%w: previous_evidence_context[%d] must include version_id or snapshot_id", ErrInvalidProjection, index)
	}
	if len([]byte(evidence.Snippet)) > maxEvidenceExcerptBytes {
		return fmt.Errorf("%w: previous_evidence_context[%d].snippet exceeds limit", ErrInvalidProjection, index)
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

func isSHA256Ref(value string) bool {
	return strings.HasPrefix(value, "sha256:") && isSHA256Hex(strings.TrimPrefix(value, "sha256:"))
}
