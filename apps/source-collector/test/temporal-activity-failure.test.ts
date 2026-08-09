import { ApplicationFailure, CancelledFailure, CompleteAsyncError } from "@temporalio/activity";
import { describe, expect, it } from "vitest";
import { sanitizeSourceActivityFailure } from "../src/temporal-activity-failure.ts";

describe("source collector Temporal activity failure sanitization", () => {
	it("replaces arbitrary errors with a retryable fixed failure", () => {
		const failure = sanitizeSourceActivityFailure(
			new Error("portal returned authorization=Bearer secret-token"),
		);

		expect(failure).toMatchObject({
			message: "Source collection activity failed.",
			nonRetryable: false,
			type: "source_collection_failed",
		});
	});

	it("preserves safe ApplicationFailure control fields without its body or details", () => {
		const failure = sanitizeSourceActivityFailure(
			ApplicationFailure.create({
				details: ["private response body"],
				message: "private response body",
				nonRetryable: true,
				type: "source_contract_invalid",
			}),
		) as ApplicationFailure;

		expect(failure).toMatchObject({
			message: "Source collection activity failed.",
			nonRetryable: true,
			type: "source_contract_invalid",
		});
		expect(failure.details).toBeUndefined();
	});

	it("replaces an unbounded ApplicationFailure type", () => {
		const failure = sanitizeSourceActivityFailure(
			ApplicationFailure.retryable("private response", "authorization=Bearer secret"),
		);

		expect(failure).toMatchObject({
			message: "Source collection activity failed.",
			type: "source_collection_failed",
		});
	});

	it("preserves Temporal cancellation and async completion control errors", () => {
		const cancellation = new CancelledFailure("cancelled");
		const asyncCompletion = new CompleteAsyncError();

		expect(sanitizeSourceActivityFailure(cancellation)).toBe(cancellation);
		expect(sanitizeSourceActivityFailure(asyncCompletion)).toBe(asyncCompletion);
	});

	it("does not preserve an abort error body on cancellation", () => {
		const error = Object.assign(new Error("portal authorization=Bearer secret"), {
			name: "AbortError",
		});
		const failure = sanitizeSourceActivityFailure(error, true);

		expect(failure).toBeInstanceOf(CancelledFailure);
		expect(failure.message).toBe("Source collection activity cancelled.");
		expect(failure.message).not.toContain("Bearer secret");
	});
});
