import { describe, expect, it } from "vitest";

import turnstileSource from "../src/platform/auth/turnstile.tsx?raw";

describe("public chat Turnstile runtime posture", () => {
	it("threads injected appearance and execution posture into explicit Turnstile rendering", () => {
		expect(turnstileSource).toContain("turnstileAppearance");
		expect(turnstileSource).toContain("turnstileExecution");
		expect(turnstileSource).toContain("appearance: turnstileAppearance");
		expect(turnstileSource).toContain("execution: turnstileExecution");
	});

	it("supports explicit execution mode by invoking turnstile.execute after render", () => {
		expect(turnstileSource).toContain("window.turnstile.execute");
		expect(turnstileSource).toContain('turnstileExecution === "execute"');
	});

	it("defers Turnstile script boot until the first user interaction on auth pages", () => {
		expect(turnstileSource).toContain("AuthTurnstileController");
		expect(turnstileSource).toContain("ensureToken");
		expect(turnstileSource).toContain("pendingEnsureResolversRef");
		expect(turnstileSource).toContain("if (!isPrimed || !siteKey || !widgetRef.current)");
	});
});
