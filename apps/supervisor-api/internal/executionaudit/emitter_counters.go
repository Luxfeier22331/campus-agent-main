package executionaudit

func (e *Emitter) recordEmit() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.emittedCount++
}

func (e *Emitter) recordDrop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.droppedCount++
}

func (e *Emitter) recordRetry() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.retriedCount++
}

func (e *Emitter) recordSpooled(count uint64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.spooledCount += count
}

func (e *Emitter) recordSpoolDrained(count uint64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.spoolDrainedCount += count
}

func (e *Emitter) recordSpoolDropped() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.spoolDroppedCount++
}

func (e *Emitter) recordFailure(err error) {
	e.mu.Lock()
	e.failedCount++
	e.lastError = err.Error()
	e.mu.Unlock()
	e.logger.Warn("supervisor_api.execution_audit_failed", "error", err.Error())
}

func (e *Emitter) setLastError(value string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastError = value
	e.logger.Warn("supervisor_api.execution_audit_unavailable", "error", value)
}
