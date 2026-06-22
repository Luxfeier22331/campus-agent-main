package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

type temporalRAGPlanMetadata struct {
	PlanRef string
	Plan    ragruntime.PlanProjection
}

func temporalRAGPlanFromRun(
	run execution.DurableRun,
	workflowPlanRef string,
) (temporalRAGPlanMetadata, bool) {
	raw, ok := run.Metadata["temporal_rag"].(map[string]any)
	if !ok {
		return temporalRAGPlanMetadata{}, false
	}
	if strings.TrimSpace(fmt.Sprint(raw["workflow_plan_ref"])) != strings.TrimSpace(workflowPlanRef) {
		return temporalRAGPlanMetadata{}, false
	}
	planRef := strings.TrimSpace(fmt.Sprint(raw["plan_ref"]))
	if planRef == "" {
		return temporalRAGPlanMetadata{}, false
	}
	plan, err := decodeRAGProjection[ragruntime.PlanProjection](raw["plan"])
	if err != nil {
		return temporalRAGPlanMetadata{}, false
	}
	if err := ragruntime.ValidatePlanProjection(plan); err != nil {
		return temporalRAGPlanMetadata{}, false
	}
	return temporalRAGPlanMetadata{PlanRef: planRef, Plan: plan}, true
}

func ragPlanProjectionForRun(
	run execution.DurableRun,
	queryServingScopesPath string,
	topKMax int,
) (ragruntime.PlanProjection, error) {
	payload, ok := run.Metadata["execution_payload"].(map[string]any)
	if !ok {
		return ragruntime.PlanProjection{}, errors.New("run metadata.execution_payload must be an object")
	}
	queryText := firstNonEmptyText(payload["user_goal"])
	if queryText == "" {
		return ragruntime.PlanProjection{}, errors.New("rag query_text is required")
	}
	rewrite, err := ragConversationRewriteForPayload(queryText, payload)
	if err != nil {
		return ragruntime.PlanProjection{}, err
	}
	scope, err := ragScopeForRun(run, payload, rewrite.QueryText, queryServingScopesPath)
	if err != nil {
		return ragruntime.PlanProjection{}, err
	}
	if err := validateRAGPreviousEvidenceScope(rewrite, scope); err != nil {
		return ragruntime.PlanProjection{}, err
	}
	profile, err := retrievalruntime.LoadRuntimeProfile("", scope.Corpus, scope.Collection)
	if err != nil {
		return ragruntime.PlanProjection{}, err
	}
	topK := positiveIntFromAny(payload["top_k"])
	if topK <= 0 {
		topK = profile.RetrievalTopK
	}
	if topKMax <= 0 {
		return ragruntime.PlanProjection{}, errors.New("rag top_k max must be configured")
	}
	if topK > topKMax {
		return ragruntime.PlanProjection{}, fmt.Errorf("rag top_k %d exceeds configured max %d", topK, topKMax)
	}
	queryMode, versionQuery := ragVersionQueryForRun(payload)
	retrievalAccess := ragRetrievalAccessForRun(payload)
	plan := ragruntime.PlanProjection{
		Collection:               scope.Collection,
		CollectionAlias:          profile.QdrantAliasName,
		Corpus:                   scope.Corpus,
		NoWideningPolicy:         true,
		PlanID:                   ragPlanID(scope, queryMode),
		QdrantAliasName:          profile.QdrantAliasName,
		QueryMode:                queryMode,
		QueryText:                rewrite.QueryText,
		QueryRewrite:             &rewrite.Projection,
		PreviousEvidenceReuse:    rewrite.PreviousEvidenceReuse,
		RequestID:                run.RequestID,
		RequiredEvidenceContract: "answer_bearing_evidence",
		RetrievalAccess:          retrievalAccess,
		RuntimeProfileID:         scope.Corpus + "/" + scope.Collection + ":" + profile.ServingStage,
		RunID:                    run.RunID,
		SchemaVersion:            "rag_plan_projection_v1",
		SourceTrustPolicy: ragruntime.SourceTrustPolicy{
			MinimumTier: defaultSourceTrustTier(scope.Collection, queryMode),
		},
		StepID:       "rag.plan",
		TopK:         topK,
		VersionQuery: versionQuery,
	}
	plan.AdmittedScopes = []ragruntime.ScopeProjection{{
		Corpus:     scope.Corpus,
		Collection: scope.Collection,
	}}
	plan.Steps = retrievalPlanStepsForProjection(plan)
	plan.Budget = ragruntime.PlanBudgetProjection{
		MaxReplans: 0,
		MaxSteps:   len(plan.Steps),
	}
	if _, memoryRef := memoryContextForRAG(run); memoryRef != "" {
		plan.MemoryRef = memoryRef
	}
	hash, err := ragruntime.HashProjection(plan)
	if err != nil {
		return ragruntime.PlanProjection{}, err
	}
	plan.PayloadSHA256 = hash
	if err := ragruntime.ValidatePlanProjection(plan); err != nil {
		return ragruntime.PlanProjection{}, err
	}
	return plan, nil
}

