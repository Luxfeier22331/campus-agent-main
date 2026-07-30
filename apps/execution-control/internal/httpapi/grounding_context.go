package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const (
	groundingContextSchemaVersion   = "grounding_context.v2"
	groundingCandidateLimitPerScope = 8
	groundingEvidenceLimit          = 8
	groundingTokenBudget            = 4096
)

type groundingContext = temporalruntime.GroundingContext
type groundingEvidence = temporalruntime.GroundingEvidence

type groundingExecutor interface {
	Prepare(
		context.Context,
		string,
		retrievalruntime.RetrievalAccess,
		temporalruntime.AgentAdmissionSnapshot,
	) (groundingPreparation, error)
}

type groundingPreparation struct {
	CandidateCount int
	Evidence       []groundingEvidence
	StageTiming    groundingStageTiming
}

type groundingStageTiming struct {
	Embedding time.Duration
	Pack      time.Duration
	// Rerank is retained as a zero-valued telemetry field for the existing
	// stage_timing contract. Retrieval ordering happens in Qdrant via RRF.
	Rerank time.Duration
	Search time.Duration
}

func (timing groundingStageTiming) projection() map[string]any {
	projection := map[string]any{}
	addStageTimingDuration(projection, "grounding.embedding_ms", timing.Embedding)
	addStageTimingDuration(projection, "grounding.search_ms", timing.Search)
	addStageTimingDuration(projection, "grounding.rerank_ms", timing.Rerank)
	addStageTimingDuration(projection, "grounding.pack_ms", timing.Pack)
	return projection
}

type qdrantGroundingExecutor struct {
	qdrant qdrantDocumentEvidenceExecutor
}

func newQdrantGroundingExecutor(
	qdrant qdrantDocumentEvidenceExecutor,
) groundingExecutor {
	return qdrantGroundingExecutor{
		qdrant: qdrant,
	}
}

type groundingCandidate struct {
	groundingEvidence
	dedupKey string
}

func (e qdrantGroundingExecutor) Prepare(
	ctx context.Context,
	query string,
	access retrievalruntime.RetrievalAccess,
	snapshot temporalruntime.AgentAdmissionSnapshot,
) (groundingPreparation, error) {
	timing := groundingStageTiming{}
	query = strings.TrimSpace(query)
	if query == "" {
		return groundingPreparation{}, errors.New("grounding query is required")
	}
	if err := validateAdmissionSnapshot(snapshot); err != nil {
		return groundingPreparation{}, err
	}
	embeddingStartedAt := time.Now()
	embeddingConfig, err := e.qdrant.resolveEmbeddingProviderConfig(
		ctx,
		embeddingProviderAdmissionPin(snapshot),
	)
	if err != nil {
		return groundingPreparation{}, err
	}
	if len(snapshot.DocumentScopes) == 0 {
		return groundingPreparation{}, errors.New("grounding document scopes are required")
	}
	instruction := snapshot.DocumentScopes[0].ServingConfig.EmbeddingQueryInstruction
	for _, scope := range snapshot.DocumentScopes {
		if scope.ServingConfig.EmbeddingQueryInstruction != instruction {
			return groundingPreparation{}, errors.New("grounding scopes require one shared embedding query instruction")
		}
	}
	embedding, err := e.qdrant.embedQueryWithProviderConfig(
		ctx,
		embeddingConfig,
		retrievalruntime.BuildDenseQueryText(query, instruction),
	)
	if err != nil {
		return groundingPreparation{}, err
	}
	timing.Embedding = time.Since(embeddingStartedAt)
	searchStartedAt := time.Now()
	candidates, err := e.queryScopes(ctx, query, access, embedding, embeddingConfig, snapshot.DocumentScopes)
	if err != nil {
		return groundingPreparation{}, err
	}
	timing.Search = time.Since(searchStartedAt)
	if len(candidates) == 0 {
		packStartedAt := time.Now()
		evidence := []groundingEvidence{}
		timing.Pack = time.Since(packStartedAt)
		return groundingPreparation{
			CandidateCount: 0,
			Evidence:       evidence,
			StageTiming:    timing,
		}, nil
	}
	// Qdrant has already fused dense and sparse candidates with RRF. Merge the
	// per-scope result sets deterministically; no second provider call is made.
	sort.SliceStable(candidates, func(left, right int) bool {
		if candidates[left].RerankScore == candidates[right].RerankScore {
			return candidates[left].dedupKey < candidates[right].dedupKey
		}
		return candidates[left].RerankScore > candidates[right].RerankScore
	})
	packStartedAt := time.Now()
	evidence := selectGroundingEvidence(candidates, snapshot.DocumentScopes, 0)
	timing.Pack = time.Since(packStartedAt)
	return groundingPreparation{
		CandidateCount: len(candidates),
		Evidence:       evidence,
		StageTiming:    timing,
	}, nil
}

