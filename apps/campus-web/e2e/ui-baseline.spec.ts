import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type Route, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

const surfaces = [
	{
		name: "登录",
		path: "/account/login",
		ready: (page: Page) => page.getByRole("heading", { exact: true, name: "登录校园问答" }),
	},
	{
		name: "班车",
		path: "/transport",
		ready: (page: Page) => page.getByRole("heading", { level: 1, name: "校园班车" }),
	},
	{
		name: "问答",
		path: "/",
		ready: (page: Page) => page.getByTestId("assistant-chat"),
	},
	{
		name: "文档",
		path: "/docs",
		ready: (page: Page) => page.getByRole("heading", { exact: true, level: 1, name: "校园文档" }),
	},
	{
		name: "同好群",
		path: "/groups",
		ready: (page: Page) => page.getByRole("heading", { exact: true, level: 1, name: "同好群" }),
	},
	{
		name: "食堂",
		path: "/dining",
		ready: (page: Page) => page.getByRole("heading", { exact: true, level: 1, name: "食堂地图" }),
	},
	{
		name: "地图",
		path: "/map",
		ready: (page: Page) => page.getByRole("region", { name: "校园地图" }),
	},
	{
		name: "反馈",
		path: "/feedback",
		ready: (page: Page) => page.getByRole("heading", { exact: true, level: 1, name: "反馈" }),
	},
] as const;