func ragRetrievalAccessForRun(payload map[string]any) ragruntime.RetrievalAccessProjection {
	contextProjection, _ := payload["context"].(map[string]any)
	authorization, _ := contextProjection["authorization"].(map[string]any)
	filter, _ := authorization["retrieval_filter"].(map[string]any)
	return ragruntime.RetrievalAccessProjection{
		EntitlementGroups:       stringSliceFromAny(filter["entitlement_groups"]),
		PolicyProjectionVersion: firstNonEmptyText(filter["policy_projection_version"]),
		VisibilityLevel:         firstNonEmptyText(filter["visibility_level"]),
		VisibilityScope:         firstNonEmptyText(filter["visibility_scope"]),
	}
}

func ragPlanID(scope runtimepolicy.Scope, queryMode string) string {
	return "rag:" + scope.Corpus + ":" + scope.Collection + ":" + queryMode
}

func defaultSourceTrustTier(collection string, queryMode string) string {
	if queryMode == "freshness_sensitive" {
		return "T3"
	}
	switch strings.TrimSpace(collection) {
	case "curriculum_plan":
		return "T0"
	case "student_rules", "institutional_rules":
		return "T1"
	case "stable_reference":
		return "T2"
	default:
		return "T1"
	}
}

func retrievalPlanStepsForProjection(plan ragruntime.PlanProjection) []ragruntime.RetrievalStepProjection {
	scope := ragruntime.ScopeProjection{Corpus: plan.Corpus, Collection: plan.Collection}
	base := func(stepID string, stepType string, stage string, expectedOutput string) ragruntime.RetrievalStepProjection {
		step := ragruntime.RetrievalStepProjection{
			Budget: ragruntime.StepBudgetProjection{
				TimeoutMS: 8000,
				TopK:      plan.TopK,
			},
			ExpectedOutput: expectedOutput,
			QueryText:      plan.QueryText,
			RunStepID:      temporalRunStepID(stepType),
			Scope:          scope,
			Stage:          stage,
			StepID:         stepID,
			StepType:       stepType,
		}
		applyPreviousEvidenceSelector(&step, plan.PreviousEvidenceReuse)
		return step
	}
	switch plan.QueryMode {
	case "historical", "as_of":
		step := base("historical-version-lookup", "historical_version_lookup", "retrieval", "candidate_set")
		if plan.VersionQuery != nil && strings.TrimSpace(plan.VersionQuery.VersionID) != "" {
			step.Selector.TargetVersionIDs = []string{strings.TrimSpace(plan.VersionQuery.VersionID)}
		}
		return []ragruntime.RetrievalStepProjection{step}
	case "compare":
		step := base("compare-pair-lookup", "compare_pair_lookup", "retrieval", "compare_inputs")
		if plan.VersionQuery != nil {
			for _, versionID := range []string{plan.VersionQuery.VersionID, plan.VersionQuery.CompareToVersionID} {
				if strings.TrimSpace(versionID) != "" {
					step.Selector.TargetVersionIDs = append(step.Selector.TargetVersionIDs, strings.TrimSpace(versionID))
				}
			}
		}
		return []ragruntime.RetrievalStepProjection{step}
	case "freshness_sensitive":
		freshness := base("freshness-gate", "freshness_gate", "retrieval", "freshness_decision")
		hybrid := base("hybrid-search", "hybrid_search", "retrieval", "candidate_set")
		hybrid.DependsOnStepIDs = []string{"freshness-gate"}
		return []ragruntime.RetrievalStepProjection{freshness, hybrid}
	case "live_assisted":
		return []ragruntime.RetrievalStepProjection{
			base("freshness-gate", "freshness_gate", "retrieval", "freshness_decision"),
			base("live-source-lookup", "live_source_lookup", "tool", "live_candidates"),
		}
	default:
		return []ragruntime.RetrievalStepProjection{
			base("hybrid-search", "hybrid_search", "retrieval", "candidate_set"),
			base("evidence-coverage-verify", "evidence_coverage_verify", "selection", "coverage_verdict"),
			base("supporting-evidence-select", "supporting_evidence_select", "selection", "supporting_evidence"),
		}
	}
}

