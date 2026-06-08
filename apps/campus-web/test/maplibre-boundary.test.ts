import { describe, expect, it } from "vitest";

import { loadMapLibre, type MapLibreRuntime } from "../src/features/map/maplibre-runtime";

describe("MapLibre runtime loader", () => {
	it("injects the self-hosted vendor assets and resolves the browser runtime", async () => {
		document.head.innerHTML = "";
		Reflect.deleteProperty(window, "maplibregl");

		const loadPromise = loadMapLibre();
		const script = document.getElementById("campus-maplibre-gl-script") as HTMLScriptElement | null;
		const style = document.getElementById("campus-maplibre-gl-style") as HTMLLinkElement | null;
		const runtime = {
			Map: class {},
			Marker: class {},
		} as unknown as MapLibreRuntime;

		expect(script?.src).toContain("/vendor/maplibre-gl/maplibre-gl.js");
		expect(script?.async).toBe(true);
		expect(style?.href).toContain("/vendor/maplibre-gl/maplibre-gl.css");
		expect(style?.rel).toBe("stylesheet");

		window.maplibregl = runtime;
		script?.dispatchEvent(new Event("load"));

		await expect(loadPromise).resolves.toBe(runtime);
		await expect(loadMapLibre()).resolves.toBe(runtime);
	});
});
