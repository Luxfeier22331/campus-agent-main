import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CitationPreview,
	CitationSourcesContext,
} from "../src/components/conversation/citation-preview";
import { SourceItemsList } from "../src/components/conversation/source-items";
import type { CampusNoticeSourceItemPayload } from "../src/features/conversation/model";
import { noticeQueryClient } from "../src/features/notices/query-client";

const api = vi.hoisted(() => ({ getNoticeDetail: vi.fn() }));
vi.mock("../src/features/notices/api", () => api);
const source: CampusNoticeSourceItemPayload = {
	kind: "campus_notice",
	noticeId: "123",
	title: "夜宵通知",
	citationIndexes: [1],
	sectionTitle: "正文",
	snippet: null,
	primaryAction: { href: "/notices/123", label: "查看通知", external: false, disabledReason: null },
};
const notice = {
	noticeId: "123",
	title: "夜宵通知",
	releasedAt: "2026-09-30T00:00:00Z",
	noticeType: { id: 1, name: "校园通知" },
	organization: { id: "org", name: "后勤处" },
	contentHtml:
		'<p>夜宵开放至22点。</p><table><tr><td>夜宵时间</td></tr></table><img src="notice-asset:image:0" alt="食堂图片">',
	images: [
		{
			ordinal: 0,
			url: "/api/notices/123/images/0",
			contentType: "image/png",
			byteSize: "123",
			name: null,
		},
	],
	attachments: [
		{
			ordinal: 0,
			name: "安排.pdf",
			contentType: "application/pdf",
			byteSize: "2048",
			downloadUrl: "https://example.com/annex.pdf",
		},
	],
};
afterEach(() => {
	noticeQueryClient.clear();
	api.getNoticeDetail.mockReset();
});
describe("conversation notice dialog", () => {
	it("loads on demand, shares full content and returns focus without replacing the conversation", async () => {
		let resolve!: (value: typeof notice) => void;
		api.getNoticeDetail.mockReturnValue(
			new Promise((r) => {
				resolve = r;
			}),
		);
		const user = userEvent.setup();
		render(
			<>
				<input aria-label="草稿" defaultValue="保留草稿" />
				<SourceItemsList sourceItems={[source]} />
			</>,
		);
		expect(api.getNoticeDetail).not.toHaveBeenCalled();
		const trigger = screen.getByRole("button", { name: "查看通知" });
		const url = location.href;
		await user.click(trigger);
		expect(screen.getByRole("status", { name: "正在读取通知正文" })).toBeVisible();
		await act(async () => resolve(notice));
		const dialog = screen.getByRole("dialog", { name: "夜宵通知" });
		expect(await within(dialog).findByText("夜宵开放至22点。")).toBeVisible();
		expect(within(dialog).getByRole("table")).toBeVisible();
		expect(within(dialog).getByRole("img", { name: "食堂图片" })).toHaveAttribute(
			"src",
			"/api/notices/123/images/0",
		);
		expect(within(dialog).getByRole("link", { name: "安排.pdf" })).toHaveAttribute(
			"href",
			"https://example.com/annex.pdf",
		);
		expect(within(dialog).getByRole("link", { name: "打开完整通知页" })).toHaveAttribute(
			"target",
			"_blank",
		);
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(trigger).toHaveFocus();
		expect(screen.getByLabelText("草稿")).toHaveValue("保留草稿");
		expect(location.href).toBe(url);
		await user.click(trigger);
		expect(await screen.findByText("夜宵开放至22点。")).toBeVisible();
		expect(api.getNoticeDetail).toHaveBeenCalledTimes(1);
	});
	it("retries a failed read inside the dialog", async () => {
		api.getNoticeDetail
			.mockRejectedValueOnce(new Error("unavailable"))
			.mockResolvedValueOnce(notice);
		const user = userEvent.setup();
		render(<SourceItemsList sourceItems={[source]} />);
		await user.click(screen.getByRole("button", { name: "查看通知" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("通知暂时不可用");
		await user.click(screen.getByRole("button", { name: "重试" }));
		expect(await screen.findByText("夜宵开放至22点。")).toBeVisible();
		await user.click(screen.getByRole("button", { name: "关闭通知预览" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
	it("replaces the citation popover and returns focus to the citation", async () => {
		api.getNoticeDetail.mockResolvedValue(notice);
		const user = userEvent.setup();
		render(
			<CitationSourcesContext.Provider value={new Map([[1, source]])}>
				<CitationPreview index={1} />
			</CitationSourcesContext.Provider>,
		);
		const citation = screen.getByRole("button", { name: /查看引用 1/ });
		await user.click(citation);
		await user.click(screen.getByRole("button", { name: "查看通知" }));
		expect(await screen.findByText("夜宵开放至22点。")).toBeVisible();
		expect(screen.getAllByRole("dialog")).toHaveLength(1);
		expect(document.querySelector("[data-radix-popper-content-wrapper]")).toBeNull();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(citation).toHaveFocus());
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByRole("button", { name: "查看通知" })).toBeNull();
	});
});
