import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { AnswerTransportStack, answerText } from "./support/stack";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(resolve(root, "apps/app-api/package.json"));
const { Client } = require("pg") as {
	Client: new (input: {
		connectionString: string;
	}) => {
		connect(): Promise<void>;
		end(): Promise<void>;
		query(sql: string, values: string[]): Promise<{ rows: { event_type: string }[] }>;
	};
};
const stack = new AnswerTransportStack();
test.beforeAll(async () => {
	test.setTimeout(240_000);
	await stack.start();
});
test.afterAll(async () => {
	await stack.close();
});
async function login(page: Page) {
	await page.addInitScript(() => {
		const captured = globalThis as typeof globalThis & { answerFrames: string };
		captured.answerFrames = "";
		const original = globalThis.fetch;
		globalThis.fetch = async (...args) => {
			const response = await original(...args);
			if (response.headers.get("content-type")?.includes("text/event-stream")) {
				const reader = response.clone().body?.getReader();
				if (reader) {
					void (async () => {
						const decoder = new TextDecoder();
						try {
							for (;;) {
								const item = await reader.read();
								if (item.done) {
									break;
								}
								captured.answerFrames += decoder.decode(item.value, { stream: true });
							}
						} catch {
							/* disconnects intentionally interrupt the stream */
						}
					})();
				}
			}
			return response;
		};
	});
	await page.goto(`${stack.webOrigin}/account/login?redirectTo=%2F`);
	await page.getByLabel("邮箱").fill("test@muc.edu.cn");
	await page.getByRole("textbox", { exact: true, name: "密码" }).fill("password123");
	await page.getByRole("button", { exact: true, name: "登录" }).click();
	await expect(page).toHaveURL(`${stack.webOrigin}/`);
}
for (const scenario of ["normal", "disconnect", "restart-reader", "unavailable"]) {
	test(`real cross-replica answer: ${scenario}`, async ({ page, context }) => {
		stack.unavailable = scenario === "unavailable";
		const beforeModels = stack.modelCalls;
		const beforeDeltas = stack.deltaCalls;
		await login(page);
		const stream = page.waitForResponse(
			(r) =>
				r.request().method() === "POST" &&
				new URL(r.url()).pathname === "/api/chat/requests/stream",
		);
		await page.getByLabel("消息输入").fill(`请输出测试回答 ${scenario}`);
		await page.getByRole("button", { name: "发送", exact: true }).click();
		await stream;
		await expect
			.poll(() => stack.deltaCalls - beforeDeltas, { timeout: 30_000 })
			.toBeGreaterThan(0);
		if (scenario === "restart-reader") {
			await stack.restartReader();
		}
		if (scenario === "disconnect") {
			await context.setOffline(true);
			await delay(350);
			await context.setOffline(false);
		}
		const assistant = page.locator('[data-slot="aui_assistant-message-root"]').last();
		await expect(assistant).toContainText(answerText, { timeout: 90_000 });
		await expect.poll(() => stack.modelCalls - beforeModels).toBe(1);
		{
			const body = await page.evaluate(
				() => (globalThis as typeof globalThis & { answerFrames: string }).answerFrames,
			);
			if (scenario === "normal") {
				expect(body).toContain("event: answer.delta");
				expect(body).toContain('"answerIndex":');
			}
			if (scenario === "unavailable") {
				expect(body).not.toContain("event: answer.delta");
				expect(stack.deltaCalls - beforeDeltas).toBe(1);
			}
			const accepted = body
				.split("\n\n")
				.find((frame) => frame.includes("event: request.accepted"));
			if (!accepted) {
				throw new Error("missing accepted event");
			}
			const data = JSON.parse(
				accepted
					.split("\n")
					.find((line) => line.startsWith("data:"))
					?.slice(5) ?? "{}",
			) as { requestId: string };
			const env = parseEnv(readFileSync(resolve(root, "apps/agent-control/.env.local"), "utf8"));
			const client = new Client({ connectionString: env.AGENT_CONTROL_DATABASE_URL ?? "" });
			await client.connect();
			try {
				const readEvents = async () =>
					(
						await client.query(
							"select event_type from agent_control.agent_run_events where request_id=$1",
							[data.requestId],
						)
					).rows;
				await expect
					.poll(async () => (await readEvents()).map((row) => row.event_type), { timeout: 30_000 })
					.toContain("run.answer_completed");
				const rows = await readEvents();
				expect(rows.some((row) => row.event_type === "run.answer_delta")).toBe(false);
				expect(rows.some((row) => row.event_type === "run.answer_started")).toBe(true);
				expect(rows.some((row) => row.event_type === "run.answer_completed")).toBe(true);
			} finally {
				await client.end();
			}
		}
		await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
		await page.reload();
		await page
			.getByRole("button", { name: `请输出测试回答 ${scenario}`, exact: true })
			.first()
			.click();
		await expect(page.locator('[data-slot="aui_assistant-message-root"]').last()).toContainText(
			answerText,
			{ timeout: 30_000 },
		);
	});
}
test("current real provider completes a canonical answer", async ({ page }) => {
	// biome-ignore lint/suspicious/noSkippedTests: real provider use is explicitly opt-in.
	test.skip(
		process.env.ANSWER_TRANSPORT_REAL_PROVIDER !== "1",
		"Enable explicitly to use the configured provider",
	);
	stack.unavailable = false;
	await stack.restoreProviderConfig();
	await login(page);
	const completed = page.waitForResponse(
		(r) =>
			r.request().method() === "POST" && new URL(r.url()).pathname === "/api/chat/requests/stream",
	);
	await page.getByLabel("消息输入").fill("请直接回复：回答传输验收成功。无需搜索或调用工具。");
	await page.getByRole("button", { name: "发送", exact: true }).click();
	await completed;
	await expect
		.poll(
			() =>
				page.evaluate(
					() => (globalThis as typeof globalThis & { answerFrames: string }).answerFrames,
				),
			{ timeout: 120_000 },
		)
		.toMatch(/event: request\.(completed|failed)/u);
	const body = await page.evaluate(
		() => (globalThis as typeof globalThis & { answerFrames: string }).answerFrames,
	);
	expect(body).toContain("event: request.completed");
	await expect(page.locator('[data-slot="aui_assistant-message-root"]').last()).toContainText(
		"验收成功",
	);
});
