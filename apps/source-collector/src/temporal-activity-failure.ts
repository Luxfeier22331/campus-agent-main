import { ApplicationFailure, CancelledFailure, CompleteAsyncError } from "@temporalio/activity";
import type { ActivityInterceptorsFactory } from "@temporalio/worker";

const SAFE_FAILURE_TYPE = /^[A-Za-z0-9_.:-]{1,80}$/u;

export const safeSourceActivityFailureInterceptor: ActivityInterceptorsFactory = (context) => ({
	inbound: {
		async execute(input, next) {
			try {
				return await next(input);
			} catch (error) {
				throw sanitizeSourceActivityFailure(error, context.cancellationSignal.aborted);
			}
		},
	},
});

export function sanitizeSourceActivityFailure(
	error: unknown,
	cancellationSignalAborted = false,
): Error {
	if (error instanceof CancelledFailure || error instanceof CompleteAsyncError) {
		return error;
	}
	if (cancellationSignalAborted && isAbortError(error)) {
		return new CancelledFailure("Source collection activity cancelled.");
	}
	if (error instanceof ApplicationFailure) {
		const category = error.category ?? undefined;
		const nextRetryDelay = error.nextRetryDelay ?? undefined;
		return ApplicationFailure.create({
			...(category ? { category } : {}),
			message: "Source collection activity failed.",
			...(nextRetryDelay ? { nextRetryDelay } : {}),
			nonRetryable: error.nonRetryable ?? false,
			type: safeFailureType(error.type),
		});
	}
	return ApplicationFailure.retryable(
		"Source collection activity failed.",
		"source_collection_failed",
	);
}

function safeFailureType(value: string | null | undefined): string {
	return typeof value === "string" && SAFE_FAILURE_TYPE.test(value)
		? value
		: "source_collection_failed";
}

function isAbortError(error: unknown): error is Error {
	return (
		error !== null &&
		typeof error === "object" &&
		(error as { name?: unknown }).name === "AbortError" &&
		typeof (error as { message?: unknown }).message === "string"
	);
}
