import AxeBuilder from "@axe-core/playwright";
import type {
	DiningMySubmission,
	DiningSubmission,
	DiningSubmissionReview,
} from "@campus-agent/dining/domain";
import { expect, type Locator, type Page, type Route, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";
import { mockAuthApi } from "./support/auth-mocks";

const at = "2026-09-15T00:00:00.000Z";
const windowId = "haidian:haidian-1f:window-1";
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
	"base64",
);
const publicSubmission: DiningSubmission = {
	submissionId: "dsb-e2e-1",
	windowId,
	name: "同学的牛肉面",
	priceText: "14 元",
	authorName: "投稿同学",
	canReport: true,
	hasReported: false,
	createdAt: at,
	updatedAt: at,
	source: "user_submission",
	photo: {
		photoId: "photo-e2e-1",
		width: 1,
		height: 1,
		url: "/api/dining/submissions/dsb-e2e-1/photos/photo-e2e-1",
	},
};
const ownSubmission: DiningMySubmission = {
	submissionId: publicSubmission.submissionId,
	windowId,
	name: publicSubmission.name,
	priceText: publicSubmission.priceText,
	status: "public",
	canEdit: true,
	canDelete: true,
	createdAt: at,
	updatedAt: at,
	deletedAt: null,
	expiresAt: null,
	hiddenAt: null,
	revision: 2,
	windowAvailable: true,
	photo: {
		photoId: "photo-e2e-1",
		width: 1,
		height: 1,
		url: "/api/dining/me/submissions/dsb-e2e-1/photos/photo-e2e-1",
	},
};
const originalReview: DiningSubmissionReview = {
	reviewId: "review-e2e-1",
	submissionId: publicSubmission.submissionId,
	anonymous: true,
	authorName: null,
	body: "汤底很香。",
	canDelete: false,
	canReport: true,
	createdAt: at,
	edited: false,
	hasReported: false,
};
interface SubmissionRequest {
	method: string;
	path: string;
	revision: string | undefined;
	key: string | undefined;
	metadata?: Record<string, unknown>;
	photo?: { name: string; size: number };
}
async function requestFields(route: Route) {
	const request = route.request();
	const contentType = request.headers()["content-type"] ?? "";
	if (contentType.startsWith("multipart/form-data")) {
		const form = await new Response(new Uint8Array(request.postDataBuffer() ?? []), {
			headers: { "content-type": contentType },
		}).formData();
		expect([...form.keys()]).toEqual(["metadata", "photo"]);
		const photo = form.get("photo");
		expect(photo).not.toBeNull();
		return {
			metadata: JSON.parse(String(form.get("metadata"))) as Record<string, unknown>,
			...(photo && typeof photo !== "string"
				? { photo: { name: photo.name, size: photo.size } }
				: {}),
		};
	}
	return { metadata: request.postDataJSON() as Record<string, unknown> };
}
async function installSubmissionApi(
	page: Page,
	input: {
		failPublicOnce?: boolean;
		reportSession?: { authenticated: boolean };
	} = {},
) {
	const state = {
		own: { ...ownSubmission } as DiningMySubmission,
		public: { ...publicSubmission },
		reviews: [{ ...originalReview }],
		publicFailures: input.failPublicOnce ? 1 : 0,
		created: 0,
		deleted: 0,
		reports: 0,
		requests: [] as SubmissionRequest[],
	};
	await page.route("**/api/dining/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		const method = request.method();
		const json = (body: unknown, status = 200) =>
			route.fulfill({
				contentType: "application/json",
				headers: { "cache-control": "no-store" },
				json: body,
				status,
			});
		if (method === "GET" && /\/submissions\/[^/]+\/photos\/[^/]+$/.test(path)) {
			return route.fulfill({
				contentType: "image/png",
				body: png,
				headers: { "cache-control": "no-store" },
			});
		}
		if (method === "GET" && /^\/api\/dining\/windows\/[^/]+\/submissions$/.test(path)) {
			return json({ items: [state.public], nextCursor: null });
		}
		if (method === "GET" && path === `/api/dining/submissions/${state.public.submissionId}`) {
			if (state.publicFailures > 0) {
				state.publicFailures -= 1;
				return json(
					{ error: { code: "temporary", message: "投稿暂时无法读取。", retryable: true } },
					503,
				);
			}
			return json({
				submission: {
					...state.public,
					...(input.reportSession ? { canReport: input.reportSession.authenticated } : {}),
				},
			});
		}
		if (method === "GET" && path === "/api/dining/me/submissions") {
			return json({ items: [state.own], nextCursor: null });
		}
		if (method === "GET" && path === `/api/dining/me/submissions/${state.own.submissionId}`) {
			return json({ submission: state.own });
		}
		if (
			(method === "POST" && /^\/api\/dining\/windows\/[^/]+\/submissions$/.test(path)) ||
			(method === "PATCH" && path === `/api/dining/me/submissions/${state.own.submissionId}`)
		) {
			const fields = await requestFields(route);
			state.requests.push({
				method,
				path,
				revision: request.headers()["if-match"],
				key: request.headers()["idempotency-key"],
				...fields,
			});
			if (state.own.status !== "public" && state.own.status !== "hidden") {
				throw new Error("Cannot edit a deleted fixture");
			}
			if (method === "POST") {
				state.created += 1;
			}
			state.own = {
				...state.own,
				name: String(fields.metadata.name),
				priceText: fields.metadata.priceText as string | null,
				revision: state.own.revision + 1,
				photo: fields.metadata.photoAction === "remove" ? null : state.own.photo,
			};
			return json({ submission: state.own }, method === "POST" ? 201 : 200);
		}
		if (method === "DELETE" && path === `/api/dining/me/submissions/${state.own.submissionId}`) {
			state.requests.push({
				method,
				path,
				revision: request.headers()["if-match"],
				key: undefined,
			});
			state.deleted += 1;
			state.own = {
				submissionId: state.own.submissionId,
				windowId,
				status: "deleted",
				canEdit: false,
				canDelete: false,
				deletedAt: at,
				expiresAt: "2026-10-15T00:00:00.000Z",
				hiddenAt: state.own.hiddenAt,
				revision: state.own.revision + 1,
				createdAt: at,
				updatedAt: at,
				windowAvailable: true,
			};
			return route.fulfill({ status: 204 });
		}
		if (
			method === "GET" &&
			path === `/api/dining/submissions/${state.public.submissionId}/reviews`
		) {
			return json({ items: state.reviews, nextCursor: null });
		}
		if (
			method === "POST" &&
			path === `/api/dining/submissions/${state.public.submissionId}/reviews`
		) {
			const fields = request.postDataJSON() as { anonymous: boolean; body: string };
			state.requests.push({
				method,
				path,
				key: request.headers()["idempotency-key"],
				revision: undefined,
				metadata: fields,
			});
			const review = {
				...originalReview,
				...fields,
				reviewId: "new-review",
				canDelete: true,
				canReport: false,
			};
			state.reviews.push(review);
			return json({ review }, 201);
		}
		if (
			method === "POST" &&
			path === `/api/dining/submissions/${state.public.submissionId}/reports`
		) {
			state.reports += 1;
			state.public = { ...state.public, hasReported: true, canReport: false };
			return json({ reportId: `report-${state.reports}` }, 201);
		}
		return route.fallback();
	});
	return state;
}
async function openWindow(page: Page) {
	await page.goto("/dining");
	await expect(page.getByRole("heading", { exact: true, name: "食堂地图" })).toBeVisible();
	await page.getByRole("button", { name: "选择兰州拉面" }).click();
	await expect(page.getByRole("heading", { name: "兰州拉面" })).toBeVisible();
}
async function noOverflow(page: Page) {
	const widths = await page.evaluate(() => ({
		content: document.documentElement.scrollWidth,
		viewport: document.documentElement.clientWidth,
	}));
	expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}
