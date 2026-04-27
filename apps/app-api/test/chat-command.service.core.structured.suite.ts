import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	expectNoInternalLocators,
	type FinalizeRequestWrite,
	type SupervisorExecutionClient,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreStructuredSuite(): void {
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
	it("renders campus-services answers from structured tool facts and safe source categories", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const cases = [
			{
				answerText:
					"debug projection_internal_state release_id=service_status_release_v2 authenticated_notice:355122",
				expected: [
					"丰台校区通勤班车乘车点：当前乘车点为丰台校区北门外班车候车点。",
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
					"debug projection_internal_state release_id=service_status_release_v2 authenticated_notice:355999",
				expected: ["海淀校区图书馆：当前状态：正常开放", "来源：校内通知"],
				expectedTraceRef: "认证通知 #355999",
				forbidden: ["open", "projection_internal_state", "service_status_release_v2"],
				prompt: "海淀图书馆今天开门吗",
				result: {
					payload_kind: "service_status_lookup",
					tool_result: {
						observed_status: "open",
						related_notice_refs: ["authenticated_notice:355999"],
						resolved_subject: "海淀校区图书馆",
					},
				},
			},
			{
				answerText:
					"raw_table_parser_state=true guide_release=service_guide_release_v3 authenticated_notice:354777",
				expected: [
					"地铁接驳车预约：预约入口：通过学校统一预约入口提交地铁接驳车预约。",
					"可用入口：统一预约入口",
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
					"debug_contact_profile release_id=contact_release_02 official_web:graduate-school:contact",
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
		] as const;
		const supervisor: SupervisorExecutionClient = {
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
					selectedTarget: "campus-services-agent",
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
			supervisor,
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
			expect(finalizedWrite.requestExecution.selectedTarget).toBe("campus-services-agent");
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
	it("persists navigation place cards into assistant structured parts", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆在海淀校区主教学区西侧，靠近校医院。",
				error: null,
				followUpQuestion: "",
				result: {
					matched_alias: "图书馆",
					place_card: {
						access_note: "访客请先完成入校登记。",
						campus_area: "主教学区西侧",
						coordinate_reference_system: "EPSG:4326",
						location_description: "海淀校区主教学区西侧，靠近校医院。",
						place: {
							campus_area: "主教学区西侧",
							campus_scope: "haidian",
							display_name: "图书馆",
							entity_type: "building",
							place_id: "muc.haidian.library",
						},
						point_geometry: {
							latitude: 39.96162,
							longitude: 116.31551,
						},
						source_refs: ["seed:campus_navigation/place_catalog.v1"],
					},
					query_text: "图书馆在哪里",
					resolved_place: {
						campus_area: "主教学区西侧",
						campus_scope: "haidian",
						display_name: "图书馆",
						entity_type: "building",
						place_id: "muc.haidian.library",
					},
				},
				selectedTarget: "navigation-agent",
				status: "completed",
				traceId: "trace_0002",
			}),
		};

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-11T09:00:00.000Z"),
			conversationStore,
			store,
			supervisor,
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆在哪里",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(finalWrites[0]).toMatchObject({
			assistantMessage: {
				kind: "answer",
				structuredParts: [
					{
						placeCard: {
							coordinateReferenceSystem: "EPSG:4326",
							displayName: "图书馆",
							entityType: "building",
							placeId: "muc.haidian.library",
						},
						type: "place_card",
					},
				],
			},
		});
		expect(response.answer.conversation.messages.at(-1)).toMatchObject({
			structuredParts: [
				{
					placeCard: {
						displayName: "图书馆",
						entityType: "building",
						placeId: "muc.haidian.library",
					},
					type: "place_card",
				},
			],
		});
	});
	it("projects typed browser-safe source items for completed RAG answers", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText: "计算机类培养方案要求学生完成对应课程模块和毕业要求。",
					error: null,
					followUpQuestion: "",
					result: {
						evidence: {
							sources: [
								{
									anchor: {
										page_start: 87,
										page_end: 102,
										reader_anchor: "graduation-requirements",
										root_unit_ids: ["curriculum-root-001", "curriculum-root-002"],
										section_path: ["二、毕业要求"],
									},
									canonical_source_title: "计算机类本科人才培养方案",
									canonical_url: "/docs/curriculum/curriculum_plan/computer-science",
									chunk_id: "curriculum:computer-science:source-faithful:sha256:test:chunk-0001",
									collection: "curriculum_plan",
									doc_id: "curriculum:computer-science",
									is_current: true,
									score: 0.88,
									snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
									source_title: "计算机类本科人才培养方案",
									source_unit_key: "curriculum:computer-science:unit:internal",
									version_id: "version_current",
								},
								{
									anchor: {
										page_start: 87,
										reader_anchor: "graduation-requirements",
										root_unit_ids: ["curriculum-root-001"],
										section_path: ["二、毕业要求"],
									},
									canonical_source_title: "计算机类本科人才培养方案",
									canonical_url: "/docs/curriculum/curriculum_plan/computer-science",
									chunk_id: "chunk-duplicate",
									collection: "curriculum_plan",
									doc_id: "curriculum:computer-science",
									is_current: true,
									snippet: "重复命中不应生成第二张来源卡片。",
									source_title: "计算机类本科人才培养方案",
									version_id: "version_current",
								},
								{
									anchor: {
										reader_anchor: "internal",
										section_path: ["内部材料"],
									},
									canonical_url: "s3://bucket/private-object.json",
									chunk_id: "chunk-private",
									collection: "curriculum_plan",
									doc_id: "curriculum:private",
									is_current: true,
									snippet: "不应展示对象存储来源。",
									source_title: "内部材料",
									version_id: "version_private",
								},
								{
									original_url: "https://www.muc.edu.cn/info/1041/12345.htm",
									published_at: "2026-04-20",
									publisher_label: "中央民族大学新闻网",
									snippet: "学校发布最新公开通知。",
									source_kind: "notice",
									source_title: "关于校园开放日安排的通知",
									target_kind: "public_notice_url",
								},
								{
									anchor: {
										page_start: 12,
										reader_anchor: "notice-summary",
										root_unit_ids: ["notice-root-001"],
										section_path: ["通知要点"],
									},
									canonical_url: "/docs/official_web/fresh_news/open-day-notice",
									original_url: "https://mp.weixin.qq.com/s/public-notice-example",
									published_at: "2026-04-21",
									publisher_label: "中央民族大学公众号",
									snippet: "整理版通知保留公开原通知链接。",
									source_kind: "notice",
									source_title: "校园开放日安排整理版",
								},
								{
									internal_notice_id: "355122",
									portal_url:
										"https://my.muc.edu.cn/comsys-portal-notice-web/download?id=private&notice_id=355122",
									published_at: "2026-04-22",
									publisher_label: "校内通知",
									snippet: "该来源需要登录后查看。",
									source_kind: "notice",
									source_title: "校内内部通知",
									target_kind: "restricted_notice",
								},
								{
									original_url:
										"https://my.muc.edu.cn/comsys-portal-notice-web/download?id=private&notice_id=355122",
									snippet: "内部通知不能向公开聊天暴露原始链接。",
									source_kind: "notice",
									source_title: "校内内部通知",
									target_kind: "public_notice_url",
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
				prompt: "计算机类培养方案的毕业要求是什么？",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(finalWrites[0]).toMatchObject({
			assistantMessage: {
				structuredParts: [
					{
						sourceItems: [
							{
								collectionLabel: "培养方案",
								pageLabel: "原文第 87-102 页",
								primaryAction: {
									href: "/docs/curriculum/curriculum_plan/computer-science?hl=curriculum-root-001,curriculum-root-002#graduation-requirements",
									label: "查看文档",
								},
								sectionTitle: "二、毕业要求",
								snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
								sourceKind: "curriculum",
								targetKind: "canonical_reader",
								title: "计算机类本科人才培养方案",
								versionLabel: "现行版",
							},
							{
								primaryAction: {
									external: true,
									href: "https://www.muc.edu.cn/info/1041/12345.htm",
									label: "打开原通知",
								},
								publishedAt: "2026-04-20",
								publisherLabel: "中央民族大学新闻网",
								snippet: "学校发布最新公开通知。",
								sourceKind: "notice",
								targetKind: "public_notice_url",
								title: "关于校园开放日安排的通知",
							},
							{
								primaryAction: {
									href: "/docs/official_web/fresh_news/open-day-notice?hl=notice-root-001#notice-summary",
									label: "查看整理版",
								},
								secondaryActions: [
									{
										external: true,
										href: "https://mp.weixin.qq.com/s/public-notice-example",
										label: "原通知",
									},
								],
								sourceKind: "notice",
								targetKind: "notice_reader",
								title: "校园开放日安排整理版",
							},
							{
								primaryAction: {
									disabledReason: "该来源需要校内身份后才能查看。",
									href: null,
									label: "需登录查看",
								},
								sourceKind: "notice",
								targetKind: "restricted_notice",
								title: "校内内部通知",
							},
						],
						type: "source_items",
					},
				],
			},
		});
		expect(response.answer.conversation.messages.at(-1)).toMatchObject({
			structuredParts: [
				{
					sourceItems: [
						{
							primaryAction: {
								href: "/docs/curriculum/curriculum_plan/computer-science?hl=curriculum-root-001,curriculum-root-002#graduation-requirements",
								label: "查看文档",
							},
							title: "计算机类本科人才培养方案",
						},
						{
							primaryAction: {
								href: "https://www.muc.edu.cn/info/1041/12345.htm",
								label: "打开原通知",
							},
							targetKind: "public_notice_url",
							title: "关于校园开放日安排的通知",
						},
						{
							primaryAction: {
								href: "/docs/official_web/fresh_news/open-day-notice?hl=notice-root-001#notice-summary",
								label: "查看整理版",
							},
							secondaryActions: [
								{
									href: "https://mp.weixin.qq.com/s/public-notice-example",
									label: "原通知",
								},
							],
							targetKind: "notice_reader",
							title: "校园开放日安排整理版",
						},
						{
							primaryAction: {
								href: null,
								label: "需登录查看",
							},
							targetKind: "restricted_notice",
							title: "校内内部通知",
						},
					],
					type: "source_items",
				},
			],
		});
		const browserFacingPayload = JSON.stringify(response.answer);
		expect(browserFacingPayload).not.toContain("chunk_id");
		expect(browserFacingPayload).not.toContain("chunkId");
		expect(browserFacingPayload).not.toContain("source_unit_key");
		expect(browserFacingPayload).not.toContain("sourceUnitKey");
		expect(browserFacingPayload).not.toContain("s3://");
		expect(browserFacingPayload).not.toContain("my.muc.edu.cn");
		expect(browserFacingPayload).not.toContain("notice_id=355122");
		expect(browserFacingPayload).not.toContain("internal_notice_id");
		expect(browserFacingPayload).not.toContain("portal_url");
	});
	it("persists navigation place cards even when point geometry is absent", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "民族博物馆在海淀校区西侧，靠近图书馆。",
				error: null,
				followUpQuestion: "",
				result: {
					matched_alias: "民族博物馆",
					place_card: {
						campus_area: "海淀校区西侧",
						location_description: "海淀校区西侧，靠近图书馆。",
						place: {
							campus_area: "海淀校区西侧",
							campus_scope: "haidian",
							display_name: "民族博物馆",
							entity_type: "building",
							place_id: "muc.haidian.museum",
						},
						source_refs: [
							"seed:campus_navigation/place_catalog.v1",
							"https://www.muc.edu.cn/xxgk1/xydt.htm",
						],
					},
					query_text: "民族博物馆在哪里",
					resolved_place: {
						campus_area: "海淀校区西侧",
						campus_scope: "haidian",
						display_name: "民族博物馆",
						entity_type: "building",
						place_id: "muc.haidian.museum",
					},
				},
				selectedTarget: "navigation-agent",
				status: "completed",
				traceId: "trace_0003",
			}),
		};

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-11T10:00:00.000Z"),
			conversationStore,
			store,
			supervisor,
		});

		await service.submit({
			payload: {
				conversationId: "conv_02HQ",
				prompt: "民族博物馆在哪里",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(finalWrites[0]).toMatchObject({
			assistantMessage: {
				structuredParts: [
					{
						placeCard: {
							displayName: "民族博物馆",
							placeId: "muc.haidian.museum",
							pointGeometry: null,
						},
						type: "place_card",
					},
				],
			},
		});
	});
	it("normalizes supervisor traceId in finalized responses when upstream payload omits it", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText: "图书馆开放到 22:00。",
					error: null,
					followUpQuestion: "",
					result: {
						evidence: {
							sources: [{ doc_id: "handbook:library-hours" }],
						},
					},
					selectedTarget: "rag-agent",
					status: "completed",
					traceId: "",
				}),
			},
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
			surface: "eval_benchmark",
		});

		expect(response.traceId).toBe("trace_0001");
		expect(response.answer.result.traceId).toBe("trace_0001");
		expect(response.supervisor).toMatchObject({
			status: "completed",
			traceId: "trace_0001",
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				surface: "eval_benchmark",
				traceId: "trace_0001",
			},
			requestObservabilityFact: {
				surface: "eval_benchmark",
				traceId: "trace_0001",
			},
		});
	});
}
