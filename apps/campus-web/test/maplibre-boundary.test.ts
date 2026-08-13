import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MapLibreRuntime } from "../src/features/map/maplibre-runtime";

describe("MapLibre runtime loader", () => {
	beforeEach(() => {
		vi.resetModules();
		document.head.innerHTML = "";
		Reflect.deleteProperty(window, "maplibregl");
	});

	it("injects the self-hosted vendor assets and resolves the browser runtime", async () => {
		const { loadMapLibre } = await import("../src/features/map/maplibre-runtime");

		const loadPromise = loadMapLibre();
		const script = document.getElementById("campus-maplibre-gl-script") as HTMLScriptElement | null;
		const style = document.getElementById("campus-maplibre-gl-style") as HTMLLinkElement | null;
		const runtime = {
			Map: class {},
			Marker: class {},
		} as unknown as MapLibreRuntime;

		expect(script?.src).toContain("/vendor/maplibre-gl/maplibre-gl-runtime.mjs");
		expect(script?.type).toBe("module");
		expect(script?.async).toBe(true);
		expect(style?.href).toContain("/vendor/maplibre-gl/maplibre-gl.css");
		expect(style?.rel).toBe("stylesheet");

		window.maplibregl = runtime;
		script?.dispatchEvent(new Event("load"));

		await expect(loadPromise).resolves.toBe(runtime);
		await expect(loadMapLibre()).resolves.toBe(runtime);
	});

	it("creates a fresh vendor request after a load failure", async () => {
		const { loadMapLibre } = await import("../src/features/map/maplibre-runtime");
		const firstLoad = loadMapLibre();
		const failedScript = document.getElementById(
			"campus-maplibre-gl-script",
		) as HTMLScriptElement | null;

		failedScript?.dispatchEvent(new Event("error"));

		await expect(firstLoad).rejects.toThrow("MapLibre vendor script failed to load.");
		expect(document.getElementById("campus-maplibre-gl-script")).toBeNull();

		const retryLoad = loadMapLibre();
		const retryScript = document.getElementById(
			"campus-maplibre-gl-script",
		) as HTMLScriptElement | null;
		const runtime = {
			Map: class {},
			Marker: class {},
		} as unknown as MapLibreRuntime;

		expect(retryScript).not.toBe(failedScript);
		window.maplibregl = runtime;
		retryScript?.dispatchEvent(new Event("load"));

		await expect(retryLoad).resolves.toBe(runtime);
	});
});
