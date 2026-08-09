import { ApplicationFailure, CancelledFailure, CompleteAsyncError } from "@temporalio/activity";
import { describe, expect, it } from "vitest";
import { sanitizeIngestionActivityFailure } from "../src/temporal-activity-failure";

describe("ingestion Temporal activity failure sanitization", () => {
	it("replaces arbitrary errors with a retryable fixed failure", () => {
		const failure = sanitizeIngestionActivityFailure(
			new Error("postgres://runtime:secret@db.internal/ingestion"),
		);

		expect(failure).toMatchObject({
			message: "Ingestion activity failed.",
			nonRetryable: false,
			type: "ingestion_activity_failed",
		});
	});

	it("preserves safe ApplicationFailure control fields without its body or details", () => {
		const failure = sanitizeIngestionActivityFailure(
			ApplicationFailure.create({
				details: ["provider secret response"],
				message: "provider secret response",
				nonRetryable: true,
				type: "invalid_ingestion_task_result",
			}),
		) as ApplicationFailure;

		expect(failure).toMatchObject({
			message: "Ingestion activity failed.",
			nonRetryable: true,
			type: "invalid_ingestion_task_result",
		});
		expect(failure.details).toBeUndefined();
	});

	it("replaces an unbounded ApplicationFailure type", () => {
		const failure = sanitizeIngestionActivityFailure(
			ApplicationFailure.retryable("private response", "authorization=Bearer secret"),
		);

		expect(failure).toMatchObject({
			message: "Ingestion activity failed.",
			type: "ingestion_activity_failed",
		});
	});

	it("preserves Temporal cancellation and async completion control errors", () => {
		const cancellation = new CancelledFailure("cancelled");
		const asyncCompletion = new CompleteAsyncError();

		expect(sanitizeIngestionActivityFailure(cancellation)).toBe(cancellation);
		expect(sanitizeIngestionActivityFailure(asyncCompletion)).toBe(asyncCompletion);
	});

	it("does not preserve an abort error body on cancellation", () => {
		const error = Object.assign(new Error("postgres://runtime:secret@db.internal"), {
			name: "AbortError",
		});
		const failure = sanitizeIngestionActivityFailure(error, true);

		expect(failure).toBeInstanceOf(CancelledFailure);
		expect(failure.message).toBe("Ingestion activity cancelled.");
		expect(failure.message).not.toContain("postgres://runtime:secret");
	});
});
