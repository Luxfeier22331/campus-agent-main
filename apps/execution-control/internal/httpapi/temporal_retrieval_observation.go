package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

type retrievalRuntimeObservationInput struct {
	CanonicalIndexTruth string
	CandidateCount      int
	FailureKind         string
	Plan                ragruntime.PlanProjection
	ReferenceCount      int
	RetrievalMode       string
	Run                 execution.DurableRun
	StartedAt           time.Time
	StepID              string
	TerminalState       string
	TraceID             string
	QueryLatencyMS      int64
}

func (s *Server) emitRetrievalRuntimeObservation(
	ctx context.Context,
	input retrievalRuntimeObservationInput,
) error {
	if s == nil || s.telemetry == nil {
		return nil
	}
	latency := time.Since(input.StartedAt)
	if input.QueryLatencyMS > 0 {
		latency = time.Duration(input.QueryLatencyMS) * time.Millisecond
	}
	event := retrievalRuntimeObservationEvent(input, latency)
	if err := s.telemetry.Emit(ctx, event); err != nil {
		return fmt.Errorf("retrieval runtime observation telemetry delivery failed: %w", err)
	}
	return nil
}

func retrievalRuntimeObservationEvent(
	input retrievalRuntimeObservationInput,
	latency time.Duration,
) telemetry.Event {
	return telemetry.Event{
		CanonicalIndexTruth:   firstNonEmptyText(input.CanonicalIndexTruth, "true"),
		CandidateCount:        input.CandidateCount,
		Collection:            input.Plan.Collection,
		ConversationID:        input.Run.ConversationID,
		Corpus:                input.Plan.Corpus,
		FailureCode:           input.FailureKind,
		FailureKind:           input.FailureKind,
		Latency:               latency,
		Name:                  "retrieval.runtime_observation",
		Outcome:               input.TerminalState,
		PlanID:                input.Plan.PlanID,
		QueryMode:             input.Plan.QueryMode,
		QuerySHA256:           sha256Hex(input.Plan.QueryText),
		ReferenceCount:        input.ReferenceCount,
		RequestID:             input.Run.RequestID,
		RequestedTool:         "knowledge_query",
		RetrievalMode:         firstNonEmptyText(input.RetrievalMode, retrievalModeForRAGPlan(input.Plan)),
		RunID:                 input.Run.RunID,
		SelectedTool:          firstNonEmptyText(input.Run.SelectedTool, "knowledge_query"),
		StepID:                firstNonEmptyText(input.StepID, "retrieval.indexed_lookup"),
		TerminalState:         input.TerminalState,
		TargetVersionIDsCount: versionIDCountForRAGPlan(input.Plan),
		TraceID:               firstNonEmptyText(input.TraceID, input.Run.TraceID),
		UserID:                input.Run.OwnerUserID,
	}
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func retrievalModeForRAGPlan(plan ragruntime.PlanProjection) string {
	return "indexed"
}

func versionIDCountForRAGPlan(plan ragruntime.PlanProjection) int {
	if plan.VersionQuery == nil {
		return 0
	}
	count := 0
	if strings.TrimSpace(plan.VersionQuery.VersionID) != "" {
		count++
	}
	if strings.TrimSpace(plan.VersionQuery.CompareToVersionID) != "" {
		count++
	}
	return count
}
