import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MarkdownPreview } from "../src/app/markdown-preview";
import { OcrResultDialog } from "../src/app/ocr-result-dialog";

it("renders OCR table line breaks and arrows without decoding code or stored text", async () => {
	const markdown = `${String.raw`<table><tr><td rowspan="2">丰台 $ \rightarrow $五棵松\n第二行</td><td>09:00</td></tr><tr><td>09:30</td></tr></table>

`}\n\n\`literal\\ncode\``;
	const body = { pages: [{ index: 0, markdown }], missingImages: ["missing"] };
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(body)),
	);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const view = render(
		<QueryClientProvider client={client}>
			<OcrResultDialog url="/api/ops/ocr/tasks/id/result" onClose={() => undefined} />
		</QueryClientProvider>,
	);
	const table = await screen.findByRole("table");
	expect(within(table).getByText(/丰台 →五棵松/)).toHaveAttribute("rowspan", "2");
	expect(table.querySelectorAll("br")).toHaveLength(1);
	expect(screen.getByText(String.raw`literal\ncode`)).toBeInTheDocument();
	expect(screen.getByText("有 1 张图片缺失，文字已保留。")).toBeInTheDocument();
	expect(body.pages[0]?.markdown).toBe(markdown);
	view.unmount();
	client.clear();
});
it("renders readable list previews without nested links or Markdown markers", () => {
	const view = render(
		<p>
			<MarkdownPreview>**图书馆**：[开放时间](https://example.test) 与 `借阅`</MarkdownPreview>
		</p>,
	);
	expect(view.container.textContent).toContain("图书馆：开放时间 与 借阅");
	expect(view.container.querySelector("a")).toBeNull();
	expect(view.container.textContent).not.toMatch(/\*\*|https:|`/);
});
