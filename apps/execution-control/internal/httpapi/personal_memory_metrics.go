package httpapi

import (
	"context"
	"time"
)

func (s *Server) recordPersonalMemoryOperation(
	operation string,
	outcome string,
	failureKind string,
	startedAt time.Time,
	selectedItems int,
	selectedChars int,
) {
	if s == nil {
		return
	}
	duration := time.Since(startedAt)
	if s.metrics != nil {
		s.metrics.RecordPersonalMemoryOperation(
			operation,
			outcome,
			failureKind,
			duration,
			selectedItems,
			selectedChars,
		)
	}
	if s.telemetry != nil {
		s.telemetry.RecordPersonalMemoryOperation(
			context.Background(),
			operation,
			outcome,
			failureKind,
			duration,
			selectedItems,
			selectedChars,
		)
	}
}

func (s *Server) recordPersonalMemoryReceipt(ctx context.Context, commandKind string, status string, outcome string) {
	if s == nil || s.telemetry == nil {
		return
	}
	s.telemetry.RecordPersonalMemoryReceipt(ctx, commandKind, status, outcome)
}
