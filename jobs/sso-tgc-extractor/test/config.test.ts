import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const baseEnv = {
	SSO_TGC_EXTRACTOR_USERNAME: "student",
	SSO_TGC_EXTRACTOR_PASSWORD: "password",
};

describe("loadConfig", () => {
	it("requires automation settings in rotation mode", () => {
		expect(() => loadConfig({ env: baseEnv })).toThrow(
			"SSO_TGC_EXTRACTOR_AUTOMATION_URL 未设置",
		);
	});

	it("requires a named credential instead of using an implicit default", () => {
		expect(() =>
			loadConfig({
				env: {
					...baseEnv,
					SSO_TGC_EXTRACTOR_AUTOMATION_URL: "https://ops.example.test",
					SSO_TGC_EXTRACTOR_AUTOMATION_TOKEN: "ops_token",
				},
			}),
		).toThrow("SSO_TGC_EXTRACTOR_CREDENTIAL_NAME 未设置");
	});

	it("only requires account settings for dry-run", () => {
		const config = loadConfig({ dryRun: true, env: baseEnv });
		expect(config).toMatchObject({
			username: "student",
			password: "password",
			automationUrl: "",
			automationToken: "",
			credentialName: "",
		});
	});

	it("preserves explicitly configured automation settings", () => {
		const config = loadConfig({
			env: {
				...baseEnv,
				SSO_TGC_EXTRACTOR_AUTOMATION_URL: "https://ops.example.test/",
				SSO_TGC_EXTRACTOR_AUTOMATION_TOKEN: "ops_token",
				SSO_TGC_EXTRACTOR_CREDENTIAL_NAME: "协作者 A",
			},
		});
		expect(config).toMatchObject({
			automationUrl: "https://ops.example.test/",
			automationToken: "ops_token",
			credentialName: "协作者 A",
		});
	});
});
