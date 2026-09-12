import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTransportNoticeLinks, saveTransportNoticeLinks } from "../src/app/ops-api/transport";
import { TransportNoticeLinkEditor } from "../src/app/transport-notice-links";
import type { TransportNoticeLink } from "../src/server/transport-store-contract";

vi.mock("../src/app/ops-api/transport", () => ({
	fetchTransportNoticeLinks: vi.fn(),
	saveTransportNoticeLinks: vi.fn(),
}));

const link: TransportNoticeLink = {
	noticeId: 355867,
	title: "班车调整通知",
	releasedAt: "2026-04-25T05:11:00.000Z",
	isPublished: false,
	summary: "调整发车时间",
};
function setup(scheduleId = "schedule:test") {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
	const events = { onDirty: vi.fn(), onBusy: vi.fn(), onCancel: vi.fn(), onSaved: vi.fn() };
	const view = (id: string) => (
		<QueryClientProvider client={client}>
			<TransportNoticeLinkEditor scheduleId={id} {...events} />
		</QueryClientProvider>
	);
	const rendered = render(view(scheduleId));
	return {
		...rendered,
		...events,
		client,
		changeSchedule: (id: string) => rendered.rerender(view(id)),
	};
}

describe("通知关联编辑的读取与退出", () => {
	beforeEach(() => vi.resetAllMocks());

	it("读取中可取消，卸载后迟到结果不重新打开或触发保存", async () => {
		let resolve!: (value: { noticeLinks: TransportNoticeLink[] }) => void;
		vi.mocked(fetchTransportNoticeLinks).mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const result = setup();
		expect(screen.getByRole("status")).toHaveTextContent("正在读取关联通知");
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		expect(result.onCancel).toHaveBeenCalledOnce();
		result.unmount();
		await act(async () => resolve({ noticeLinks: [link] }));
		expect(screen.queryByRole("region", { name: "维护关联通知" })).not.toBeInTheDocument();
		expect(result.onSaved).not.toHaveBeenCalled();
	});

	it("读取失败同时提供取消与手动重试，恢复后编辑同一时间段", async () => {
		vi.mocked(fetchTransportNoticeLinks)
			.mockRejectedValueOnce(new Error("读取失败"))
			.mockResolvedValueOnce({ noticeLinks: [link] });
		const result = setup();
		await screen.findByText("关联通知读取失败");
		expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
		expect(fetchTransportNoticeLinks).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		expect(await screen.findByLabelText("通知 355867 关联说明")).toHaveValue(link.summary);
		expect(fetchTransportNoticeLinks).toHaveBeenLastCalledWith(
			"schedule:test",
			expect.any(AbortSignal),
		);
		expect(result.onSaved).not.toHaveBeenCalled();
	});

	it("保存失败保留选择和说明，重试成功不改排班缓存", async () => {
		vi.mocked(fetchTransportNoticeLinks).mockResolvedValue({ noticeLinks: [link] });
		vi.mocked(saveTransportNoticeLinks)
			.mockRejectedValueOnce(new Error("保存失败"))
			.mockResolvedValueOnce({ noticeLinks: [{ ...link, summary: "改为 08:05" }] });
		const result = setup();
		const scheduleCache = {
			schedulePeriods: [{ scheduleId: "schedule:test", updatedAt: "2026-09-01T00:00:00Z" }],
		};
		result.client.setQueryData(["transport", "ops", "schedule-periods"], scheduleCache);
		fireEvent.change(await screen.findByLabelText("通知 355867 关联说明"), {
			target: { value: "改为 08:05" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存关联" }));
		await screen.findByText("关联保存失败");
		expect(screen.getByLabelText("通知 355867 关联说明")).toHaveValue("改为 08:05");
		expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
		expect(result.onSaved).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "保存关联" }));
		await waitFor(() => expect(result.onSaved).toHaveBeenCalledOnce());
		expect(saveTransportNoticeLinks).toHaveBeenLastCalledWith("schedule:test", [
			{ noticeId: 355867, summary: "改为 08:05" },
		]);
		expect(result.client.getQueryData(["transport", "ops", "schedule-periods"])).toEqual(
			scheduleCache,
		);
		expect(
			result.client.getQueryState(["transport", "ops", "schedule-periods"])?.isInvalidated,
		).toBe(false);
	});

	it("保存中禁止取消及重复提交", async () => {
		vi.mocked(fetchTransportNoticeLinks).mockResolvedValue({ noticeLinks: [link] });
		let resolve!: (value: { noticeLinks: TransportNoticeLink[] }) => void;
		vi.mocked(saveTransportNoticeLinks).mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const result = setup();
		fireEvent.change(await screen.findByLabelText("通知 355867 关联说明"), {
			target: { value: "改动" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存关联" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeDisabled());
		expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
		expect(result.onBusy).toHaveBeenLastCalledWith(true);
		await act(async () => resolve({ noticeLinks: [{ ...link, summary: "改动" }] }));
		await waitFor(() => expect(result.onSaved).toHaveBeenCalledOnce());
	});

	it("切换时间段不显示旧草稿，旧请求迟到也不覆盖新选择", async () => {
		let resolveOld!: (value: { noticeLinks: TransportNoticeLink[] }) => void;
		vi.mocked(fetchTransportNoticeLinks).mockImplementation((id) =>
			id === "old"
				? new Promise((done) => {
						resolveOld = done;
					})
				: Promise.resolve({
						noticeLinks: [{ ...link, noticeId: 349494, summary: "另一个时间段" }],
					}),
		);
		const result = setup("old");
		result.changeSchedule("new");
		expect(await screen.findByLabelText("通知 349494 关联说明")).toHaveValue("另一个时间段");
		await act(async () => resolveOld({ noticeLinks: [link] }));
		expect(screen.queryByLabelText("通知 355867 关联说明")).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("通知 349494 关联说明"), {
			target: { value: "未保存" },
		});
		vi.mocked(fetchTransportNoticeLinks).mockResolvedValue({ noticeLinks: [link] });
		result.changeSchedule("third");
		expect(await screen.findByLabelText("通知 355867 关联说明")).toHaveValue(link.summary);
		expect(screen.queryByDisplayValue("未保存")).not.toBeInTheDocument();
	});
});
