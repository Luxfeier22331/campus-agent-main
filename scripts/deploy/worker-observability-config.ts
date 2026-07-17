interface WorkerObservabilityExpectation {
	destinations: string[];
	surface: string;
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
	if (!(value && typeof value === "object" && !Array.isArray(value))) {
		throw new Error(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function expectEqual(actual: unknown, expected: unknown, name: string): void {
	if (actual !== expected) {
		throw new Error(`${name} must be ${JSON.stringify(expected)}.`);
	}
}

function expectDestinations(actual: unknown, expected: string[], name: string): void {
	const normalized = actual === undefined ? [] : actual;
	if (!Array.isArray(normalized) || JSON.stringify(normalized) !== JSON.stringify(expected)) {
		throw new Error(`${name} must be ${JSON.stringify(expected)}.`);
	}
}

export function assertApplicationLogOnlyObservability(
	value: unknown,
	expectation: WorkerObservabilityExpectation,
): void {
	const observability = requireRecord(value, `${expectation.surface} observability`);
	const logs = requireRecord(observability.logs, `${expectation.surface} observability.logs`);
	const traces = requireRecord(observability.traces, `${expectation.surface} observability.traces`);

	expectEqual(observability.enabled, true, `${expectation.surface} observability.enabled`);
	expectEqual(logs.enabled, true, `${expectation.surface} observability.logs.enabled`);
	expectEqual(
		logs.head_sampling_rate,
		1,
		`${expectation.surface} observability.logs.head_sampling_rate`,
	);
	expectEqual(
		logs.invocation_logs,
		false,
		`${expectation.surface} observability.logs.invocation_logs`,
	);
	expectEqual(logs.persist, false, `${expectation.surface} observability.logs.persist`);
	expectDestinations(
		logs.destinations,
		expectation.destinations,
		`${expectation.surface} observability.logs.destinations`,
	);
	expectEqual(traces.enabled, false, `${expectation.surface} observability.traces.enabled`);
	expectEqual(
		traces.head_sampling_rate,
		0,
		`${expectation.surface} observability.traces.head_sampling_rate`,
	);
	expectEqual(traces.persist, false, `${expectation.surface} observability.traces.persist`);
	expectDestinations(
		traces.destinations,
		[],
		`${expectation.surface} observability.traces.destinations`,
	);
}
