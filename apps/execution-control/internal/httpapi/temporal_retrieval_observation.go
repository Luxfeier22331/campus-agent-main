package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

type retrievalRuntimeObservationInput struct {
	CandidateCount int
	FailureKind    string
	Plan           ragruntime.PlanProjection
	ReferenceCount int
	Run            execution.DurableRun
	StartedAt      time.Time
	TerminalState  string
	TraceID        string
	QueryLatencyMS int64
}

func (s *Server) emitRetrievalRuntimeObservation(
	ctx context.Context,
	input retrievalRuntimeObservationInput,
) {
	if s == nil || s.telemetry == nil {
		return
	}
	latency := time.Since(input.StartedAt)
	if input.QueryLatencyMS > 0 {
		latency = time.Duration(input.QueryLatencyMS) * time.Millisecond
	}
	event := retrievalRuntimeObservationEvent(input, latency)
	if err := s.telemetry.Emit(ctx, event); err != nil && s.logger != nil {
		s.logger.Warn("execution_control.retrieval_runtime_observation_unavailable", "error", err.Error())
	}
}

func retrievalRuntimeObservationEvent(
	input retrievalRuntimeObservationInput,
	latency time.Duration,
) telemetry.Event {
	return telemetry.Event{
		CanonicalIndexTruth:   "true",
		CandidateCount:        input.CandidateCount,
		Collection:            input.Plan.Collection,
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
		RequestedCapability:   "knowledge",
		RetrievalMode:         retrievalModeForRAGPlan(input.Plan),
		RunID:                 input.Run.RunID,
		StepID:                "retrieval.indexed_lookup",
		TerminalState:         input.TerminalState,
		TargetVersionIDsCount: versionIDCountForRAGPlan(input.Plan),
		TraceID:               firstNonEmptyText(input.TraceID, input.Run.TraceID),
	}
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func retrievalModeForRAGPlan(plan ragruntime.PlanProjection) string {
	if plan.QueryMode == "live_assisted" {
		return "live_assisted"
	}
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
