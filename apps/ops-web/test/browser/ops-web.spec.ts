import { expect, type Page, test } from "@playwright/test";

import type { OpsInternalPortalAuthStatus } from "../../src/shared/ops-contract.ts";

function captureRuntimeErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(`console: ${message.text()}`);
		}
	});
	page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
	return errors;
}

async function expectStableViewport(page: Page, errors: string[]): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(() => ({
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
			})),
		)
		.toEqual(
			expect.objectContaining({
				clientWidth: page.viewportSize()?.width,
				scrollWidth: page.viewportSize()?.width,
			}),
		);
	expect(errors).toEqual([]);
}

test("总览在各宽度下保持可读", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/overview?window=1h");

	await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
	await expect(page.getByText("请求成功率")).toBeVisible();
	await expect(page.getByText("执行控制状态异常")).toBeVisible();
	await expect(page.getByRole("img", { name: "请求趋势" })).toBeVisible();
	await expectStableViewport(page, errors);
});

test("请求列表可以进入详情并切换三个区域", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/requests");

	await expect(page.getByRole("heading", { name: "请求排查" })).toBeVisible();
	await page.getByRole("link", { name: "req_ops_001" }).first().click();
	await expect(page.getByRole("heading", { name: "请求详情" })).toBeVisible();

	await page.getByRole("link", { name: "执行" }).click();
	await expect(page.getByRole("heading", { name: "执行步骤" })).toBeVisible();
	await page.getByRole("link", { name: "日志与调用链" }).click();
	await expect(page.getByRole("list", { name: "日志原始记录" })).toContainText("request completed");
	await expect(page.getByRole("list", { name: "调用链原始记录" })).toContainText("agent.primary");
	await expectStableViewport(page, errors);
});

test("导航在移动端使用抽屉且桌面端保持可见", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	await page.goto("/requests");
	const viewportWidth = page.viewportSize()?.width ?? 0;

	if (viewportWidth < 1024) {
		const toggle = page.getByRole("button", { name: "打开导航" });
		await toggle.click();
		await expect(page.getByRole("navigation", { name: "运维导航" }).last()).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(toggle).toBeFocused();
	} else {
		await expect(page.getByRole("navigation", { name: "运维导航" }).first()).toBeVisible();
	}
	await expectStableViewport(page, errors);
});

test("首次部署只允许写入凭据并在成功后进入待验证", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const auth = await mockInternalPortalAuth(page, unconfiguredAuthStatus());
	await page.goto("/internal-portal-auth");

	await expect(page.getByRole("heading", { name: "门户认证" })).toBeVisible();
	await expect(page.getByText("未配置")).toBeVisible();
	await expect(page.getByText("已暂停")).toBeVisible();
	await expect(page.getByRole("button", { name: "恢复验证" })).toHaveCount(0);
	const input = page.getByLabel("SSO_TGC 或 Cookie");
	await input.fill("SSO_TGC=TGT-browser-ticket; JSESSIONID=session");
	await page.getByRole("button", { name: "替换凭据" }).click();
	await expect(page.getByText("凭据已替换，将在下一个维护周期验证。")).toBeVisible();
	await expect(page.getByText("已配置")).toBeVisible();
	await expect(page.getByText("待验证")).toBeVisible();
	await expect(input).toHaveValue("");
	expect(auth.replacements).toEqual(["SSO_TGC=TGT-browser-ticket; JSESSIONID=session"]);
	expect(auth.resumeCount).toBe(0);
	await expect(page.getByText("TGT-browser-ticket")).toHaveCount(0);
	await expectStableViewport(page, errors);
});

test("已过期凭据必须替换而不能直接恢复", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const auth = await mockInternalPortalAuth(page, expiredAuthStatus());
	await page.goto("/internal-portal-auth");

	await expect(page.getByText("已配置")).toBeVisible();
	await expect(page.getByText("已暂停")).toBeVisible();
	await expect(page.getByRole("button", { name: "恢复验证" })).toHaveCount(0);
	const input = page.getByLabel("SSO_TGC 或 Cookie");
	await input.fill("TGT-replacement-ticket");
	await page.getByRole("button", { name: "替换凭据" }).click();

	await expect(page.getByText("待验证")).toBeVisible();
	await expect(input).toHaveValue("");
	expect(auth.replacements).toEqual(["TGT-replacement-ticket"]);
	await expect(page.getByText("TGT-replacement-ticket")).toHaveCount(0);
	await expectStableViewport(page, errors);
});