func (e qdrantGroundingExecutor) queryScopes(
	ctx context.Context,
	query string,
	access retrievalruntime.RetrievalAccess,
	embedding []float64,
	embeddingConfig providerConfigSnapshot,
	scopes []temporalruntime.DocumentScope,
) ([]groundingCandidate, error) {
	results := make([][]qdrantPoint, len(scopes))
	errorsByScope := make([]error, len(scopes))
	var wait sync.WaitGroup
	for index := range scopes {
		index := index
		wait.Add(1)
		go func() {
			defer wait.Done()
			scope := scopes[index]
			profile := knowledgeServingConfigFromSnapshot(scope.ServingConfig)
			limit := scope.CandidateTopK
			if limit <= 0 || limit > groundingCandidateLimitPerScope {
				limit = groundingCandidateLimitPerScope
			}
			request := retrievalruntime.SearchRequest{
				RunID:             scope.ReleaseID,
				RequestID:         scope.ReleaseID,
				TraceID:           scope.ReleaseID,
				InvocationID:      scope.ReleaseID,
				SearchOrdinal:     index + 1,
				QueryText:         query,
				DocumentScope:     scope.Scope,
				ServingConfigPath: scope.ServingConfigPath,
				CandidateTopK:     limit,
				RetrievalAccess:   access,
			}
			results[index], errorsByScope[index] =
				e.qdrant.queryPointsInCollectionWithProfileAndProviderConfig(
					ctx,
					request,
					profile,
					embedding,
					embeddingConfig,
					scope.QdrantCollection,
				)
		}()
	}
	wait.Wait()
	for index, err := range errorsByScope {
		if err != nil {
			return nil, fmt.Errorf("query grounding scope %s: %w", scopes[index].Scope, err)
		}
	}
	seen := map[string]struct{}{}
	candidates := make([]groundingCandidate, 0, len(scopes)*groundingCandidateLimitPerScope)
	for index, points := range results {
		for _, point := range points {
			candidate, err := groundingCandidateFromQdrantPoint(scopes[index], point)
			if err != nil {
				return nil, err
			}
			if _, exists := seen[candidate.dedupKey]; exists {
				continue
			}
			seen[candidate.dedupKey] = struct{}{}
			candidates = append(candidates, candidate)
		}
	}
	return candidates, nil
}

func groundingCandidateFromQdrantPoint(
	scope temporalruntime.DocumentScope,
	point qdrantPoint,
) (groundingCandidate, error) {
	payload := qdrantPointMetadata(point)
	required := map[string]string{
		"chunk_id":       firstNonEmptyText(payload["chunk_id"]),
		"section_ref":    firstNonEmptyText(payload["section_ref"]),
		"document_id":    firstNonEmptyText(payload["document_id"]),
		"section_id":     firstNonEmptyText(payload["section_id"]),
		"document_title": firstNonEmptyText(payload["document_title"]),
		"section_title":  firstNonEmptyText(payload["section_title"]),
		"canonical_url":  firstNonEmptyText(payload["canonical_url"]),
		"text":           qdrantPointText(point),
		"text_sha256":    firstNonEmptyText(payload["text_sha256"]),
		"release_id":     firstNonEmptyText(payload["release_id"]),
		"document_scope": firstNonEmptyText(payload["document_scope"]),
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return groundingCandidate{}, fmt.Errorf("grounding Qdrant payload %s is required", field)
		}
	}
	if required["release_id"] != scope.ReleaseID || required["document_scope"] != scope.Scope {
		return groundingCandidate{}, errors.New("grounding Qdrant payload does not match admitted release")
	}
	if !validSHA256Ref(required["text_sha256"]) ||
		sha256TextRef(required["text"]) != required["text_sha256"] {
		return groundingCandidate{}, errors.New("grounding Qdrant payload text hash is invalid")
	}
	if math.IsNaN(point.Score) || math.IsInf(point.Score, 0) || point.Score < 0 {
		return groundingCandidate{}, errors.New("grounding Qdrant score is invalid")
	}
	tokenCount, ok := positiveIntValue(payload["token_count"])
	if !ok || tokenCount > groundingTokenBudget {
		return groundingCandidate{}, errors.New("grounding Qdrant payload token_count is invalid")
	}
	dedupKey := strings.Join([]string{
		scope.Scope,
		scope.ReleaseID,
		required["chunk_id"],
		required["text_sha256"],
	}, "\x00")
	return groundingCandidate{
		groundingEvidence: groundingEvidence{
			DocumentScope: scope.Scope,
			ReleaseID:     scope.ReleaseID,
			ChunkID:       required["chunk_id"],
			SectionRef:    required["section_ref"],
			DocumentID:    required["document_id"],
			SectionID:     required["section_id"],
			DocumentTitle: required["document_title"],
			SectionTitle:  required["section_title"],
			CanonicalURL:  required["canonical_url"],
			Text:          required["text"],
			TextSHA256:    required["text_sha256"],
			TokenCount:    tokenCount,
			RerankScore:   point.Score,
		},
		dedupKey: dedupKey,
	}, nil
}

