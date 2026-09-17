import { expect, test } from "@playwright/test";
import { mockCampusApi } from "./support/api-mocks";

test.describe("support page browser flows", () => {
	test.beforeEach(async ({ page }) => {
		await mockCampusApi(page, { authenticated: false });
	});

	test("submits feedback with the original route context", async ({ page }) => {
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

		const feedbackSource = page.getByLabel("反馈来源");
		await expect(feedbackSource).toContainText("校园地图");
		await page.evaluate(() => window.history.replaceState({}, "", "/feedback"));
		await expect(page).toHaveURL("/feedback");
		await expect(feedbackSource).toContainText("校园地图");
		await page.getByLabel("问题描述").fill("地图地点名称需要更新。");
		await page.getByRole("button", { name: "提交反馈" }).click();

		await expect(page.getByText("反馈已提交。")).toBeVisible();
		expect(submittedBody).toMatchObject({
			body: "地图地点名称需要更新。",
			routeContext: "/feedback?source=map",
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

		await expect(page.getByLabel("反馈来源")).toContainText("/feedback?source=mobile");
		await page.getByRole("combobox", { name: "问题类型" }).click();
		await page.getByRole("option", { name: "内容问题" }).click();
		await page.getByLabel("问题描述").fill("移动端反馈表单需要保持可用。");
		await page.getByLabel("联系方式（可选）").fill("  mobile@example.edu  ");
		await page.getByRole("button", { name: "提交反馈" }).click();

		await expect(page.getByText("反馈已提交。")).toBeVisible();
		expect(submittedBody).toMatchObject({
			body: "移动端反馈表单需要保持可用。",
			category: "content_issue",
			contact: "mobile@example.edu",
			routeContext: "/feedback?source=mobile",
		});
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
		await expect(page.getByLabel("反馈来源")).toContainText("服务协议与隐私政策");

		await page.getByLabel("问题描述").fill("服务协议里有一处链接需要更新。");
		await page.getByRole("button", { name: "提交反馈" }).click();

		await expect(page.getByText("反馈已提交。")).toBeVisible();
		expect(submittedBody).toMatchObject({
			body: "服务协议里有一处链接需要更新。",
			routeContext: "/feedback?source=legal",
		});
	});
});