func temporalRunStepID(stepType string) string {
	switch stepType {
	case "evidence_coverage_verify", "supporting_evidence_select":
		return "evidence.selection"
	case "freshness_gate", "parent_context_expand":
		return "retrieval.expand_or_rescue"
	case "live_source_lookup":
		return "retrieval.expand_or_rescue"
	default:
		return "retrieval.indexed_lookup"
	}
}

func ragVersionQueryForRun(payload map[string]any) (string, *ragruntime.VersionQueryProjection) {
	rawVersion := cloneAnyMapFromMetadata(payload["version_query"])
	mode := firstNonEmptyText(rawVersion["mode"], "current")
	switch mode {
	case "historical", "as_of", "compare", "freshness_sensitive", "live_assisted":
		return mode, &ragruntime.VersionQueryProjection{
			Mode:               mode,
			AsOf:               firstNonEmptyText(rawVersion["as_of"]),
			VersionID:          firstNonEmptyText(rawVersion["version_id"]),
			CompareToVersionID: firstNonEmptyText(rawVersion["compare_to_version_id"]),
		}
	case "current":
		if len(rawVersion) == 0 {
			return "current", nil
		}
		return "current", &ragruntime.VersionQueryProjection{
			Mode:               "current",
			AsOf:               firstNonEmptyText(rawVersion["as_of"]),
			VersionID:          firstNonEmptyText(rawVersion["version_id"]),
			CompareToVersionID: firstNonEmptyText(rawVersion["compare_to_version_id"]),
		}
	default:
		return mode, &ragruntime.VersionQueryProjection{
			Mode:               mode,
			AsOf:               firstNonEmptyText(rawVersion["as_of"]),
			VersionID:          firstNonEmptyText(rawVersion["version_id"]),
			CompareToVersionID: firstNonEmptyText(rawVersion["compare_to_version_id"]),
		}
	}
}

func ragScopeForRun(
	run execution.DurableRun,
	payload map[string]any,
	queryText string,
	queryServingScopesPath string,
) (runtimepolicy.Scope, error) {
	scope, ok := payload["requested_scope"].(map[string]any)
	if !ok {
		scope, _ = run.Metadata["requested_scope"].(map[string]any)
	}
	corpus := firstNonEmptyText(scope["corpus"])
	collection := firstNonEmptyText(scope["collection"])
	if corpus != "" || collection != "" {
		if corpus == "" || collection == "" {
			return runtimepolicy.Scope{}, errors.New("rag requested_scope corpus and collection are required")
		}
		allowed, err := runtimepolicy.QueryScopeAllowed(corpus, collection, queryServingScopesPath)
		if err != nil {
			return runtimepolicy.Scope{}, err
		}
		if !allowed {
			return runtimepolicy.Scope{}, fmt.Errorf("rag requested_scope %s/%s is not query-enabled", corpus, collection)
		}
		return runtimepolicy.Scope{Corpus: corpus, Collection: collection}, nil
	}
	return runtimepolicy.InferKnowledgeQueryScope(queryText, queryServingScopesPath)
}

