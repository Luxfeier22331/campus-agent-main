import { AsyncLocalStorage } from "node:async_hooks";
import { normalizeAppApiRoute } from "./app/route-normalization";

interface DiagnosticContext {
	route: string;
	cf_ray: string | null;
	job?: string;
	reported: WeakSet<object>;
}
const contextStorage = new AsyncLocalStorage<DiagnosticContext>();
const errorTypes = new Set([
	"Error",
	"TypeError",
	"RangeError",
	"AggregateError",
	"APIError",
	"DatabaseError",
	"DrizzleQueryError",
]);
const networkClasses: Record<string, string> = {
	ETIMEDOUT: "network_timeout",
	ECONNRESET: "connection_reset",
	EPIPE: "connection_reset",
	ECONNREFUSED: "connection_refused",
	ENOTFOUND: "dns_failure",
	EAI_AGAIN: "dns_failure",
};

export function runtimeErrorType(error: unknown): string {
	return error instanceof Error && errorTypes.has(error.name) ? error.name : "UnknownError";
}

export function databaseFailureMetadata(error: unknown): {
	failure_class: string;
	dependency_code: string | null;
} {
	const seen = new Set<object>();
	let current = error;
	let queryError = false;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
		if (seen.has(current)) {
			break;
		}
		seen.add(current);
		const record = current as { name?: unknown; code?: unknown; cause?: unknown };
		queryError ||= record.name === "DrizzleQueryError";
		const code = typeof record.code === "string" ? record.code : "";
		if (Object.hasOwn(networkClasses, code)) {
			return { failure_class: networkClasses[code] ?? "unknown", dependency_code: code };
		}
		if (/^[0-9A-Z]{5}$/.test(code)) {
			const failure_class =
				code === "57014"
					? "query_cancelled"
					: code === "53300"
						? "connection_limit"
						: code.startsWith("08")
							? "connection_failure"
							: code.startsWith("28")
								? "database_authentication_failure"
								: ["57P01", "57P02", "57P03"].includes(code)
									? "database_unavailable"
									: code.startsWith("23")
										? "constraint_violation"
										: "query_failure";
			return { failure_class, dependency_code: code };
		}
		current = record.cause;
	}
	return { failure_class: queryError ? "query_failure" : "unknown", dependency_code: null };
}

export function withRequestDiagnostics<T>(request: Request, run: () => T): T {
	const ray = request.headers.get("cf-ray");
	return contextStorage.run(
		{
			route: normalizeAppApiRoute(request.url, request.method),
			reported: new WeakSet(),
			cf_ray: ray && /^[a-zA-Z0-9-]{1,64}$/.test(ray) ? ray : null,
		},
		run,
	);
}

export function withScheduledDiagnostics<T>(job: string, run: () => T): T {
	return contextStorage.run(
		{ route: "scheduled", cf_ray: null, job, reported: new WeakSet() },
		run,
	);
}

export function markRuntimeFailureReported(error: object): void {
	contextStorage.getStore()?.reported.add(error);
}

export function reportRuntimeFailure(
	error: unknown,
	input: { source: string; error_code: string; operation?: string },
): void {
	if (error && typeof error === "object") {
		if (contextStorage.getStore()?.reported.has(error)) {
			return;
		}
		contextStorage.getStore()?.reported.add(error);
	}
	console.error({
		...input,
		error_type: runtimeErrorType(error),
		...databaseFailureMetadata(error),
		route: contextStorage.getStore()?.route ?? null,
		cf_ray: contextStorage.getStore()?.cf_ray ?? null,
		...(contextStorage.getStore()?.job ? { job: contextStorage.getStore()?.job } : {}),
	});
}

export function safeRuntimeFailure(error: unknown, source: string): Error {
	reportRuntimeFailure(error, { source, error_code: "runtime_operation_failed" });
	const safe = new Error("Runtime operation failed.");
	markRuntimeFailureReported(safe);
	return safe;
}
