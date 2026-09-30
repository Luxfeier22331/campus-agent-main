import { expect, test } from "@playwright/test";

const body = "关于份量、口味、取餐动线和高峰排队时间的详细体验。".repeat(18);

test("长评价列表显示摘要且详情保留全文", async ({ page }) => {
	await page.route("**/api/ops/dining/reviews**", async (route) => {
		const response = await route.fetch();
		const data = await response.json();
		if (data.items) {
			data.items = data.items.map((item: { body: string }) => ({ ...item, body }));
		}
		if (data.review) {
			data.review.body = body;
		}
		await route.fulfill({ response, json: data });
	});
	if ((page.viewportSize()?.width ?? 0) >= 1440) {
		await page.setViewportSize({ width: 768, height: 900 });
	}
	await page.goto("/dining/reviews");
	const row = page.getByRole("article").first();
	await expect(row).toBeVisible();
	await expect
		.poll(async () => (await row.boundingBox())?.height ?? Number.POSITIVE_INFINITY)
		.toBeLessThan(350);
	await row.getByRole("button", { name: /^查看评价 / }).click();
	await expect(page.getByRole("dialog", { name: "评价详情" }).getByLabel("评价正文")).toHaveValue(
		body,
	);
});

test("举报队列保持紧凑，详情滚动时操作始终可见", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.route("**/api/ops/dining/reports?*", async (route) => {
		const response = await route.fetch();
		const data = await response.json();
		data.items = data.items.map((item: { target: { current: object; reported: object } }) => ({
			...item,
			details: "举报补充说明。".repeat(30),
			target: {
				...item.target,
				current: { ...item.target.current, body },
				reported: { ...item.target.reported, replayable: true, body },
			},
		}));
		await route.fulfill({ response, json: data });
	});
	if ((page.viewportSize()?.width ?? 0) >= 1440) {
		await page.setViewportSize({ width: 768, height: 900 });
	}
	await page.goto("/dining/reports");
	const row = page.getByRole("listitem").filter({ hasText: "举报补充说明。" }).first();
	await expect(row).toBeVisible();
	await expect
		.poll(async () => (await row.boundingBox())?.height ?? Number.POSITIVE_INFINITY)
		.toBeLessThan(220);
	await row.getByRole("button").click();
	const detail = page.getByRole("dialog", { name: "举报详情", exact: true });
	await expect(detail).toBeVisible();
	await expect
		.poll(async () => detail.evaluate((element) => element.scrollWidth - element.clientWidth))
		.toBe(0);
	await detail.getByText("举报时内容", { exact: true }).click();
	await detail.locator(".overflow-y-auto").evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const footer = detail.locator(".shrink-0.border-t");
	await expect(footer).toBeInViewport();
	await detail.getByRole("button", { name: "关闭举报详情" }).click();
	await expect(row.getByRole("button")).toBeFocused();
});

test("举报连续查看重置滚动与历史，失败保留确认并允许重试", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	let resolved = false;
	let attempts = 0;
	await page.route("**/api/ops/dining/reports?*", async (route) => {
		const response = await route.fetch();
		const data = await response.json();
		const first = data.items[0];
		data.items = resolved
			? []
			: [0, 1].map((index) => ({
					...first,
					reportId: `serial-${index}`,
					details: `第 ${index + 1} 条举报`,
					target: {
						...first.target,
						current: { ...first.target.current, body },
						reported: { replayable: true, body },
					},
				}));
		await route.fulfill({ response, json: data });
	});
	await page.route("**/api/ops/dining/reviews/*/reports/resolve", async (route) => {
		attempts++;
		if (attempts === 1) {
			await route.fulfill({
				status: 503,
				json: { error: { code: "OPS_UNAVAILABLE", message: "处理暂时失败" } },
			});
			return;
		}
		resolved = true;
		await route.fulfill({ status: 204 });
	});
	await page.goto("/dining/reports");
	const rows = page.getByRole("list", { name: "待处理举报", exact: true }).getByRole("button");
	await rows.first().click();
	const detail = page.getByRole("dialog", { name: "举报详情", exact: true });
	await expect(detail.getByRole("button", { name: "上一条", exact: true })).toBeDisabled();
	await detail.getByText("举报时内容", { exact: true }).click();
	await detail.locator(".overflow-y-auto").evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await detail.getByRole("button", { name: "下一条", exact: true }).click();
	await expect(detail).toContainText("第 2 条举报");
	await expect(detail.locator("details")).not.toHaveAttribute("open");
	await expect
		.poll(() => detail.locator(".overflow-y-auto").evaluate((element) => element.scrollTop))
		.toBe(0);
	await expect(detail.getByRole("button", { name: "下一条", exact: true })).toBeDisabled();
	await detail.getByRole("button", { name: "关闭举报详情" }).click();
	await expect(rows.nth(1)).toBeFocused();
	await rows.nth(1).click();
	await detail.getByRole("button", { name: "保留评价并处理举报", exact: true }).click();
	const confirm = page.getByRole("alertdialog");
	await confirm.getByRole("button", { name: "保留评价", exact: true }).click();
	await expect(confirm).toContainText("处理暂时失败");
	await confirm.getByRole("button", { name: "保留评价", exact: true }).click();
	await expect(detail).toBeHidden();
	await expect(page.getByText("当前没有待处理举报。")).toBeVisible();
	await expect(page.getByRole("region", { name: "举报队列", exact: true })).toBeFocused();
	expect(attempts).toBe(2);
});

test("评价切换状态时旧评价立即退出且搜索表单保留", async ({ page }) => {
	let release = () => {
		/* gate remains pending until the assertion completes */
	};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/ops/dining/reviews?*", async (route) => {
		if (new URL(route.request().url()).searchParams.get("visibility") === "hidden") {
			await gate;
		}
		await route.continue();
	});
	await page.goto("/dining/reviews");
	await expect(page.getByRole("article").first()).toBeVisible();
	const { selectFilter } = await import("./select-control");
	await selectFilter(page, "状态", "hidden", "已隐藏");
	try {
		await expect(page.getByText("正在读取评价...")).toBeVisible();
		await expect(page.getByRole("article")).toHaveCount(0);
		await expect(page.getByLabel("搜索", { exact: true })).toBeVisible();
	} finally {
		release();
	}
	await expect(page.getByText("当前范围没有评价。")).toBeVisible();
});
