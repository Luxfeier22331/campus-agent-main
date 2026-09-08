import { expect, it } from "vitest";
import { ocrMarkdownForBrowser } from "../src/server/ocr-results.ts";

it("rewrites overlapping image numbers exactly once", () => {
	expect(
		ocrMarkdownForBrowser("id", "![a](images/4-1) ![b](images/4-11)", [
			"ocr/tasks/id/images/4-1",
			"ocr/tasks/id/images/4-11",
		]),
	).toBe("![a](/api/ops/ocr/tasks/id/images/4-1) ![b](/api/ops/ocr/tasks/id/images/4-11)");
});
