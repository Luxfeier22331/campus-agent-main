package httpapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) LiveSourceLookupActivity(
	ctx context.Context,
	input temporalruntime.LiveSourceLookupActivityInput,
) (temporalruntime.LiveSourceLookupActivityOutput, error) {
	if strings.TrimSpace(input.RAGPlanRef) == "" {
		return temporalruntime.LiveSourceLookupActivityOutput{}, fmt.Errorf("rag_plan_ref is required")
	}
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.LiveSourceLookupActivityOutput{}, err
	}
	plan, err := temporalRAGPlanProjectionFromRun(run, input.RAGPlanRef)
	if err != nil {
		return s.failLiveSourceLookupActivity(ctx, run, "rag_plan_projection_missing", err)
	}
	stepTypes, err := normalizeLiveSourceLookupStepTypes(input.StepTypes)
	if err != nil {
		return s.failLiveSourceLookupActivity(ctx, run, "rag_live_source_lookup_plan_invalid", err)
	}
	startedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          "knowledge_query",
		Run:           run,
		Status:        "started",
		StepID:        "retrieval.live_source_lookup",
		StepKind:      "retrieval",
		TaskQueue:     temporalruntime.KnowledgeActivityTaskQueueForActivity(temporalruntime.LiveSourceLookupActivityName),
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: temporalProjectionRef(run.RunID, "retrieval/live-source-lookup"),
		Payload: map[string]any{
			"collection":            plan.Collection,
			"corpus":                plan.Corpus,
			"query_mode":            plan.QueryMode,
			"retrieval_mode":        "live_assisted",
			"step_types":            append([]string{}, stepTypes...),
			"canonical_index_truth": false,
		},
	}); err != nil {
		return temporalruntime.LiveSourceLookupActivityOutput{}, err
	}
	result, err := s.ragLiveSourceLookup(ctx, plan, stepTypes)
	if err != nil {
		if emitErr := s.emitRetrievalRuntimeObservation(ctx, retrievalRuntimeObservationInput{
			CandidateCount:      0,
			CanonicalIndexTruth: "false",
			FailureKind:         "retrieval_live_source_lookup_failed",
			Plan:                plan,
			ReferenceCount:      0,
			RetrievalMode:       "live_assisted",
			Run:                 run,
			StartedAt:           startedAt,
			StepID:              "retrieval.live_source_lookup",
			TerminalState:       "failed_closed",
			TraceID:             input.TraceID,
		}); emitErr != nil {
			return temporalruntime.LiveSourceLookupActivityOutput{}, emitErr
		}
		return s.failLiveSourceLookupActivity(ctx, run, "retrieval_live_source_lookup_failed", err)
	}
	lookupRef := temporalProjectionRef(run.RunID, "retrieval/live-source-lookup")
	if err := s.replaceTemporalRAGMetadata(ctx, run, func(metadata map[string]any) {
		metadata["lookup_ref"] = lookupRef
		metadata["lookup_result"] = result
	}); err != nil {
		return temporalruntime.LiveSourceLookupActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          "knowledge_query",
		Run:           run,
		Status:        "completed",
		StepID:        "retrieval.live_source_lookup",
		StepKind:      "retrieval",
		TaskQueue:     temporalruntime.KnowledgeActivityTaskQueueForActivity(temporalruntime.LiveSourceLookupActivityName),
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "retrieval_lookup_projection",
		ProjectionRef: lookupRef,
		Payload: map[string]any{
			"candidate_count":       result.CandidateCount,
			"canonical_index_truth": false,
			"freshness_gate":        result.FreshnessGate,
			"lookup_ref":            lookupRef,
			"payload_sha256":        result.PayloadSHA256,
			"query_latency_ms":      result.QueryLatencyMS,
			"retrieval_mode":        "live_assisted",
			"step_types":            append([]string{}, stepTypes...),
		},
	}); err != nil {
		return temporalruntime.LiveSourceLookupActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":activity-retrieval-live-source-lookup-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeActivityCompleted,
		OccurredAt:           time.Now().UTC(),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"activity":        "retrieval.live_source_lookup",
			"candidate_count": result.CandidateCount,
			"lookup_ref":      lookupRef,
			"retrieval_mode":  "live_assisted",
		},
	}); err != nil {
		return temporalruntime.LiveSourceLookupActivityOutput{}, err
	}
	if err := s.emitRetrievalRuntimeObservation(ctx, retrievalRuntimeObservationInput{
		CandidateCount:      result.CandidateCount,
		CanonicalIndexTruth: "false",
		FailureKind:         "",
		Plan:                plan,
		ReferenceCount:      len(result.Candidates),
		RetrievalMode:       "live_assisted",
		Run:                 run,
		StartedAt:           startedAt,
		StepID:              "retrieval.live_source_lookup",
		TerminalState:       "completed",
		TraceID:             input.TraceID,
		QueryLatencyMS:      result.QueryLatencyMS,
	}); err != nil {
		return temporalruntime.LiveSourceLookupActivityOutput{}, err
	}
	return temporalruntime.LiveSourceLookupActivityOutput{
		LookupRef: lookupRef,
		RunID:     run.RunID,
		Status:    "completed",
	}, nil
}

