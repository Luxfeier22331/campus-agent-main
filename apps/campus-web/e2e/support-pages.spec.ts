import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";
import { collectPageDiagnostics } from "./support/diagnostics";

test.describe("support page browser flows", () => {
	test.beforeEach(async ({ page }) => {
		await mockCampusApi(page);
	});

	test("renders transport schedule and surfaces API failures", async ({ page }) => {
		await page.goto("/services");

		await expect(page.getByRole("heading", { name: "班车时刻表" }).first()).toBeVisible();
		await expect(page.getByText("海淀校区 -> 丰台校区")).toBeVisible();
		await expect(page.getByText("07:30")).toBeVisible();

		await page.route("**/api/campus-services/transport-schedule/status", async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: { error: { code: "transport_unavailable", message: "unavailable" } },
				status: 500,
			});
		});
		await page.reload();

		await expect(page.getByText("班车时刻表暂时无法读取。")).toBeVisible();
	});

	test("submits feedback with route context and handles submit failure", async ({ page }) => {
		let submittedBody: unknown = null;
		await page.route("**/api/feedback", async (route) => {
			submittedBody = route.request().postDataJSON();
			await route.fulfill({
				contentType: "application/json",
				json: {
					feedback: {
						category: "map_issue",
						feedbackId: "feedback_e2e",
						receivedAt: "2026-06-30T08:00:00.000Z",
						routeContext: "/feedback?source=map",
						status: "received",
					},
				},
				status: 200,
			});
		});
		await page.goto("/feedback?source=map");

		await expect(page.getByLabel("当前页面")).toContainText("/feedback?source=map");
		await page.getByLabel("问题描述").fill("地图地点名称需要更新。");
		await page.getByRole("button", { name: "提交反馈" }).click();

		await expect(page.getByText("已收到：feedback_e2e")).toBeVisible();
		expect(submittedBody).toMatchObject({
			body: "地图地点名称需要更新。",
			routeContext: "/feedback?source=map",
		});

		await page.route("**/api/feedback", async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: { error: { code: "feedback_failed", message: "failed" } },
				status: 500,
			});
		});
		await page.reload();
		await page.getByLabel("问题描述").fill("再次提交失败。");
		await page.getByRole("button", { name: "提交反馈" }).click();

		await expect(page.getByText("反馈暂时没有提交成功。")).toBeVisible();
	});

	test("validates feedback body before submitting", async ({ page }) => {
		const requests: unknown[] = [];
		await page.route("**/api/feedback", async (route) => {
			requests.push(route.request().postDataJSON());
			await route.fulfill({
				contentType: "application/json",
				json: { feedback: { feedbackId: "unexpected" } },
				status: 200,
			});
		});
		await page.goto("/feedback");

		await expect(page.getByRole("button", { name: "提交反馈" })).toBeDisabled();
		expect(requests).toEqual([]);
	});

	test("submits feedback category and trimmed contact", async ({ page }) => {
		let submittedBody: unknown = null;
		await page.route("**/api/feedback", async (route) => {
			submittedBody = route.request().postDataJSON();
			await route.fulfill({
				contentType: "application/json",
				json: {
					feedback: {
						category: "map_issue",
						feedbackId: "feedback_category_e2e",
						receivedAt: "2026-06-30T08:00:00.000Z",
						routeContext: "/feedback",
						status: "received",
					},
				},
				status: 200,
			});
		});
		await page.goto("/feedback");

		await page.getByRole("combobox", { name: "问题类型" }).click();
		await page.getByRole("option", { name: "地图问题" }).click();
		await page.getByLabel("问题描述").fill("地图点位需要更新。");
		await page.getByLabel("联系方式（可选）").fill("  student@muc.edu.cn  ");
		await page.getByRole("button", { name: "提交反馈" }).click();

		await expect(page.getByText("已收到：feedback_category_e2e")).toBeVisible();
		await expect(page.getByLabel("问题描述")).toHaveValue("");
		await expect(page.getByRole("combobox", { name: "问题类型" })).toContainText("地图问题");
		expect(submittedBody).toMatchObject({
			body: "地图点位需要更新。",
			category: "map_issue",
			contact: "student@muc.edu.cn",
		});
	});

	test("keeps mobile feedback submission scoped to the current route", async ({ page }) => {
		let submittedBody: unknown = null;
		await page.setViewportSize({ height: 812, width: 390 });
		await page.route("**/api/feedback", async (route) => {
			submittedBody = route.request().postDataJSON();
			await route.fulfill({
				contentType: "application/json",
				json: {
					feedback: {
						category: "content_issue",
						feedbackId: "feedback_mobile_e2e",
						receivedAt: "2026-06-30T08:00:00.000Z",
						routeContext: "/feedback?source=mobile",
						status: "received",
					},
				},
				status: 200,
			});
		});
		await page.goto("/feedback?source=mobile");

		await expect(page.getByLabel("当前页面")).toContainText("/feedback?source=mobile");
		await page.getByRole("combobox", { name: "问题类型" }).click();
		await page.getByRole("option", { name: "内容问题" }).click();
		await page.getByLabel("问题描述").fill("移动端反馈表单需要保持可用。");
		await page.getByLabel("联系方式（可选）").fill("  mobile@muc.edu.cn  ");
		await page.getByRole("button", { name: "提交反馈" }).click();

		await expect(page.getByText("已收到：feedback_mobile_e2e")).toBeVisible();
		expect(submittedBody).toMatchObject({
			body: "移动端反馈表单需要保持可用。",
			category: "content_issue",
			contact: "mobile@muc.edu.cn",
			routeContext: "/feedback?source=mobile",
		});
	});

	test("keeps mobile feedback validation local before submitting", async ({ page }) => {
		const requests: unknown[] = [];
		await page.setViewportSize({ height: 812, width: 390 });
		await page.route("**/api/feedback", async (route) => {
			requests.push(route.request().postDataJSON());
			await route.fulfill({
				contentType: "application/json",
				json: { feedback: { feedbackId: "unexpected_mobile" } },
				status: 200,
			});
		});
		await page.goto("/feedback?source=mobile");

		await expect(page.getByRole("button", { name: "提交反馈" })).toBeDisabled();
		expect(requests).toEqual([]);
	});

	test("keeps legal feedback source in the submitted route context", async ({ page }) => {
		let submittedBody: unknown = null;
		await page.route("**/api/feedback", async (route) => {
			submittedBody = route.request().postDataJSON();
			await route.fulfill({
				contentType: "application/json",
				json: {
					feedback: {
						category: "content_issue",
						feedbackId: "feedback_legal_e2e",
						receivedAt: "2026-06-30T08:00:00.000Z",
						routeContext: "/feedback?source=legal",
						status: "received",
					},
				},
				status: 200,
			});
		});
		await page.goto("/legal/terms");

		await page.getByRole("link", { name: "反馈" }).click();
		await expect(page).toHaveURL("/feedback?source=legal");
		await expect(page.getByLabel("当前页面")).toContainText("/feedback?source=legal");

		await page.getByLabel("问题描述").fill("服务协议里有一处链接需要更新。");
		await page.getByRole("button", { name: "提交反馈" }).click();

		await expect(page.getByText("已收到：feedback_legal_e2e")).toBeVisible();
		expect(submittedBody).toMatchObject({
			body: "服务协议里有一处链接需要更新。",
			routeContext: "/feedback?source=legal",
		});
	});

	for (const route of [
		{ heading: "登录", path: "/account/login" },
		{ heading: "创建账号", path: "/account/register" },
		{ heading: "找回密码", path: "/account/forgot-password" },
		{ heading: "设置新密码", path: "/account/reset-password?token=reset_e2e" },
		{ heading: "用户服务协议", path: "/legal/terms" },
		{ heading: "隐私政策", path: "/legal/privacy" },
		{
			heading: "登录授权未完成",
			path: "/account/federation/error?error=invalid_redirect_uri",
		},
	]) {
		test(`renders ${route.path} without browser errors`, async ({ page }) => {
			const diagnostics = collectPageDiagnostics(page);

			await page.goto(route.path);

			await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
			expect(diagnostics.unexpectedConsoleErrors()).toEqual([]);
			expect(diagnostics.pageErrors).toEqual([]);
		});
	}
});
