export function normalizeString(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function runTelemetrySideEffectWithoutRequestFailure(operation: () => void): void {
	try {
		operation();
	} catch {
		// Telemetry must never become a request-path failure source.
	}
}

export async function runTelemetryAsyncSideEffectWithoutRequestFailure(
	operation: () => Promise<void>,
): Promise<void> {
	try {
		await operation();
	} catch {
		// Telemetry must never become a request-path failure source.
	}
}
