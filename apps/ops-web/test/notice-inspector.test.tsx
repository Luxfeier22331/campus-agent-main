import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticeInspector, type NoticeInspectorProps } from "../src/app/notices/notice-inspector";
import { NoticeOcrSection } from "../src/app/notices/notice-ocr";
import type { NoticeOcr } from "../src/shared/ocr-contract";

function inspectorProps(id: number | null): NoticeInspectorProps {
	return {
		selectedNoticeId: id,
		notice:
			id === null
				? null
				: {
						noticeId: id,
						title: `通知 ${id}`,
						category: null,
						state: "needs_classification",
						noticeType: { id: 5, name: "办公通知" },
						organization: null,
						releasedAt: "2026-08-23T10:00:00.000Z",
						isExternal: false,
						externalUrl: null,
					},
		detailPending: false,
		detailError: null,
		dirty: false,
		draftCategory: "",
		savePending: false,
		saveSucceeded: false,
		saveError: null,
		createJobError: null,
		currentNoticeJobs: [],
		currentPendingJobSubmissions: [],
		isFamilyBusy: () => false,
		onDraftCategory: vi.fn(),
		onRetry: vi.fn(),
		onSave: vi.fn(),
		onStartJob: vi.fn(),
	};
}

const pendingOcr: NoticeOcr = {
	noticeId: "1",
	resources: [
		{
			sourceKey: "image-0",
			kind: "image",
			ordinal: 0,
			displayOrdinal: 0,
			label: "班次表",
			selectedResultId: null,
			batches: [
				{
					id: "10000000-0000-4000-8000-000000000001",
					status: "submitted",
					createdAt: "2026-09-12T00:00:00.000Z",
					pageCount: 0,
					missingImageCount: 0,
					error: null,
					hasResult: false,
				},
			],
		},
	],
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("notice inspector reading", () => {
	it("retains visited panels and individual scroll positions only for the open notice", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
		});
		for (const id of [1, 2]) {
			client.setQueryData(["notice-preview", id], {
				noticeId: id,
				isExternal: false,
				externalUrl: null,
				contentHtml: '<p>班次正文</p><img src="notice-asset:image:0" alt="班次表">',
				images: [{ ordinal: 0, url: `/api/ops/notices/${id}/images/0` }],
				attachments: [],
			});
		}
		const fetcher = vi.fn(async () => Response.json(pendingOcr));
		vi.stubGlobal("fetch", fetcher);
		const view = (id: number | null) => (
			<QueryClientProvider client={client}>
				<NoticeInspector {...inspectorProps(id)} />
			</QueryClientProvider>
		);
		const { container, rerender, unmount } = render(view(1));
		const scroll = container.querySelector<HTMLElement>("[data-notice-scroll]");
		if (!scroll) {
			throw new Error("Missing inspector scroll container");
		}
		const image = container.querySelector("img");
		expect(fetcher).not.toHaveBeenCalled();
		const tab = (name: string) =>
			fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
		scroll.scrollTop = 640;
		tab("维护");
		expect(scroll.scrollTop).toBe(0);
		await screen.findByText("正在识别");
		expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
		const headings = screen.getAllByRole("heading").map((element) => element.textContent);
		expect(headings.indexOf("分类")).toBeLessThan(headings.indexOf("来源信息"));
		expect(headings.indexOf("下一步")).toBeLessThan(headings.indexOf("识别结果"));
		expect(screen.queryByText(/不增加额外的维护记录|会自动刷新/)).not.toBeInTheDocument();
		scroll.scrollTop = 240;
		tab("正文");
		expect(scroll.scrollTop).toBe(640);
		expect(container.querySelector("img")).toBe(image);
		expect(screen.queryByRole("combobox", { name: "通知分类" })).not.toBeInTheDocument();
		tab("维护");
		expect(scroll.scrollTop).toBe(240);
		rerender(view(2));
		expect(screen.getByRole("tab", { name: "正文" })).toHaveAttribute("aria-selected", "true");
		expect(container.querySelector("[data-notice-scroll]")?.scrollTop).toBe(0);
		rerender(view(null));
		rerender(view(1));
		expect(container.querySelector("[data-notice-scroll]")?.scrollTop).toBe(0);
		expect(screen.getByRole("tab", { name: "正文" })).toHaveAttribute("aria-selected", "true");
		unmount();
		client.clear();
	});

	it("does not query inactive OCR, pauses its polling, and refreshes when active again", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const fetcher = vi.fn(async () => Response.json(pendingOcr));
		vi.stubGlobal("fetch", fetcher);
		const view = (active: boolean) => (
			<QueryClientProvider client={client}>
				<NoticeOcrSection noticeId={1} active={active} />
			</QueryClientProvider>
		);
		const { rerender, unmount } = render(view(false));
		expect(fetcher).not.toHaveBeenCalled();
		rerender(view(true));
		await screen.findByText("正在识别");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5_100);
		});
		expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2);
		rerender(view(false));
		const calls = fetcher.mock.calls.length;
		await act(async () => {
			await client.invalidateQueries({ queryKey: ["ocr", "notice", 1] });
			await vi.advanceTimersByTimeAsync(10_100);
		});
		expect(fetcher).toHaveBeenCalledTimes(calls);
		rerender(view(true));
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(calls + 1));
		unmount();
		client.clear();
	});
});

