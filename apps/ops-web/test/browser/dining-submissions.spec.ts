import AxeBuilder from "@axe-core/playwright";
import type {
	DiningOpsContentReportRecord,
	DiningOpsSubmissionDetail,
	DiningOpsSubmissionRecord,
} from "@campus-agent/dining/domain";
import { DiningOpsSubmissionRecordSchema } from "@campus-agent/dining/domain";
import { expect, type Page, test } from "@playwright/test";
import { selectFilter } from "./select-control";

const at = "2026-09-14T08:00:00.000Z";
const expiry = "2026-10-14T08:00:00.000Z";
const id = "dsb-browser";
const windowId = "hall:floor:window";
const photo = {
	photoId: "photo-current",
	width: 1,
	height: 1,
	url: `/api/ops/dining/submissions/${id}/photos/photo-current`,
};
const initial: Extract<DiningOpsSubmissionRecord, { status: "public" }> = {
	submissionId: id,
	status: "public",
	revision: 3,
	contentRevision: 2,
	name: "学生牛肉面",
	priceText: "12 元",
	photo,
	authorId: "internal-user",
	authorDisplayName: "投稿同学",
	accountDeletingAt: null,
	windowId,
	windowAvailable: true,
	createdAt: at,
	updatedAt: at,
	updatedBy: "internal-user",
	hiddenAt: null,
	hiddenBy: null,
	deletedAt: null,
	deletedBy: null,
	expiresAt: null,
	canDelete: true,
	canUnhide: false,
	canRestore: false,
	pendingReportCount: 1,
};
const history: DiningOpsSubmissionDetail["edits"] = [
	{
		editId: "edit-1",
		editedAt: at,
		editedBy: "internal-user",
		previousRevision: 1,
		nextRevision: 2,
		previous: {
			replayable: true,
			name: "原始牛肉面",
			priceText: "10 元",
			photo: { state: "expired", photoId: "photo-old", expiresAt: at },
		},
		next: {
			replayable: true,
			name: "学生牛肉面",
			priceText: "12 元",
			photo: { ...photo, state: "available", expiresAt: null },
		},
	},
];

