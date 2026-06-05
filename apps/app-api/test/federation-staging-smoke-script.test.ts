import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("federation staging smoke script", () => {
	it("exposes a staging-only OAuth/OIDC smoke command", () => {
		const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));

		expect(packageJson.scripts["federation:smoke:staging"]).toBe(
			"node ../../scripts/run-with-staging-smoke-env.mjs --cwd apps/app-api node ./scripts/staging-federation-smoke.mjs",
		);
		expect(packageJson.scripts["federation:smoke:staging"]).not.toContain("localhost");
		expect(packageJson.scripts["federation:smoke:staging"]).not.toContain("127.0.0.1");
	});

	it("requires staging hub origin, client secret, token exchange, and userinfo checks", () => {
		const scriptSource = readFileSync(
			join(appDir, "scripts", "staging-federation-smoke.mjs"),
			"utf8",
		);

		expect(scriptSource).toContain("https://hub-staging.mucwiki-edge.link");
		expect(scriptSource).toContain("https://api-staging.mucwiki-edge.link/readyz");
		expect(scriptSource).toContain("APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET is required");
		expect(scriptSource).toContain("/api/federation/authorize");
		expect(scriptSource).toContain("/api/federation/token");
		expect(scriptSource).toContain("/api/federation/userinfo");
		expect(scriptSource).toContain("authorization_code");
		expect(scriptSource).toContain("preferred_username");
		expect(scriptSource).toContain("updated_at");
		expect(scriptSource).toContain("code_verifier");
		expect(scriptSource).toContain('Buffer.from(input).toString("base64")');
		expect(scriptSource).toMatch(/authorization: `Basic \$\{base64BasicCredential\(`/);
		expect(scriptSource).toMatch(/\$\{args\.clientId\}:\$\{args\.clientSecret\}/);
		expect(scriptSource).not.toContain("muc.wiki/.well-known");
	});
});
