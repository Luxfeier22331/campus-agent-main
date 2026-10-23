import { expect, it } from "vitest";
import { stripHistoricalCitations } from "../src/history-citations.ts";

it("strips numeric decorations while preserving prose, code, escapes and ordinary links", () => {
	const literals = "`[1]`\n```ts\n[1, 5]\n```\n~~~\n[9]\n~~~\n\\[4] [学校](https://muc.edu.cn)";
	expect(stripHistoricalCitations(`聚雅[1]、荟贤[2, 5]；通知[3](/notices/3)。${literals}`)).toBe(
		`聚雅、荟贤；通知。${literals}`,
	);
});

it.each([
	"````md\n```\n[8]\n```\n````",
	"```md\n[8]",
	"[示例[8]](https://example.com/a(b))",
	"``code ` [8]``",
])("preserves Markdown literal %s", (text) => {
	expect(stripHistoricalCitations(text)).toBe(text);
});