func temporalRAGPlanProjectionFromRun(
	run execution.DurableRun,
	planRef string,
) (ragruntime.PlanProjection, error) {
	raw, ok := run.Metadata["temporal_rag"].(map[string]any)
	if !ok {
		return ragruntime.PlanProjection{}, fmt.Errorf("run metadata.temporal_rag is required")
	}
	if strings.TrimSpace(fmt.Sprint(raw["plan_ref"])) != strings.TrimSpace(planRef) {
		return ragruntime.PlanProjection{}, fmt.Errorf("rag plan ref drift")
	}
	plan, err := decodeRAGProjection[ragruntime.PlanProjection](raw["plan"])
	if err != nil {
		return ragruntime.PlanProjection{}, err
	}
	if err := ragruntime.ValidatePlanProjection(plan); err != nil {
		return ragruntime.PlanProjection{}, err
	}
	if plan.RunID != run.RunID {
		return ragruntime.PlanProjection{}, fmt.Errorf("rag plan run_id drift")
	}
	return plan, nil
}

func temporalRAGLookupResultFromRun(
	run execution.DurableRun,
	lookupRef string,
) (ragruntime.RetrievalLookupResult, error) {
	raw, ok := run.Metadata["temporal_rag"].(map[string]any)
	if !ok {
		return ragruntime.RetrievalLookupResult{}, fmt.Errorf("run metadata.temporal_rag is required")
	}
	if strings.TrimSpace(fmt.Sprint(raw["lookup_ref"])) != strings.TrimSpace(lookupRef) {
		return ragruntime.RetrievalLookupResult{}, fmt.Errorf("rag lookup ref drift")
	}
	result, err := decodeRAGProjection[ragruntime.RetrievalLookupResult](raw["lookup_result"])
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	if retrievalLookupRunID(result) != run.RunID {
		return ragruntime.RetrievalLookupResult{}, fmt.Errorf("rag lookup run_id drift")
	}
	if result.CandidateCount <= 0 || len(result.Candidates) == 0 {
		return ragruntime.RetrievalLookupResult{}, fmt.Errorf("rag lookup selected no candidates")
	}
	return result, nil
}

func selectRAGEvidence(
	run execution.DurableRun,
	lookup ragruntime.RetrievalLookupResult,
	selectedEvidenceMax int,
) (ragruntime.EvidenceSelectionResult, error) {
	plan := ragruntime.PlanProjection{}
	if raw, ok := run.Metadata["temporal_rag"].(map[string]any); ok {
		if decoded, err := decodeRAGProjection[ragruntime.PlanProjection](raw["plan"]); err == nil {
			plan = decoded
		}
	}
	if selectedEvidenceMax <= 0 {
		return ragruntime.EvidenceSelectionResult{}, errors.New("rag selected evidence max must be configured")
	}
	selection, err := ragruntime.SelectSupportingEvidence(ragruntime.EvidenceSelectionRequest{
		Lookup: lookup,
		Plan:   plan,
		RunID:  run.RunID,
	})
	if err != nil {
		return ragruntime.EvidenceSelectionResult{}, err
	}
	if len(selection.SelectedEvidence) > selectedEvidenceMax {
		selection.SelectedEvidence = selection.SelectedEvidence[:selectedEvidenceMax]
		selection.SupportingEvidenceCount = len(selection.SelectedEvidence)
	}
	selection.EvidenceRef = temporalProjectionRef(run.RunID, "evidence/selection")
	hash, err := ragruntime.HashProjection(selection)
	if err != nil {
		return ragruntime.EvidenceSelectionResult{}, err
	}
	selection.PayloadSHA256 = hash
	if err := ragruntime.ValidateEvidenceSelection(selection); err != nil {
		return ragruntime.EvidenceSelectionResult{}, err
	}
	return selection, nil
}

