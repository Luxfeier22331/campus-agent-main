import { describe, expect, it } from "vitest";

import {
	buildAccountLoginUrl,
	CAMPUS_RUNTIME_CONFIG_SCRIPT_ID,
	getCampusRuntimeConfig,
	parseCampusRuntimeConfigSource,
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
			"https://campus-staging.mucwiki-edge.link/account/login?return_to=https%3A%2F%2Fcampus-staging.mucwiki-edge.link%2Fc%2Fconv_01",
		);
	});

	it("reads the browser runtime config script", () => {
		document.body.innerHTML = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">{"accountUrl":"https://campus.muc.wiki/account","loginUrl":"https://campus.muc.wiki/account/login"}</script>`;

		expect(getCampusRuntimeConfig()).toMatchObject({
			accountUrl: "https://campus.muc.wiki/account",
			loginUrl: "https://campus.muc.wiki/account/login",
		});
	});

	it("fails closed when browser runtime config is missing", () => {
		document.body.innerHTML = "";

		expect(() => getCampusRuntimeConfig()).toThrow("Campus runtime config is missing.");
		expect(() => parseCampusRuntimeConfigSource("")).toThrow("Campus runtime config is missing.");
	});
});
