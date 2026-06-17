import { describe, expect, it } from "vitest";

import cardsSource from "../src/panel/pages/overview-page/cards.tsx?raw";
import pageSource from "../src/panel/pages/overview-page.tsx?raw";

describe("Operator Console overview runtime health UI", () => {
	it("renders runtime health with operator-facing labels", () => {
		expect(pageSource).toContain("getOperatorRuntimeHealth");
		expect(cardsSource).toContain("runtimeHealth");
		expect(cardsSource).toContain("taskQueuePollers");
		expect(cardsSource).toContain("执行服务健康");
		expect(cardsSource).toContain("状态同步");
		expect(cardsSource).toContain("任务队列处理节点");
		expect(`${pageSource}\n${cardsSource}`).not.toMatch(
			/Temporal UI|raw history|prometheus|metrics explorer|Run projection|Workflow queue|pollers=/i,
		);
	});
});