test.describe("Campus UI baseline", { tag: "@ui-baseline" }, () => {
	test.beforeEach(async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
		await mockTransportApi(page);
	});

	test("代表性页面在目标宽度保持主要任务可见且没有页面级溢出", { tag: "@layout" }, async ({
		page,
	}) => {
		for (const surface of surfaces) {
			await page.goto(surface.path, { waitUntil: "domcontentloaded" });
			await expect(surface.ready(page)).toBeVisible({ timeout: 15_000 });
			const overflow = await page.evaluate(() => ({
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
			}));
			expect(
				overflow.scrollWidth,
				`${surface.name} ${surface.path} 在 ${overflow.clientWidth}px 下发生页面级横向溢出`,
			).toBeLessThanOrEqual(overflow.clientWidth + 1);
		}
	});

	test("Dining 分段筛选在明暗主题和各断点保持选择与键盘操作", { tag: "@layout" }, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/dining", { waitUntil: "domcontentloaded" });
		for (const theme of ["light", "dark"]) {
			await page.evaluate((value) => {
				document.documentElement.dataset.theme = value;
			}, theme);
			if ((page.viewportSize()?.width ?? 0) >= 1024) {
				const hall = page.getByRole("radio", { name: "荟贤食堂" });
				await hall.focus();
				await page.keyboard.press("Space");
				await expect(hall).toBeChecked();
				await hall.click();
				await expect(hall).toBeChecked();
				await expect(page.getByRole("radio", { name: "海淀一食堂" })).not.toBeChecked();
			} else {
				const hall = page.getByRole("combobox", { name: "选择食堂" });
				await hall.click();
				await page.getByRole("option", { name: "荟贤食堂" }).click();
				await expect(hall).toContainText("荟贤食堂");
			}
			const floor = page.getByRole("radio", { name: "荟贤二层" });
			await floor.click();
			await floor.click();
			await expect(floor).toBeChecked();
			await page.keyboard.press("ArrowLeft");
			await expect(page.getByRole("radio", { name: "荟贤一层" })).toBeFocused();
			await page.keyboard.press("Space");
			await expect(page.getByRole("radio", { name: "荟贤一层" })).toBeChecked();
			await expect(floor).not.toBeChecked();
			await expect(page).toHaveURL(/floor=fengtai-1f/u);
			expect((await floor.boundingBox())?.height).toBeGreaterThanOrEqual(44);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				page.viewportSize()?.width ?? 0,
			);
		}
	});

	test("通知筛选在明暗主题下保持触控尺寸并可选择和清除", { tag: "@layout" }, async ({ page }) => {
		await mockCampusApi(page, { authenticated: true });
		await page.route("**/api/notices?**", (route) =>
			route.fulfill({
				json: {
					filters: {
						categories: [{ label: "采购招标", value: "procurement" }],
						noticeTypes: [],
						organizations: [],
					},
					items: [],
					pagination: { page: 1, pageSize: 30, totalItems: 0, totalPages: 0 },
				},
			}),
		);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/notices", { waitUntil: "domcontentloaded" });
		const category = page.getByRole("combobox", { name: "业务分类" });
		await expect(page.getByRole("heading", { name: "没有符合条件的通知" })).toBeVisible();
		for (const theme of ["light", "dark"]) {
			await page.evaluate((value) => {
				document.documentElement.dataset.theme = value;
			}, theme);
			await expect(category).toHaveCSS("border-radius", "12px");
			expect((await category.boundingBox())?.height).toBeGreaterThanOrEqual(44);
			await category.focus();
			await page.keyboard.press("Space");
			await page.getByRole("option", { name: "采购招标" }).click();
			await expect(category).toContainText("采购招标");
			await expect(page).toHaveURL(/category=procurement/u);
			await expect(category).toBeFocused();
			await page.getByRole("button", { name: "清除筛选" }).click();
			await expect(category).toContainText("全部分类");
			await expect(page).not.toHaveURL(/category=/u);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				page.viewportSize()?.width ?? 0,
			);
		}
	});

	test("班车月历在放大文字及明暗主题下保持可读并恢复焦点", { tag: "@layout" }, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/transport", { waitUntil: "networkidle" });
		await expect(page.getByRole("radio", { name: "丰台校区 → 海淀校区" })).toBeVisible();
		for (const theme of ["light", "dark"]) {
			for (const fontSize of [16, 32]) {
				await page.evaluate(
					({ theme, fontSize }) => {
						document.documentElement.dataset.theme = theme;
						document.documentElement.style.fontSize = `${fontSize}px`;
					},
					{ theme, fontSize },
				);
				const nav = page.locator(".campus-top-nav");
				expect(
					await nav.evaluate((element) =>
						[...element.querySelectorAll("a, button")]
							.filter((control) => control.getBoundingClientRect().width > 0)
							.every((control) => {
								const box = control.getBoundingClientRect();
								return box.left >= 0 && box.right <= document.documentElement.clientWidth;
							}),
					),
				).toBe(true);
				const date = page.getByRole("button", { name: /^选择日期：/u });
				await date.click();
				const calendar = page.getByRole("region", { name: "班车月历" });
				await expect(calendar).toBeVisible();
				await expect(calendar.getByText("停运", { exact: true }).first()).toBeVisible();
				if (fontSize === 16) {
					const results = await new AxeBuilder({ page })
						.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
						.analyze();
					expect(results.violations, formatViolations(results.violations)).toEqual([]);
				}
				expect(
					await calendar
						.locator(".ui-metadata")
						.first()
						.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
				).toBeGreaterThanOrEqual(12);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
					),
				).toBe(true);
				await page.keyboard.press("Escape");
				await expect(date).toBeFocused();
			}
		}
	});

	test("主题切换保持根节点语义并在刷新后持久化", { tag: "@interaction" }, async ({ page }) => {
		await page.goto("/feedback", { waitUntil: "domcontentloaded" });
		const themeTrigger = page.getByRole("button", { name: /外观，当前/u });
		const visibleThemeTrigger = await findVisibleLocator(themeTrigger);
		if (visibleThemeTrigger) {
			await visibleThemeTrigger.click();
			await page.getByRole("menuitemradio", { name: "深色" }).click();
		} else {
			const trigger = page.getByRole("button", { name: "打开全局菜单" });
			await trigger.click();
			const drawer = page.getByRole("dialog", { name: "校园问答导航" });
			await drawer.getByText("深色", { exact: true }).click();
		}
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem("campus-agent.theme")))
			.toBe("dark");

		await page.reload();
		await expect(page.getByRole("heading", { exact: true, name: "反馈" })).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	});

	test("移动产品导航支持 Escape 并把焦点还给触发按钮", { tag: "@mobile" }, async ({ page }) => {
		await page.goto("/feedback", { waitUntil: "domcontentloaded" });
		const trigger = page.getByRole("button", { name: "打开全局菜单" });
		const triggerBox = await trigger.boundingBox();
		expect(triggerBox?.width).toBeGreaterThanOrEqual(44);
		expect(triggerBox?.height).toBeGreaterThanOrEqual(44);
		await trigger.focus();
		await trigger.press("Enter");
		await expect(page.getByRole("dialog", { name: "校园问答导航" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(trigger).toBeFocused();
	});

	test("移动产品导航在关闭后再交接账号弹窗", { tag: "@mobile" }, async ({ page }) => {
		for (const surface of [
			{
				path: "/feedback",
				ready: (currentPage: Page) =>
					currentPage.getByRole("heading", { exact: true, level: 1, name: "反馈" }),
			},
			{ path: "/", ready: (currentPage: Page) => currentPage.getByTestId("assistant-chat") },
			{
				path: "/map",
				ready: (currentPage: Page) => currentPage.getByRole("region", { name: "校园地图" }),
			},
		]) {
			await page.goto(surface.path, { waitUntil: "domcontentloaded" });
			await expect(surface.ready(page)).toBeVisible({ timeout: 15_000 });
			const trigger = page.getByRole("button", { name: "打开全局菜单" });
			await trigger.click();
			const navigationDialog = page.getByRole("dialog", { name: "校园问答导航" });
			await expect(navigationDialog).toBeVisible();
			await navigationDialog.getByRole("button", { name: /^(账号|登录)$/u }).click();

			const authDialog = page.getByRole("dialog", { name: "登录或创建校园问答账号" });
			await expect(navigationDialog).toBeHidden();
			await expect(authDialog).toBeVisible();
			await expect(page.getByRole("dialog")).toHaveCount(1);
			await expect(authDialog.getByLabel("邮箱")).toBeFocused();

			await page.keyboard.press("Escape");
			await expect(authDialog).toBeHidden();
			await expect(trigger).toBeFocused();
		}
	});

	test("产品导航在 1024px 断点前后切换呈现方式", { tag: "@breakpoint" }, async ({ page }) => {
		await page.goto("/feedback", { waitUntil: "domcontentloaded" });
		const width = page.viewportSize()?.width ?? 0;
		const mobileTrigger = page.getByRole("button", { name: "打开全局菜单" });
		const desktopNavigation = page.getByRole("navigation", { name: "产品导航" });
		if (width < 1024) {
			await expect(mobileTrigger).toBeVisible();
			await expect(desktopNavigation).toBeHidden();
		} else {
			await expect(mobileTrigger).toBeHidden();
			await expect(desktopNavigation).toBeVisible();
		}
	});

	test("问答与文档 TopNav 使用各自的高度密度", { tag: "@interaction" }, async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });
		await expect(page.getByTestId("assistant-chat")).toBeVisible();
		await expect
			.poll(
				async () =>
					(await page.getByTestId("assistant-chat").locator(".campus-top-nav").boundingBox())
						?.height,
			)
			.toBe(52);

		await page.goto("/docs", { waitUntil: "domcontentloaded" });
		await expect(
			page.getByRole("heading", { exact: true, level: 1, name: "校园文档" }),
		).toBeVisible();
		await expect
			.poll(async () => (await page.locator(".campus-top-nav").boundingBox())?.height)
			.toBe(64);
	});

	test("搜索弹窗具有名称并在 Escape 后归还焦点", { tag: "@interaction" }, async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });
		await expect(page.getByTestId("assistant-chat")).toBeVisible();

		if ((page.viewportSize()?.width ?? 0) < 1024) {
			await page.locator('[data-sidebar="trigger"]:visible').click();
			await expect(page.getByRole("dialog", { name: "聊天记录" })).toBeVisible();
		}

		const searchTrigger = page.getByRole("button", { name: "搜索聊天" });
		await searchTrigger.click();
		const searchDialog = page.getByRole("dialog", { name: "搜索聊天" });
		await expect(searchDialog).toBeVisible();
		await expect(searchDialog.getByRole("combobox", { name: "搜索历史会话" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(searchDialog).toBeHidden();
		await expect(searchTrigger).toBeFocused();
	});

	test("共享账号弹窗首帧可见并在关闭后恢复焦点", { tag: "@desktop" }, async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });
		await expect(page.getByTestId("assistant-chat")).toBeVisible();
		const loginTrigger = page
			.locator("#campus-chat-sidebar")
			.locator('[data-sidebar="footer"]')
			.getByRole("button", { name: "登录" });
		await loginTrigger.click();
		const authDialog = page.getByRole("dialog", { name: "登录或创建校园问答账号" });
		await expect(authDialog).toBeVisible({ timeout: 500 });
		await page.keyboard.press("Escape");
		await expect(authDialog).toBeHidden();
		await expect(loginTrigger).toBeFocused();
	});

	test("账户界面沿用 Campus 交互色与圆角", { tag: "@interaction" }, async ({ page }) => {
		const width = page.viewportSize()?.width ?? 0;
		await page.goto("/feedback", { waitUntil: "domcontentloaded" });
		for (const theme of ["light", "dark"] as const) {
			await page.evaluate((nextTheme) => {
				localStorage.setItem("campus-agent.theme", nextTheme);
			}, theme);
			await page.reload({ waitUntil: "domcontentloaded" });
			await expect(page.getByRole("heading", { exact: true, name: "反馈" })).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

			const routeContext = page.getByLabel("反馈来源");
			await expect(routeContext).toHaveCSS("border-radius", "8px");
			const selectBeforeAuth = await readFocusedFeedbackOptionStyle(page);
			expect(selectBeforeAuth.backgroundColor).toBe(
				await resolveCssColor(page, "--sys-surface-hover"),
			);
			expect(selectBeforeAuth.color).toBe(await resolveCssColor(page, "--sys-text-strong"));

			if (width === 1440) {
				const stylesheetSources = await readApplicationStylesheetSources(page);
				const activeNavigation = page
					.getByRole("navigation", { name: "产品导航" })
					.getByRole("link", { name: "反馈" });
				const selectedHover = await resolveCssColor(page, "--campus-selected-hover");
				await activeNavigation.hover();
				await expect(activeNavigation).toHaveCSS("background-color", selectedHover);
				const navigationBeforeAuth = await readVisualStyle(activeNavigation);
				expect(navigationBeforeAuth.backgroundColor).toBe(selectedHover);
				expect(navigationBeforeAuth.color).toBe(
					await resolveCssColor(page, "--campus-selected-foreground"),
				);

				const accountTrigger = page
					.locator(".campus-top-nav")
					.getByRole("button", { name: "账号" });
				await expect(accountTrigger).toBeEnabled();
				await accountTrigger.click();
				const authDialog = page.getByRole("dialog", { name: "登录或创建校园问答账号" });
				await expect(authDialog).toBeVisible();
				await expect(page.locator('[data-campus-account-surface="auth-modal"]')).toBeVisible();

				const submit = authDialog.getByRole("button", { exact: true, name: "登录" });
				const campusAction = await resolveCssColor(page, "--campus-action");
				await expect(submit).toBeEnabled();
				await expect(submit).toHaveCSS("background-color", campusAction);
				expect((await readVisualStyle(submit)).backgroundColor).toBe(campusAction);
				const close = authDialog.getByRole("button", { name: "关闭登录窗口" });
				const neutralHover = await resolveCssColor(page, "--sys-surface-hover");
				await close.hover();
				await expect(close).toHaveCSS("background-color", neutralHover);
				expect((await readVisualStyle(close)).backgroundColor).toBe(neutralHover);
				expect(await readApplicationStylesheetSources(page)).toEqual(stylesheetSources);

				await page.keyboard.press("Escape");
				await expect(authDialog).toBeHidden();
				await activeNavigation.hover();
				await expect(activeNavigation).toHaveCSS("background-color", selectedHover);
				expect(await readVisualStyle(activeNavigation)).toEqual(navigationBeforeAuth);
				expect(await readFocusedFeedbackOptionStyle(page)).toEqual(selectBeforeAuth);
				await expect(routeContext).toHaveCSS("border-radius", "8px");
			}

			await page.getByLabel("问题描述").fill("验证成功状态语义色。");
			await page.getByRole("button", { name: "提交反馈" }).click();
			const success = page.getByRole("alert").filter({ hasText: "反馈已提交。" });
			await expect(success).toBeVisible();
			expect((await readVisualStyle(success)).backgroundColor).toBe(
				await resolveCssColor(page, "--sys-status-success-subtle"),
			);
			expect((await readVisualStyle(success)).color).toBe(
				await resolveCssColor(page, "--sys-text-default"),
			);

			const failFeedback = async (route: Route) => {
				await route.fulfill({
					contentType: "application/json",
					json: { error: { code: "feedback_failed", message: "failed" } },
					status: 500,
				});
			};
			await page.route("**/api/feedback", failFeedback);
			await page.getByLabel("问题描述").fill("验证错误状态语义色。");
			await page.getByRole("button", { name: "提交反馈" }).click();
			const danger = page.getByRole("alert").filter({ hasText: "反馈暂时没有提交成功。" });
			await expect(danger).toBeVisible();
			expect((await readVisualStyle(danger)).backgroundColor).toBe(
				await resolveCssColor(page, "--sys-status-danger-subtle"),
			);
			expect((await readVisualStyle(danger)).color).toBe(
				await resolveCssColor(page, "--sys-text-default"),
			);
			await page.unroute("**/api/feedback", failFeedback);
		}
	});

	test("问答聊天记录侧栏在桌面端支持收起、展开和持久化", { tag: "@desktop" }, async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });
		await expect(page.getByTestId("assistant-chat")).toBeVisible();

		const trigger = page.locator('[data-sidebar="trigger"]:visible');
		const sidebar = page.locator("#campus-chat-sidebar");
		const main = page.getByTestId("assistant-chat");
		const topNav = main.locator(".campus-top-nav");
		const sidebarFooter = sidebar.locator('[data-sidebar="footer"]');
		await expect(trigger).toHaveAccessibleName("收起聊天记录");
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
		await expect(sidebar).toHaveAttribute("data-state", "expanded");
		await expect.poll(async () => (await main.boundingBox())?.x).toBe(260);
		await expect.poll(async () => (await topNav.boundingBox())?.height).toBe(52);
		await expect.poll(() => bottomInset(sidebar, sidebarFooter)).toBe(0);
		await expect(
			sidebar.locator('[data-sidebar="footer"]').getByRole("button", { name: "登录" }),
		).toBeVisible();

		await trigger.click();
		await expect(trigger).toHaveAccessibleName("展开聊天记录");
		await expect(trigger).toHaveAttribute("aria-expanded", "false");
		await expect(sidebar).toHaveAttribute("data-state", "collapsed");
		await expect.poll(async () => (await main.boundingBox())?.x).toBe(52);
		await expect.poll(() => bottomInset(sidebar, sidebarFooter)).toBe(0);
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem("campus-agent.chat-sidebar")))
			.toBe("collapsed");

		await page.reload();
		await expect(page.getByTestId("assistant-chat")).toBeVisible();
		await expect(trigger).toHaveAccessibleName("展开聊天记录");
		await expect(sidebar).toHaveAttribute("data-state", "collapsed");

		await trigger.click();
		await expect(trigger).toHaveAccessibleName("收起聊天记录");
		await expect(sidebar).toHaveAttribute("data-state", "expanded");
	});

	test("问答移动聊天记录 Sheet 关闭后把焦点还给触发按钮", { tag: "@mobile" }, async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });
		const trigger = page.locator('[data-sidebar="trigger"]:visible');
		await expect(trigger).toHaveAccessibleName("打开聊天记录");
		await expect
			.poll(async () => (await page.locator(".campus-top-nav").boundingBox())?.height)
			.toBe(52);
		await trigger.focus();
		await trigger.press("Enter");

		const dialog = page.getByRole("dialog", { name: "聊天记录" });
		await expect(dialog).toBeVisible();
		await expect.poll(async () => (await dialog.boundingBox())?.width).toBe(260);
		await expect(dialog.getByRole("button", { name: "登录" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();

		await trigger.press("Enter");
		await expect(dialog).toBeVisible();
		await page.getByRole("button", { name: "关闭聊天记录" }).click();
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();

		await trigger.press("Enter");
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "登录" }).click();
		await expect(dialog).toBeHidden();
		const authDialog = page.getByRole("dialog", { name: "登录或创建校园问答账号" });
		await expect(authDialog).toBeVisible();
		await expect(authDialog.getByLabel("邮箱")).toBeFocused();
	});

	test("消息输入聚焦时 Control+B 不会收起聊天记录", { tag: "@desktop" }, async ({ page }) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });
		const trigger = page.locator('[data-sidebar="trigger"]:visible');
		const sidebar = page.locator("#campus-chat-sidebar");
		const composer = page.getByLabel("消息输入");
		await expect(sidebar).toHaveAttribute("data-state", "expanded");
		await composer.focus();
		await page.keyboard.press("Control+B");
		await expect(sidebar).toHaveAttribute("data-state", "expanded");

		await trigger.focus();
		await page.keyboard.press("Control+B");
		await expect(sidebar).toHaveAttribute("data-state", "collapsed");
	});
});

