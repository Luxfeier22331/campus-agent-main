export function runTelemetrySideEffectWithoutRequestFailure(operation: () => void): void {
	try {
		operation();
	} catch {
		// Telemetry must never become a request-path failure source.
	}
}
