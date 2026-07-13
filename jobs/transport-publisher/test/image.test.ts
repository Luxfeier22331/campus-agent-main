import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(resolve(import.meta.dirname, "../Dockerfile"), "utf8");

describe("transport publisher image", () => {
	it("starts with the packaged TypeScript runner", () => {
		expect(dockerfile).toContain(
			'ENTRYPOINT ["/app/jobs/transport-publisher/node_modules/.bin/tsx", "/app/jobs/transport-publisher/src/cli.ts"]',
		);
		expect(dockerfile).not.toContain('ENTRYPOINT ["pnpm"');
	});
});