async function accessible(page: Page, scope?: string) {
	let axe = new AxeBuilder({ page }).withTags([
		"wcag2a",
		"wcag2aa",
		"wcag21a",
		"wcag21aa",
		"wcag22aa",
	]);
	if (scope) {
		axe = axe.include(scope);
	}
	const result = await axe.analyze();
	expect(
		result.violations,
		JSON.stringify(
			result.violations.map(({ id, nodes }) => ({
				id,
				nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
			})),
			null,
			2,
		),
	).toEqual([]);
}
async function closeSheet(page: Page, sheet: Locator) {
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
}

test.describe("Dining submission browser journeys", () => {
	for (const width of [320, 390, 1440]) {
		test(`public list and share refresh preserve source and reflow at ${width}`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			await mockCampusApi(page, { authenticated: false });
			await installSubmissionApi(page);
			await openWindow(page);
			const link = page.getByRole("link", { name: /同学的牛肉面/ });
			await expect(link).toContainText("用户投稿 · 投稿同学");
			await noOverflow(page);
			await link.getByRole("img").click();
			const sheet = page.getByRole("dialog", { name: "用户投稿", exact: true });
			await expect(sheet.getByRole("heading", { name: "同学的牛肉面" })).toBeVisible();
			await expect(sheet).toContainText("用户投稿 · 投稿同学");
			await page.evaluate(() => {
				Object.defineProperty(navigator, "clipboard", {
					configurable: true,
					value: {
						writeText: async (value: string) => {
							document.body.dataset.copiedLink = value;
						},
					},
				});
			});
			const location = page.url();
			await sheet.getByRole("button", { name: "复制链接", exact: true }).click();
			await expect(sheet.getByRole("status")).toHaveText("链接已复制");
			expect(page.url()).toBe(location);
			const share = await page.locator("body").getAttribute("data-copied-link");
			expect(share).toBe(new URL("/dining?submission=dsb-e2e-1", page.url()).href);
			if (!share) {
				throw new Error("Expected copied link");
			}
			await page.goto(share);
			await page.reload();
			await expect(sheet.getByRole("heading", { name: "同学的牛肉面" })).toBeVisible();
			await noOverflow(page);
			await accessible(page, '[role="dialog"]');
		});
	}
	test("signs in, creates a photo submission, edits and deletes to metadata only", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 900 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		const sessionState = { authenticated: false };
		await mockCampusApi(page, { sessionState });
		await mockAuthApi(page, { sessionState, signIn: "success" });
		const state = await installSubmissionApi(page);
		await openWindow(page);
		// This journey mocks authentication; do not contact the real captcha provider.
		await page.evaluate(() => {
			const script = document.getElementById("__CAMPUS_AUTH_CONFIG__");
			if (script) {
				const config = JSON.parse(script.textContent ?? "{}");
				script.textContent = JSON.stringify({ ...config, turnstileSiteKey: null });
			}
		});
		await page.getByRole("button", { name: "投稿", exact: true }).click();
		const auth = page.getByRole("dialog", { name: "登录或创建校园问答账号" });
		await auth.getByLabel("邮箱").fill("student@example.edu");
		await auth.getByRole("textbox", { name: "密码", exact: true }).fill("validpassword123");
		await auth.getByRole("button", { name: "登录", exact: true }).click();
		await expect(auth).toBeHidden();
		const form = page.getByRole("form", { name: "新增用户投稿" });
		await expect(form).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(form).toBeHidden();
		await expect(page.getByRole("button", { name: "投稿", exact: true })).toBeFocused();
		await page.keyboard.press("Enter");
		await form.getByLabel("菜品名称").fill("照片投稿");
		await form
			.getByLabel("照片（选填）")
			.setInputFiles({ name: "dish.png", mimeType: "image/png", buffer: png });
		await expect(form.getByAltText("投稿照片预览")).toBeVisible();
		await noOverflow(page);
		await accessible(page, '[role="dialog"]');
		await form.getByRole("button", { name: "发布投稿" }).click();
		const own = page.getByRole("dialog", { name: "我的投稿", exact: true });
		await expect(own.getByRole("heading", { name: "照片投稿" })).toBeVisible();
		expect(state.requests[0]?.photo).toEqual({ name: "dish.png", size: png.length });
		await own.getByRole("button", { name: "编辑投稿" }).click();
		const edit = own.getByRole("form", { name: "编辑用户投稿" });
		await edit.getByLabel("菜品名称").fill("更新后的投稿");
		await edit.getByRole("radio", { name: "移除照片" }).check();
		await edit.getByRole("button", { name: "保存修改" }).click();
		await expect(own.getByRole("heading", { name: "更新后的投稿" })).toBeVisible();
		expect(state.requests.at(-1)).toMatchObject({
			method: "PATCH",
			revision: '"3"',
			metadata: { photoAction: "remove" },
		});
		await own.getByRole("button", { name: "删除投稿" }).click();
		const confirmation = page.getByRole("alertdialog");
		await expect(confirmation).toContainText("30");
		await confirmation.getByRole("button", { name: "确认删除" }).click();
		await expect(own).toContainText("已删除");
		await expect(own.getByText("更新后的投稿", { exact: true })).toHaveCount(0);
		await expect(own.getByRole("button", { name: "编辑投稿" })).toHaveCount(0);
		expect(state.requests.at(-1)).toMatchObject({ method: "DELETE", revision: '"4"' });
		await noOverflow(page);
	});
	test("recovers detail failure, creates a submission review, and reports the parent", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 900 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await mockCampusApi(page);
		const state = await installSubmissionApi(page, { failPublicOnce: true });
		await page.goto("/dining?submission=dsb-e2e-1");
		const sheet = page.getByRole("dialog", { name: "用户投稿", exact: true });
		await expect(sheet.getByRole("alert")).toContainText("投稿暂时无法读取");
		await sheet.getByRole("button", { name: "重试", exact: true }).click();
		await sheet.getByRole("button", { name: "查看与发表评价" }).click();
		const reviews = page.getByRole("dialog", { name: "同学的牛肉面", exact: true });
		await expect(reviews).toContainText("用户投稿 · 14 元");
		await reviews.getByLabel("评价内容").fill("值得再来。");
		await reviews.getByRole("button", { name: "提交", exact: true }).click();
		await expect(reviews.getByText("值得再来。", { exact: true })).toBeVisible();
		expect(state.requests.at(-1)?.path).toBe("/api/dining/submissions/dsb-e2e-1/reviews");
		await noOverflow(page);
		await accessible(page, '[role="dialog"]:not([aria-hidden="true"])');
		await closeSheet(page, reviews);
		await expect(sheet.getByRole("button", { name: "查看与发表评价" })).toBeFocused();
		await sheet.getByRole("button", { name: "举报投稿" }).click();
		await sheet.getByLabel("补充说明").fill("照片涉及隐私");
		await sheet.getByRole("button", { name: "提交举报" }).click();
		await expect(sheet.getByText("已举报", { exact: true })).toBeVisible();
		expect(state.reports).toBe(1);
	});
});