func answerBearingEvidence(candidates []ragruntime.EvidenceRef) []ragruntime.EvidenceRef {
	selected := make([]ragruntime.EvidenceRef, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.IsAnswerBearing {
			selected = append(selected, candidate)
		}
	}
	return selected
}

func retrievalRescueDecision(
	plan ragruntime.PlanProjection,
	lookup ragruntime.RetrievalLookupResult,
) (bool, string, error) {
	switch strings.TrimSpace(plan.QueryMode) {
	case "live_assisted":
		return false, "", errors.New("live_assisted retrieval requires admitted live source lookup; indexed rescue is not implemented")
	case "as_of":
		if plan.ResolvedVersionQuery == nil || strings.TrimSpace(plan.ResolvedVersionQuery.VersionID) == "" {
			return false, "", errors.New("as_of retrieval requires pre-resolved version_id before indexed rescue")
		}
	}
	if len(answerBearingEvidence(lookup.Candidates)) > 0 {
		return false, "answer_bearing_evidence_present", nil
	}
	if hasRetrievalStepType(plan, "parent_context_expand") {
		return false, "", errors.New("parent_context_expand is admitted but no Go document-section reader is configured")
	}
	return false, "answer_bearing_evidence_missing", nil
}

func hasRetrievalStepType(plan ragruntime.PlanProjection, stepType string) bool {
	for _, step := range plan.Steps {
		if strings.TrimSpace(step.StepType) == stepType {
			return true
		}
	}
	return false
}

func temporalRAGSynthesisPacketForRun(
	run execution.DurableRun,
	planRef string,
	evidenceRef string,
) (ragSynthesisPacket, error) {
	raw, ok := run.Metadata["temporal_rag"].(map[string]any)
	if !ok {
		return ragSynthesisPacket{}, fmt.Errorf("run metadata.temporal_rag is required")
	}
	if strings.TrimSpace(fmt.Sprint(raw["plan_ref"])) != strings.TrimSpace(planRef) {
		return ragSynthesisPacket{}, fmt.Errorf("rag plan ref drift")
	}
	if strings.TrimSpace(fmt.Sprint(raw["evidence_ref"])) != strings.TrimSpace(evidenceRef) {
		return ragSynthesisPacket{}, fmt.Errorf("rag evidence ref drift")
	}
	plan, err := decodeRAGProjection[ragruntime.PlanProjection](raw["plan"])
	if err != nil {
		return ragSynthesisPacket{}, err
	}
	selection, err := decodeRAGProjection[ragruntime.EvidenceSelectionResult](raw["evidence_selection"])
	if err != nil {
		return ragSynthesisPacket{}, err
	}
	packet := ragSynthesisPacket{
		OutputSchemaID:          "rag_answer_v2",
		PreviousEvidenceContext: previousEvidenceContextForSynthesis(plan),
		PromptRefs:              []string{"prompt://rag/rag_answer_v2"},
		QueryIntent:             plan.QueryText,
		RequestID:               run.RequestID,
		RunID:                   run.RunID,
		SelectedEvidence:        selection.SelectedEvidence,
		StepID:                  "synthesis",
	}
	if memoryItems, memoryRef := memoryContextForRAG(run); memoryRef != "" {
		packet.MemoryRef = memoryRef
		packet.MemoryContext = memoryItems
	}
	hash, err := ragruntime.HashProjection(packet)
	if err != nil {
		return ragSynthesisPacket{}, err
	}
	packet.PayloadSHA256 = hash
	if err := validateRAGSynthesisPacket(packet); err != nil {
		return ragSynthesisPacket{}, err
	}
	return packet, nil
}

