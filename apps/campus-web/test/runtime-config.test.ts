import { describe, expect, it } from "vitest";

import {
	buildAccountLoginUrl,
	CAMPUS_RUNTIME_CONFIG_SCRIPT_ID,
	getCampusRuntimeConfig,
	parseCampusRuntimeConfigSource,
	readDeploymentLane,
} from "../src/platform/runtime/config";

describe("campus runtime config", () => {
	it("builds same-origin account and login URLs from injected runtime config", () => {
		const config = parseCampusRuntimeConfigSource(
			JSON.stringify({
				accountUrl: "https://campus-staging.mucwiki-edge.link/account",
				loginUrl: "https://campus-staging.mucwiki-edge.link/account/login",
			}),
		);

		expect(config.accountUrl).toBe("https://campus-staging.mucwiki-edge.link/account");
		expect(buildAccountLoginUrl(config, "https://campus-staging.mucwiki-edge.link/c/conv_01")).toBe(
			"https://campus-staging.mucwiki-edge.link/account/login?redirectTo=https%3A%2F%2Fcampus-staging.mucwiki-edge.link%2Fc%2Fconv_01",
		);
	});

	it("reads the browser runtime config script", () => {
		document.body.innerHTML = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">{"accountUrl":"https://campus.muc.wiki/account","loginUrl":"https://campus.muc.wiki/account/login"}</script>`;

		expect(getCampusRuntimeConfig()).toMatchObject({
			accountUrl: "https://campus.muc.wiki/account",
			loginUrl: "https://campus.muc.wiki/account/login",
		});
	});

	it("reads the deployment lane and ignores values outside the allowlist", () => {
		const parse = (deploymentLane: unknown) =>
			parseCampusRuntimeConfigSource(
				JSON.stringify({
					accountUrl: "https://chat.muc.wiki/account",
					deploymentLane,
					loginUrl: "https://chat.muc.wiki/account/login",
				}),
			).deploymentLane;

		expect(parse("staging")).toBe("staging");
		expect(parse("production")).toBe("production");
		expect(parse("development")).toBeNull();
		expect(parse(undefined)).toBeNull();
	});

	it("reports no lane on pages without injected runtime config", () => {
		document.body.innerHTML = "";

		expect(readDeploymentLane()).toBeNull();
	});

	it("fails closed when browser runtime config is missing", () => {
		document.body.innerHTML = "";

		expect(() => getCampusRuntimeConfig()).toThrow("Campus runtime config is missing.");
		expect(() => parseCampusRuntimeConfigSource("")).toThrow("Campus runtime config is missing.");
	});
});
