package executionaudit

func (e *Emitter) recordEmit() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.emittedCount++
}

func (e *Emitter) recordFailure(err error) {
	errorMessage := err.Error()
	e.mu.Lock()
	e.failedCount++
	e.lastError = errorMessage
	e.mu.Unlock()
	e.logger.Warn(
		"execution_control.execution_audit_failed",
		"error",
		statusSafeLastError(errorMessage, "execution audit delivery error"),
	)
}

func (e *Emitter) setLastError(value string) {
	e.mu.Lock()
	e.lastError = value
	e.mu.Unlock()
	e.logger.Warn(
		"execution_control.execution_audit_unavailable",
		"error",
		statusSafeLastError(value, "execution audit configuration error"),
	)
}
