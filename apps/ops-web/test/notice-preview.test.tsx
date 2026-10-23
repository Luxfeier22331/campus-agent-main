import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticePreviewPanel } from "../src/app/notices/notice-preview";

const preview = (
	noticeId: number,
	contentHtml: string | null = `<p>通知 ${noticeId} 正文</p>`,
) => ({
	noticeId,
	contentHtml,
	isExternal: false,
	externalUrl: null,
	images: [],
	attachments: [],
});
function wrapper({ children }: { children: React.ReactNode }) {
	return (
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{children}
		</QueryClientProvider>
	);
}
afterEach(() => vi.unstubAllGlobals());
describe("notice preview panel", () => {
	it("keeps content during refresh and shows a compact failure with manual recovery", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
		});
		client.setQueryData(["notice-preview", 1], preview(1));
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json(
					{ error: { code: "OPS_NOTICE_PREVIEW_UNAVAILABLE", message: "通知来源暂时无法读取。" } },
					{ status: 502 },
				),
			)
			.mockResolvedValueOnce(Response.json(preview(1, "<p>恢复后的正文</p>")));
		vi.stubGlobal("fetch", fetcher);
		render(
			<QueryClientProvider client={client}>
				<NoticePreviewPanel noticeId={1} />
			</QueryClientProvider>,
		);
		await act(async () => {
			await client.refetchQueries({ queryKey: ["notice-preview", 1] });
		});
		expect(await screen.findByText("正文刷新失败")).toBeInTheDocument();
		expect(screen.getByText("通知 1 正文")).toBeInTheDocument();
		expect(screen.queryByText("正文读取失败")).not.toBeInTheDocument();
		expect(screen.queryByText("正在读取正文…")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "重试刷新" }));
		expect(await screen.findByText("恢复后的正文")).toBeInTheDocument();
	});
	it("does not claim missing attachments for an empty or invalid body", async () => {
		const fetcher = vi.fn(async () => Response.json(preview(1, null)));
		vi.stubGlobal("fetch", fetcher);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<NoticePreviewPanel noticeId={1} />
			</QueryClientProvider>,
		);
		expect(await screen.findByText("这条通知没有正文。")).toBeInTheDocument();
		expect(screen.queryByText(/可查看下方附件/)).not.toBeInTheDocument();
		act(() => {
			client.setQueryData(["notice-preview", 1], preview(1, "<script>bad</script>"));
		});
		expect(await screen.findByText("正文暂时无法展示。")).toBeInTheDocument();
		expect(screen.queryByText(/可查看下方附件/)).not.toBeInTheDocument();
	});
	it("shows external domain without an empty-body notice", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					...preview(1, null),
					isExternal: true,
					externalUrl: "https://library.example.edu/opening",
				}),
			),
		);
		render(<NoticePreviewPanel noticeId={1} />, { wrapper });
		expect(await screen.findByText("外链通知 · library.example.edu")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "打开原始链接" })).toHaveAttribute(
			"href",
			"https://library.example.edu/opening",
		);
		expect(screen.queryByText("这条通知没有正文。")).not.toBeInTheDocument();
	});
	it("shows attachment names and counts without probing files or inventing types", async () => {
		const name = `${"通知附件".repeat(30)}.pdf`;
		const fetcher = vi.fn(async () =>
			Response.json({
				...preview(1),
				attachments: [
					{ ordinal: 0, name, suffix: "pdf", url: "/api/ops/notices/1/attachments/0" },
					{ ordinal: 1, name: null, suffix: null, url: "/api/ops/notices/1/attachments/1" },
				],
			}),
		);
		vi.stubGlobal("fetch", fetcher);
		render(<NoticePreviewPanel noticeId={1} />, { wrapper });
		expect(await screen.findByRole("link", { name })).toHaveAttribute("target", "_blank");
		expect(screen.getByRole("link", { name: "附件 2" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "附件 2" })).toBeInTheDocument();
		expect(screen.queryByText(/图片 0|未知类型/)).not.toBeInTheDocument();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it("keeps image links across parent renders and rebinds updated content", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
		});
		const data = {
			...preview(1, '<p>正文</p><img src="notice-asset:image:0" alt="班次表">'),
			images: [{ ordinal: 0, url: "/api/ops/notices/1/images/0" }],
		};
		client.setQueryData(["notice-preview", 1], data);
		const view = () => (
			<QueryClientProvider client={client}>
				<NoticePreviewPanel noticeId={1} />
			</QueryClientProvider>
		);
		const { rerender } = render(view());
		expect(await screen.findByRole("link", { name: "查看原图：班次表" })).toBeInTheDocument();
		rerender(view());
		expect(screen.getByRole("link", { name: "查看原图：班次表" })).toBeInTheDocument();
		client.setQueryData(["notice-preview", 1], {
			...data,
			contentHtml: '<p>更新正文</p><img src="notice-asset:image:0" alt="新班次表">',
		});
		expect(await screen.findByRole("link", { name: "查看原图：新班次表" })).toBeInTheDocument();
	});
	it("renders tables, images and attachment links", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					...preview(
						1,
						'<p>正文</p><table><tbody><tr><td>08:00</td></tr></tbody></table><img src="notice-asset:image:0" alt="班次表">',
					),
					images: [{ ordinal: 0, url: "/api/ops/notices/1/images/0" }],
					attachments: [
						{
							ordinal: 0,
							name: "安排.pdf",
							suffix: "pdf",
							url: "/api/ops/notices/1/attachments/0",
						},
					],
				}),
			),
		);
		render(<NoticePreviewPanel noticeId={1} />, { wrapper });
		expect(await screen.findByRole("table")).toBeInTheDocument();
		expect(screen.getByText("图片 1")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "附件 1" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "安排.pdf" })).toHaveAttribute(
			"href",
			"/api/ops/notices/1/attachments/0",
		);
		expect(screen.getByRole("link", { name: "查看原图：班次表" })).toHaveAttribute(
			"target",
			"_blank",
		);
	});
	it("shows a local image failure without hiding the body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					...preview(1, '<p>正文保留</p><img src="notice-asset:image:0" alt="图片">'),
					images: [{ ordinal: 0, url: "/api/ops/notices/1/images/0" }],
				}),
			),
		);
		const { container } = render(<NoticePreviewPanel noticeId={1} />, { wrapper });
		await screen.findByText("正文保留");
		const image = container.querySelector("img");
		if (!image) {
			throw new Error("Missing test image");
		}
		fireEvent.error(image);
		expect(screen.getByText("图片加载失败")).toBeInTheDocument();
		const retry = screen.getByRole("button", { name: "重试图片" });
		fireEvent.click(retry);
		expect(retry).toBeDisabled();
		expect(screen.getByText("正在重试…")).toBeInTheDocument();
		fireEvent.error(image);
		expect(retry).toBeEnabled();
		fireEvent.click(retry);
		fireEvent.load(image);
		expect(image).not.toHaveAttribute("hidden");
		expect(screen.queryByRole("button", { name: "重试图片" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "查看原图：图片" })).toBeInTheDocument();
		expect(screen.getByText("正文保留")).toBeInTheDocument();
	});
	it("cancels an old request and never displays it as the new notice", async () => {
		let oldSignal: AbortSignal | null | undefined;
		let resolveOld!: (response: Response) => void;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				if (url.includes("/1/")) {
					oldSignal = init?.signal;
					return new Promise<Response>((resolve) => {
						resolveOld = resolve;
					});
				}
				return Response.json(preview(2));
			}),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const view = (id: number) => (
			<QueryClientProvider client={client}>
				<NoticePreviewPanel noticeId={id} />
			</QueryClientProvider>
		);
		const { rerender } = render(view(1));
		await waitFor(() => expect(oldSignal).toBeDefined());
		expect(screen.getByText("正在读取正文…")).toBeInTheDocument();
		expect(screen.queryByText(/图片 0|附件 0/)).not.toBeInTheDocument();
		rerender(view(2));
		expect(await screen.findByText("通知 2 正文")).toBeInTheDocument();
		expect(oldSignal?.aborted).toBe(true);
		resolveOld(Response.json(preview(1)));
		expect(screen.queryByText("通知 1 正文")).not.toBeInTheDocument();
	});
	it("keeps attachments when body is empty and retries a failed request", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({ error: { code: "missing", message: "来源不可用" } }, { status: 502 }),
			)
			.mockResolvedValueOnce(
				Response.json({
					...preview(1, null),
					attachments: [
						{
							ordinal: 0,
							name: "表格.xlsx",
							suffix: "xlsx",
							url: "/api/ops/notices/1/attachments/0",
						},
					],
				}),
			);
		vi.stubGlobal("fetch", fetcher);
		render(<NoticePreviewPanel noticeId={1} />, { wrapper });
		await screen.findByText("正文读取失败");
		fireEvent.click(screen.getByRole("button", { name: /重试/ }));
		expect(await screen.findByText("这条通知没有正文。可查看下方附件。")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "表格.xlsx" })).toBeInTheDocument();
	});
});
