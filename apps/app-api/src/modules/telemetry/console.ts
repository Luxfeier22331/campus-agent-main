import type { RuntimeEventSink } from "./runtime-event";
import { sanitizeRuntimeEventPayload } from "./runtime-event";

interface ConsoleLike {
	info(message: unknown): void;
}

export function createConsoleRuntimeEventSink(
	consoleImplementation: ConsoleLike = console,
): RuntimeEventSink {
	return {
		emit(payload) {
			const sanitized = sanitizeRuntimeEventPayload(payload);
			if (sanitized) {
				consoleImplementation.info({
					...sanitized,
					schema_version: "runtime-lifecycle-event-v1",
					source: "app-api.lifecycle",
				});
			}
			return Promise.resolve();
		},
	};
}