test("新凭据已写入但调度仍暂停时可以重试恢复", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const auth = await mockInternalPortalAuth(page, pendingResumeAuthStatus());
	await page.goto("/internal-portal-auth");

	await expect(page.getByText("待验证")).toBeVisible();
	const resume = page.getByRole("button", { name: "恢复验证" });
	await resume.click();

	await expect(resume).toHaveCount(0);
	expect(auth.resumeCount).toBe(1);
	await expectStableViewport(page, errors);
});

async function mockInternalPortalAuth(page: Page, initial: OpsInternalPortalAuthStatus) {
	let status = structuredClone(initial);
	const calls = { replacements: [] as string[], resumeCount: 0 };
	await page.route("**/api/ops/internal-portal-auth**", async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname;
		if (pathname === "/api/ops/internal-portal-auth" && request.method() === "GET") {
			await route.fulfill({ json: status });
			return;
		}
		if (pathname === "/api/ops/internal-portal-auth" && request.method() === "PUT") {
			const body = request.postDataJSON() as { credential: string };
			calls.replacements.push(body.credential);
			status = statusAfterReplacement(status);
			await route.fulfill({ json: status });
			return;
		}
		if (
			pathname === "/api/ops/internal-portal-auth/maintenance/resume" &&
			request.method() === "POST"
		) {
			calls.resumeCount += 1;
			status = {
				...status,
				maintenance: { ...status.maintenance, scheduleState: "ACTIVE" },
			};
			await route.fulfill({ json: status });
			return;
		}
		await route.fallback();
	});
	return calls;
}

function unconfiguredAuthStatus(): OpsInternalPortalAuthStatus {
	return {
		configured: false,
		maintenance: emptyPausedMaintenance(),
		observedLifetime: { lowerBoundSeconds: null, upperBoundSeconds: null },
		updatedAt: null,
		updatedBy: null,
	};
}

function expiredAuthStatus(): OpsInternalPortalAuthStatus {
	return {
		configured: true,
		maintenance: {
			errorCode: "internal_portal_credential_expired",
			lastAttemptAt: "2026-07-16T01:00:00.000Z",
			lastOutcome: "CREDENTIAL_EXPIRED",
			lastSuccessAt: "2026-07-16T00:30:02.000Z",
			nextRunAt: null,
			noticeProbeSucceeded: false,
			portalSessionEstablished: false,
			scheduleState: "PAUSED",
			serviceTicketIssued: false,
		},
		observedLifetime: { lowerBoundSeconds: 1_802, upperBoundSeconds: 3_600 },
		updatedAt: "2026-07-16T00:00:00.000Z",
		updatedBy: "ops@example.test",
	};
}

function pendingResumeAuthStatus(): OpsInternalPortalAuthStatus {
	return {
		configured: true,
		maintenance: {
			...emptyPausedMaintenance(),
			lastAttemptAt: "2026-07-16T00:30:00.000Z",
			lastOutcome: "CREDENTIAL_EXPIRED",
		},
		observedLifetime: { lowerBoundSeconds: null, upperBoundSeconds: null },
		updatedAt: "2026-07-16T01:00:00.000Z",
		updatedBy: "ops@example.test",
	};
}

function emptyPausedMaintenance(): OpsInternalPortalAuthStatus["maintenance"] {
	return {
		errorCode: null,
		lastAttemptAt: null,
		lastOutcome: null,
		lastSuccessAt: null,
		nextRunAt: null,
		noticeProbeSucceeded: null,
		portalSessionEstablished: null,
		scheduleState: "PAUSED",
		serviceTicketIssued: null,
	};
}

function statusAfterReplacement(
	previous: OpsInternalPortalAuthStatus,
): OpsInternalPortalAuthStatus {
	return {
		...previous,
		configured: true,
		maintenance: { ...previous.maintenance, scheduleState: "ACTIVE" },
		observedLifetime: { lowerBoundSeconds: null, upperBoundSeconds: null },
		updatedAt: "2026-07-16T02:00:00.000Z",
		updatedBy: "ops@example.test",
	};
}
