package httpapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

func (s *Server) emitRagasEvalProjection(
	ctx context.Context,
	run execution.DurableRun,
	finalizedResponse map[string]any,
) error {
	if s == nil || s.telemetry == nil {
		return nil
	}
	event, err := ragasEvalProjectionEvent(run, finalizedResponse)
	if err != nil {
		return err
	}
	if strings.TrimSpace(event.Release) == "" {
		event.Release = strings.TrimSpace(s.config.RuntimeRelease)
	}
	if strings.TrimSpace(event.DeploymentEnvironment) == "" {
		event.DeploymentEnvironment = strings.TrimSpace(s.config.DeploymentEnvironment)
	}
	if err := s.telemetry.Emit(ctx, event); err != nil {
		return fmt.Errorf("ragas eval projection telemetry delivery failed: %w", err)
	}
	return nil
}

func ragasEvalProjectionEvent(
	run execution.DurableRun,
	finalizedResponse map[string]any,
) (telemetry.Event, error) {
	raw, ok := run.Metadata["temporal_rag"].(map[string]any)
	if !ok {
		return telemetry.Event{}, fmt.Errorf("run metadata.temporal_rag is required")
	}
	plan, err := decodeRAGProjection[ragruntime.PlanProjection](raw["plan"])
	if err != nil {
		return telemetry.Event{}, err
	}
	selection, err := decodeRAGProjection[ragruntime.EvidenceSelectionResult](
		raw["evidence_selection"],
	)
	if err != nil {
		return telemetry.Event{}, err
	}
	answerText := strings.TrimSpace(stringValue(finalizedResponse["answer_text"]))
	if answerText == "" {
		return telemetry.Event{}, fmt.Errorf("answer_text is required for ragas eval projection")
	}
	if strings.TrimSpace(plan.QueryText) == "" {
		return telemetry.Event{}, fmt.Errorf("query_text is required for ragas eval projection")
	}
	contexts, contextIDs := ragasRetrievedContextProjection(selection.SelectedEvidence)
	if len(contexts) == 0 || len(contextIDs) == 0 {
		return telemetry.Event{}, fmt.Errorf("retrieved contexts are required for ragas eval projection")
	}
	caseID := firstNonEmptyText(run.RequestID, run.RunID)
	return telemetry.Event{
		CanonicalIndexTruth:     "true",
		CandidateCount:          selection.CandidateCount,
		Collection:              plan.Collection,
		ConversationID:          run.ConversationID,
		Corpus:                  plan.Corpus,
		EvalAnswer:              answerText,
		EvalCaseID:              caseID,
		EvalQuestion:            strings.TrimSpace(plan.QueryText),
		EvalRetrievedContextIDs: contextIDs,
		EvalRetrievedContexts:   contexts,
		EvalSurfaceKey:          "execution-control.rag",
		EvalVariantID:           "go-rag-temporal",
		Name:                    "eval.ragas_projection",
		Outcome:                 "completed",
		PlanID:                  plan.PlanID,
		QueryMode:               plan.QueryMode,
		QuerySHA256:             sha256Hex(plan.QueryText),
		ReferenceCount:          len(selection.SelectedEvidence),
		RequestID:               run.RequestID,
		RequestedTool:           "knowledge_query",
		RetrievalMode:           retrievalModeForRAGPlan(plan),
		RunID:                   run.RunID,
		SelectedTool:            firstNonEmptyText(run.SelectedTool, "knowledge_query"),
		Status:                  "completed",
		StepID:                  "eval.ragas_projection",
		StepKind:                "eval",
		TerminalState:           "completed",
		TraceID:                 run.TraceID,
		UserID:                  run.OwnerUserID,
	}, nil
}

func ragasRetrievedContextProjection(
	evidence []ragruntime.EvidenceRef,
) ([]string, []string) {
	contexts := make([]string, 0, len(evidence))
	contextIDs := make([]string, 0, len(evidence))
	for _, item := range evidence {
		excerpt := strings.TrimSpace(item.Excerpt)
		contextID := firstNonEmptyText(
			item.SourceRef,
			item.SpanRef,
			strings.TrimSpace(item.SourceID)+":"+strings.TrimSpace(item.ChunkID),
		)
		if excerpt == "" || strings.Trim(contextID, ":") == "" {
			continue
		}
		contexts = append(contexts, excerpt)
		contextIDs = append(contextIDs, contextID)
	}
	return contexts, contextIDs
}