func previousEvidenceContextForSynthesis(plan ragruntime.PlanProjection) []ragruntime.PreviousEvidenceContextItem {
	if plan.PreviousEvidenceReuse == nil {
		return nil
	}
	if plan.PreviousEvidenceReuse.Decision != "contextual_anchor_for_new_retrieval" {
		return nil
	}
	return append([]ragruntime.PreviousEvidenceContextItem{}, plan.PreviousEvidenceReuse.ProofRefs...)
}

func temporalRAGSynthesisRefFromRun(run execution.DurableRun) (string, bool) {
	raw, ok := run.Metadata["temporal_rag"].(map[string]any)
	if !ok {
		return "", false
	}
	synthesisRef := strings.TrimSpace(optionalStringFromAny(raw["synthesis_ref"]))
	if synthesisRef == "" {
		return "", false
	}
	return synthesisRef, true
}

func temporalGroundingVerificationForRun(
	run execution.DurableRun,
	evidenceRef string,
	synthesisRef string,
) (ragruntime.GroundingVerificationResult, error) {
	raw, ok := run.Metadata["temporal_rag"].(map[string]any)
	if !ok {
		return ragruntime.GroundingVerificationResult{}, fmt.Errorf("run metadata.temporal_rag is required")
	}
	if strings.TrimSpace(fmt.Sprint(raw["evidence_ref"])) != strings.TrimSpace(evidenceRef) {
		return ragruntime.GroundingVerificationResult{}, fmt.Errorf("rag evidence ref drift")
	}
	if strings.TrimSpace(fmt.Sprint(raw["synthesis_ref"])) != strings.TrimSpace(synthesisRef) {
		return ragruntime.GroundingVerificationResult{}, fmt.Errorf("rag synthesis ref drift")
	}
	selection, err := decodeRAGProjection[ragruntime.EvidenceSelectionResult](raw["evidence_selection"])
	if err != nil {
		return ragruntime.GroundingVerificationResult{}, err
	}
	response, err := temporalFinalizedResponseFromRun(run, synthesisRef)
	if err != nil {
		return ragruntime.GroundingVerificationResult{}, err
	}
	answerText := strings.TrimSpace(fmt.Sprint(response["answer_text"]))
	if answerText == "" {
		return ragruntime.GroundingVerificationResult{}, errors.New("answer_text is required for grounding")
	}
	sourceRefs := make([]string, 0, len(selection.SelectedEvidence))
	for _, item := range selection.SelectedEvidence {
		if strings.TrimSpace(item.SourceRef) != "" {
			sourceRefs = append(sourceRefs, strings.TrimSpace(item.SourceRef))
		}
	}
	if len(sourceRefs) == 0 {
		return ragruntime.GroundingVerificationResult{}, errors.New("source refs are required for grounding")
	}
	return ragruntime.GroundingVerificationResult{
		ClaimSupportCount: len(sourceRefs),
		GroundingRef:      temporalProjectionRef(run.RunID, "grounding/verify"),
		RunID:             run.RunID,
		SchemaVersion:     "grounding_verification_result_v1",
		SourceRefs:        sourceRefs,
		UnsupportedFields: []string{},
		Verdict:           "supported",
		VerificationKind:  "evidence_integrity",
	}, nil
}

func decodeRAGProjection[T any](value any) (T, error) {
	var decoded T
	encoded, err := json.Marshal(value)
	if err != nil {
		return decoded, fmt.Errorf("encode rag projection: %w", err)
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return decoded, fmt.Errorf("decode rag projection: %w", err)
	}
	return decoded, nil
}

func nestedAny(root any, path ...string) any {
	current := root
	for _, segment := range path {
		record, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = record[segment]
	}
	return current
}

func positiveIntFromAny(values ...any) int {
	for _, value := range values {
		switch typed := value.(type) {
		case int:
			if typed > 0 {
				return typed
			}
		case int64:
			if typed > 0 {
				return int(typed)
			}
		case float64:
			if typed > 0 {
				return int(typed)
			}
		}
	}
	return 0
}

func retrievalLookupRunID(result ragruntime.RetrievalLookupResult) string {
	return strings.TrimSpace(result.Request.RunID)
}