async function setupSubmissionLogin(page: Page) {
	const sessionState = { authenticated: false };
	await mockCampusApi(page, { sessionState });
	await mockAuthApi(page, { sessionState, signIn: "success" });
	await installSubmissionApi(page, { reportSession: sessionState });
	await page.goto("/dining?submission=dsb-e2e-1");
	const sheet = page.getByRole("dialog", { name: "用户投稿", exact: true });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole("button", { name: "登录后举报", exact: true })).toBeVisible();
	await page.evaluate(() => {
		const script = document.getElementById("__CAMPUS_AUTH_CONFIG__");
		if (script) {
			const config = JSON.parse(script.textContent ?? "{}");
			script.textContent = JSON.stringify({ ...config, turnstileSiteKey: null });
		}
	});
}

test("continues reporting after login without a second click, but not after cancel", async ({
	page,
}) => {
	await setupSubmissionLogin(page);
	await page.getByRole("button", { name: "登录后举报", exact: true }).click();
	await page.getByRole("button", { name: "关闭登录窗口" }).click();
	await expect(page.getByRole("button", { name: "提交举报" })).toHaveCount(0);
	await page.getByRole("button", { name: "登录后举报", exact: true }).click();
	const auth = page.getByRole("dialog", { name: "登录或创建校园问答账号" });
	await auth.getByLabel("邮箱").fill("student@example.edu");
	await auth.getByRole("textbox", { name: "密码", exact: true }).fill("validpassword123");
	await auth.getByRole("button", { name: "登录", exact: true }).click();
	await expect(auth).toBeHidden();
	await expect(page.getByRole("button", { name: "提交举报" })).toBeVisible();
	await page.getByRole("button", { name: "取消", exact: true }).click();
	await expect(page.getByRole("button", { name: "提交举报" })).toHaveCount(0);
});

