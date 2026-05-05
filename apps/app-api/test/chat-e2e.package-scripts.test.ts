// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
	scripts: Record<string, string>;
};

describe("chat e2e package scripts", () => {
	it("exposes environment-neutral and profile-specific chat e2e commands", () => {
		expect(packageJson.scripts["chat:e2e"]).toContain("scripts/chat-e2e.ts");
		expect(packageJson.scripts["chat:e2e:dev"]).toContain("scripts/chat-e2e-local-dev.ts");
		expect(packageJson.scripts["chat:e2e:staging"]).toContain("--profile staging");
		expect(packageJson.scripts["chat:e2e:local-real-provider"]).toContain(
			"scripts/chat-e2e-local-real-provider.ts",
		);
	});

	it("does not keep the legacy staging smoke command as a public script", () => {
		expect(packageJson.scripts["chat:smoke:staging"]).toBeUndefined();
	});

	it("keeps local dev e2e as a repo-owned runtime orchestration entry", () => {
		const scriptSource = readFileSync(
			resolve(__dirname, "../scripts/chat-e2e-local-dev.ts"),
			"utf8",
		);

		expect(scriptSource).toContain("infra/local/start-supervisor-runtime.sh");
		expect(scriptSource).toContain("isReadyzReady(args.execReadyzUrl)");
		expect(scriptSource).toContain("db:bootstrap");
		expect(scriptSource).toContain("smoke-identity:provision");
		expect(scriptSource).toContain("dev:live-smoke");
		expect(scriptSource).toContain('"--profile"');
		expect(scriptSource).toContain('"dev"');
	});
});