async function findVisibleLocator(locator: Locator): Promise<Locator | null> {
	for (let index = 0; index < (await locator.count()); index += 1) {
		const candidate = locator.nth(index);
		if (await candidate.isVisible()) {
			return candidate;
		}
	}
	return null;
}

async function bottomInset(container: Locator, child: Locator): Promise<number | undefined> {
	const [containerBox, childBox] = await Promise.all([
		container.boundingBox(),
		child.boundingBox(),
	]);
	if (!(containerBox && childBox)) {
		return;
	}
	return Math.round(containerBox.y + containerBox.height - childBox.y - childBox.height);
}

async function readFocusedFeedbackOptionStyle(page: Page) {
	await page.getByRole("combobox", { name: "问题类型" }).click();
	const option = page.getByRole("option", { name: "内容问题" });
	await expect(option).toBeVisible();
	await option.focus();
	const style = await readVisualStyle(option);
	await page.keyboard.press("Escape");
	return style;
}

async function readVisualStyle(locator: Locator) {
	return locator.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			backgroundColor: style.backgroundColor,
			color: style.color,
			opacity: style.opacity,
			visibility: style.visibility,
		};
	});
}

async function resolveCssColor(page: Page, variable: `--${string}`): Promise<string> {
	return page.evaluate((property) => {
		const probe = document.createElement("span");
		probe.style.color = `var(${property})`;
		document.body.append(probe);
		const color = getComputedStyle(probe).color;
		probe.remove();
		return color;
	}, variable);
}