func selectGroundingEvidence(
	ranked []groundingCandidate,
	scopes []temporalruntime.DocumentScope,
	minScore float64,
) []groundingEvidence {
	evidence := make([]groundingEvidence, 0, groundingEvidenceLimit)
	scopeLimits := make(map[string]int, len(scopes))
	for _, scope := range scopes {
		scopeLimits[scope.Scope] = scope.MaxEvidenceSections
	}
	scopeCounts := make(map[string]int, len(scopes))
	selectedCandidates := map[string]struct{}{}
	selectedSections := map[string]struct{}{}
	tokenCount := 0
	appendCandidate := func(candidate groundingCandidate, requireNewSection bool) bool {
		if candidate.RerankScore < minScore || len(evidence) >= groundingEvidenceLimit {
			return false
		}
		if _, exists := selectedCandidates[candidate.dedupKey]; exists {
			return false
		}
		scopeLimit, admitted := scopeLimits[candidate.DocumentScope]
		if !admitted || scopeCounts[candidate.DocumentScope] >= scopeLimit {
			return false
		}
		if tokenCount+candidate.TokenCount > groundingTokenBudget {
			return false
		}
		sectionKey := strings.Join([]string{
			candidate.DocumentScope,
			candidate.ReleaseID,
			candidate.DocumentID,
			candidate.SectionID,
		}, "\x00")
		if requireNewSection {
			if _, exists := selectedSections[sectionKey]; exists {
				return false
			}
		}
		candidate.EvidenceRef = "evidence://" + retrievalruntime.HashText(candidate.dedupKey)
		evidence = append(evidence, candidate.groundingEvidence)
		tokenCount += candidate.TokenCount
		scopeCounts[candidate.DocumentScope]++
		selectedCandidates[candidate.dedupKey] = struct{}{}
		selectedSections[sectionKey] = struct{}{}
		return true
	}
	for _, scope := range scopes {
		for _, candidate := range ranked {
			if candidate.DocumentScope == scope.Scope && appendCandidate(candidate, false) {
				break
			}
		}
	}
	for _, candidate := range ranked {
		appendCandidate(candidate, true)
	}
	for _, candidate := range ranked {
		appendCandidate(candidate, false)
	}
	if evidence == nil {
		return []groundingEvidence{}
	}
	return evidence
}