test("copy failures expose a selectable public URL without navigation", async ({ page }) => {
	await mockCampusApi(page);
	await installSubmissionApi(page);
	await page.goto("/dining?submission=dsb-e2e-1");
	const before = page.url();
	for (const unavailable of [false, true]) {
		await page.evaluate((missing) => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: missing
					? undefined
					: {
							writeText: async () => {
								throw new Error("Denied");
							},
						},
			});
		}, unavailable);
		await page.getByRole("button", { name: "复制链接", exact: true }).click();
		const link = page.getByRole("textbox", { name: "公开投稿链接" });
		await expect(link).toHaveValue(new URL("/dining?submission=dsb-e2e-1", before).href);
		await expect(page.getByRole("status")).toHaveText("无法自动复制，请手动复制下方链接。");
		await link.focus();
		expect(
			await link.evaluate(
				(input: HTMLInputElement) => (input.selectionEnd ?? 0) - (input.selectionStart ?? 0),
			),
		).toBe((await link.inputValue()).length);
		expect(page.url()).toBe(before);
	}
});

test("creation protects text and photos across all dismissal paths", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await mockCampusApi(page);
	await installSubmissionApi(page);
	await openWindow(page);
	await page.getByRole("button", { name: "投稿", exact: true }).click();
	const form = page.getByRole("form", { name: "新增用户投稿" });
	await form.getByLabel("菜品名称").fill("未保存的菜品");
	await form
		.getByLabel("照片（选填）")
		.setInputFiles({ name: "dish.png", mimeType: "image/png", buffer: png });
	for (const dismiss of [
		() => page.keyboard.press("Escape"),
		() => page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click(),
		() => form.getByRole("button", { name: "取消", exact: true }).click(),
		() => page.mouse.click(2, 2),
	]) {
		await dismiss();
		await expect(page.getByRole("alertdialog")).toBeVisible();
		await expect(page.getByRole("button", { name: "继续编辑" })).toBeFocused();
		await page.getByRole("button", { name: "继续编辑" }).click();
		await expect(form.getByLabel("菜品名称")).toHaveValue("未保存的菜品");
		expect(
			await form
				.getByLabel("照片（选填）")
				.evaluate((input: HTMLInputElement) => input.files?.length),
		).toBe(1);
	}
	await form.getByRole("button", { name: "取消", exact: true }).click();
	await page.getByRole("button", { name: "放弃修改" }).click();
	await expect(form).toBeHidden();
	await page.getByRole("button", { name: "投稿", exact: true }).click();
	await expect(form.getByLabel("菜品名称")).toHaveValue("");
	await page.keyboard.press("Escape");
	await expect(form).toBeHidden();
});