async function mockSubmissions(page: Page, start: DiningOpsSubmissionRecord = initial) {
	let current = structuredClone(start);
	let conflict = false;
	let failPhoto = false;
	let reportResolved = false;
	const calls: Array<{ path: string; body: unknown }> = [];
	const listQueries: URLSearchParams[] = [];
	const reportQueries: URLSearchParams[] = [];
	await page.clock.setFixedTime(new Date(at));
	await page.route("**/api/ops/dining/submissions**", async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.includes("/photos/")) {
			await route.fulfill(
				failPhoto
					? { status: 503 }
					: {
							contentType: "image/png",
							body: Buffer.from(
								"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
								"base64",
							),
						},
			);
			return;
		}
		if (url.pathname.endsWith("/submissions")) {
			listQueries.push(url.searchParams);
			await route.fulfill({
				json: {
					items:
						url.searchParams.get("status") === "expired" || url.searchParams.has("cursor")
							? []
							: [current],
					nextCursor: url.searchParams.has("cursor") ? null : "next-page",
				},
			});
			return;
		}
		if (route.request().method() === "GET") {
			await route.fulfill({
				json: {
					submission: current,
					edits: current.status === "purged" || current.status === "expired" ? [] : history,
				},
			});
			return;
		}
		const body = route.request().postDataJSON() as {
			expectedRevision: number;
			visible?: boolean;
			resolution?: "keep" | "hide";
		};
		calls.push({ path: url.pathname, body });
		if (conflict) {
			conflict = false;
			current = { ...initial, name: "作者刚更新的名称", revision: 4, contentRevision: 3 };
			await route.fulfill({
				status: 409,
				json: { error: { code: "OPS_DINING_CONFLICT", message: "投稿已更新，请刷新后重试。" } },
			});
			return;
		}
		if (current.status === "purged" || current.status === "expired") {
			throw new Error("Purged content cannot mutate");
		}
		if (url.pathname.endsWith("/reports/resolve")) {
			reportResolved = true;
			current = { ...current, pendingReportCount: 0 };
			await route.fulfill({ status: 204 });
			return;
		}
		if (url.pathname.endsWith("/delete")) {
			current = {
				...initial,
				...current,
				status: "deleted",
				deletedAt: at,
				deletedBy: "operator",
				expiresAt: expiry,
				canDelete: false,
				canRestore: true,
				canUnhide: false,
				revision: current.revision + 1,
			};
		} else if (url.pathname.endsWith("/restore")) {
			current = current.hiddenAt
				? {
						...initial,
						...current,
						status: "hidden",
						deletedAt: null,
						deletedBy: null,
						expiresAt: null,
						canRestore: false,
						canDelete: true,
						canUnhide: true,
						hiddenAt: current.hiddenAt,
						revision: current.revision + 1,
					}
				: { ...initial, revision: current.revision + 1 };
		} else {
			current = body.visible
				? { ...initial, revision: current.revision + 1 }
				: {
						...initial,
						status: "hidden",
						hiddenAt: at,
						hiddenBy: "operator",
						canUnhide: true,
						revision: current.revision + 1,
					};
		}
		await route.fulfill({ json: { submission: current } });
	});
	await page.route("**/api/ops/dining/reports?*", async (route) => {
		const query = new URL(route.request().url()).searchParams;
		reportQueries.push(query);
		const report: DiningOpsContentReportRecord = {
			reportId: "report-1",
			reporterUserId: "reporter",
			reason: "privacy",
			details: "需要核对照片",
			createdAt: at,
			resolution: reportResolved ? "keep" : null,
			resolvedAt: reportResolved ? at : null,
			resolvedBy: reportResolved ? "operator" : null,
			target: {
				kind: "submission",
				current,
				targetRevision: 1,
				reported: {
					replayable: true,
					name: "举报时名称",
					priceText: "10 元",
					photo: { state: "expired", photoId: "photo-old", expiresAt: at },
				},
			},
		};
		await route.fulfill({
			json: {
				items:
					query.get("target_type") === "review" ||
					(query.get("status") === "pending" && reportResolved) ||
					(query.get("status") === "resolved" && !reportResolved)
						? []
						: [report],
				nextCursor: null,
			},
		});
	});
	return {
		calls,
		listQueries,
		reportQueries,
		setCurrent: (value: DiningOpsSubmissionRecord) => {
			current = value;
		},
		setConflict: () => {
			conflict = true;
		},
		setFailPhoto: (value: boolean) => {
			failPhoto = value;
		},
	};
}

async function checkLayout(page: Page) {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect
		.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
		.toBeLessThanOrEqual(1);
	const results = await new AxeBuilder({ page })
		.include("main")
		.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
		.analyze();
	expect(results.violations).toEqual([]);
}

async function confirm(page: Page, action: string) {
	await page.getByRole("button", { name: action, exact: true }).click();
	const dialog = page.getByRole("alertdialog", { name: `${action}？` });
	await dialog.getByRole("button", { name: action, exact: true }).click();
}

