import { assert, expect, it } from "vitest";
import {
	parseTransportSearch,
	transportReturnTarget,
} from "../src/features/transport/route-search";

it("restores only local transport selections, not arbitrary redirect targets", () => {
	const search = {
		date: "2026-05-01",
		serviceKind: "subway",
		routeId: "route:fengtai-to-wukesong",
		rider: "student",
	};
	expect(parseTransportSearch(search)).toEqual(search);
	const target = transportReturnTarget(`/transport?${new URLSearchParams(search)}`);
	assert(target);
	expect(Object.fromEntries(new URL(target, "https://campus.test").searchParams)).toEqual(search);
	for (const target of [
		"https://evil.test/transport",
		"//evil.test/transport",
		"/transport-other",
		"/notices/1",
		"/transport\\evil",
	]) {
		expect(transportReturnTarget(target)).toBeUndefined();
	}
	expect(
		parseTransportSearch({ date: "invalid", rider: "invalid", serviceKind: "invalid" }),
	).toEqual({});
});
