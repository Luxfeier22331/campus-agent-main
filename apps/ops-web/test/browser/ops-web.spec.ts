import { expect, type Page, test } from "@playwright/test";

import type {
	OpsInternalPortalAuthStatus,
	ProviderConfigStatus,
} from "../../src/shared/ops-contract.ts";

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
	const observabilityRequests: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (
			url.pathname === "/api/ops/requests/req_ops_001/observability" ||
			url.pathname === "/api/ops/requests/req_ops_001/sentry-issues"
		) {
			observabilityRequests.push(`${url.pathname}${url.search}`);
		}
	});
	await page.goto("/requests");

	await expect(page.getByRole("heading", { name: "请求排查" })).toBeVisible();
	await page.getByRole("link", { name: "req_ops_001" }).first().click();
	await expect(page.getByRole("heading", { name: "请求详情" })).toBeVisible();

	await page.getByRole("link", { name: "执行" }).click();
	await expect(page.getByRole("heading", { name: "执行步骤" })).toBeVisible();
	expect(observabilityRequests).toEqual([]);
	await page.getByRole("link", { name: "日志与调用链" }).click();
	await expect(page.getByRole("list", { name: "日志原始记录" })).toContainText("request.finalized");
	await expect(page.getByRole("list", { name: "调用链原始记录" })).toContainText("agent.primary");
	const sentryIssues = page.getByRole("list", { name: "Sentry Issue 摘要" });
	await expect(sentryIssues).toContainText("Request execution failed");
	await expect(sentryIssues).toContainText("3 个事件");
	await expect(page.getByText('campus.request_id:"req_ops_001"')).toBeVisible();
	const sentryLink = page.getByRole("link", { name: "在 Sentry 查看" });
	await expect(sentryLink).toHaveAttribute(
		"href",
		"https://sentry.example.test/organizations/campus/issues/450001/",
	);
	await expect(sentryLink).toHaveAttribute("target", "_blank");
	await expect(sentryLink).toHaveAttribute("rel", "noreferrer");
	expect([...observabilityRequests].sort()).toEqual(
		[
			"/api/ops/requests/req_ops_001/observability?kind=logs",
			"/api/ops/requests/req_ops_001/observability?kind=trace",
			"/api/ops/requests/req_ops_001/sentry-issues",
		].sort(),
	);
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

test("Provider Config 可以创建不可变 revision、验证并激活完整 bundle", async ({ page }) => {
	const errors = captureRuntimeErrors(page);
	const provider = await mockProviderConfig(page);
	await page.goto("/providers");

	await expect(page.getByRole("heading", { name: "Provider Config" })).toBeVisible();
	await page.getByLabel("Connection ID").fill("provider-connection");
	await page.getByLabel("Provider", { exact: true }).fill("openai-compatible");
	await page.getByLabel("Base URL").fill("https://provider.example/v1");
	await page.getByLabel("API key").fill("private-provider-key");
	await page.getByRole("button", { name: "创建 revision" }).click();
	await expect(page.getByText("https://provider.example/v1", { exact: true })).toBeVisible();
	await expect(
		page
			.getByRole("table", { name: "Provider connections" })
			.getByText("provider-connection@1", { exact: true }),
	).toBeVisible();
	await expect(page.getByText("private-provider-key")).toHaveCount(0);

	await page.getByLabel("Model").fill("provider-chat-model");
	await page.getByRole("button", { name: "创建 Profile" }).click();
	await expect(page.getByText("provider-chat-model", { exact: true }).first()).toBeVisible();
	await page.getByRole("button", { name: "验证 primary_agent" }).click();

	await page.getByLabel("Role").selectOption("rag_query_embedding");
	await page.getByLabel("Model").fill("provider-embedding-model");
	await page.getByRole("button", { name: "创建 Profile" }).click();
	await expect(page.getByText("provider-embedding-model", { exact: true }).first()).toBeVisible();
	await page.getByRole("button", { name: "验证 rag_query_embedding" }).click();
	await expect(page.getByText("passed", { exact: true })).toHaveCount(2);

	await page.getByLabel("primary_agent").selectOption("primary_agent-profile");
	await page.getByLabel("rag_query_embedding").selectOption("rag_query_embedding-profile");
	await page.getByRole("button", { name: "激活 revision 1" }).click();

	await expect(page.getByText("Active revision 1", { exact: true })).toBeVisible();
	await expect(page.getByText("primary_agent: provider-chat-model", { exact: true })).toBeVisible();
	await expect(
		page.getByText("rag_query_embedding: provider-embedding-model", { exact: true }),
	).toBeVisible();
	expect(provider.receivedApiKeys).toEqual(["private-provider-key"]);
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

async function mockProviderConfig(page: Page) {
	const state: ProviderConfigStatus & { receivedApiKeys: string[] } = {
		activeRevision: 0,
		connections: [],
		profiles: [],
		receivedApiKeys: [],
		roles: [
			{ configured: false, role: "primary_agent" },
			{ configured: false, role: "rag_query_embedding" },
			{ configured: false, role: "rag_reranker" },
		],
		sampledAt: "2026-07-16T00:00:00.000Z",
	};
	await page.route("**/api/ops/provider-config**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path === "/api/ops/provider-config" && request.method() === "GET") {
			await route.fulfill({ json: state });
			return;
		}
		if (path.endsWith("/connections") && request.method() === "POST") {
			const body = request.postDataJSON() as Record<string, unknown>;
			state.receivedApiKeys.push(String(body.apiKey));
			state.connections = [
				{
					baseUrl: String(body.baseUrl),
					connectionId: String(body.connectionId),
					featureConfig: {},
					features: ["prompt", "embedding"],
					provider: String(body.provider),
					revision: 1,
					secretFingerprint: "fingerprint",
					secretLast4: "-key",
				},
			];
			await route.fulfill({ json: { ok: true }, status: 201 });
			return;
		}
		if (path.endsWith("/profiles") && request.method() === "POST") {
			const body = request.postDataJSON() as Record<string, unknown>;
			const role = body.role as "primary_agent" | "rag_query_embedding" | "rag_reranker";
			state.profiles.push({
				connectionId: String(body.connectionId),
				connectionRevision: Number(body.connectionRevision),
				...(role === "rag_query_embedding" ? { dimensions: Number(body.dimensions) } : {}),
				kind: body.kind as "prompt" | "embedding" | "rerank",
				model: String(body.model),
				profileId: `${role}-profile`,
				role,
				timeoutMs: Number(body.timeoutMs),
				transport: String(body.transport),
				validationStatus: "unvalidated",
			});
			await route.fulfill({ json: { ok: true }, status: 201 });
			return;
		}
		if (path.endsWith("/validate") && request.method() === "POST") {
			const profileId = path.split("/").at(-2);
			state.profiles = state.profiles.map((profile) =>
				profile.profileId === profileId ? { ...profile, validationStatus: "passed" } : profile,
			);
			await route.fulfill({ json: { ok: true } });
			return;
		}
		if (path.endsWith("/activation") && request.method() === "POST") {
			state.activeRevision += 1;
			state.roles = state.roles.map((role) => {
				const profile = state.profiles.find((candidate) => candidate.role === role.role);
				return profile
					? {
							configured: true,
							model: profile.model,
							profileId: profile.profileId,
							provider: "openai-compatible",
							role: role.role,
							transport: profile.transport,
						}
					: role;
			});
			await route.fulfill({ json: { ok: true } });
			return;
		}
		await route.fallback();
	});
	return state;
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
