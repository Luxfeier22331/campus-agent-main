// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import {
	buildCampusServicesTransportScheduleService,
	parseTransportStatusProjection,
} from "../src/modules/campus-services-transport-schedule";

const env = {
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("public campus services transport status route", () => {
	it("returns the current materialized status projection from the shared database", async () => {
		const projection = {
			release: {
				releaseId: "transport-release-current",
				publishedAt: "2026-04-20T18:00:00+08:00",
				sourceRefs: ["https://portal.example.edu/notice/123"],
			},
			groups: [
				{
					kind: "daily" as const,
					routes: [
						{
							routeId: "route:haidian-to-fengtai",
							displayName: "海淀校区→丰台校区",
							departures: [
								{
									departureTime: "07:00",
									kind: "teacher" as const,
									status: "normal" as const,
									sourceRefs: ["https://portal.example.edu/notice/123"],
								},
								{
									departureTime: "12:10",
									kind: "student" as const,
									status: "changed" as const,
									note: "该班次临时改至南门上车",
									serviceDate: "2026-04-21",
									sourceRefs: ["https://portal.example.edu/notice/456"],
								},
							],
						},
					],
				},
			],
		};
		const app = createApp(env, {
			campusServicesTransportScheduleService: {
				async getPublicStatus() {
					return { etag: '"sha256:transport-current"', projection };
				},
			},
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/campus-services/transport-schedule/status"),
		);
		const text = await response.text();
		const payload = JSON.parse(text);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
		expect(response.headers.get("etag")).toBe('"sha256:transport-current"');
		expect(payload).toMatchObject({
			release: {
				releaseId: "transport-release-current",
				publishedAt: "2026-04-20T18:00:00+08:00",
				sourceRefs: ["https://portal.example.edu/notice/123"],
			},
			groups: [
				{
					kind: "daily",
					routes: [
						{
							routeId: "route:haidian-to-fengtai",
							displayName: "海淀校区→丰台校区",
							departures: [
								{
									departureTime: "07:00",
									kind: "teacher",
									status: "normal",
									sourceRefs: ["https://portal.example.edu/notice/123"],
								},
								{
									departureTime: "12:10",
									kind: "student",
									status: "changed",
									note: "该班次临时改至南门上车",
									serviceDate: "2026-04-21",
									sourceRefs: ["https://portal.example.edu/notice/456"],
								},
							],
						},
					],
				},
			],
		});
		expect(text).not.toContain("result_envelope");
	});

	it("fails closed when the stored status projection is invalid", async () => {
		const app = createApp(env, {
			campusServicesTransportScheduleService: buildCampusServicesTransportScheduleService({
				store: {
					async getCurrentStatus() {
						return {
							contentSha256: "sha256:invalid",
							status: {
								release: {
									releaseId: "transport-release-current",
									publishedAt: "2026-04-20T18:00:00+08:00",
									sourceRefs: ["https://portal.example.edu/notice/123"],
								},
								groups: [
									{
										kind: "daily",
										routes: [
											{
												routeId: "route:haidian-to-fengtai",
												displayName: "海淀校区→丰台校区",
												departures: [
													{
														departureTime: "07:00",
														kind: "teacher",
														status: "silently_normalized",
														sourceRefs: ["https://portal.example.edu/notice/123"],
													},
												],
											},
										],
									},
								],
							},
						};
					},
				},
			}),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/campus-services/transport-schedule/status"),
		);

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "invalid_transport_status_projection",
			},
		});
	});

	it("returns unavailable when no current transport release exists", async () => {
		const app = createApp(env, {
			campusServicesTransportScheduleService: buildCampusServicesTransportScheduleService({
				store: {
					async getCurrentStatus() {
						return null;
					},
				},
			}),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/campus-services/transport-schedule/status"),
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "transport_status_unavailable",
				retryable: true,
			},
		});
	});

	it("rejects malformed arrays, wall times and calendar dates", () => {
		const projection = {
			groups: [
				{
					kind: "temporary",
					routes: [
						{
							departures: [
								{
									departureTime: "08:00",
									kind: "student",
									serviceDate: "2026-04-21",
									sourceRefs: ["https://portal.example.edu/notice/456"],
									status: "added",
								},
							],
							displayName: "海淀校区→丰台校区",
							routeId: "route:haidian-to-fengtai",
						},
					],
				},
			],
			release: {
				publishedAt: "2026-04-20T18:00:00+08:00",
				releaseId: "transport-release-current",
				sourceRefs: ["https://portal.example.edu/notice/123"],
			},
		};

		expect(
			captureError(() => parseTransportStatusProjection({ ...projection, groups: null })),
		).toMatchObject(INVALID_TRANSPORT_STATUS_ERROR);
		const invalidTime = structuredClone(projection);
		const invalidTimeDeparture = invalidTime.groups[0]?.routes[0]?.departures[0];
		if (!invalidTimeDeparture) {
			throw new Error("Transport status test fixture is missing a departure.");
		}
		invalidTimeDeparture.departureTime = "24:00";
		expect(captureError(() => parseTransportStatusProjection(invalidTime))).toMatchObject(
			INVALID_TRANSPORT_STATUS_ERROR,
		);

		const invalidDate = structuredClone(projection);
		const invalidDateDeparture = invalidDate.groups[0]?.routes[0]?.departures[0];
		if (!invalidDateDeparture) {
			throw new Error("Transport status test fixture is missing a departure.");
		}
		invalidDateDeparture.serviceDate = "2026-02-31";
		expect(captureError(() => parseTransportStatusProjection(invalidDate))).toMatchObject(
			INVALID_TRANSPORT_STATUS_ERROR,
		);

		const invalidPublishedAt = structuredClone(projection);
		invalidPublishedAt.release.publishedAt = "2026-04-20";
		expect(captureError(() => parseTransportStatusProjection(invalidPublishedAt))).toMatchObject(
			INVALID_TRANSPORT_STATUS_ERROR,
		);

		expect(
			captureError(() =>
				parseTransportStatusProjection({
					...projection,
					release: {
						...projection.release,
						sourceRefs: ["https://portal.example.edu/notice/123", 42],
					},
				}),
			),
		).toMatchObject(INVALID_TRANSPORT_STATUS_ERROR);

		const invalidOptionalDate = structuredClone(projection);
		const invalidOptionalDateDeparture = invalidOptionalDate.groups[0]?.routes[0]?.departures[0];
		if (!invalidOptionalDateDeparture) {
			throw new Error("Transport status test fixture is missing a departure.");
		}
		(invalidOptionalDateDeparture as { serviceDate: unknown }).serviceDate = 42;
		expect(captureError(() => parseTransportStatusProjection(invalidOptionalDate))).toMatchObject(
			INVALID_TRANSPORT_STATUS_ERROR,
		);

		const temporaryWithoutDate = structuredClone(projection);
		const undatedTemporaryDeparture = temporaryWithoutDate.groups[0]?.routes[0]?.departures[0];
		if (!undatedTemporaryDeparture) {
			throw new Error("Transport status test fixture is missing a departure.");
		}
		delete (undatedTemporaryDeparture as { serviceDate?: string }).serviceDate;
		expect(captureError(() => parseTransportStatusProjection(temporaryWithoutDate))).toMatchObject(
			INVALID_TRANSPORT_STATUS_ERROR,
		);

		expect(
			captureError(() => parseTransportStatusProjection({ ...projection, groups: [] })),
		).toMatchObject(INVALID_TRANSPORT_STATUS_ERROR);
	});
});

const INVALID_TRANSPORT_STATUS_ERROR = {
	code: "invalid_transport_status_projection",
	message: "Transport status projection is invalid.",
	status: 502,
};

function captureError(callback: () => unknown): unknown {
	try {
		callback();
	} catch (error) {
		return error;
	}
	return null;
}
