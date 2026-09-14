import type {
	DBAdapter,
	DBAdapterInstance,
	DBTransactionAdapter,
} from "@better-auth/core/db/adapter";
import { APIError, isAPIError } from "better-auth/api";
import { AppApiRouteError } from "../../http";
import {
	databaseFailureMetadata,
	markRuntimeFailureReported,
	reportRuntimeFailure,
} from "../../runtime-diagnostics";

export class AuthDependencyFailure extends APIError {
	constructor() {
		super("SERVICE_UNAVAILABLE", {
			code: "dependency_not_ready",
			message: "Authentication service is temporarily unavailable.",
		});
		markRuntimeFailureReported(this);
	}
}

/** Translate before the SDK's session/signup handlers can hide the database failure. */
export async function runAuthDatabaseOperation<T>(
	operation: string,
	run: () => Promise<T>,
): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (
			isAPIError(error) ||
			error instanceof AppApiRouteError ||
			databaseFailureMetadata(error).failure_class === "constraint_violation"
		) {
			throw error;
		}
		reportRuntimeFailure(error, {
			source: "app-api.auth.database",
			error_code: "authentication_dependency_not_ready",
			operation,
		});
		throw new AuthDependencyFailure();
	}
}

function wrapOperations<T extends DBTransactionAdapter>(adapter: T): T {
	const wrapped = { ...adapter };
	function wrap<K extends keyof DBTransactionAdapter>(key: K) {
		const method = adapter[key];
		if (typeof method !== "function") {
			return;
		}
		// Preserve each installed adapter signature; no query arguments are inspected or recorded.
		wrapped[key] = ((...args: unknown[]) =>
			runAuthDatabaseOperation(String(key), () => Reflect.apply(method, adapter, args))) as T[K];
	}
	for (const key of [
		"create",
		"findOne",
		"findMany",
		"count",
		"update",
		"updateMany",
		"delete",
		"deleteMany",
		"consumeOne",
		"incrementOne",
	] as const) {
		wrap(key);
	}
	return wrapped;
}

export function withAuthDatabaseFailures(factory: DBAdapterInstance): DBAdapterInstance {
	return (options) => {
		const adapter = factory(options);
		const wrapped: DBAdapter = {
			...wrapOperations(adapter),
			transaction: (run) =>
				runAuthDatabaseOperation("transaction", () =>
					adapter.transaction((tx) => run(wrapOperations(tx))),
				),
		};
		return wrapped;
	};
}

export const authLogger = {
	level: "warn" as const,
	log(level: "debug" | "info" | "warn" | "error", _message: string, ...args: unknown[]) {
		if (level !== "warn" && level !== "error") {
			return;
		}
		const error = args.find((value) => value instanceof Error);
		if (error instanceof AuthDependencyFailure) {
			return;
		}
		reportRuntimeFailure(error, {
			source: "app-api.auth.sdk",
			error_code: level === "error" ? "authentication_sdk_error" : "authentication_sdk_warning",
		});
	},
};
