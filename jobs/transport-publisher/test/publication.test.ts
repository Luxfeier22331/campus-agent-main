import { describe, expect, it } from "vitest";
import { prepareTransportPublication } from "../src/publication";

function validPublication() {
	return {
		effectiveFrom: "2026-03-20",
		effectiveUntil: null,
		routes: [
			{
				aliases: ["去丰台", "丰台线"],
				destinationCampus: "fengtai",
				destinationStopId: "stop:fengtai-main-gate",
				destinationStopName: "丰台南门",
				originCampus: "haidian",
				originStopId: "stop:haidian-east-gate",
				originStopName: "海淀东门",
				routeId: "route:haidian-to-fengtai",
			},
		],
		status: {
			groups: [
				{
					kind: "weekday",
					routes: [
						{
							departures: [
								{
									departureTime: "07:30",
									kind: "student",
									sourceRefs: ["https://portal.example.edu/notice/355122"],
									status: "normal",
								},
							],
							displayName: "海淀校区到丰台校区",
							routeId: "route:haidian-to-fengtai",
						},
					],
				},
			],
			release: {
				publishedAt: "2026-03-19T16:00:00+08:00",
				releaseId: "transport:355122:2026-03-20",
				sourceRefs: ["https://portal.example.edu/notice/355122"],
			},
		},
	};
}

describe("prepareTransportPublication", () => {
	it("validates and expands one canonical status into typed rows", () => {
		const prepared = prepareTransportPublication(validPublication());

		expect(prepared.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(prepared.routeRows).toEqual([
			expect.objectContaining({
				displayName: "海淀校区到丰台校区",
				routeId: "route:haidian-to-fengtai",
				sortOrder: 0,
			}),
		]);
		expect(prepared.departureRows).toEqual([
			expect.objectContaining({
				departureId: "departure:0001",
				effectiveFrom: "2026-03-20",
				routeId: "route:haidian-to-fengtai",
				serviceMode: "weekday",
			}),
		]);
	});

	it("fingerprints the effective window and typed route metadata", () => {
		const baseline = prepareTransportPublication(validPublication());
		const windowChanged = prepareTransportPublication({
			...validPublication(),
			effectiveUntil: "2026-07-31",
		});
		const routeChangedPayload = validPublication();
		routeChangedPayload.routes[0]!.originStopName = "海淀校区东门";
		const routeChanged = prepareTransportPublication(routeChangedPayload);

		expect(windowChanged.contentSha256).not.toBe(baseline.contentSha256);
		expect(routeChanged.contentSha256).not.toBe(baseline.contentSha256);
	});

	it("rejects fields that could smuggle raw notice content", () => {
		const payload = { ...validPublication(), rawNoticeBody: "not admitted" };

		expect(() => prepareTransportPublication(payload)).toThrow(
			/publication contains unsupported field: rawNoticeBody/u,
		);
	});

	it("requires a date for temporary departures", () => {
		const payload = validPublication();
		payload.status.groups[0]!.kind = "temporary";

		expect(() => prepareTransportPublication(payload)).toThrow(
			/temporary departures require serviceDate/u,
		);
	});

	it("rejects impossible dates, wall times and non-RFC3339 publish times", () => {
		const invalidDate = validPublication();
		invalidDate.effectiveFrom = "2026-02-31";
		expect(() => prepareTransportPublication(invalidDate)).toThrow(/effectiveFrom must be an ISO date/u);

		const invalidTime = validPublication();
		invalidTime.status.groups[0]!.routes[0]!.departures[0]!.departureTime = "25:90";
		expect(() => prepareTransportPublication(invalidTime)).toThrow(/invalid transport status/u);

		const invalidPublishedAt = validPublication();
		invalidPublishedAt.status.release.publishedAt = "2026-03-19";
		expect(() => prepareTransportPublication(invalidPublishedAt)).toThrow(/invalid transport status/u);
	});

	it("rejects route metadata that is not consumed by the status", () => {
		const payload = validPublication();
		payload.routes.push({ ...payload.routes[0]!, routeId: "route:unused" });

		expect(() => prepareTransportPublication(payload)).toThrow(
			/unused route metadata: route:unused/u,
		);
	});
});