test("投稿列表筛选分页和治理详情在桌面与手机可用", async ({ page }) => {
	const mock = await mockSubmissions(page);
	await page.goto("/dining/submissions");
	await expect(page.getByRole("heading", { name: "用户投稿", exact: true })).toBeVisible();
	await expect(
		page.getByRole("link", { name: "学生牛肉面", exact: true }).filter({ visible: true }),
	).toBeVisible();
	await checkLayout(page);
	await selectFilter(page, "投稿状态", "hidden", "已隐藏");
	await expect.poll(() => mock.listQueries.at(-1)?.get("status")).toBe("hidden");
	await page.getByRole("combobox", { name: "窗口", exact: true }).fill(windowId);
	await page.getByRole("button", { name: "筛选窗口" }).click();
	await expect.poll(() => mock.listQueries.at(-1)?.get("window_id")).toBe(windowId);
	await selectFilter(page, "投稿举报", "pending", "有待处理举报");
	await expect.poll(() => mock.listQueries.at(-1)?.get("report_status")).toBe("pending");
	await page.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(page.getByText("当前筛选范围没有投稿。")).toBeVisible();
	await page.getByRole("button", { name: "上一页", exact: true }).click();
	await page
		.getByRole("link", { name: "学生牛肉面", exact: true })
		.filter({ visible: true })
		.click();
	await expect(page.getByRole("heading", { name: "用户投稿详情" })).toBeVisible();
	await page.getByRole("tab", { name: "作者与处理信息", exact: true }).click();
	await expect(page.getByText("内部用户标识：internal-user")).toBeVisible();
	const detailUrl = page.url();
	await page.getByRole("link", { name: "internal-user", exact: true }).click();
	await expect(page).toHaveURL(/users\/internal-user/);
	await page.getByRole("link", { name: "返回", exact: true }).click();
	await expect(page).toHaveURL(detailUrl);
	await page.getByRole("tab", { name: "编辑历史", exact: true }).click();
	await expect(page.getByText("历史照片已到期或清理，不可回放。").first()).toBeVisible();
	await expect(page.getByRole("img", { name: "投稿当前照片", exact: true })).toBeVisible();
	await checkLayout(page);
	await confirm(page, "隐藏投稿");
	await expect(page.getByRole("status").filter({ hasText: "隐藏投稿已完成" })).toBeVisible();
	expect(mock.calls[0]).toEqual({
		path: `/api/ops/dining/submissions/${id}/visibility`,
		body: { expectedRevision: 3, visible: false },
	});
	await confirm(page, "软删除投稿");
	await expect(page.getByText(/恢复截止：/)).toBeVisible();
	await expect(page.getByText("恢复删除后仍保持隐藏，须另行恢复公开。")).toBeVisible();
	await confirm(page, "恢复删除");
	await expect(page.getByRole("button", { name: "恢复公开", exact: true })).toBeEnabled();
	await confirm(page, "恢复公开");
	expect(
		mock.calls.map((call) => (call.body as { expectedRevision: number }).expectedRevision),
	).toEqual([3, 4, 5, 6]);
	await page.getByRole("tab", { name: "相关举报", exact: true }).click();
	await selectFilter(page, "举报目标", "review", "此投稿下的评价");
	await expect.poll(() => mock.reportQueries.at(-1)?.get("target_type")).toBe("review");
	await expect(page.getByText("当前没有待处理举报。")).toBeVisible();
	await selectFilter(page, "举报目标", "submission", "此投稿");
	await page
		.getByRole("list", { name: "待处理举报", exact: true })
		.getByRole("button")
		.first()
		.click();
	await page
		.getByRole("button", { name: "保留投稿并处理举报", exact: true })
		.filter({ visible: true })
		.click();
	await page
		.getByRole("alertdialog", { name: "保留这条投稿？" })
		.getByRole("button", { name: "保留投稿" })
		.click();
	await expect(page.getByText("当前没有待处理举报。")).toBeVisible();
	await selectFilter(page, "处理状态", "resolved", "已处理");
	await expect(page.getByText("已保留", { exact: true }).filter({ visible: true })).toBeVisible();
	await page
		.getByRole("list", { name: "已处理举报", exact: true })
		.getByRole("button")
		.first()
		.click();
	await expect(page.getByText("处理人：operator").filter({ visible: true })).toBeVisible();
	await page.getByRole("button", { name: "关闭举报详情" }).click();
	await page.getByRole("link", { name: "返回投稿列表" }).click();
	await expect(page.getByRole("heading", { name: "用户投稿", exact: true })).toBeVisible();
	expect(new URL(page.url()).searchParams.get("status")).toBe("hidden");
	expect(new URL(page.url()).searchParams.get("windowId")).toBe(windowId);
	expect(new URL(page.url()).searchParams.get("reportStatus")).toBe("pending");
	await expect(page.getByRole("button", { name: "上一页", exact: true })).toBeDisabled();
	await checkLayout(page);
});

