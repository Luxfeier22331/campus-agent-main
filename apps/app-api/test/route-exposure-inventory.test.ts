import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { APP_API_ROUTE_EXPOSURE_INVENTORY } from "../src/app/route-exposure";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesDir = join(__dirname, "../src/app/routes");
const routeFiles = [
	"auth.ts",
	"campus-experience.ts",
	"campus-groups.ts",
	"chat.ts",
	"chat-run-routes.ts",
	"dining.ts",
	"docs.ts",
	"federation.ts",
	"internal.ts",
	"profile-memory.ts",
	"runtime.ts",
] as const;

const registeredRouteRegex = /input\.app\.(all|delete|get|patch|post|put)\(\s*["']([^"']+)["']/g;

function readRegisteredRoutes(): Array<{ method: string; path: string }> {
	const routes: Array<{ method: string; path: string }> = [];
	for (const routeFile of routeFiles) {
		const source = readFileSync(join(routesDir, routeFile), "utf8");
		for (const match of source.matchAll(registeredRouteRegex)) {
			routes.push({
				method: match[1].toUpperCase(),
				path: match[2],
			});
		}
	}
	return routes.sort((left, right) =>
		`${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`),
	);
}

describe("app-api route exposure inventory", () => {
	it("classifies every registered route with caller class and admission rule", () => {
		const inventoryKeys = new Set(
			APP_API_ROUTE_EXPOSURE_INVENTORY.map((route) => `${route.method} ${route.path}`),
		);
		const registeredRoutes = readRegisteredRoutes();

		expect(
			APP_API_ROUTE_EXPOSURE_INVENTORY.filter((route) => !(route.callerClass && route.admission)),
		).toEqual([]);
		expect([...inventoryKeys].sort()).toEqual(
			registeredRoutes.map((route) => `${route.method} ${route.path}`),
		);
		expect(inventoryKeys.has("POST /api/chatkit")).toBe(false);
		expect(inventoryKeys.has("GET /api/dining")).toBe(true);
		expect(inventoryKeys.has("GET /api/dining/menu-items/:menuItemId/reviews")).toBe(true);
		expect(inventoryKeys.has("GET /api/campus-groups/catalog")).toBe(true);
		expect(inventoryKeys.has("PUT /api/internal/ops/campus-groups/catalog")).toBe(true);
	});

	it("keeps internal and collector routes out of browser-facing caller classes", () => {
		expect(
			APP_API_ROUTE_EXPOSURE_INVENTORY.filter((route) =>
				route.path.startsWith("/api/internal/"),
			).every((route) => route.callerClass === "machine-internal"),
		).toBe(true);
	});
});
