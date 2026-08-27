// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
	captureException: vi.fn(),
	setContext: vi.fn(),
	setTag: vi.fn(),
	withScope: vi.fn((callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
		callback({
			setTag: vi.fn(),
		}),
	),
}));

vi.mock("@sentry/cloudflare", () => sentryMocks);

import { createAppTelemetry } from "../src/modules/telemetry";

describe("app telemetry", () => {
	beforeEach(() => {
		sentryMocks.captureException.mockReset();
		sentryMocks.setContext.mockReset();
		sentryMocks.setTag.mockReset();
		sentryMocks.withScope.mockReset();
		sentryMocks.withScope.mockImplementation(
			(callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
				callback({
					setTag: vi.fn(),
				}),
		);
	});

	it("keeps request scope updates non-blocking when Sentry fails", () => {
		sentryMocks.setTag.mockImplementation(() => {
			throw new Error("sentry setTag failed");
		});
		const telemetry = createAppTelemetry();

		expect(() =>
			telemetry.configureChatRequestScope({
				requestId: "req_01",
				surface: "campus_web",
			}),
		).not.toThrow();
		expect(() =>
			telemetry.configureRequestOutcome({
				errorCode: "execution_timeout",
				requestId: "req_01",
				status: "error",
				surface: "campus_web",
			}),
		).not.toThrow();
	});

	it("configures only bounded request and outcome tags in Sentry", () => {
		const telemetry = createAppTelemetry();

		telemetry.configureChatRequestScope({
			requestId: "req_01",
			surface: "campus_web",
		});
		telemetry.configureRequestOutcome({
			errorCode: "execution_timeout",
			requestId: "req_01",
			status: "error",
			surface: "campus_web",
		});

		expect(sentryMocks.setTag).toHaveBeenCalledWith("campus.request_id", "req_01");
		expect(sentryMocks.setTag).toHaveBeenCalledWith("surface", "campus_web");
		expect(sentryMocks.setTag).toHaveBeenCalledWith("status", "error");
		expect(sentryMocks.setTag).toHaveBeenCalledWith("error_code", "execution_timeout");
		expect(sentryMocks.setTag).not.toHaveBeenCalledWith("principal_type", expect.anything());
		expect(sentryMocks.setTag).not.toHaveBeenCalledWith("safety_identifier", expect.anything());
		expect(sentryMocks.setContext).not.toHaveBeenCalled();
	});
});