async function readApplicationStylesheetSources(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		Array.from(
			document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
				'link[rel="stylesheet"], style[data-vite-dev-id]',
			),
			(node) =>
				node instanceof HTMLLinkElement
					? new URL(node.href, document.baseURI).pathname
					: (node.dataset.viteDevId ?? ""),
		),
	);
}

async function mockTransportApi(page: Page) {
	const route = {
		routeId: "route:style-test",
		serviceKind: "commute",
		origin: "丰台校区",
		destination: "海淀校区",
		boardingPoint: "聚雅餐厅东侧停车场路口",
		note: null,
		status: "operating",
		departures: [
			{
				kind: "fixed",
				departureTime: "18:00",
				riderType: "all",
				boardingPoint: null,
				capacity: null,
				note: null,
			},
		],
	};
	const catalog = [
		{
			routeId: route.routeId,
			serviceKind: route.serviceKind,
			origin: route.origin,
			destination: route.destination,
			defaultBoardingPoint: route.boardingPoint,
			boardingGuide: "请提前候车",
			dropOffPoint: null,
			nextServiceDate: null,
		},
	];
	const schedule = (date: string) => ({
		date,
		routeCatalog: catalog,
		routes: [
			{
				...route,
				...(date.endsWith("01") ? { status: "suspended", departures: [] } : {}),
				...(date.endsWith("02") ? { departures: [] } : {}),
			},
		],
	});
	await page.route("**/api/transport/schedule**", async (request) => {
		const url = new URL(request.request().url());
		if (url.pathname.endsWith("schedule-range")) {
			const from = url.searchParams.get("from") ?? "";
			const to = url.searchParams.get("to") ?? "";
			const days = Array.from({ length: Number(to.slice(-2)) }, (_, index) =>
				schedule(`${from.slice(0, 8)}${String(index + 1).padStart(2, "0")}`),
			);
			await request.fulfill({ json: { from, to, days } });
		} else {
			await request.fulfill({ json: schedule(url.searchParams.get("date") ?? "") });
		}
	});
}

function formatViolations(
	violations: Array<{ help: string; id: string; nodes: unknown[] }>,
): string {
	return violations
		.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`)
		.join("\n");
}
