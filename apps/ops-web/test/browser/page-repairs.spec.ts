import { expect, test } from "@playwright/test";

const at = "2026-09-30T08:00:00.000Z";

test("邮箱查询保留输入焦点和创建草稿，撤销失败保留确认框", async ({ page }) => {
	const filteredQueries: string[] = [];
	let commands = 0;
	let finishQuery: () => void = () => undefined;
	const heldQuery = new Promise<void>((resolve) => {
		finishQuery = resolve;
	});
	const grant = {
		id: "11111111-1111-4111-8111-111111111111",
		email: "visitor@example.com",
		environment: "staging",
		kind: "invitation",
		state: "pending",
		userId: "user_1",
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
	await page.route("**/api/ops/email-access-grants**", async (route) => {
		if (route.request().method() !== "GET") {
			commands++;
			await route.fulfill({
				status: 503,
				json: { error: { code: "UNAVAILABLE", message: "授权服务暂不可用" } },
			});
			return;
		}
		const email = new URL(route.request().url()).searchParams.get("email");
		if (email !== null) {
			filteredQueries.push(email);
			await heldQuery;
		}
		await route.fulfill({ json: { environment: "staging", items: [grant], nextCursor: null } });
	});
	await page.goto("/email-access");
	const create = page.getByRole("textbox", { name: "完整邮箱", exact: true });
	await create.fill("draft@example.com");
	const filter = page.getByRole("textbox", { name: "按邮箱筛选", exact: true });
	await filter.focus();
	await filter.pressSequentially("visitor@example.com");
	await expect(filter).toBeFocused();
	expect(filteredQueries).toEqual([]);
	await filter.press("Enter");
	await expect.poll(() => filteredQueries).toEqual(["visitor@example.com"]);
	await expect(filter).toBeFocused();
	await expect(create).toHaveValue("draft@example.com");
	finishQuery();
	await page.getByRole("button", { name: "撤销", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
	await dialog.getByRole("button", { name: "取消" }).click();
	expect(commands).toBe(0);
	await page.getByRole("button", { name: "撤销", exact: true }).click();
	await dialog.getByRole("button", { name: "撤销", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("授权服务暂不可用");
	await expect(dialog).toBeVisible();
	expect(commands).toBe(1);
	await dialog.getByRole("button", { name: "取消" }).click();
	await page.reload();
	await expect(filter).toHaveValue("visitor@example.com");
	const returnUrl = page.url();
	await page.getByRole("link", { name: "user_1", exact: true }).filter({ visible: true }).click();
	await expect(page).toHaveURL(/users\/user_1/);
	await page.getByRole("link", { name: "返回", exact: true }).click();
	await expect(page).toHaveURL(returnUrl);
	await expect(filter).toHaveValue("visitor@example.com");
});

test("OCR 重跑保留失败和待处理状态，结果支持页码跳转", async ({ page }) => {
	let attempts = 0;
	let finish: () => void = () => undefined;
	const pending = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const task = {
		id: "00000000-0000-4000-8000-000000000001",
		status: "completed",
		createdAt: at,
		input: {
			kind: "source",
			noticeId: "354516",
			key: "notices/354516/images/0",
			contentType: "image/png",
		},
		result: {},
		pageCount: 2,
		error: null,
	};
	await page.route("**/api/ops/ocr/tasks**", async (route) => {
		if (route.request().url().endsWith("/rerun")) {
			attempts++;
			if (attempts === 1) {
				await route.fulfill({
					status: 503,
					json: { error: { code: "OCR_UNAVAILABLE", message: "OCR 暂不可用" } },
				});
			} else {
				await pending;
				await route.fulfill({ json: {} });
			}
		} else if (route.request().url().endsWith("/result")) {
			await route.fulfill({
				json: {
					pages: [
						{ index: 0, markdown: "第一页内容" },
						{ index: 1, markdown: "第二页内容" },
					],
					missingImages: [],
				},
			});
		} else {
			await route.fulfill({
				json: {
					tasks: [task],
					images: [
						{
							noticeId: "354516",
							sourceKey: task.input.key,
							kind: "image",
							ordinal: 0,
							displayOrdinal: 0,
							label: "图片1",
							selectedResultId: task.id,
							batches: [
								{
									id: task.id,
									status: task.status,
									createdAt: at,
									pageCount: 2,
									missingImageCount: 0,
									error: null,
									hasResult: true,
									canResume: false,
								},
							],
						},
					],
				},
			});
		}
	});
	await page.goto("/ocr");
	await page.getByRole("button", { name: "重新识别", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await dialog.getByRole("button", { name: "取消" }).click();
	expect(attempts).toBe(0);
	await page.getByRole("button", { name: "重新识别", exact: true }).click();
	await dialog.getByRole("button", { name: "确认重新识别" }).click();
	await expect(dialog.getByRole("alert")).toContainText("OCR 暂不可用");
	await dialog.getByRole("button", { name: "确认重新识别" }).click();
	await expect(dialog.getByRole("button", { name: "取消" })).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();
	finish();
	await expect(dialog).toBeHidden();
	await page.getByRole("button", { name: "查看结果" }).click();
	const pagePicker = page.getByRole("combobox", { name: "跳转页码（共 2 页）" });
	if (await pagePicker.evaluate((node) => node.tagName === "SELECT")) {
		await pagePicker.selectOption("1");
	} else {
		await pagePicker.click();
		await page.getByRole("option", { name: "第 2 页", exact: true }).click();
	}
	await expect(page.locator("#ocr-result-page-1")).toBeFocused();
	await expect(page.getByText("第一页内容", { exact: true })).toBeAttached();
});

test("索引回滚先确认，失败保留上下文并允许再次提交", async ({ page }) => {
	let attempts = 0;
	await page.route("**/api/ops/tasks**", async (route) => {
		if (route.request().method() === "POST") {
			attempts++;
			await route.fulfill(
				attempts === 1 ? { status: 503, json: { message: "回滚任务提交失败" } } : { json: {} },
			);
		} else {
			await route.fulfill({
				json: {
					tasks: [
						{
							id: "notice-pipeline",
							label: "通知流水线",
							runtime: "temporal",
							canSchedule: true,
							canRun: true,
							enabled: false,
							intervalMinutes: 30,
							running: false,
							runs: [],
							error: null,
						},
					],
				},
			});
		}
	});
	await page.goto("/tasks");
	const trigger = page.getByRole("button", { name: "暂停调度并回滚索引", exact: true });
	await trigger.click();
	const dialog = page.getByRole("alertdialog");
	await dialog.getByRole("button", { name: "取消" }).click();
	expect(attempts).toBe(0);
	await trigger.click();
	await dialog.getByRole("button", { name: "提交索引回滚" }).click();
	await expect(dialog.getByRole("alert")).toContainText("回滚任务提交失败");
	await dialog.getByRole("button", { name: "提交索引回滚" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("status").filter({ hasText: "回滚" })).toContainText("已提交");
});

test("用户操作列在横向滚动后仍固定，移动端保留账号信息", async ({ page }) => {
	await page.route("**/api/ops/users?*", async (route) =>
		route.fulfill({
			json: {
				items: [
					{
						id: "user-1",
						name: "测试同学",
						email: "student@muc.edu.cn",
						state: "active",
						accessState: "allowed",
						accessSource: "campus_email",
						activeSessionCount: 3,
						createdAt: at,
						updatedAt: at,
						emailVerified: true,
					},
				],
				nextCursor: null,
			},
		}),
	);
	await page.goto("/users");
	if ((page.viewportSize()?.width ?? 0) < 640) {
		const list = page.getByTestId("users-mobile-list");
		await expect(list).toContainText("有效会话3");
		await expect(list).toContainText("注册时间");
		await expect(list.getByRole("link", { name: "查看用户详情" })).toBeVisible();
	} else {
		const table = page.getByRole("table", { name: "用户列表" });
		await expect(table.locator("tbody td").last()).toHaveCSS("position", "sticky");
		await table.evaluate((node) => {
			node.style.minWidth = "2000px";
			const scroll = node.closest(".overflow-x-auto");
			if (scroll) {
				scroll.scrollLeft = 250;
			}
		});
		const cell = table.locator("tbody td").last();
		const box = await cell.boundingBox();
		if (!box) {
			throw new Error("操作列没有可见边界");
		}
		expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
	}
});