test("投稿冲突重新读取真实版本，图片失败不阻断治理", async ({ page }) => {
	const mock = await mockSubmissions(page);
	mock.setConflict();
	mock.setFailPhoto(true);
	await page.goto(`/dining/submissions/${id}`);
	await expect(
		page.getByText("投稿当前照片读取失败。请检查访问权限或稍后重试。", { exact: true }),
	).toBeVisible();
	await confirm(page, "隐藏投稿");
	await expect(
		page.getByRole("alertdialog", { name: "隐藏投稿？" }).getByRole("alert"),
	).toContainText("投稿已更新，请刷新后重试。");
	await page
		.getByRole("alertdialog", { name: "隐藏投稿？" })
		.getByRole("button", { name: "取消", exact: true })
		.click();
	await expect(page.getByText("作者刚更新的名称", { exact: true })).toBeVisible();
	mock.setFailPhoto(false);
	await page.getByRole("button", { name: "重新读取图片" }).first().click();
	await expect(page.getByRole("img", { name: "投稿当前照片", exact: true })).toBeVisible();
	await confirm(page, "隐藏投稿");
	expect(
		mock.calls.map((call) => (call.body as { expectedRevision: number }).expectedRevision),
	).toEqual([3, 4]);
	await checkLayout(page);
});

test("注销、窗口缺失、清理中与到期投稿准确限制恢复", async ({ page }) => {
	const hidden: DiningOpsSubmissionRecord = {
		...initial,
		status: "hidden",
		hiddenAt: at,
		canUnhide: false,
		windowAvailable: false,
	};
	const mock = await mockSubmissions(page, hidden);
	await page.goto(`/dining/submissions/${id}`);
	await expect(page.getByText("所属窗口不在当前公开地图中；投稿及关联评价不公开。")).toBeVisible();
	await expect(page.getByRole("button", { name: "恢复公开", exact: true })).toBeDisabled();
	mock.setCurrent({ ...hidden, windowAvailable: true });
	await page.getByRole("button", { name: "刷新详情" }).click();
	await expect(page.getByText("照片已开始清理，不能恢复公开。")).toBeVisible();
	await expect(page.getByRole("button", { name: "恢复公开", exact: true })).toBeDisabled();
	mock.setCurrent({ ...initial, accountDeletingAt: at, canDelete: false });
	await page.getByRole("button", { name: "刷新详情" }).click();
	await expect(page.getByText("作者正在注销，投稿已撤下；不能通过普通操作恢复。")).toBeVisible();
	await expect(page.getByRole("button", { name: "软删除投稿", exact: true })).toHaveCount(0);
	const metadata = Object.fromEntries(
		Object.entries(initial).filter(([key]) => !["name", "priceText", "photo"].includes(key)),
	);
	mock.setCurrent(
		DiningOpsSubmissionRecordSchema.parse({
			...metadata,
			status: "expired",
			deletedAt: at,
			deletedBy: "operator",
			expiresAt: at,
			canDelete: false,
			canRestore: false,
			canUnhide: false,
		}),
	);
	await page.getByRole("button", { name: "刷新详情" }).click();
	await expect(page.getByText("30 天恢复期限已结束；正文和照片不可回放，不能恢复。")).toBeVisible();
	await expect(page.getByRole("img", { name: "投稿当前照片", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "恢复删除", exact: true })).toHaveCount(0);
	await checkLayout(page);
});

test("已清理投稿不显示身份正文或可执行动作", async ({ page }) => {
	await mockSubmissions(page, {
		submissionId: id,
		status: "purged",
		revision: 4,
		contentRevision: 2,
		purgedAt: at,
		canDelete: false,
		canRestore: false,
		canUnhide: false,
	});
	await page.goto(`/dining/submissions/${id}`);
	await expect(
		page.getByText("正文、照片和作者身份已清理，仅保留处理引用；不能恢复。"),
	).toBeVisible();
	await expect(page.getByText("内部用户标识：internal-user")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "软删除投稿", exact: true })).toHaveCount(0);
	await page
		.getByRole("list", { name: "待处理举报", exact: true })
		.getByRole("button")
		.first()
		.click();
	await expect(
		page.getByRole("button", { name: "保留投稿并处理举报", exact: true }).filter({ visible: true }),
	).toBeDisabled();
	await checkLayout(page);
});