func validateGroundingContext(value groundingContext) error {
	if value.SchemaVersion != groundingContextSchemaVersion ||
		strings.TrimSpace(value.RunID) == "" ||
		!validSHA256Ref(value.AdmissionSHA256) ||
		!lowercaseSHA256Pattern.MatchString(value.PlanSHA256) ||
		!validSHA256Ref(value.QuerySHA256) ||
		value.PreparedAt.IsZero() ||
		value.ModelContextChars < 0 ||
		value.TokenCount < 0 || value.TokenCount > groundingTokenBudget ||
		len(value.Evidence) > groundingEvidenceLimit {
		return errors.New("grounding context envelope is invalid")
	}
	plan := temporalruntime.GroundingPlanSnapshot{
		Mode:           value.Mode,
		QuerySHA256:    value.QuerySHA256,
		SchemaVersion:  groundingPlanSchemaVersion,
		SelectedScopes: value.SelectedScopes,
	}
	if err := validateGroundingPlan(plan); err != nil {
		return err
	}
	if hashAdmissionJSON(plan) != value.PlanSHA256 {
		return errors.New("grounding context plan hash is invalid")
	}
	wantCovered := coveredGroundingScopes(value.SelectedScopes, value.Evidence)
	if !equalStringSlices(wantCovered, value.CoveredScopes) {
		return errors.New("grounding context covered scopes are invalid")
	}
	wantStatus := groundingStatus(value.Mode, value.SelectedScopes, value.CoveredScopes)
	if value.Status != wantStatus {
		return errors.New("grounding context status is invalid")
	}
	if value.ModelContextChars != groundingModelContextCharacterCount(value.Status, value.Evidence) {
		return errors.New("grounding context model character count is invalid")
	}
	tokenCount := 0
	seen := map[string]struct{}{}
	selectedScopeSet := make(map[string]struct{}, len(value.SelectedScopes))
	for _, scope := range value.SelectedScopes {
		selectedScopeSet[scope] = struct{}{}
	}
	for _, evidence := range value.Evidence {
		evidenceDigest := strings.TrimPrefix(evidence.EvidenceRef, "evidence://")
		if evidenceDigest == evidence.EvidenceRef || !lowercaseSHA256Pattern.MatchString(evidenceDigest) ||
			strings.TrimSpace(evidence.DocumentScope) == "" ||
			strings.TrimSpace(evidence.ReleaseID) == "" ||
			strings.TrimSpace(evidence.ChunkID) == "" ||
			strings.TrimSpace(evidence.SectionRef) == "" ||
			strings.TrimSpace(evidence.DocumentID) == "" ||
			strings.TrimSpace(evidence.SectionID) == "" ||
			strings.TrimSpace(evidence.DocumentTitle) == "" ||
			strings.TrimSpace(evidence.SectionTitle) == "" ||
			strings.TrimSpace(evidence.CanonicalURL) == "" ||
			strings.TrimSpace(evidence.Text) == "" ||
			!validSHA256Ref(evidence.TextSHA256) ||
			sha256TextRef(evidence.Text) != evidence.TextSHA256 ||
			evidence.TokenCount <= 0 ||
			math.IsNaN(evidence.RerankScore) || math.IsInf(evidence.RerankScore, 0) ||
			evidence.RerankScore < 0 ||
			evidence.RerankScore > 1 {
			return errors.New("grounding context evidence is invalid")
		}
		if _, admitted := selectedScopeSet[evidence.DocumentScope]; !admitted {
			return errors.New("grounding evidence scope is not selected")
		}
		if _, exists := seen[evidence.EvidenceRef]; exists {
			return errors.New("grounding context evidence_ref is duplicated")
		}
		seen[evidence.EvidenceRef] = struct{}{}
		tokenCount += evidence.TokenCount
	}
	if tokenCount != value.TokenCount {
		return errors.New("grounding context token_count does not match evidence")
	}
	return nil
}

func coveredGroundingScopes(selectedScopes []string, evidence []groundingEvidence) []string {
	available := make(map[string]struct{}, len(evidence))
	for _, item := range evidence {
		available[item.DocumentScope] = struct{}{}
	}
	covered := make([]string, 0, len(selectedScopes))
	for _, scope := range selectedScopes {
		if _, ok := available[scope]; ok {
			covered = append(covered, scope)
		}
	}
	return covered
}

func groundingStatus(mode string, selectedScopes []string, coveredScopes []string) string {
	if mode == "none" {
		return "not_required"
	}
	if len(coveredScopes) == 0 {
		return "empty"
	}
	if len(coveredScopes) < len(selectedScopes) {
		return "partial"
	}
	return "ready"
}

func groundingModelContextCharacterCount(status string, evidence []groundingEvidence) int {
	modelEvidence := make([]map[string]any, 0, len(evidence))
	for _, item := range evidence {
		modelEvidence = append(modelEvidence, map[string]any{
			"document_title": item.DocumentTitle,
			"evidence_ref":   item.EvidenceRef,
			"section_title":  item.SectionTitle,
			"text":           item.Text,
		})
	}
	encoded, err := json.Marshal(map[string]any{
		"evidence": modelEvidence,
		"status":   status,
	})
	if err != nil {
		return -1
	}
	return len([]rune(string(encoded)))
}

func knowledgeRetrievalAccessForPayload(payload map[string]any) (retrievalruntime.RetrievalAccess, error) {
	authorization := cloneAnyMapFromMetadata(nestedAny(payload, "context", "authorization"))
	filter := cloneAnyMapFromMetadata(authorization["retrieval_filter"])
	access := retrievalruntime.RetrievalAccess{
		EntitlementGroups:       stringSliceFromAny(filter["entitlement_groups"]),
		PolicyProjectionVersion: strings.TrimSpace(stringValue(filter["policy_projection_version"])),
		VisibilityLevel:         strings.TrimSpace(stringValue(filter["visibility_level"])),
		VisibilityScope:         strings.TrimSpace(stringValue(filter["visibility_scope"])),
	}
	if access.PolicyProjectionVersion == "" || access.VisibilityLevel == "" {
		return retrievalruntime.RetrievalAccess{}, errors.New("run retrieval access projection is required")
	}
	return access, nil
}
