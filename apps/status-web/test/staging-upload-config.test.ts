import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
	buildStatusStagingUploadConfig,
	validateCampusWebPublicOrigin,
	validateStatusQaOrigin,
	validateStatusStagingOrigin,
} from "../scripts/staging-upload-config";

const source = `name = "status-web"\nmain = "src/index.ts"\n[env.staging]\n[env.staging.vars]\nDEPLOYMENT_ENVIRONMENT = "staging"\n[[env.staging.kv_namespaces]]\nbinding = "STATUS_SNAPSHOT"\nid = "00000000000000000000000000000000"\n[assets]\ndirectory = "./public"\n`;
const wranglerConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const uploadStagingVersionSource = readFileSync(
	new URL("../scripts/upload-staging-version.ts", import.meta.url),
	"utf8",
);

describe("status-web staging configuration", () => {
	it("verifies the environment-owned KV binding before reusing a version", () => {
		expect(uploadStagingVersionSource).toContain("await uploadStagingWorkerVersion");
		expect(uploadStagingVersionSource).toContain("expectedBindings:");
		expect(uploadStagingVersionSource).toContain('name: "STATUS_SNAPSHOT"');
		expect(uploadStagingVersionSource).toContain("properties: { namespace_id: kvNamespaceId }");
	});

	it("accepts a canonical HTTPS origin and replaces the KV placeholder", () => {
		expect(validateStatusStagingOrigin("https://campus.muc.wiki")).toBe("https://campus.muc.wiki/");
		expect(validateStatusQaOrigin("https://api.muc.wiki")).toBe("https://api.muc.wiki/");
		expect(validateCampusWebPublicOrigin("https://campus.muc.wiki")).toBe(
			"https://campus.muc.wiki/",
		);
		const config = buildStatusStagingUploadConfig(
			source,
			"/workspace/apps/status-web",
			"a".repeat(32),
		);
		expect(config).toContain('id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
		expect(config).toContain("/workspace/apps/status-web/src/index.ts");
		const parsed = parse(config) as {
			assets?: { directory?: string };
			env?: { staging?: { kv_namespaces?: Array<{ binding?: string; id?: string }> } };
		};
		expect(parsed.assets?.directory).toBe("/workspace/apps/status-web/public");
		expect(parsed.env?.staging?.kv_namespaces).toEqual([
			{ binding: "STATUS_SNAPSHOT", id: "a".repeat(32) },
		]);
	});

	it("rejects a path or non-HTTPS redirect target", () => {
		expect(() => validateStatusStagingOrigin("http://campus.example.test")).toThrow(/HTTPS/u);
		expect(() => validateStatusStagingOrigin("https://campus.example.test/path")).toThrow(
			/origin/u,
		);
	});

	it("reports the QA origin contract separately", () => {
		expect(() => validateStatusQaOrigin("http://api.example.test")).toThrow(/STATUS_QA_ORIGIN/u);
	});

	it("requires the campus public origin to be a canonical HTTPS origin", () => {
		expect(() => validateCampusWebPublicOrigin("http://campus.example.test")).toThrow(/HTTPS/u);
		expect(() => validateCampusWebPublicOrigin("https://campus.example.test/path")).toThrow(
			/origin/u,
		);
	});

	it("builds the checked-in template with environment-owned values", () => {
		const appDir = "/workspace/apps/status-web";
		const config = parse(
			buildStatusStagingUploadConfig(wranglerConfig, appDir, "b".repeat(32)),
		) as {
			assets?: { directory?: string };
			env?: { staging?: { kv_namespaces?: Array<{ binding?: string; id?: string }> } };
			main?: string;
			observability?: unknown;
		};

		expect(validateStatusStagingOrigin("https://campus.muc.wiki")).toBe("https://campus.muc.wiki/");
		expect(validateCampusWebPublicOrigin("https://campus.muc.wiki")).toBe(
			"https://campus.muc.wiki/",
		);
		expect(config.main).toBe(resolve(appDir, "src/index.ts"));
		expect(config.assets?.directory).toBe(resolve(appDir, "public"));
		expect(config.env?.staging?.kv_namespaces).toEqual([
			{ binding: "STATUS_SNAPSHOT", id: "b".repeat(32) },
		]);
		expect(config.observability).toBeUndefined();
	});
});
