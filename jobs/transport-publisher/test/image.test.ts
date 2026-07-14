import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(resolve(import.meta.dirname, "../Dockerfile"), "utf8");

describe("transport publisher image", () => {
	it("starts with Node's packaged TypeScript runtime", () => {
		expect(dockerfile).toContain(
			'ENTRYPOINT ["node", "/app/jobs/transport-publisher/src/cli.ts"]',
		);
		expect(dockerfile).toContain(
			"deploy --legacy --prod --no-optional /opt/transport-publisher",
		);
		expect(dockerfile).not.toContain('ENTRYPOINT ["pnpm"');
		expect(dockerfile).not.toContain('ENTRYPOINT ["tsx"');
	});
});
