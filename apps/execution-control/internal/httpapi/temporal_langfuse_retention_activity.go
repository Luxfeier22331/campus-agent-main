package httpapi

import (
	"context"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) PurgeLangfuseTraceRetentionActivity(
	ctx context.Context,
	input temporalruntime.LangfuseTraceRetentionActivityInput,
) (temporalruntime.LangfuseTraceRetentionActivityOutput, error) {
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "langfuse.trace.retention.purge", 10*time.Second)
	defer stopHeartbeat()
	if err := s.validateLangfuseTraceRetentionInput(input); err != nil {
		return temporalruntime.LangfuseTraceRetentionActivityOutput{}, err
	}
	runtimeCount, err := s.runtimeTraceStore.PurgeTracesBefore(ctx, input.Cutoff)
	if err != nil {
		return temporalruntime.LangfuseTraceRetentionActivityOutput{}, sanitizedTemporalApplicationError(
			"langfuse_runtime_trace_retention_failed",
			err,
			false,
		)
	}
	hindsightCount, err := s.personalMemoryTraceStore.PurgeTracesBefore(ctx, input.Cutoff)
	if err != nil {
		return temporalruntime.LangfuseTraceRetentionActivityOutput{}, sanitizedTemporalApplicationError(
			"langfuse_hindsight_trace_retention_failed",
			err,
			false,
		)
	}
	return temporalruntime.LangfuseTraceRetentionActivityOutput{
		HindsightTraceCount: hindsightCount,
		RuntimeTraceCount:   runtimeCount,
	}, nil
}

func (s *Server) VerifyLangfuseTraceRetentionActivity(
	ctx context.Context,
	input temporalruntime.LangfuseTraceRetentionActivityInput,
) (temporalruntime.LangfuseTraceRetentionActivityOutput, error) {
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "langfuse.trace.retention.verify", 10*time.Second)
	defer stopHeartbeat()
	if err := s.validateLangfuseTraceRetentionInput(input); err != nil {
		return temporalruntime.LangfuseTraceRetentionActivityOutput{}, err
	}
	runtimeCount, err := s.runtimeTraceStore.CountTracesBefore(ctx, input.Cutoff)
	if err != nil {
		return temporalruntime.LangfuseTraceRetentionActivityOutput{}, sanitizedTemporalApplicationError(
			"langfuse_runtime_trace_retention_verify_failed",
			err,
			false,
		)
	}
	hindsightCount, err := s.personalMemoryTraceStore.CountTracesBefore(ctx, input.Cutoff)
	if err != nil {
		return temporalruntime.LangfuseTraceRetentionActivityOutput{}, sanitizedTemporalApplicationError(
			"langfuse_hindsight_trace_retention_verify_failed",
			err,
			false,
		)
	}
	return temporalruntime.LangfuseTraceRetentionActivityOutput{
		HindsightTraceCount: hindsightCount,
		RuntimeTraceCount:   runtimeCount,
	}, nil
}

func (s *Server) validateLangfuseTraceRetentionInput(
	input temporalruntime.LangfuseTraceRetentionActivityInput,
) error {
	if input.Cutoff.IsZero() {
		return sanitizedTemporalApplicationError(
			"langfuse_trace_retention_invalid",
			errors.New("Langfuse trace retention cutoff is required"),
			true,
		)
	}
	if s.runtimeTraceStore == nil || s.personalMemoryTraceStore == nil || s.langfuseTraceErr != nil {
		return sanitizedTemporalApplicationError(
			"langfuse_trace_maintenance_not_configured",
			s.langfuseTraceErr,
			true,
		)
	}
	return nil
}
