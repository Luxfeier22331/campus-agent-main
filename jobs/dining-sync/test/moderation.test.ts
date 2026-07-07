import { describe, expect, it, vi } from "vitest";

import { GiteeAiDiningModerator } from "../src/moderation";

describe("Gitee AI dining moderator", () => {
	it("sends OpenAI-compatible text moderation requests and accepts unflagged results", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ results: [{ flagged: false }] }));
		const moderator = new GiteeAiDiningModerator({
			apiKey: "moderation-secret",
			baseUrl: "https://ai.gitee.com/v1",
			fetch: fetchImpl,
			imageModel: "nsfw-classifier",
			textModel: "Security-semantic-filtering",
			timeoutMs: 1000,
		});

		await expect(
			moderator.checkText({
				comment: "清淡",
				contributorName: "果小生",
				dishName: "金汤鱼粉",
				stallName: "鱼粉",
			}),
		).resolves.toEqual({ status: "safe" });

		expect(fetchImpl).toHaveBeenCalledWith(
			"https://ai.gitee.com/v1/moderations",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer moderation-secret",
					"Content-Type": "application/json",
				}),
				method: "POST",
			}),
		);
		const body = requestBodyFrom(fetchImpl);
		expect(body).toMatchObject({
			model: "Security-semantic-filtering",
			input: [
				{
					text: expect.stringContaining("菜品：金汤鱼粉"),
					type: "text",
				},
			],
		});
	});

	it("blocks flagged text results", async () => {
		const moderator = new GiteeAiDiningModerator({
			apiKey: "moderation-secret",
			baseUrl: "https://ai.gitee.com/v1",
			fetch: vi.fn(async () => jsonResponse({ results: [{ flagged: true }] })),
			imageModel: "nsfw-classifier",
			textModel: "Security-semantic-filtering",
			timeoutMs: 1000,
		});

		await expect(
			moderator.checkText({
				comment: "bad",
				contributorName: null,
				dishName: "金汤鱼粉",
				stallName: "鱼粉",
			}),
		).resolves.toEqual({ status: "blocked" });
	});

	it("checks image URLs with the image moderation model", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ results: [{ flagged: false }] }));
		const moderator = new GiteeAiDiningModerator({
			apiKey: "moderation-secret",
			baseUrl: "https://ai.gitee.com/v1/",
			fetch: fetchImpl,
			imageModel: "nsfw-classifier",
			textModel: "Security-semantic-filtering",
			timeoutMs: 1000,
		});

		await expect(
			moderator.checkImage({
				url: "https://assets.example.test/dining/review-moderation/rec-safe-1.jpg",
			}),
		).resolves.toEqual({ status: "safe" });

		const body = requestBodyFrom(fetchImpl);
		expect(body).toEqual({
			input: [
				{
					image_url: {
						url: "https://assets.example.test/dining/review-moderation/rec-safe-1.jpg",
					},
					type: "image_url",
				},
			],
			model: "nsfw-classifier",
		});
	});

	it("fails closed when the provider returns an invalid response or fails", async () => {
		const invalidResponseModerator = new GiteeAiDiningModerator({
			apiKey: "moderation-secret",
			baseUrl: "https://ai.gitee.com/v1",
			fetch: vi.fn(async () => jsonResponse({ results: [] })),
			imageModel: "nsfw-classifier",
			textModel: "Security-semantic-filtering",
			timeoutMs: 1000,
		});
		const failingModerator = new GiteeAiDiningModerator({
			apiKey: "moderation-secret",
			baseUrl: "https://ai.gitee.com/v1",
			fetch: vi.fn(async () => new Response("{}", { status: 500 })),
			imageModel: "nsfw-classifier",
			textModel: "Security-semantic-filtering",
			timeoutMs: 1000,
		});

		await expect(
			invalidResponseModerator.checkImage({
				url: "https://assets.example.test/dining/review-moderation/rec-safe-1.png",
			}),
		).rejects.toThrow(/invalid moderation response/i);
		await expect(
			failingModerator.checkText({
				comment: null,
				contributorName: null,
				dishName: "金汤鱼粉",
				stallName: "鱼粉",
			}),
		).rejects.toThrow(/HTTP 500/);
	});
});

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		headers: { "Content-Type": "application/json" },
		status: 200,
	});
}

function requestBodyFrom(fetchImpl: ReturnType<typeof vi.fn>): unknown {
	const calls = fetchImpl.mock.calls as Array<[RequestInfo | URL, RequestInit]>;
	const body = calls[0]?.[1]?.body;
	if (typeof body !== "string") {
		throw new Error("Expected string request body.");
	}
	return JSON.parse(body) as unknown;
}
