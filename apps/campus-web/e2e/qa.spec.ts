import { expect, test } from "@playwright/test";
import { type CampusApiRequestRecord, fulfillChatStream, mockCampusApi } from "./support/api-mocks";
import { mockAuthApi } from "./support/auth-mocks";
import { collectPageDiagnostics } from "./support/diagnostics";
import { startStreamingSseServer } from "./support/streaming-sse-server";

test.describe("Q&A browser flow", () => {
	test("allows an anonymous user to sign in from the auth dialog and submit the prompt", async ({
		page,
	}) => {
		const requests: CampusApiRequestRecord[] = [];
		const sessionState = { authenticated: false };
		await mockCampusApi(page, { requests, sessionState });
		await mockAuthApi(page, { sessionState, signIn: "success" });
		await page.goto("/");

		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
		expect(requests.filter((request) => request.path === "/api/chat/requests/stream")).toEqual([]);

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page
			.getByRole("dialog", { name: "登录或创建校园问答账号" })
			.getByRole("button", { exact: true, name: "登录" })
			.click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toHaveCount(0);
		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("国家奖学金评审材料以学校正式通知为准。")).toBeVisible();
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({ prompt: "国家奖学金怎么评审？" });
	});

	test("keeps anonymous sign-in and prompt submission usable on mobile", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		const sessionState = { authenticated: false };
		await page.setViewportSize({ height: 812, width: 390 });
		await mockCampusApi(page, { requests, sessionState });
		await mockAuthApi(page, { sessionState, signIn: "success" });
		await page.goto("/");

		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toBeVisible();
		expect(requests.filter((request) => request.path === "/api/chat/requests/stream")).toEqual([]);

		await page.getByLabel("邮箱").fill("student@example.edu");
		await page.getByRole("textbox", { exact: true, name: "密码" }).fill("validpassword123");
		await page
			.getByRole("dialog", { name: "登录或创建校园问答账号" })
			.getByRole("button", { exact: true, name: "登录" })
			.click();

		await expect(page.getByRole("dialog", { name: "登录或创建校园问答账号" })).toHaveCount(0);
		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("国家奖学金评审材料以学校正式通知为准。")).toBeVisible();
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({ prompt: "国家奖学金怎么评审？" });
	});

	test("submits a prompt and renders streamed answer text", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/");

		await page.getByLabel("消息输入").fill("国家奖学金怎么评审？");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("国家奖学金怎么评审？")).toBeVisible();
		await expect(page.getByText("国家奖学金评审材料以学校正式通知为准。")).toBeVisible();
	});

	test("cancels a running request", async ({ page }) => {
		let cancelCalled = false;
		const postStopDelta = "这段服务端回答在停止后不应显示。";
		await mockCampusApi(page);
		await page.route("**/api/chat/requests/stream", (route) =>
			fulfillChatStream(route, {
				answerText: postStopDelta,
				delayMs: 2_000,
				terminal: "cancelled",
			}),
		);
		await page.route("**/api/chat/requests/*/cancel", async (route) => {
			cancelCalled = true;
			await route.fulfill({
				contentType: "application/json",
				json: {
					run: {
						acceptedAt: "2026-06-24T01:00:00.000Z",
						completedAt: null,
						conversationId: "conv_e2e",
						durationMs: null,
						phase: "running",
						requestId: "req_e2e",
						startedAt: null,
						status: "running",
					},
				},
				status: 202,
			});
		});
		await page.goto("/");

		await page.getByLabel("消息输入").fill("请生成一个较长回答");
		await page.getByRole("button", { name: "发送" }).click();
		await expect(page.locator(".aui-thread-run-status")).toHaveText("正在回答");
		expect(await page.locator(".aui-md").count()).toBe(0);
		await page.getByRole("button", { name: "停止生成" }).click();

		await expect.poll(() => cancelCalled).toBe(true);
		await expect(page.getByText(postStopDelta)).toHaveCount(0);
		await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0);
	});

	test("keeps the historical streaming viewport bounded and renders sources", async ({ page }) => {
		const prompt = "请详细说明历史会话中的评审流程";
		const requestId = "req_issue_342";
		const conversationId = "conv_history_e2e";
		const answerText = createLongStreamingAnswer();
		const sourceItems = [
			{
				citationIndexes: [1],
				collectionLabel: "学生规章",
				kind: "campus_document" as const,
				primaryAction: {
					disabledReason: null,
					external: false as const,
					href: "/docs/regulations/student_rules/doc-c62077b20430",
					label: "查看文档" as const,
				},
				sectionTitle: "考勤与请假",
				snippet: "学生应按规定完成考勤，特殊情况依照请假流程办理。",
				title: "学生考勤管理规定",
				versionSlug: "2026",
			},
		];
		const answerChunks = splitText(answerText, 100);
		const streamServer = await startStreamingSseServer((requestBody) => {
			const body = JSON.parse(requestBody) as {
				conversationId?: string;
				prompt?: string;
			};
			const requestedConversationId = body.conversationId ?? conversationId;
			const requestedPrompt = body.prompt ?? prompt;
			const answer = {
				conversation: {
					activeRequestId: null,
					archivedAt: null,
					createdAt: "2026-06-30T08:00:00.000Z",
					id: requestedConversationId,
					messages: [
						{
							conversationId: requestedConversationId,
							createdAt: "2026-06-30T08:00:00.000Z",
							id: "msg_issue_342_user",
							kind: null,
							requestId,
							retryable: null,
							role: "user" as const,
							structuredParts: [],
							text: requestedPrompt,
						},
						{
							conversationId: requestedConversationId,
							createdAt: "2026-06-30T08:00:00.000Z",
							id: "msg_issue_342_assistant",
							kind: "answer" as const,
							requestId,
							retryable: null,
							role: "assistant" as const,
							structuredParts: [{ sourceItems, type: "source_items" as const }],
							text: answerText,
						},
					],
					pinnedAt: null,
					title: requestedPrompt,
					updatedAt: "2026-06-30T08:00:00.000Z",
				},
				result: {
					kind: "answer" as const,
					requestId,
					text: answerText,
				},
			};
			return [
				{
					body: streamEvent("request.accepted", {
						occurredAt: "2026-06-30T08:00:00.000Z",
						requestId,
						sequence: 1,
						status: "accepted",
					}),
				},
				...answerChunks.map((delta, index) => ({
					body: streamEvent("answer.delta", {
						delta,
						messageId: "msg_issue_342_assistant",
						occurredAt: "2026-06-30T08:00:00.000Z",
						requestId,
						sequence: index + 2,
						status: "streaming",
					}),
					delayMs: 45,
				})),
				{
					body: streamEvent("request.completed", {
						answer,
						occurredAt: "2026-06-30T08:00:00.000Z",
						requestId,
						sequence: answerChunks.length + 2,
						status: "completed",
					}),
				},
			];
		});

		try {
			await mockCampusApi(page);
			await page.route("**/api/chat/requests/stream", (route) =>
				route.continue({ url: `${streamServer.url}/stream` }),
			);
			await page.goto("/");
			await page.getByRole("button", { name: "国家奖学金" }).click();
			await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
			await page.getByLabel("消息输入").fill(prompt);
			await page.getByRole("button", { name: "发送" }).click();

			await expect(page.locator(".aui-thread-run-status")).toHaveText("正在回答");
			await expect(page.locator("[data-aui-top-anchor-reserve]")).toHaveCount(1);
			await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();

			const samples = await page.evaluate(async () => {
				const values: Array<{
					clientHeight: number;
					pageScrollHeight: number;
					reserveHeight: number;
					scrollHeight: number;
					stopInViewport: boolean;
					windowHeight: number;
				}> = [];
				for (let index = 0; index < 24; index += 1) {
					const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
					const reserve = document.querySelector<HTMLElement>("[data-aui-top-anchor-reserve]");
					const stop = document.querySelector<HTMLButtonElement>('[aria-label="停止生成"]');
					if (!stop) {
						break;
					}
					const rect = stop?.getBoundingClientRect();
					values.push({
						clientHeight: viewport?.clientHeight ?? 0,
						pageScrollHeight: document.documentElement.scrollHeight,
						reserveHeight: reserve?.getBoundingClientRect().height ?? 0,
						scrollHeight: viewport?.scrollHeight ?? 0,
						stopInViewport: Boolean(
							rect &&
								rect.top >= 0 &&
								rect.left >= 0 &&
								rect.bottom <= window.innerHeight &&
								rect.right <= window.innerWidth,
						),
						windowHeight: window.innerHeight,
					});
					await new Promise((resolve) => window.setTimeout(resolve, 100));
				}
				return values;
			});

			const viewportHeight = samples[0]?.clientHeight ?? 0;
			const clientHeights = samples.map((sample) => sample.clientHeight);
			const reserveHeights = samples.map((sample) => sample.reserveHeight);
			const scrollHeights = samples.map((sample) => sample.scrollHeight);
			expect(viewportHeight).toBeGreaterThan(0);
			expect(Math.max(...clientHeights) - Math.min(...clientHeights)).toBeLessThanOrEqual(2);
			expect(Math.max(...reserveHeights)).toBeLessThanOrEqual(viewportHeight * 2);
			expect(Math.max(...scrollHeights)).toBeGreaterThan(Math.min(...scrollHeights));
			expect(samples.every((sample) => sample.pageScrollHeight <= sample.windowHeight + 2)).toBe(
				true,
			);
			expect(samples.length).toBeGreaterThanOrEqual(5);
			expect(samples.every((sample) => sample.stopInViewport)).toBe(true);

			await expect(page.getByText("评审流程说明")).toBeVisible();
			await expect(page.getByRole("region", { name: "来源" })).toBeVisible();
			await expect(page.getByText("学生考勤管理规定")).toBeVisible();
			expect(streamServer.requestBodies).toHaveLength(1);
			expect(JSON.parse(streamServer.requestBodies[0] ?? "{}")).toMatchObject({
				conversationId,
				prompt,
			});
		} finally {
			await streamServer.close();
		}
	});

	test("continues an opened historical conversation with the existing conversation id", async ({
		page,
	}) => {
		const requests: CampusApiRequestRecord[] = [];
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await page.getByRole("button", { name: "国家奖学金" }).click();
		await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
		await page.getByLabel("消息输入").fill("继续说明申请材料");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("续问回答会沿用当前历史会话上下文。")).toBeVisible();
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({
				conversationId: "conv_history_e2e",
				prompt: "继续说明申请材料",
			});
	});

	test("continues a historical conversation from the mobile history drawer", async ({ page }) => {
		const requests: CampusApiRequestRecord[] = [];
		await page.setViewportSize({ height: 812, width: 390 });
		await mockCampusApi(page, { requests });
		await page.goto("/");

		await page.getByRole("button", { name: "打开聊天记录" }).click();
		await page.getByRole("button", { name: "国家奖学金" }).click();
		await expect(page.getByText("历史记录中的国家奖学金回答。")).toBeVisible();
		await expect(page.getByRole("dialog", { name: "聊天记录" })).toBeHidden();
		await expect(page.getByRole("button", { name: "打开聊天记录" })).toBeFocused();

		await page.getByLabel("消息输入").fill("继续说明申请材料");
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.getByText("续问回答会沿用当前历史会话上下文。")).toBeVisible();
		await expect
			.poll(() => lastStreamBody(requests))
			.toMatchObject({
				conversationId: "conv_history_e2e",
				prompt: "继续说明申请材料",
			});
	});

	test("recovers a dropped answer stream with backoff during a backend outage", async ({
		page,
	}) => {
		const diagnostics = collectPageDiagnostics(page);
		await mockCampusApi(page);
		const conversationId = "conv_e2e";
		const prompt = "后端故障期间还能收到回答吗？";
		const answerText = "后端恢复后补齐送达的完整回答。";
		const staleDelta = "断开前的不完整片段";
		const occurredAt = "2026-06-24T01:00:00.000Z";
		const messageRecord = (message: {
			id: string;
			kind: "answer" | null;
			role: "assistant" | "user";
			text: string;
		}) => ({
			...message,
			conversationId,
			createdAt: occurredAt,
			requestId: "req_outage_e2e",
			retryable: null,
			structuredParts: [],
		});
		await page.route("**/api/chat/requests/stream", async (route) => {
			await route.fulfill({
				body: [
					`event: request.accepted\ndata: ${JSON.stringify({
						occurredAt,
						requestId: "req_outage_e2e",
						sequence: 1,
						status: "accepted",
					})}\n\n`,
					`event: answer.delta\ndata: ${JSON.stringify({
						delta: staleDelta,
						messageId: "msg_outage_assistant",
						occurredAt,
						requestId: "req_outage_e2e",
						sequence: 2,
						status: "running",
					})}\n\n`,
				].join(""),
				contentType: "text/event-stream",
				status: 200,
			});
		});
		let statusCalls = 0;
		await page.route("**/api/chat/requests/req_outage_e2e", async (route) => {
			if (route.request().method() !== "GET") {
				return route.fallback();
			}
			statusCalls += 1;
			if (statusCalls <= 2) {
				await route.fulfill({
					contentType: "application/json",
					json: {
						error: {
							code: "execution_status_pending",
							message: "The request could not be completed.",
							retryable: true,
						},
					},
					status: 504,
				});
				return;
			}
			await route.fulfill({
				contentType: "application/json",
				json: {
					run: {
						conversationId,
						phase: "running",
						requestId: "req_outage_e2e",
						status: "running",
					},
				},
				status: 200,
			});
		});
		await page.route("**/api/chat/requests/req_outage_e2e/events/stream**", async (route) => {
			await route.fulfill({
				body: `event: request.completed\ndata: ${JSON.stringify({
					answer: {
						conversation: {
							activeRequestId: null,
							archivedAt: null,
							createdAt: occurredAt,
							id: conversationId,
							messages: [
								messageRecord({ id: "msg_outage_user", kind: null, role: "user", text: prompt }),
								messageRecord({
									id: "msg_outage_assistant",
									kind: "answer",
									role: "assistant",
									text: answerText,
								}),
							],
							pinnedAt: null,
							title: prompt,
							updatedAt: occurredAt,
						},
						result: { kind: "answer", requestId: "req_outage_e2e", text: answerText },
					},
					occurredAt,
					requestId: "req_outage_e2e",
					sequence: 3,
					status: "completed",
				})}\n\n`,
				contentType: "text/event-stream",
				status: 200,
			});
		});
		await page.goto("/");

		await page.getByLabel("消息输入").fill(prompt);
		await page.getByRole("button", { name: "发送" }).click();

		await expect(page.locator(".aui-thread-run-status")).toHaveText("正在恢复连接");
		await expect(page.getByRole("button", { name: "恢复连接" })).toHaveCount(0);

		await expect(page.getByText(answerText)).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText(staleDelta)).toHaveCount(0);
		await expect(page.locator(".aui-thread-run-status")).toHaveCount(0);
		expect(statusCalls).toBe(3);
		expect(diagnostics.unexpectedConsoleErrors()).toEqual([]);
		expect(diagnostics.pageErrors).toEqual([]);
	});

	test("searches history and opens the matched conversation", async ({ page }) => {
		await mockCampusApi(page);
		await page.goto("/");

		await page.getByRole("button", { name: "搜索聊天" }).click();
		await expect(page.getByRole("dialog", { name: "搜索聊天" })).toBeVisible();
		await page.getByPlaceholder("搜索历史会话").fill("图书馆");
		await page.getByText("图书馆开放时间").click();

		await expect(page).toHaveURL(/\/c\/conv_library_e2e$/);
		await expect(page.getByText("图书馆开放时间以馆方公告为准。")).toBeVisible();
	});
});

function lastStreamBody(requests: CampusApiRequestRecord[]) {
	return requests.filter((request) => request.path === "/api/chat/requests/stream").at(-1)?.body;
}

function createLongStreamingAnswer(): string {
	return [
		"## 评审流程说明",
		"以下内容用于验证历史会话继续提问时的长回答布局。",
		...Array.from(
			{ length: 80 },
			(_, index) =>
				`${index + 1}. 第 ${index + 1} 项：申请人应按照学校正式通知准备材料，并在规定时间内完成提交；具体要求以发布部门的最新说明为准。`,
		),
		"### 办理提醒",
		"如需确认当前规则，请打开来源文档并以页面中的正式版本为准。",
	].join("\n\n");
}

function splitText(text: string, chunkSize: number): string[] {
	const chunks: string[] = [];
	for (let start = 0; start < text.length; start += chunkSize) {
		chunks.push(text.slice(start, start + chunkSize));
	}
	return chunks;
}

function streamEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
