import { describe, expect, it } from "vitest";
import { buildStyleDevHash, parseStyleDevHash } from "../src/style-dev/navigation";

describe("style-dev navigation", () => {
	it("uses overview as the default location", () => {
		expect(parseStyleDevHash("")).toEqual({ storyId: null, variantId: null });
		expect(parseStyleDevHash("#overview")).toEqual({ storyId: null, variantId: null });
	});

	it("round-trips a story and variant", () => {
		const hash = buildStyleDevHash("style-dev-conversation-run-status", "completed");
		expect(hash).toBe("#style-dev-conversation-run-status/completed");
		expect(parseStyleDevHash(hash)).toEqual({
			storyId: "style-dev-conversation-run-status",
			variantId: "completed",
		});
	});

	it("encodes slash characters in ids", () => {
		const hash = buildStyleDevHash("entry/with-slash", "example/with-slash");
		expect(parseStyleDevHash(hash)).toEqual({
			storyId: "entry/with-slash",
			variantId: "example/with-slash",
		});
	});
});
