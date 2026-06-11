import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	type CapabilityExecutionClient,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromCapabilityClient,
	createPrincipal,
	expectNoInternalLocators,
	type FinalizeRequestWrite,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreStructuredPart02Suite(): void {
	it("renders campus-services answers from structured tool facts and safe source categories", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const cases = [
			{
				answerText:
					"丰台校区通勤班车乘车点：当前状态：有限开放。有效时间：4月28日 08:00 至 22:00。提示：当前乘车点为丰台校区北门外班车候车点。最新提示：受大风影响，晚间班次临时取消。来源：校内通知。",
				expected: [
					"丰台校区通勤班车乘车点：当前状态：有限开放。",
					"有效时间：4月28日 08:00 至 22:00。",
					"提示：当前乘车点为丰台校区北门外班车候车点。",
					"最新提示：受大风影响，晚间班次临时取消。",
					"来源：校内通知",
				],
				expectedTraceRef: "认证通知 #355122",
				forbidden: [
					"projection_internal_state",
					"service_status_release_v2",
					"authenticated_notice:355122",
				],
				prompt: "丰台校区通勤班车在哪里上车",
				result: {
					payload_kind: "service_status_lookup",
					tool_result: {
						observed_status: "limited_service",
						effective_from: "2026-04-28T08:00:00+08:00",
						effective_until: "2026-04-28T22:00:00+08:00",
						operational_notices: [
							{
								note: "受大风影响，晚间班次临时取消。",
								source_refs: ["authenticated_notice:355122"],
							},
						],
						related_notice_refs: ["authenticated_notice:355122"],
						resolved_subject: "丰台校区通勤班车乘车点",
						status_note: "当前乘车点为丰台校区北门外班车候车点。",
					},
				},
			},
			{
				answerText:
					"海淀校区图书馆：当前状态：正常开放。有效时间：4月28日 08:00 至 22:00。来源：校内通知。",
				expected: [
					"海淀校区图书馆：当前状态：正常开放。",
					"有效时间：4月28日 08:00 至 22:00。",
					"来源：校内通知",
				],
				expectedTraceRef: "认证通知 #355999",
				forbidden: ["open", "projection_internal_state", "service_status_release_v2"],
				prompt: "海淀图书馆今天开门吗",
				result: {
					payload_kind: "service_status_lookup",
					tool_result: {
						observed_status: "open",
						effective_from: "2026-04-28T08:00:00+08:00",
						effective_until: "2026-04-28T22:00:00+08:00",
						related_notice_refs: ["authenticated_notice:355999"],
						resolved_subject: "海淀校区图书馆",
					},
				},
			},
			{
				answerText:
					"静园10号楼负一层女浴室：当前状态：有限开放。有效时间：4月16日 00:00 起。提示：静园10号楼负一层女浴室目前已建成（见图1），将于本周四（4月16日）试运行。来源：校内通知。",
				expected: [
					"静园10号楼负一层女浴室：当前状态：有限开放。",
					"有效时间：4月16日 00:00 起。",
					"提示：静园10号楼负一层女浴室目前已建成（见图1），将于本周四（4月16日）试运行。",
					"来源：校内通知",
				],
				expectedTraceRef: "校内通知 #355650",
				forbidden: [
					"projection_internal_state",
					"service-status-live-355650-promote-20260428T105200",
					"notice:muc_internal_portal:355650",
					"muc_internal_portal",
					"2099",
				],
				prompt: "静园10号楼女浴室现在开放吗",
				result: {
					effective_from: "2026-04-16T00:00:00+08:00",
					effective_until: "2099-12-31T23:59:59+08:00",
					observed_status: "limited_service",
					outcome: "resolved_current",
					override_source_refs: ["notice:muc_internal_portal:355650"],
					related_notice_refs: ["notice:muc_internal_portal:355650"],
					resolved_subject: "静园10号楼负一层女浴室",
					status_note: "静园10号楼负一层女浴室目前已建成（见图1），将于本周四（4月16日）试运行",
					subject_query: "静园10号楼女浴室现在开放吗",
				},
			},
			{
				answerText:
					"地铁接驳车预约：预约入口：通过学校统一预约入口提交地铁接驳车预约。入口：统一预约入口。来源：校内通知。",
				expected: [
					"地铁接驳车预约：预约入口：通过学校统一预约入口提交地铁接驳车预约。",
					"入口：统一预约入口",
					"来源：校内通知",
				],
				expectedTraceRef: "认证通知 #354777",
				forbidden: [
					"raw_table_parser_state",
					"service_guide_release_v3",
					"authenticated_notice:354777",
				],
				prompt: "地铁接驳车怎么预约",
				result: {
					allowed_tools: ["service_guide_lookup"],
					tool_result: {
						entry_refs: [
							{
								label: "统一预约入口",
								source_refs: ["authenticated_notice:354777"],
							},
						],
						guide_sections: [
							{
								content: "通过学校统一预约入口提交地铁接驳车预约。",
								source_refs: ["authenticated_notice:354777"],
								title: "预约入口",
							},
						],
						resolved_service: {
							display_name: "地铁接驳车预约",
						},
						source_refs: ["authenticated_notice:354777"],
					},
				},
			},
			{
				answerText:
					"校园卡挂失与补卡：挂失与补卡流程：先办理挂失，再在自助补卡机补卡。所需材料：本人有效证件。入口：学生自助补卡机。办理时间：卡务中心 09:00-17:00。联系方式：海淀校区校园卡管理中心 010-68933381。适用范围：学生和教职工均可办理。来源：学校官网、校内通知。",
				expected: [
					"校园卡挂失与补卡：挂失与补卡流程：先办理挂失，再在自助补卡机补卡。",
					"所需材料：本人有效证件",
					"入口：学生自助补卡机",
					"办理时间：卡务中心 09:00-17:00",
					"联系方式：海淀校区校园卡管理中心 010-68933381",
					"适用范围：学生和教职工均可办理。",
					"来源：学校官网、校内通知",
				],
				expectedTraceRef: "官网来源：campus-card",
				forbidden: [
					"guide_release",
					"service_guide_release_v3",
					"official_web:campus-card",
					"authenticated_notice:354777",
				],
				prompt: "校园卡丢了怎么办",
				result: {
					allowed_tools: ["service_guide_lookup"],
					tool_result: {
						contact_refs: [
							{
								label: "海淀校区校园卡管理中心",
								phone: "010-68933381",
								source_refs: ["official_web:campus-card"],
							},
						],
						eligibility_notes: ["学生和教职工均可办理。"],
						entry_refs: [
							{
								label: "学生自助补卡机",
								location_ref: "中慧楼二层",
								source_refs: ["official_web:campus-card"],
							},
						],
						guide_sections: [
							{
								content: "先办理挂失，再在自助补卡机补卡。",
								source_refs: ["official_web:campus-card"],
								title: "挂失与补卡流程",
							},
						],
						office_hours: [
							{
								label: "卡务中心",
								source_refs: ["official_web:campus-card"],
								time_range: "09:00-17:00",
							},
						],
						required_materials: [
							{
								name: "本人有效证件",
								source_refs: ["official_web:campus-card"],
							},
						],
						resolved_service: {
							display_name: "校园卡挂失与补卡",
						},
						source_refs: ["official_web:campus-card", "authenticated_notice:354777"],
					},
				},
			},
			{
				answerText:
					"中央民族大学 VPN 使用说明：客户端安装：首次使用请根据系统提示下载客户端。；双击Install EasyConnect.pkg，根据提示完成安装。来源：学校官网。",
				expected: [
					"中央民族大学 VPN 使用说明：客户端安装：首次使用请根据系统提示下载客户端。；双击Install EasyConnect.pkg，根据提示完成安装。",
					"来源：学校官网",
				],
				expectedTraceRef: "官网来源：muc-it-vpn-service-guide",
				forbidden: [
					"guide_release",
					"service_guide_release_v4",
					"official_web:muc-it-vpn-service-guide",
				],
				prompt: "VPN客户端怎么安装",
				result: {
					allowed_tools: ["service_guide_lookup"],
					tool_result: {
						guide_sections: [
							{
								section_id: "service:official_web:vpn:procedure_group:client_install",
								section_type: "procedure",
								title: "客户端安装",
								content:
									"1. 首次使用请根据系统提示下载客户端。\n2. 双击Install EasyConnect.pkg，根据提示完成安装。",
								source_refs: ["official_web:muc-it-vpn-service-guide"],
							},
						],
						procedure_groups: [
							{
								group_id: "service:official_web:vpn:procedure_group:client_install",
								title: "客户端安装",
								source_refs: ["official_web:muc-it-vpn-service-guide"],
								steps: [
									{
										content: "首次使用请根据系统提示下载客户端。",
										source_refs: ["official_web:muc-it-vpn-service-guide"],
									},
									{
										content: "双击Install EasyConnect.pkg，根据提示完成安装。",
										source_refs: ["official_web:muc-it-vpn-service-guide"],
									},
								],
							},
						],
						resolved_service: {
							display_name: "中央民族大学 VPN 使用说明",
						},
						selected_section_ids: ["service:official_web:vpn:procedure_group:client_install"],
						source_refs: ["official_web:muc-it-vpn-service-guide"],
					},
				},
			},
			{
				answerText:
					"地铁接驳车首班车时间为 08:00（海淀东门 -> 五棵松地铁站）。最新提示：今日接驳车候车点调整至海淀东门。来源：校内通知。",
				expected: [
					"地铁接驳车首班车时间为 08:00（海淀东门 -> 五棵松地铁站）",
					"最新提示：今日接驳车候车点调整至海淀东门。",
					"来源：校内通知",
				],
				expectedTraceRef: "认证通知 #354777",
				forbidden: [
					"transport_schedule_release",
					"authenticated_notice:354777",
					"notice:muc_internal_portal:354777",
				],
				prompt: "今天地铁接驳车最早几点",
				result: {
					payload_kind: "transport_schedule_lookup",
					tool_result: {
						operational_notices: [
							{
								operational_comment: "今日接驳车候车点调整至海淀东门。",
								source_ref: "notice:muc_internal_portal:354777",
							},
						],
						related_notice_refs: ["authenticated_notice:354777"],
						resolved_route: {
							display_name: "地铁接驳车",
						},
						selected_departure: {
							departure_at: "2026-04-24T08:00:00+08:00",
							destination_stop_ref: {
								display_name: "五棵松地铁站",
							},
							origin_stop_ref: {
								display_name: "海淀东门",
							},
						},
					},
				},
			},
			{
				answerText:
					"研究生院办公室联系方式：办公室电话：010-68930001。办公地点：海淀校区研究生院。来源：学校官网。",
				expected: [
					"研究生院办公室联系方式：办公室电话：010-68930001",
					"办公地点：海淀校区研究生院",
					"来源：学校官网",
				],
				expectedTraceRef: "官网来源：graduate-school/contact",
				forbidden: [
					"debug_contact_profile",
					"contact_release_02",
					"official_web:graduate-school:contact",
				],
				prompt: "研究生院办公室电话是多少",
				result: {
					payload_kind: "contact_directory_lookup",
					tool_result: {
						contact_points: [
							{
								label: "办公室电话",
								source_refs: ["official_web:graduate-school:contact"],
								value: "010-68930001",
							},
						],
						location_refs: [
							{
								location_ref: "海淀校区研究生院",
								source_refs: ["official_web:graduate-school:contact"],
							},
						],
						resolved_contact: {
							display_name: "研究生院办公室",
						},
						source_refs: ["official_web:graduate-school:contact"],
					},
				},
			},
			{
				answerText:
					"研究生院招生办公室联系方式：招生咨询电话：010-68930001；招生邮箱：admission@muc.edu.cn。办公地点：办公室：海淀校区研究生院。办公时间：招生咨询 工作日 09:00-17:00。来源：学校官网。",
				expected: [
					"研究生院招生办公室联系方式：招生咨询电话：010-68930001；招生邮箱：admission@muc.edu.cn",
					"办公地点：办公室：海淀校区研究生院",
					"办公时间：招生咨询 工作日 09:00-17:00",
					"来源：学校官网",
				],
				expectedTraceRef: "官网来源：graduate-school/contact",
				forbidden: [
					"debug_contact_profile",
					"contact_release_03",
					"official_web:graduate-school:contact",
				],
				prompt: "研究生院招生办公室联系方式",
				result: {
					payload_kind: "contact_directory_lookup",
					tool_result: {
						contact_points: [
							{
								channel_type: "phone",
								label: "招生咨询电话",
								source_refs: ["official_web:graduate-school:contact"],
								value: "010-68930001",
							},
							{
								channel_type: "email",
								label: "招生邮箱",
								source_refs: ["official_web:graduate-school:contact"],
								value: "admission@muc.edu.cn",
							},
						],
						location_refs: [
							{
								address_text: "海淀校区研究生院",
								label: "办公室",
								location_ref: "海淀校区研究生院",
								source_refs: ["official_web:graduate-school:contact"],
							},
						],
						office_hours: [
							{
								day_pattern: "工作日",
								label: "招生咨询",
								source_refs: ["official_web:graduate-school:contact"],
								time_range: "09:00-17:00",
							},
						],
						resolved_contact: {
							display_name: "研究生院招生办公室",
						},
						source_refs: ["official_web:graduate-school:contact"],
					},
				},
			},
		] as const;
		const supervisor: CapabilityExecutionClient = {
			execute: vi.fn(async (input) => {
				const currentCase = cases.find((candidate) => candidate.prompt === input.userGoal);
				if (!currentCase) {
					throw new Error(`Unexpected campus-services prompt: ${input.userGoal}`);
				}
				return {
					answerText: currentCase.answerText,
					error: null,
					followUpQuestion: "",
					result: currentCase.result,
					selectedCapability: "campus_services",
					status: "completed",
					traceId: "trace_0003",
				} as const;
			}),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromCapabilityClient(supervisor),
		});

		for (const [index, currentCase] of cases.entries()) {
			const response = await service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: currentCase.prompt,
				},
				principal: createPrincipal(),
				surface: "public_chat_web",
			});
			expect(response.answer.result.kind).toBe("answer");
			if (response.answer.result.kind !== "answer") {
				throw new Error("expected completed answer result");
			}
			const answerText = response.answer.result.text;
			expectNoInternalLocators(answerText);
			for (const expectedFragment of currentCase.expected) {
				expect(answerText).toContain(expectedFragment);
			}
			for (const forbiddenFragment of currentCase.forbidden) {
				expect(answerText).not.toContain(forbiddenFragment);
			}

			const finalizedWrite = finalWrites[index] as FinalizeRequestWrite;
			expect(finalizedWrite.assistantMessage.text).toBe(answerText);
			expect(finalizedWrite.requestExecution.selectedCapability).toBe("campus_services");
			const tracePart = finalizedWrite.assistantMessage.structuredParts.find(
				(part) => part.type === "campus_service_trace_cards",
			);
			expect(tracePart).toBeDefined();
			if (!(tracePart && tracePart.type === "campus_service_trace_cards")) {
				throw new Error("expected campus_service_trace_cards structured part");
			}
			expect(tracePart.traceCards.length).toBeGreaterThan(0);
			const traceRefs = tracePart.traceCards.flatMap((card) => card.refs);
			expect(traceRefs.join(" ")).toContain(currentCase.expectedTraceRef);
			const tracePayload = JSON.stringify(tracePart);
			expect(tracePayload).not.toContain("authenticated_notice:");
			expect(tracePayload).not.toContain("official_web:");
			expect(tracePayload).not.toContain("release_id");
			expect(tracePayload).not.toContain("projection_internal_state");
			expect(tracePayload).not.toContain("table_parser_state");
			expect(response.answer.conversation.messages.at(-1)?.structuredParts).toContainEqual(
				tracePart,
			);
		}
	});
}