test("editing protects unsaved input across browser navigation", async ({ page }) => {
	await mockCampusApi(page);
	await installSubmissionApi(page);
	await page.goto("/dining?mine=1");
	await page.getByRole("button", { name: "查看与编辑" }).click();
	await page.getByRole("button", { name: "编辑投稿" }).click();
	const form = page.getByRole("form", { name: "编辑用户投稿" });
	await form.getByLabel("菜品名称").fill("本地正在编辑");
	const back = page.goBack();
	await expect(page.getByRole("alertdialog")).toBeVisible();
	await page.getByRole("button", { name: "继续编辑" }).click();
	await back;
	await expect(form.getByLabel("菜品名称")).toHaveValue("本地正在编辑");
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "放弃修改" }).click();
	await expect(form).toBeHidden();
	await expect(page).toHaveURL(/mine=/);
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("failed photo retries are independent of the text and photo detail link", async ({ page }) => {
	await mockCampusApi(page);
	await installSubmissionApi(page);
	await page.route("**/photos/**", (route) => route.abort());
	await openWindow(page);
	const retry = page.getByRole("button", { name: "重试照片" });
	await expect(retry).toBeVisible();
	expect(await retry.evaluate((element) => Boolean(element.closest("a")))).toBe(false);
	await retry.click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.getByRole("link", { name: /同学的牛肉面/ }).focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("dialog", { name: "用户投稿", exact: true })).toBeVisible();
});
