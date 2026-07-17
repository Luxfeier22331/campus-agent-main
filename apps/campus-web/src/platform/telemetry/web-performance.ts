import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";

type RouteGroup = "account" | "dining" | "docs" | "feedback" | "map" | "other" | "qa" | "services";

let started = false;

export function startWebPerformanceTelemetry(): void {
	if (started) {
		return;
	}
	started = true;
	const routeGroup = resolveWebPerformanceRouteGroup(window.location.pathname);
	const report = (metric: Metric) => reportWebPerformanceMetric(metric, routeGroup);

	onCLS(report);
	onFCP(report);
	onINP(report);
	onLCP(report);
	onTTFB(report);
}

export function reportWebPerformanceMetric(metric: Metric, routeGroup: RouteGroup): void {
	if (!(Number.isFinite(metric.value) && metric.value >= 0)) {
		return;
	}

	void fetch("/api/telemetry/web-performance", {
		body: JSON.stringify({
			metricName: metric.name,
			navigationType: metric.navigationType,
			rating: metric.rating,
			routeGroup,
			schemaVersion: "web_performance.v1",
			value: metric.value,
		}),
		credentials: "omit",
		headers: { "content-type": "application/json" },
		keepalive: true,
		method: "POST",
	}).catch(() => undefined);
}

export function resolveWebPerformanceRouteGroup(pathname: string): RouteGroup {
	if (pathname === "/" || pathname.startsWith("/c/")) {
		return "qa";
	}
	if (pathname === "/dining") {
		return "dining";
	}
	if (pathname === "/map") {
		return "map";
	}
	if (pathname === "/services") {
		return "services";
	}
	if (pathname === "/feedback") {
		return "feedback";
	}
	if (pathname.startsWith("/account")) {
		return "account";
	}
	if (pathname.startsWith("/docs")) {
		return "docs";
	}
	return "other";
}
