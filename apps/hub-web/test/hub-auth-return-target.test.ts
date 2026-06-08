import { describe, expect, it } from "vitest";

import {
	resolveHubAuthReturnOrigins,
	resolveHubAuthReturnTarget,
} from "../src/platform/auth/return-target";

describe("hub auth return target", () => {
	it("maps public-chat relative return paths to the configured chat app origin", () => {
		const appOrigins = resolveHubAuthReturnOrigins({
			publicChatOrigin: "https://chat.example.com",
		});

		expect(
			resolveHubAuthReturnTarget("return_to=%2Fchat%2Fconv_01HQ", {
				appOrigins,
			}),
		).toBe("https://chat.example.com/chat/conv_01HQ");
	});

	it("allows explicit chat app absolute targets only from configured app origins", () => {
		const appOrigins = resolveHubAuthReturnOrigins({
			publicChatOrigin: "https://chat.example.com",
		});

		expect(
			resolveHubAuthReturnTarget(
				"return_app=chat&return_to=https%3A%2F%2Fchat.example.com%2Fchat%2Fconv_01HQ",
				{
					appOrigins,
				},
			),
		).toBe("https://chat.example.com/chat/conv_01HQ");
		expect(
			resolveHubAuthReturnTarget(
				"return_app=chat&return_to=https%3A%2F%2Fevil.example.com%2Fchat%2Fconv_01HQ",
				{
					appOrigins,
				},
			),
		).toBe("https://chat.example.com/chat");
	});

	it("allows explicit campus app return targets only for campus origins and routes", () => {
		const appOrigins = resolveHubAuthReturnOrigins({
			publicCampusOrigin: "https://campus-staging.mucwiki-edge.link",
		});

		expect(
			resolveHubAuthReturnTarget(
				"return_app=campus&return_to=https%3A%2F%2Fcampus-staging.mucwiki-edge.link%2Fc%2Fconv_01HQ",
				{
					appOrigins,
				},
			),
		).toBe("https://campus-staging.mucwiki-edge.link/c/conv_01HQ");
		expect(
			resolveHubAuthReturnTarget(
				"return_app=campus&return_to=https%3A%2F%2Fcampus-staging.mucwiki-edge.link%2Ffeedback",
				{
					appOrigins,
				},
			),
		).toBe("https://campus-staging.mucwiki-edge.link/feedback");
		expect(
			resolveHubAuthReturnTarget(
				"return_app=campus&return_to=https%3A%2F%2Fevil.example.com%2Ffeedback",
				{
					appOrigins,
				},
			),
		).toBe("https://campus-staging.mucwiki-edge.link/");
		expect(
			resolveHubAuthReturnTarget(
				"return_app=campus&return_to=https%3A%2F%2Fcampus-staging.mucwiki-edge.link%2Fadmin",
				{
					appOrigins,
				},
			),
		).toBe("https://campus-staging.mucwiki-edge.link/");
	});
});
