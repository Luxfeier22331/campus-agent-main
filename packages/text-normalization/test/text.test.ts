import { describe, expect, it } from "vitest";
import { htmlToStructuredText } from "../src/index.ts";

describe("htmlToStructuredText", () => {
	it("serializes HTML tables as logical semicolon-joined rows", () => {
		const text = htmlToStructuredText(
			"<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
		);
		expect(text).toBe("A；B\nC；D");
	});

	it("keeps explicit table headers as column labels", () => {
		const text = htmlToStructuredText(
			"<table><thead><tr><th>类别</th><th>时间</th></tr></thead><tbody><tr><td>讲座</td><td>9:00</td></tr></tbody></table>",
		);
		expect(text).toBe("类别：讲座；时间：9:00");
	});

	it("converts provider literal \\n escapes inside table cells to spaces", () => {
		const text = htmlToStructuredText(
			"<table><tr><td>水力发电概述\\n认识水坝</td><td>地热能</td></tr></table>",
		);
		expect(text).toBe("水力发电概述 认识水坝；地热能");
	});

	it("unwraps disallowed tags and drops script/style content", () => {
		const text = htmlToStructuredText(
			"<div><script>alert(1)</script><style>p{color:red}</style><span>文本</span></div>",
		);
		expect(text).toBe("文本");
	});

	it("removes comments and preserves BR line breaks and block boundaries", () => {
		const text = htmlToStructuredText("<!-- note --><p>第一行<br>第二行</p><p>段落二</p>");
		expect(text).toBe("第一行\n第二行\n段落二");
	});

	it("normalizes ASCII whitespace runs", () => {
		const text = htmlToStructuredText("<p>字   节 间</p>");
		expect(text).toBe("字 节 间");
	});

	it("returns empty for whitespace-only input", () => {
		expect(htmlToStructuredText("   ")).toBe("");
	});
});
