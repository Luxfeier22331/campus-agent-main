import { expect, it } from "vitest";
import { PUBLISHED_NOTICE_SOURCE_QUERY } from "../src/source.ts";

it("selects published internal notices without requiring body text or OCR completion", () => {
	expect(PUBLISHED_NOTICE_SOURCE_QUERY).toContain("WHERE is_published AND NOT is_external");
	expect(PUBLISHED_NOTICE_SOURCE_QUERY).not.toContain("content_text IS NOT NULL");
});
