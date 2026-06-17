import { describe, expect, it } from "vitest";

import cardsSource from "../src/panel/pages/overview-page/cards.tsx?raw";
import pageSource from "../src/panel/pages/overview-page.tsx?raw";

describe("Operator Console overview runtime health UI", () => {
	it("renders app-api projected runtime health instead of raw Temporal surfaces", () => {
		expect(pageSource).toContain("getOperatorRuntimeHealth");
		expect(cardsSource).toContain("runtimeHealth");
		expect(cardsSource).toContain("taskQueuePollers");
		expect(cardsSource).toContain("Execution Runtime Health");
		expect(`${pageSource}\n${cardsSource}`).not.toMatch(
			/Temporal UI|raw history|prometheus|metrics explorer/i,
		);
	});
});
