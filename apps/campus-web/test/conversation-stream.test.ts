import { describe, expect, it } from "vitest";

import {
	buildAssistantMessageFromCompletedAnswer,
	getLifecycleLabel,
} from "../src/features/conversation/lifecycle";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";

describe("conversation execution lifecycle", () => {
	it("maps stream lifecycle events to visible labels", () => {
		expect(getLifecycleLabel("execution.queued")).toBe("已排队");
		expect(getLifecycleLabel("execution.running")).toBe("正在处理");
		expect(getLifecycleLabel("request.accepted")).toBe("已接收");
		expect(getLifecycleLabel("request.completed")).toBe("已完成");
		expect(getLifecycleLabel("request.failed")).toBe("请求失败");
		expect(getLifecycleLabel("request.cancelled")).toBe("已取消");
	});

	it("builds assistant messages for completed answer, clarification, and no-answer results", () => {
		const baseEvent = {
			data: {
				answer: {
					conversation: {
						createdAt: "2026-06-08T00:00:00.000Z",
						id: "conv_01",
						messages: [],
						title: "测试会话",
						updatedAt: "2026-06-08T00:00:00.000Z",
					},
					result: {
						kind: "clarification",
						requestId: "req_01",
						text: "需要补充哪个校区？",
						traceId: "trace_01",
					},
				},
				occurredAt: "2026-06-08T00:00:01.000Z",
				requestId: "req_01",
				status: "completed",
				traceId: "trace_01",
			},
			event: "request.completed",
		} satisfies ChatRequestStreamEvent;

		expect(buildAssistantMessageFromCompletedAnswer(baseEvent)?.kind).toBe("clarification");
		expect(buildAssistantMessageFromCompletedAnswer(baseEvent)?.text).toBe("需要补充哪个校区？");
		expect(
			buildAssistantMessageFromCompletedAnswer({
				...baseEvent,
				data: {
					...baseEvent.data,
					answer: {
						...baseEvent.data.answer,
						result: {
							kind: "no_answer",
							requestId: "req_02",
							text: "当前资料不足以回答。",
							traceId: "trace_02",
						},
					},
				},
			})?.kind,
		).toBe("no_answer");
	});
});
