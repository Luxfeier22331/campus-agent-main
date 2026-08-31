import { describe, expect, it } from "vitest";

import { PUBLISHED_NOTICE_SOURCE_QUERY } from "../src/source.ts";

describe("published notice source query", () => {
	it("reads only the published notice fields required for chunking", () => {
		expect(PUBLISHED_NOTICE_SOURCE_QUERY).toContain("notice_id::text, title, content_text");
		expect(PUBLISHED_NOTICE_SOURCE_QUERY).toContain("WHERE is_published");
		expect(PUBLISHED_NOTICE_SOURCE_QUERY).toContain("content_text IS NOT NULL");
		expect(PUBLISHED_NOTICE_SOURCE_QUERY).not.toContain("content_html");
		expect(PUBLISHED_NOTICE_SOURCE_QUERY).not.toContain("released_at");
		expect(PUBLISHED_NOTICE_SOURCE_QUERY).not.toContain("category");
		expect(PUBLISHED_NOTICE_SOURCE_QUERY).not.toContain("organization");
	});
});
