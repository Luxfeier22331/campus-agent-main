import { expect, test } from "@playwright/test";
import { expectControlValue, selectFilter } from "./select-control";

const at = "2026-09-30T08:00:00.000Z";

test("评价筛选、分页与详情在刷新和前进后退后恢复", async ({ page }) => {
	await page.goto("/dining/reviews");
	await expect(page.getByRole("article").first()).toBeVisible();
	const detailButton = page.getByRole("button", { name: /查看评价/ }).first();
	await detailButton.click();
	await expect(page).toHaveURL(/reviewId=/);
	await page.reload();
	await expect(page.getByRole("dialog", { name: "评价详情" })).toBeVisible();
	await page.getByRole("button", { name: "关闭评价详情" }).click();
	await expect(page).not.toHaveURL(/reviewId=/);
	await page.goBack();
	await expect(page.getByRole("dialog", { name: "评价详情" })).toBeVisible();
	await page.goForward();
	await expect(page.getByRole("dialog", { name: "评价详情" })).toBeHidden();
	await selectFilter(page, "评价目标", "submission", "用户投稿");
	await page.getByLabel("投稿标识").fill("submission-123");
	await page.getByLabel("搜索", { exact: true }).fill("食堂");
	await page.getByRole("button", { name: "搜索", exact: true }).click();
	await expect(page).toHaveURL(/submission_id=submission-123/);
	await selectFilter(page, "状态", "hidden", "已隐藏");
	await page.reload();
	await expectControlValue(
		page.getByRole("combobox", { name: "状态", exact: true }),
		"hidden",
		"已隐藏",
	);
	await expect(page.getByLabel("投稿标识")).toHaveValue("submission-123");
	await expect(page.getByLabel("搜索", { exact: true })).toHaveValue("食堂");
	await page.route("**/api/ops/dining/reviews?*", async (route) =>
		route.fulfill({
			json: {
				items: [],
				nextCursor: new URL(route.request().url()).searchParams.has("cursor") ? null : "next-page",
			},
		}),
	);
	await page.reload();
	await page.getByRole("button", { name: "下一页", exact: true }).click();
	await expect(page).toHaveURL(/cursor=next-page/);
	await page.reload();
	await expect(page.getByRole("button", { name: "上一页", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "上一页", exact: true }).click();
	await expect(page).not.toHaveURL(/cursor=/);
	await expect(page).toHaveURL(/submission_id=submission-123/);
});

test("同好群搜索仅影响显示，编辑保留完整目录且清除后恢复排序", async ({ page }) => {
	const group = {
		id: "alpha",
		name: "摄影群",
		summary: "照片交流",
		qqGroupNumber: "12345",
		joinUrl: null,
		tags: ["摄影"],
	};
	let catalog = {
		schemaVersion: "campus-groups-catalog.v1",
		sections: [
			{
				id: "group",
				name: "兴趣",
				groups: [
					group,
					{
						...group,
						id: "beta",
						name: "读书群",
						qqGroupNumber: "67890",
						summary: "图书讨论",
						tags: ["阅读"],
					},
				],
			},
		],
	};
	await page.route("**/api/ops/groups/catalog", async (route) => {
		if (route.request().method() === "PUT") {
			catalog = route.request().postDataJSON();
		}
		await route.fulfill({ json: catalog });
	});
	await page.goto("/groups");
	const search = page.getByRole("textbox", { name: "搜索同好群" });
	await search.fill("12345");
	await expect(page.getByRole("heading", { name: "摄影群", exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "读书群", exact: true })).toBeHidden();
	await expect(page.getByRole("button", { name: "调整“摄影群”的顺序" })).toBeDisabled();
	await page.getByRole("button", { name: "编辑 摄影群" }).click();
	await page.getByRole("textbox", { name: "群名", exact: true }).fill("摄影同好群");
	await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
	await expect(page.getByText("同好群已保存。")).toBeVisible();
	expect(catalog.sections[0]?.groups).toHaveLength(2);
	expect(catalog.sections[0]?.groups[1]?.name).toBe("读书群");
	await search.fill("");
	await expect(page.getByRole("heading", { name: "读书群", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "调整“摄影同好群”的顺序" })).toBeEnabled();
});

test("OCR 当前结果、历史失败、调度与通知返回链一致", async ({ page }) => {
	const success = {
		id: "10000000-0000-4000-8000-000000000001",
		status: "completed",
		createdAt: at,
		pageCount: 1,
		missingImageCount: 0,
		error: null,
		hasResult: true,
		canResume: false,
	};
	const failed = {
		...success,
		id: "10000000-0000-4000-8000-000000000002",
		status: "failed",
		hasResult: false,
		pageCount: 0,
		error: "识别队列已满",
	};
	const image = {
		noticeId: "354516",
		sourceKey: "image",
		kind: "image",
		ordinal: 0,
		displayOrdinal: 0,
		label: "图片1",
		selectedResultId: success.id,
		batches: [failed, success],
	};
	await page.route("**/api/ops/ocr/tasks", (route) =>
		route.fulfill({ json: { tasks: [], images: [image] } }),
	);
	await page.route("**/api/ops/ocr/tasks/*/result", (route) =>
		route.fulfill({
			json: {
				pages: [
					{
						index: 0,
						markdown: String.raw`<table><tr><td>丰台 $ \rightarrow $五棵松\n下一行</td></tr></table>`,
					},
				],
				missingImages: [],
			},
		}),
	);
	await page.route("**/api/ops/tasks", (route) =>
		route.fulfill({ json: { tasks: [{ id: "document-ocr", enabled: false, error: null }] } }),
	);
	await page.goto("/ocr");
	await expect(page.getByText("自动识别已暂停")).toBeVisible();
	await expect(page.getByText("当前结果：可用 · 1 页")).toBeVisible();
	await expect(page.getByText("最新尝试：识别失败")).toBeVisible();
	await page.getByRole("button", { name: "查看结果", exact: true }).click();
	await expect(page.getByRole("table")).toContainText("丰台 →五棵松");
	await expect(page.getByRole("table").locator("br")).toHaveCount(1);
	await page.getByRole("button", { name: "关闭", exact: true }).click();
	await page.getByRole("link", { name: "通知 354516 · 图片1" }).click();
	await expect(page).toHaveURL(
		(url) => JSON.parse(url.searchParams.get("q") ?? "null") === "354516",
	);
	await page.getByRole("link", { name: "返回正文图片识别" }).click();
	await expect(page).toHaveURL(/\/ocr$/);
	await expect(page.getByText("当前结果：可用 · 1 页")).toBeVisible();
});

test("非画布内容页在平板与窄屏没有页面级溢出", async ({ page }, testInfo) => {
	testInfo.skip(testInfo.project.name !== "desktop-1440", "跨宽度检查在桌面项目执行");
	const grant = {
		id: "11111111-1111-4111-8111-111111111111",
		email: "visitor@example.com",
		environment: "staging",
		kind: "invitation",
		state: "pending",
		userId: null,
		createdAt: at,
		updatedAt: at,
		createdBy: "operator",
		claimExpiresAt: at,
		accessExpiresAt: null,
		claimedAt: null,
		revokedAt: null,
		revokedBy: null,
		lastInvitationSentAt: at,
	};
	const route = {
		routeId: "commute",
		serviceKind: "commute",
		origin: "海淀校区",
		destination: "丰台校区",
		displayOrder: 0,
		defaultBoardingPoint: "东门",
		dropOffPoint: "南门",
		boardingGuide: null,
		createdAt: at,
		updatedAt: at,
		updatedBy: "operator",
	};
	const period = {
		scheduleId: "current",
		routeId: "commute",
		validFrom: "2026-01-01",
		validTo: null,
		weekdays: [1, 2, 3, 4, 5, 6, 7],
		status: "operating",
		boardingPointOverride: null,
		note: null,
		sourceReleasedAt: null,
		createdAt: at,
		updatedAt: at,
		updatedBy: "operator",
		items: [
			{
				itemId: "morning",
				kind: "fixed",
				departureTime: "08:00",
				riderType: "all",
				boardingPoint: null,
				capacity: null,
				note: null,
				sortOrder: 0,
			},
		],
	};
	const submission = {
		submissionId: "layout",
		status: "public",
		revision: 1,
		contentRevision: 1,
		name: "学生牛肉面",
		priceText: "12 元",
		photo: {
			photoId: "photo",
			width: 1,
			height: 1,
			url: "/api/ops/dining/submissions/layout/photos/photo",
		},
		authorId: "internal-user",
		authorDisplayName: "投稿同学",
		accountDeletingAt: null,
		windowId: "hall:floor:window",
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
	await page.route("**/api/ops/email-access-grants**", (r) =>
		r.fulfill({ json: { environment: "staging", items: [grant], nextCursor: null } }),
	);
	await page.route("**/api/ops/transport/routes", (r) => r.fulfill({ json: { routes: [route] } }));
	await page.route("**/api/ops/transport/schedule-periods", (r) =>
		r.fulfill({ json: { schedulePeriods: [period] } }),
	);
	await page.route("**/api/ops/dining/submissions?*", (r) =>
		r.fulfill({ json: { items: [submission], nextCursor: null } }),
	);
	await page.route("**/api/ops/groups/catalog", (r) =>
		r.fulfill({
			json: {
				schemaVersion: "campus-groups-catalog.v1",
				sections: [
					{
						id: "interest",
						name: "兴趣",
						groups: [
							{
								id: "photo",
								name: "摄影群",
								summary: "照片交流",
								qqGroupNumber: "12345",
								joinUrl: null,
								tags: ["摄影"],
							},
						],
					},
				],
			},
		}),
	);

	for (const width of [320, 390, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		for (const path of [
			"/dining/reviews",
			"/dining/menu",
			"/dining/submissions",
			"/dining/reports",
			"/groups",
			"/transport",
			"/email-access",
		]) {
			await page.goto(path);
			await expect(page.locator("main h1")).toBeVisible();
			const ready: Record<string, string> = {
				"/email-access": "visitor@example.com",
				"/groups": "摄影群",
				"/transport": "默认乘车点",
				"/dining/submissions": "学生牛肉面",
			};
			if (ready[path]) {
				await expect(
					page.getByText(ready[path], { exact: true }).filter({ visible: true }).first(),
				).toBeVisible();
			}

			await expect
				.poll(() =>
					page.evaluate(
						() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
					),
				)
				.toBeLessThanOrEqual(0);
		}
	}
});