test("投稿读取拒绝与空结果分别展示，支持就近重试", async ({ page }) => {
	let reject = true;
	await page.route("**/api/ops/dining/submissions?*", async (route) => {
		await route.fulfill(
			reject
				? {
						status: 403,
						json: {
							error: { code: "OPS_ADMISSION_DENIED", message: "当前账号没有运营访问权限。" },
						},
					}
				: { json: { items: [], nextCursor: null } },
		);
	});
	await page.goto("/dining/submissions");
	await expect(page.getByText("当前账号没有运营访问权限。")).toBeVisible();
	await expect(page.getByText("当前筛选范围没有投稿。")).toHaveCount(0);
	reject = false;
	await page.getByRole("button", { name: "重试", exact: true }).click();
	await expect(page.getByText("当前筛选范围没有投稿。")).toBeVisible();
	await checkLayout(page);
});

test("举报筛选分页、刷新与投稿回跳恢复同一条举报", async ({ page }) => {
	await mockSubmissions(page);
	await page.route("**/api/ops/dining/reports?*", async (route) => {
		const query = new URL(route.request().url()).searchParams;
		await route.fulfill({
			json: {
				items: [
					{
						reportId: query.has("cursor") ? "page-two" : "page-one",
						reporterUserId: "reader",
						reason: "other",
						details: "分页举报",
						createdAt: at,
						resolution: null,
						resolvedAt: null,
						resolvedBy: null,
						target: {
							kind: "submission",
							current: initial,
							targetRevision: 2,
							reported: {
								replayable: true,
								name: initial.name,
								priceText: initial.priceText,
								photo: null,
							},
						},
					},
				],
				nextCursor: query.has("cursor") ? null : "next-page",
			},
		});
	});
	await page.goto("/dining/reports");
	await selectFilter(page, "举报目标", "submission", "用户投稿");
	await page.getByLabel("投稿标识", { exact: true }).fill(id);
	await page.getByRole("button", { name: "筛选投稿", exact: true }).click();
	await page.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(page).toHaveURL(/cursor=next-page/);
	await page.getByRole("list", { name: "待处理举报", exact: true }).getByRole("button").click();
	const detail = page.getByRole("dialog", { name: "举报详情", exact: true });
	await expect(detail).toBeVisible();
	const from = page.url();
	await page.reload();
	await expect(detail).toBeVisible();
	await detail.getByRole("link", { name: "查看投稿详情与历史" }).click();
	await page.getByRole("link", { name: "返回举报队列" }).click();
	await expect(page).toHaveURL(from);
	await expect(detail).toBeVisible();
	await detail.getByRole("link", { name: "查看投稿详情与历史" }).click();
	await page.goBack();
	await expect(page).toHaveURL(from);
	await expect(detail).toBeVisible();
	await detail.getByRole("button", { name: "关闭举报详情" }).click();
	await expect(
		page.getByRole("list", { name: "待处理举报", exact: true }).getByRole("button"),
	).toBeFocused();
	await page.getByRole("button", { name: "上一页", exact: true }).click();
	await expect(page).not.toHaveURL(/cursor=/);
	await expect(page.getByRole("button", { name: "上一页", exact: true })).toBeDisabled();
	await expect(page.getByLabel("投稿标识", { exact: true })).toHaveValue(id);
});

test("举报状态加载期间保留筛选且不显示另一状态的记录", async ({ page }) => {
	await mockSubmissions(page);
	let release = () => {
		/* gate remains pending until the assertion completes */
	};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/ops/dining/reports?*", async (route) => {
		if (new URL(route.request().url()).searchParams.get("status") !== "resolved") {
			await route.fallback();
			return;
		}
		await gate;
		await route.fulfill({ json: { items: [], nextCursor: null } });
	});
	await page.goto("/dining/reports");
	await expect(page.getByRole("list", { name: "待处理举报", exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "已处理", exact: true }).click();
	try {
		await expect(page.getByRole("tabpanel", { name: "已处理", exact: true })).toContainText(
			"正在读取举报",
		);
		await expect(page.getByRole("listitem").filter({ hasText: "需要核对照片" })).toHaveCount(0);
		await expect(page.getByLabel("投稿标识", { exact: true })).toBeVisible();
	} finally {
		release();
	}
	await expect(page.getByText("当前没有已处理举报。")).toBeVisible();
});
