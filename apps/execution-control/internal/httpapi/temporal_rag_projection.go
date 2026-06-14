package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
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
) (ragruntime.PlanProjection, error) {
	payload, ok := run.Metadata["execution_payload"].(map[string]any)
	if !ok {
		return ragruntime.PlanProjection{}, errors.New("run metadata.execution_payload must be an object")
	}
	queryText := firstNonEmptyText(payload["user_goal"])
	if queryText == "" {
		return ragruntime.PlanProjection{}, errors.New("rag query_text is required")
	}
	scope, err := ragScopeForRun(run, payload, queryText, queryServingScopesPath)
	if err != nil {
		return ragruntime.PlanProjection{}, err
	}
	topK := positiveIntFromAny(payload["top_k"])
	if topK <= 0 {
		topK = 8
	}
	queryMode, versionQuery := ragVersionQueryForRun(payload)
	plan := ragruntime.PlanProjection{
		Collection:               scope.Collection,
		CollectionAlias:          scope.Collection,
		Corpus:                   scope.Corpus,
		NoWideningPolicy:         true,
		PlanID:                   ragPlanID(scope, queryMode),
		QueryMode:                queryMode,
		QueryText:                queryText,
		RequestID:                run.RequestID,
		RequiredEvidenceContract: "answer_bearing_evidence",
		RunID:                    run.RunID,
		SchemaVersion:            "rag_plan_projection_v1",
		StepID:                   "rag.plan",
		TopK:                     topK,
		VersionQuery:             versionQuery,
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

func ragPlanID(scope runtimepolicy.Scope, queryMode string) string {
	return "rag:" + scope.Corpus + ":" + scope.Collection + ":" + queryMode
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
) (ragruntime.EvidenceSelectionResult, error) {
	if lookup.CandidateCount <= 0 || len(lookup.Candidates) == 0 {
		return ragruntime.EvidenceSelectionResult{}, errors.New("candidate evidence is required")
	}
	selected := lookup.Candidates
	if len(selected) > 8 {
		selected = selected[:8]
	}
	selection := ragruntime.EvidenceSelectionResult{
		CandidateCount:          len(lookup.Candidates),
		CoverageStatus:          "supported",
		EvidenceRef:             temporalProjectionRef(run.RunID, "evidence/selection"),
		PayloadSHA256:           "",
		RejectionReasons:        []string{},
		RunID:                   run.RunID,
		SchemaVersion:           "evidence_selection_result_v1",
		SelectedEvidence:        selected,
		SupportingEvidenceCount: len(selected),
	}
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
		OutputSchemaID:   "rag_answer_v2",
		PromptRefs:       []string{"prompt://rag/rag_answer_v2"},
		QueryIntent:      plan.QueryText,
		RequestID:        run.RequestID,
		RunID:            run.RunID,
		SelectedEvidence: selection.SelectedEvidence,
		StepID:           "synthesis",
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