it("identifies a single body image, refreshes status, and allows rerunning a failed task", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	let batches: NoticeOcr["resources"][number]["batches"] = [];
	const originalBatch = pendingOcr.resources[0]?.batches[0];
	if (!originalBatch) {
		throw new Error("Missing OCR fixture batch");
	}
	const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
		if (init?.method === "POST") {
			batches = [{ ...originalBatch, status: "failed", error: "识别失败详情" }];
			return Response.json({ launchError: null });
		}
		return Response.json({
			...pendingOcr,
			resources: [{ ...pendingOcr.resources[0], ordinal: 2, displayOrdinal: 0, batches }],
		});
	});
	vi.stubGlobal("fetch", fetcher);
	const { unmount } = render(
		<QueryClientProvider client={client}>
			<NoticeOcrSection noticeId={1} />
		</QueryClientProvider>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "识别图片" }));
	expect(await screen.findAllByText("识别失败详情")).toHaveLength(2);
	expect(fetcher).toHaveBeenCalledWith(
		"/api/ops/ocr/tasks",
		expect.objectContaining({
			method: "POST",
			body: JSON.stringify({ noticeId: "1", resourceKind: "image", resourceOrdinal: 0 }),
		}),
	);
	expect(screen.getByRole("img", { name: "班次表原图" })).toHaveAttribute(
		"src",
		"/api/ops/notices/1/images/0",
	);
	fireEvent.click(screen.getByRole("button", { name: "重新识别" }));
	await waitFor(() =>
		expect(fetcher).toHaveBeenCalledWith(
			"/api/ops/ocr/tasks/10000000-0000-4000-8000-000000000001/rerun",
			expect.objectContaining({ method: "POST" }),
		),
	);
	unmount();
	client.clear();
});

it("shows PDF attachment OCR history and opens its page result", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const attachmentBatch = {
		id: "10000000-0000-4000-8000-000000000010",
		status: "completed" as const,
		createdAt: "2026-09-12T00:00:00.000Z",
		pageCount: 3,
		missingImageCount: 0,
		error: null,
		hasResult: true,
	};
	const fetcher = vi.fn(async (url: string) =>
		url.includes("/result")
			? Response.json({ pages: [{ index: 0, markdown: "第一页内容" }], missingImages: [] })
			: Response.json({
					noticeId: "1",
					resources: [
						{
							sourceKey: "pdf-0",
							kind: "attachment",
							ordinal: 0,
							displayOrdinal: 0,
							label: "PDF附件1",
							selectedResultId: attachmentBatch.id,
							batches: [attachmentBatch],
						},
					],
				}),
	);
	vi.stubGlobal("fetch", fetcher);
	const { unmount } = render(
		<QueryClientProvider client={client}>
			<NoticeOcrSection noticeId={1} />
		</QueryClientProvider>,
	);
	expect(await screen.findByText("PDF附件1")).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "识别 PDF" })).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
	expect(await screen.findByText("第一页内容")).toBeInTheDocument();
	unmount();
	client.clear();
});
