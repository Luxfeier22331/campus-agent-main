import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	expectNoInternalLocators,
	type FinalizeRequestWrite,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreStructuredPart01Suite(): void {
	it("renders service-guide grouped procedure fixture as focused public answer", async () => {
		const fixture = JSON.parse(
			readFileSync(
				resolve(
					process.cwd(),
					"../../tests/fixtures/service_guide_vpn_grouped_procedure_result.json",
				),
				"utf-8",
			),
		) as Record<string, unknown>;
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-05-04T10:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText:
						"中央民族大学 VPN 使用说明：客户端安装：首次使用请根据系统提示下载客户端。；双击Install EasyConnect.pkg，根据提示完成安装。来源：学校官网。",
					error: null,
					followUpQuestion: "",
					result: {
						allowed_tools: ["service_guide_lookup"],
						tool_result: fixture,
					},
					selectedTarget: "campus-services-agent",
					status: "completed",
					traceId: "trace_fixture_vpn",
				}),
			},
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_fixture_vpn",
				prompt: "VPN客户端怎么安装",
			},
			principal: createPrincipal(),
		});

		const finalizedWrite = finalWrites[0] as FinalizeRequestWrite;
		expect(finalizedWrite.assistantMessage.text).toContain(
			"中央民族大学 VPN 使用说明：客户端安装：",
		);
		expect(finalizedWrite.assistantMessage.text).toContain("首次使用请根据系统提示下载客户端。");
		expect(finalizedWrite.assistantMessage.text).toContain(
			"双击Install EasyConnect.pkg，根据提示完成安装。",
		);
		expect(finalizedWrite.assistantMessage.text).not.toContain("直接登录");
		expect(finalizedWrite.assistantMessage.text).not.toContain("移动端");
		expectNoInternalLocators(finalizedWrite.assistantMessage.text);
		expect(response.answer.result.kind).toBe("answer");
		if (response.answer.result.kind !== "answer") {
			throw new Error("expected answer result");
		}
		expect(response.answer.result.text).toContain("客户端安装");
		expect(response.answer.result.text).not.toContain("直接登录");
		expect(response.answer.result.text).not.toContain("移动端");
	});
	it("sanitizes internal source locators before writing completed answers to browser-facing chat surfaces", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText:
						"第四学期有合同法、人格权法、侵权责任法。 [program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4#program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4:source-faithful:sha256:test:chunk-0001]",
					error: null,
					followUpQuestion: "",
					result: {
						evidence: {
							sources: [
								{
									chunk_id:
										"program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4:source-faithful:sha256:test:chunk-0001",
									collection: "program_semester_facts",
									doc_id: "program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4",
								},
							],
						},
					},
					selectedTarget: "rag-agent",
					status: "completed",
					traceId: "trace_0002",
				}),
			},
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "法学民族班培养方案里大二下有什么课",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			principal: createPrincipal(),
		});
		const finalizedWrite = finalWrites[0] as FinalizeRequestWrite;

		expect(finalizedWrite).toMatchObject({
			assistantMessage: {
				kind: "answer",
			},
			requestExecution: {
				status: "completed",
			},
		});
		expectNoInternalLocators(finalizedWrite.assistantMessage.text);
		expect(finalizedWrite.assistantMessage.text).toContain(
			"第四学期有合同法、人格权法、侵权责任法。",
		);
		expect(response.answer.result.kind).toBe("answer");
		if (response.answer.result.kind !== "answer") {
			throw new Error("expected completed answer result");
		}
		expectNoInternalLocators(response.answer.result.text);
		expect(response.answer.result.text).toBe("第四学期有合同法、人格权法、侵权责任法。");
	});
}
