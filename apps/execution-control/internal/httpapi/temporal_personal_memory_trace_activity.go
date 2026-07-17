package httpapi

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) PurgePersonalMemoryTracesActivity(
	ctx context.Context,
	input temporalruntime.PersonalMemoryTraceMaintenanceActivityInput,
) (temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput, error) {
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "memory.trace.purge", 10*time.Second)
	defer stopHeartbeat()
	runtimeUserID, hindsightUserID, eraseCutoff, err := s.personalMemoryTraceScope(input.Command)
	if err != nil {
		return temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput{}, err
	}
	runtimeDeleted, err := s.runtimeTraceStore.PurgeUserTracesBefore(ctx, runtimeUserID, eraseCutoff)
	if err != nil {
		return temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput{}, sanitizedTemporalApplicationError(
			"personal_memory_runtime_trace_purge_failed",
			err,
			false,
		)
	}
	hindsightDeleted, err := s.personalMemoryTraceStore.PurgeUserTraces(ctx, hindsightUserID)
	if err != nil {
		return temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput{}, sanitizedTemporalApplicationError(
			"personal_memory_hindsight_trace_purge_failed",
			err,
			false,
		)
	}
	return temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput{
		DeletedTraceCount: runtimeDeleted + hindsightDeleted,
	}, nil
}

func (s *Server) VerifyPersonalMemoryTracesActivity(
	ctx context.Context,
	input temporalruntime.PersonalMemoryTraceMaintenanceActivityInput,
) (temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput, error) {
	runtimeUserID, hindsightUserID, eraseCutoff, err := s.personalMemoryTraceScope(input.Command)
	if err != nil {
		return temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput{}, err
	}
	runtimeRemaining, err := s.runtimeTraceStore.CountUserTracesBefore(ctx, runtimeUserID, eraseCutoff)
	if err != nil {
		return temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput{}, sanitizedTemporalApplicationError(
			"personal_memory_runtime_trace_verify_failed",
			err,
			false,
		)
	}
	hindsightRemaining, err := s.personalMemoryTraceStore.CountUserTraces(ctx, hindsightUserID)
	if err != nil {
		return temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput{}, sanitizedTemporalApplicationError(
			"personal_memory_hindsight_trace_verify_failed",
			err,
			false,
		)
	}
	return temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput{
		RemainingTraceCount: runtimeRemaining + hindsightRemaining,
	}, nil
}

func (s *Server) personalMemoryTraceScope(
	command memoryruntime.PersonalMemoryCommandRequest,
) (string, string, time.Time, error) {
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(command); err != nil {
		return "", "", time.Time{}, sanitizedTemporalApplicationError("memory_command_invalid", err, true)
	}
	if strings.TrimSpace(command.CommandKind) != "owner_erase" {
		return "", "", time.Time{}, sanitizedTemporalApplicationError(
			"memory_trace_maintenance_invalid",
			errors.New("personal memory trace maintenance requires owner_erase"),
			true,
		)
	}
	if s.runtimeTraceStore == nil || s.personalMemoryTraceStore == nil || s.langfuseTraceErr != nil {
		return "", "", time.Time{}, sanitizedTemporalApplicationError(
			"memory_trace_maintenance_not_configured",
			s.langfuseTraceErr,
			false,
		)
	}
	eraseCutoff, err := time.Parse(time.RFC3339, strings.TrimSpace(command.SourceUpdatedAt))
	if err != nil {
		return "", "", time.Time{}, sanitizedTemporalApplicationError(
			"memory_trace_maintenance_invalid",
			errors.New("personal memory trace maintenance cutoff is invalid"),
			true,
		)
	}
	retiredGeneration := command.OwnerGeneration - 1
	if retiredGeneration < 1 {
		retiredGeneration = 1
	}
	return strings.TrimSpace(command.UserID), scopedHindsightBankID(
		s.config.PersonalMemoryOwnerSalt,
		command.TenantID,
		command.UserID,
		retiredGeneration,
	), eraseCutoff.UTC(), nil
}
