import { describe, expect, it } from "vitest";

import {
	buildHubLoginUrl,
	CAMPUS_RUNTIME_CONFIG_SCRIPT_ID,
	getCampusRuntimeConfig,
	parseCampusRuntimeConfigSource,
} from "../src/platform/runtime/config";

describe("campus runtime config", () => {
	it("builds hub account and login URLs from injected runtime config", () => {
		const config = parseCampusRuntimeConfigSource(
			JSON.stringify({
				accountUrl: "https://hub-staging.mucwiki-edge.link/account",
				loginReturnApp: "campus",
				loginUrl: "https://hub-staging.mucwiki-edge.link/account/login",
			}),
		);

		expect(config.accountUrl).toBe("https://hub-staging.mucwiki-edge.link/account");
		expect(buildHubLoginUrl(config, "https://campus-staging.mucwiki-edge.link/c/conv_01")).toBe(
			"https://hub-staging.mucwiki-edge.link/account/login?return_app=campus&return_to=https%3A%2F%2Fcampus-staging.mucwiki-edge.link%2Fc%2Fconv_01",
		);
	});

	it("reads the browser runtime config script", () => {
		document.body.innerHTML = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">{"accountUrl":"https://hub.muc.wiki/account","loginReturnApp":"campus","loginUrl":"https://hub.muc.wiki/account/login"}</script>`;

		expect(getCampusRuntimeConfig()).toMatchObject({
			accountUrl: "https://hub.muc.wiki/account",
			loginReturnApp: "campus",
			loginUrl: "https://hub.muc.wiki/account/login",
		});
	});

	it("fails closed when browser runtime config is missing", () => {
		document.body.innerHTML = "";

		expect(() => getCampusRuntimeConfig()).toThrow("Campus runtime config is missing.");
		expect(() => parseCampusRuntimeConfigSource("")).toThrow("Campus runtime config is missing.");
	});
});
