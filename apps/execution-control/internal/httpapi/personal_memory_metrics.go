package httpapi

import "time"

func (s *Server) recordPersonalMemoryOperation(
	operation string,
	outcome string,
	failureKind string,
	startedAt time.Time,
	selectedItems int,
	selectedChars int,
) {
	if s == nil || s.metrics == nil {
		return
	}
	s.metrics.RecordPersonalMemoryOperation(
		operation,
		outcome,
		failureKind,
		time.Since(startedAt),
		selectedItems,
		selectedChars,
	)
}