func normalizeLiveSourceLookupStepTypes(stepTypes []string) ([]string, error) {
	if len(stepTypes) == 0 {
		return nil, fmt.Errorf("step_types is required")
	}
	normalized := make([]string, 0, len(stepTypes))
	for _, raw := range stepTypes {
		stepType := strings.TrimSpace(raw)
		switch stepType {
		case "freshness_gate", "live_source_lookup":
			normalized = append(normalized, stepType)
		case "":
			return nil, fmt.Errorf("step_types must not contain empty values")
		default:
			return nil, fmt.Errorf("unsupported live_source_lookup step_type %q", stepType)
		}
	}
	return normalized, nil
}

func (s *Server) ragLiveSourceLookup(
	ctx context.Context,
	plan ragruntime.PlanProjection,
	stepTypes []string,
) (ragruntime.RetrievalLookupResult, error) {
	if !containsString(stepTypes, "live_source_lookup") {
		return ragruntime.RetrievalLookupResult{}, fmt.Errorf("live_source_lookup requires an executable live_source_lookup step")
	}
	if strings.TrimSpace(plan.Corpus) != "official_web" {
		return ragruntime.RetrievalLookupResult{}, fmt.Errorf("live_source_lookup is only admitted for official_web corpus")
	}
	switch strings.TrimSpace(plan.QueryMode) {
	case "freshness_sensitive", "live_assisted":
	default:
		return ragruntime.RetrievalLookupResult{}, fmt.Errorf("live_source_lookup query_mode = %q is not admitted", plan.QueryMode)
	}
	freshnessGate, err := liveSourceLookupFreshnessGate(plan, stepTypes)
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	started := time.Now()
	searchMaxResults := plan.TopK
	if searchMaxResults <= 0 || searchMaxResults > publicWebSearchMaxResults {
		searchMaxResults = publicWebSearchMaxResults
	}
	searchResult, _, outcome := s.executePublicWebSearch(ctx, publicWebSearchPayload{
		MaxResults: &searchMaxResults,
		QueryText:  plan.QueryText,
	})
	if outcome != "resolved_current" {
		return ragruntime.RetrievalLookupResult{}, fmt.Errorf("public_web_search outcome = %q", outcome)
	}
	sources, ok := searchResult["sources"].([]publicWebSearchSource)
	if !ok || len(sources) == 0 {
		return ragruntime.RetrievalLookupResult{}, fmt.Errorf("public_web_search returned no sanitized sources")
	}
	asOf := time.Now().UTC().Format(time.RFC3339)
	candidates := make([]ragruntime.EvidenceRef, 0, len(sources))
	for index, source := range sources {
		candidates = append(candidates, liveEvidenceRefFromPublicWebSource(plan, source, index, asOf))
	}
	result := ragruntime.RetrievalLookupResult{
		CandidateCount: len(candidates),
		Candidates:     candidates,
		FreshnessGate:  freshnessGate,
		LookupRef:      temporalProjectionRef(plan.RunID, "retrieval/live-source-lookup"),
		QueryLatencyMS: time.Since(started).Milliseconds(),
		Request: ragruntime.RetrievalLookupRequest{
			CollectionAlias: plan.Corpus + "/" + plan.Collection,
			QueryMode:       plan.QueryMode,
			QueryText:       plan.QueryText,
			RunID:           plan.RunID,
			TopK:            searchMaxResults,
		},
		SchemaVersion: "retrieval_lookup_result_v1",
	}
	hash, err := ragruntime.HashProjection(result)
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	result.PayloadSHA256 = hash
	return result, nil
}

func liveSourceLookupFreshnessGate(
	plan ragruntime.PlanProjection,
	stepTypes []string,
) (*ragruntime.FreshnessGateVerdict, error) {
	mode := strings.TrimSpace(plan.QueryMode)
	hasGate := containsString(stepTypes, "freshness_gate")
	if mode == "freshness_sensitive" && !hasGate {
		return nil, fmt.Errorf("freshness_sensitive plan requires freshness_gate step")
	}
	if mode == "live_assisted" && hasGate {
		return nil, fmt.Errorf("live_assisted plan must not include freshness_gate step")
	}
	if !hasGate {
		return nil, nil
	}
	return &ragruntime.FreshnessGateVerdict{
		Decision:     "allowed",
		Mode:         mode,
		Required:     true,
		SourcePolicy: "official_web_public_only",
		VerifiedAt:   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func liveEvidenceRefFromPublicWebSource(
	plan ragruntime.PlanProjection,
	source publicWebSearchSource,
	index int,
	asOf string,
) ragruntime.EvidenceRef {
	sourceID := firstNonEmptyText(source.EvidenceID, source.URL)
	score := 1.0 - float64(index)*0.01
	if score < 0.01 {
		score = 0.01
	}
	return ragruntime.EvidenceRef{
		Anchor:              sourceID,
		AsOf:                asOf,
		CanonicalIndexTruth: false,
		CanonicalURL:        source.URL,
		ChunkID:             sourceID,
		DocumentID:          sourceID,
		Excerpt:             source.Snippet,
		IsAnswerBearing:     true,
		IsCurrent:           true,
		LatestURL:           source.URL,
		RevisionTrack:       "source-faithful",
		RetrievalMode:       "live_assisted",
		RootUnitID:          sourceID,
		Score:               score,
		SourceChannel:       "official_web",
		SourceID:            sourceID,
		SourcePolicyVerdict: "allowed",
		SourceRef:           "source://official_web/live/" + sourceID,
		SourceTrustTier:     "T2",
		SourceUnitKey:       source.URL,
		SourceUnitKind:      "public_web_url",
		SpanRef:             "span://official_web/live/" + sourceID + "#snippet",
		Title:               source.Title,
		VersionID:           "live:" + asOf,
	}
}
