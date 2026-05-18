package executionaudit

import "sync/atomic"

func (e *Emitter) recordEmit() {
	atomic.AddUint64(&e.emittedCount, 1)
}

func (e *Emitter) recordFailure(err error) {
	atomic.AddUint64(&e.failedCount, 1)
	e.lastError = err.Error()
	e.logger.Warn("supervisor_api.execution_audit_failed", "error", err.Error())
}

func (e *Emitter) setLastError(value string) {
	e.lastError = value
	e.logger.Warn("supervisor_api.execution_audit_unavailable", "error", value)
}
