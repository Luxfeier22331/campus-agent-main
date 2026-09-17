import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeDetailPageContent } from "../src/app/routes/notice-detail-page";
import { NoticesPageContent } from "../src/app/routes/notices-page";
import { ApiRequestError } from "../src/platform/api/client";
import { createCampusQueryClient } from "../src/platform/query/client";

const api = vi.hoisted(() => ({
	getNoticeDetail: vi.fn(),
	listNotices: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
const routeSearch = vi.hoisted(
	(): Record<string, unknown> => ({
		page: 1,
		stream: "notices",
	}),
);

vi.mock("../src/features/notices/api", () => ({
	getNoticeDetail: api.getNoticeDetail,
	listNotices: api.listNotices,
}));

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		Link: ({
			children,
			params,
			search: _search,
			to,
			...props
		}: {
			children: React.ReactNode;
			params?: { noticeId?: string };
			search?: unknown;
			to: string;
		}) => (
			<a href={to.replace("$noticeId", params?.noticeId ?? "")} {...props}>
				{children}
			</a>
		),
		useNavigate: () => navigate,
		useParams: () => ({ noticeId: "358159" }),
		useSearch: () => routeSearch,
	};
});

describe("notice pages", () => {
	beforeEach(() => {
		api.getNoticeDetail.mockReset();
		api.listNotices.mockReset();
		navigate.mockReset();
		for (const key of Object.keys(routeSearch)) {
			delete routeSearch[key];
		}
		routeSearch.page = 1;
		routeSearch.stream = "notices";
	});

	it("renders internal rows as router links and external rows as new-tab links", async () => {
		api.listNotices.mockResolvedValue({
			filters: {
				categories: [
					{ label: "校园服务与运行", value: "campus_operations" },
					{ label: "采购招标", value: "procurement" },
				],
				noticeTypes: [
					{ label: "活动报道", value: 5 },
					{ label: "公示公告", value: 36 },
				],
				organizations: [{ label: "保卫处", value: "org-1" }],
			},
			items: [
				{
					category: "campus_operations",
					externalUrl: null,
					isExternal: false,
					noticeId: "358159",
					noticeType: { id: 5, name: "活动报道" },
					organization: { id: "org-1", name: "保卫处" },
					releasedAt: "2026-08-11T00:00:00.000Z",
					title: "海淀校区东北门暂停开放",
				},
				{
					category: "unclassified",
					externalUrl: "https://mp.weixin.qq.com/s/example",
					isExternal: true,
					noticeId: "358160",
					noticeType: { id: 5, name: "活动报道" },
					organization: null,
					releasedAt: "2026-08-10T00:00:00.000Z",
					title: "外部通知样本",
				},
				{
					category: "procurement",
					externalUrl: "https://www.ccgp.gov.cn/cggg/zygg/example",
					isExternal: true,
					noticeId: "358161",
					noticeType: { id: 36, name: "公示公告" },
					organization: { id: "org-2", name: "招标采购中心" },
					releasedAt: "2026-08-09T00:00:00.000Z",
					title: "采购结果公告",
				},
			],
			pagination: { page: 1, pageSize: 30, totalItems: 3, totalPages: 1 },
		});

		renderWithQuery(<NoticesPageContent />);

		const internal = await screen.findByRole("link", { name: /海淀校区东北门暂停开放/u });
		expect(internal).toHaveAttribute("href", "/notices/358159");
		const internalTime = within(internal).getByText("2026-08-11 08:00:00");
		expect(internalTime).toBeVisible();
		expect(within(internal).queryByText("校内门户")).toBeNull();
		expect(
			within(internal).getByText("校园服务与运行").closest('[data-slot="badge"]'),
		).toHaveAttribute("data-notice-category-tone", "orange");
		expect(internal.querySelector(".lucide-chevron-right")).not.toBeNull();
		expect(internal.querySelector(".lucide-arrow-up-right")).toBeNull();
		const external = screen.getByRole("link", { name: /外部通知样本/u });
		expect(external).toHaveAttribute("href", "https://mp.weixin.qq.com/s/example");
		expect(external).toHaveAttribute("target", "_blank");
		expect(external).toHaveAttribute("rel", "noopener noreferrer");
		const sourceLabel = within(external).getByText("微信公众号");
		expect(sourceLabel).toBeVisible();
		expect(sourceLabel.closest('[data-slot="badge"]')).toBeNull();
		const externalTime = within(external).getByText("2026-08-10 08:00:00");
		expect(externalTime).toBeVisible();
		expect(external.querySelector(".lucide-arrow-up-right")).not.toBeNull();
		expect(external.querySelector(".lucide-chevron-right")).toBeNull();
		const procurement = screen.getByRole("link", { name: /采购结果公告/u });
		expect(
			within(procurement).getByText("采购招标").closest('[data-slot="badge"]'),
		).toHaveAttribute("data-notice-category-tone", "orange");
		expect(within(procurement).getByText("中国政府采购网")).toBeVisible();
		expect(within(procurement).getByText("招标采购中心")).toBeVisible();
		expect(within(external).getByText("未分类")).toBeVisible();
	});

	it("renders core filters without secondary filter controls", async () => {
		Object.assign(routeSearch, {
			category: "procurement",
			from: "2026-08-01",
			q: "采购",
			to: "2026-08-20",
		});
		api.listNotices.mockResolvedValue({
			filters: {
				categories: [{ label: "采购招标", value: "procurement" }],
				noticeTypes: [{ label: "公示公告", value: 36 }],
				organizations: [{ label: "招标采购中心", value: "org-2" }],
			},
			items: [],
			pagination: { page: 1, pageSize: 30, totalItems: 0, totalPages: 0 },
		});

		renderWithQuery(<NoticesPageContent />);

		expect(screen.queryByRole("button", { name: /筛选条件/u })).toBeNull();
		expect(screen.getByLabelText("标题或正文关键词")).toHaveValue("采购");
		await waitFor(() => expect(screen.getByLabelText("业务分类")).toHaveTextContent("采购招标"));
		expect(screen.queryByLabelText("开始")).toBeNull();
		expect(screen.queryByLabelText("结束")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "发布日期：2026年8月1日 - 2026年8月20日" }));
		expect(await screen.findByLabelText("开始")).toBeVisible();
		expect(screen.getByLabelText("结束")).toBeVisible();
		expect(screen.queryByLabelText("正文来源")).toBeNull();
		expect(screen.queryByLabelText("门户栏目")).toBeNull();
		expect(screen.queryByLabelText("发布部门")).toBeNull();
	});

	it("switches between notification and campus news streams and clears category", async () => {
		Object.assign(routeSearch, { category: "procurement", page: 4 });
		api.listNotices.mockResolvedValue(emptyNoticeList());

		renderWithQuery(<NoticesPageContent />);

		fireEvent.click(await screen.findByRole("radio", { name: "校园动态" }));
		expect(lastSearchUpdate({ category: "procurement", page: 4, stream: "notices" })).toEqual({
			category: undefined,
			page: 1,
			stream: "campus_news",
		});
	});

	it("renders campus news as an independent view without category controls", async () => {
		Object.assign(routeSearch, { stream: "campus_news" });
		api.listNotices.mockResolvedValue(emptyNoticeList());

		renderWithQuery(<NoticesPageContent />);

		expect(await screen.findByRole("heading", { name: "校园动态" })).toBeVisible();
		expect(screen.getByRole("form", { name: "校园动态筛选" })).toBeVisible();
		expect(screen.getByRole("button", { name: "搜索校园动态" })).toBeVisible();
		expect(screen.queryByLabelText("业务分类")).toBeNull();
		expect(await screen.findByRole("heading", { name: "没有符合条件的校园动态" })).toBeVisible();
		expect(await screen.findByText("调整关键词或日期范围后再试。")).toBeVisible();
	});

	it("uses campus news wording while the independent view is loading", () => {
		Object.assign(routeSearch, { stream: "campus_news" });
		api.listNotices.mockImplementation(() => new Promise(() => undefined));

		renderWithQuery(<NoticesPageContent />);

		expect(screen.getByRole("status", { name: "正在读取校园动态" })).toBeVisible();
	});

	it("uses campus news wording when the independent view fails", async () => {
		Object.assign(routeSearch, { stream: "campus_news" });
		api.listNotices.mockRejectedValue(new Error("campus news unavailable"));

		renderWithQuery(<NoticesPageContent />);

		expect(await screen.findByRole("alert")).toHaveTextContent("校园动态不可用");
		expect(screen.getByRole("alert")).toHaveTextContent("校园动态暂时无法读取，请稍后重试。");
	});

	it("restores the date range and resets pagination on calendar change", async () => {
		Object.assign(routeSearch, {
			from: "2026-03-01",
			page: 7,
			to: "2026-08-13",
		});
		api.listNotices.mockResolvedValue(emptyNoticeList());

		renderWithQuery(<NoticesPageContent />);

		fireEvent.click(screen.getByRole("button", { name: "发布日期：2026年3月1日 - 2026年8月13日" }));
		const from = await screen.findByLabelText("开始");
		const to = screen.getByLabelText("结束");
		expect(screen.getByRole("group", { name: "发布日期范围" })).toBeVisible();
		expect(from).toBeVisible();
		expect(to).toBeVisible();

		fireEvent.click(screen.getByRole("button", { name: "下个月" }));
		fireEvent.click(screen.getByRole("button", { name: "2026年4月1日星期三" }));
		expect(navigate).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "应用" }));
		expect(lastSearchUpdate({ from: "2026-03-01", page: 7, to: "2026-08-13" })).toEqual({
			from: "2026-04-01",
			page: 1,
			to: "2026-08-13",
		});
	});

	it("updates text and business category through the existing URL query", async () => {
		const user = userEvent.setup();
		Object.assign(routeSearch, { page: 5, q: "旧关键词" });
		api.listNotices.mockResolvedValue(emptyNoticeList());

		renderWithQuery(<NoticesPageContent />);

		const title = await screen.findByLabelText("标题或正文关键词");
		expect(title).toHaveAttribute("placeholder", "搜索通知");
		fireEvent.change(title, { target: { value: "开放安排" } });
		fireEvent.submit(screen.getByRole("form", { name: "通知筛选" }));
		expect(lastSearchUpdate({ page: 5, q: "旧关键词" })).toEqual({
			page: 1,
			q: "开放安排",
		});

		const category = screen.getByLabelText("业务分类");
		category.focus();
		await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
		expect(lastSearchUpdate({ page: 5, q: "旧关键词" })).toEqual({
			category: "procurement",
			page: 1,
			q: "旧关键词",
		});
		expect(screen.queryByLabelText("门户栏目")).toBeNull();
		expect(screen.queryByLabelText("发布部门")).toBeNull();
		expect(screen.queryByLabelText("正文来源")).toBeNull();
	});

	it("clears the URL filters and the local title draft together", async () => {
		Object.assign(routeSearch, { category: "procurement", page: 4, q: "采购" });
		api.listNotices.mockResolvedValue(emptyNoticeList());

		renderWithQuery(<NoticesPageContent />);

		const title = await screen.findByLabelText("标题或正文关键词");
		fireEvent.change(title, { target: { value: "尚未提交" } });
		fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

		expect(title).toHaveValue("");
		expect(navigate).toHaveBeenLastCalledWith({
			search: { page: 1, stream: "notices" },
		});
	});

	it("shows validated content and attachment metadata without a download action", async () => {
		api.getNoticeDetail.mockResolvedValue({
			attachments: [
				{
					byteSize: "2048",
					contentType: "application/pdf",
					downloadUrl:
						"https://my.muc.edu.cn/comsys-portal-notice-web/download?id=annex-1&notice_id=358159",
					name: "开放安排.pdf",
					ordinal: 0,
				},
			],
			contentHtml: '<p>暂停开放说明</p><img src="notice-asset:image:0" alt="暂停开放示意">',
			category: "campus_operations",
			externalUrl: null,
			images: [
				{
					byteSize: "256",
					contentType: "image/png",
					name: null,
					ordinal: 0,
					url: "/api/notices/358159/images/0",
				},
			],
			isExternal: false,
			noticeId: "358159",
			noticeType: { id: 5, name: "活动报道" },
			organization: { id: "org-1", name: "保卫处" },
			releasedAt: "2026-08-11T00:00:00.000Z",
			title: "海淀校区东北门暂停开放",
		});

		renderWithQuery(<NoticeDetailPageContent />);

		expect(await screen.findByRole("heading", { name: "海淀校区东北门暂停开放" })).toBeVisible();
		expect(screen.getByText("校园服务与运行").closest('[data-slot="badge"]')).toHaveAttribute(
			"data-notice-category-tone",
			"orange",
		);
		expect(screen.getByText("暂停开放说明")).toBeVisible();
		expect(screen.queryByText("门户类型")).toBeNull();
		expect(screen.queryByText("通知编号")).toBeNull();
		const portalLink = screen.getByRole("link", { name: "在信息门户查看" });
		expect(portalLink).toHaveAttribute(
			"href",
			"https://my.muc.edu.cn/page/11#/print?notice_id=358159&show_type=1&type=5",
		);
		expect(portalLink).toHaveAttribute("target", "_blank");
		expect(portalLink).toHaveAttribute("rel", "noopener noreferrer");
		expect(screen.getByRole("img")).toHaveAttribute("src", "/api/notices/358159/images/0");
		const attachmentHeading = screen.getByRole("heading", { name: "附件信息" });
		const attachmentSection = attachmentHeading.closest("section");
		expect(attachmentSection).not.toBeNull();
		const attachmentLink = within(attachmentSection as HTMLElement).getByRole("link", {
			name: "开放安排.pdf",
		});
		expect(attachmentLink).toHaveAttribute(
			"href",
			"https://my.muc.edu.cn/comsys-portal-notice-web/download?id=annex-1&notice_id=358159",
		);
		expect(attachmentLink).toHaveAttribute("target", "_blank");
		expect(attachmentLink).toHaveAttribute("rel", "noopener noreferrer");
		expect(within(attachmentSection as HTMLElement).getByText("PDF · 2.0 KB")).toBeVisible();
		expect(within(attachmentSection as HTMLElement).queryByRole("button")).toBeNull();
		await waitFor(() =>
			expect(api.getNoticeDetail).toHaveBeenCalledWith("358159", expect.anything()),
		);
	});

	it("does not show the portal link before detail data is available", () => {
		api.getNoticeDetail.mockImplementation(() => new Promise(() => undefined));

		renderWithQuery(<NoticeDetailPageContent />);

		expect(screen.getByRole("status", { name: "正在读取通知正文" })).toBeVisible();
		expect(screen.queryByRole("link", { name: "在信息门户查看" })).toBeNull();
	});

	it("does not show the portal link when detail loading fails", async () => {
		api.getNoticeDetail.mockRejectedValue(new Error("notice unavailable"));

		renderWithQuery(<NoticeDetailPageContent />);

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("通知暂时不可用");
		expect(within(alert).getByRole("button", { name: "重试" })).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "在信息门户查看" })).toBeNull();
	});

	it("returns to the notice directory when the notice does not exist", async () => {
		api.getNoticeDetail.mockRejectedValue(
			new ApiRequestError({
				code: "notice_not_found",
				message: "notice not found",
				retryable: false,
				status: 404,
			}),
		);

		renderWithQuery(<NoticeDetailPageContent />);

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("通知不存在");
		expect(within(alert).getByRole("link", { name: "返回通知目录" })).toBeInTheDocument();
		expect(within(alert).queryByRole("button", { name: "重试" })).toBeNull();
	});
});

function renderWithQuery(children: React.ReactNode) {
	return render(
		<QueryClientProvider client={createCampusQueryClient()}>{children}</QueryClientProvider>,
	);
}

function emptyNoticeList() {
	return {
		filters: {
			categories: [{ label: "采购招标", value: "procurement" }],
			noticeTypes: [{ label: "公示公告", value: 36 }],
			organizations: [{ label: "招标采购中心", value: "org-2" }],
		},
		items: [],
		pagination: { page: 1, pageSize: 30, totalItems: 0, totalPages: 0 },
	};
}

function lastSearchUpdate(previous: Record<string, unknown>): Record<string, unknown> {
	const input = navigate.mock.calls.at(-1)?.[0] as
		| { search?: (value: Record<string, unknown>) => Record<string, unknown> }
		| undefined;
	if (typeof input?.search !== "function") {
		throw new Error("Expected navigation with a search updater.");
	}
	return input.search(previous);
}
