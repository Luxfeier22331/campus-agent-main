import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MapPage } from "../src/app/routes/map-page";

type MapEventName = "click" | "mousemove" | "mouseout";

const maplibreRuntimeMock = vi.hoisted(() => ({
	canvas: null as HTMLElement | null,
	eventListeners: new Map<
		MapEventName,
		Array<(event: { point: { x: number; y: number } }) => void>
	>(),
	fitBounds: vi.fn(),
	flyTo: vi.fn(),
	loadMapLibre: vi.fn(),
	markerElements: [] as HTMLElement[],
	queryRenderedFeatures: vi.fn(),
	resize: vi.fn(),
	setFilter: vi.fn(),
	setMaxBounds: vi.fn(),
	setMaxZoom: vi.fn(),
	setMinZoom: vi.fn(),
	setStyle: vi.fn(),
}));

vi.mock("../src/features/map/api", async () => {
	const { featureInteractionMapPlaces } = await import("./fixtures/map-page-data");
	return {
		getCampusMapPlaces: vi.fn().mockResolvedValue({
			campus: {
				defaultCenter: [116.3216, 39.9519],
				id: "muc-campuses",
				name: "中央民族大学校区",
			},
			places: featureInteractionMapPlaces,
		}),
	};
});

vi.mock("../src/features/map/maplibre-runtime", () => ({
	loadMapLibre: maplibreRuntimeMock.loadMapLibre.mockResolvedValue({
		Map: class {
			container: HTMLElement;
			constructor(options: { container: HTMLElement }) {
				this.container = options.container;
				maplibreRuntimeMock.canvas = document.createElement("canvas");
				this.container.appendChild(maplibreRuntimeMock.canvas);
			}
			addControl() {
				return this;
			}
			fitBounds(input: unknown, options?: unknown) {
				maplibreRuntimeMock.fitBounds(input, options);
				return this;
			}
			flyTo(input: unknown) {
				maplibreRuntimeMock.flyTo(input);
				return this;
			}
			getCanvas() {
				return maplibreRuntimeMock.canvas;
			}
			off() {
				return this;
			}
			on(eventName: MapEventName, listener: (event: { point: { x: number; y: number } }) => void) {
				const listeners = maplibreRuntimeMock.eventListeners.get(eventName) ?? [];
				listeners.push(listener);
				maplibreRuntimeMock.eventListeners.set(eventName, listeners);
				return this;
			}
			once(_eventName: string, listener: () => void) {
				listener();
				return this;
			}
			queryRenderedFeatures(input: unknown, options: unknown) {
				return maplibreRuntimeMock.queryRenderedFeatures(input, options);
			}
			remove() {
				return this;
			}
			resize() {
				maplibreRuntimeMock.resize();
				return this;
			}
			setFilter(layerId: string, filter: unknown) {
				maplibreRuntimeMock.setFilter(layerId, filter);
				return this;
			}
			setMaxBounds(input: unknown) {
				maplibreRuntimeMock.setMaxBounds(input);
				return this;
			}
			setMaxZoom(input: unknown) {
				maplibreRuntimeMock.setMaxZoom(input);
				return this;
			}
			setMinZoom(input: unknown) {
				maplibreRuntimeMock.setMinZoom(input);
				return this;
			}
			setStyle(input: unknown) {
				maplibreRuntimeMock.setStyle(input);
				return this;
			}
		},
		Marker: class {
			element: HTMLElement;
			constructor(options: { element: HTMLElement }) {
				this.element = options.element;
			}
			addTo(map: { container: HTMLElement }) {
				maplibreRuntimeMock.markerElements.push(this.element);
				map.container.appendChild(this.element);
				return this;
			}
			remove() {
				this.element.remove();
				return this;
			}
			setLngLat() {
				return this;
			}
		},
		NavigationControl: class {},
		ScaleControl: class {},
	}),
}));

describe("campus map feature interactions", () => {
	beforeEach(() => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			addEventListener: vi.fn(),
			addListener: vi.fn(),
			dispatchEvent: vi.fn(),
			matches: query === "(min-width: 960px)",
			media: query,
			onchange: null,
			removeEventListener: vi.fn(),
			removeListener: vi.fn(),
		}));
		maplibreRuntimeMock.canvas = null;
		maplibreRuntimeMock.eventListeners.clear();
		maplibreRuntimeMock.fitBounds.mockReset();
		maplibreRuntimeMock.flyTo.mockReset();
		maplibreRuntimeMock.markerElements.length = 0;
		maplibreRuntimeMock.queryRenderedFeatures.mockReset();
		maplibreRuntimeMock.resize.mockReset();
		maplibreRuntimeMock.setFilter.mockReset();
		maplibreRuntimeMock.setMaxBounds.mockReset();
		maplibreRuntimeMock.setMaxZoom.mockReset();
		maplibreRuntimeMock.setMinZoom.mockReset();
		maplibreRuntimeMock.setStyle.mockReset();
		setMapTokens();
	});

	it("selects places by clicking bound building features without using names", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toBeInTheDocument();
		await waitForMapClickListener();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValueOnce([
			renderedFeature({ fid: 40, layer: "building", name: "完全不同的名字" }),
		]);

		act(() => emitMapEvent("click", { x: 180, y: 240 }));

		expect(await screen.findByRole("dialog", { name: "聚雅食堂" })).toBeInTheDocument();
		expect(window.location.search).toContain("place=fengtai-juya-canteen");
		expect(maplibreRuntimeMock.queryRenderedFeatures).toHaveBeenCalledWith(
			[
				[172, 232],
				[188, 248],
			],
			{ layers: ["campus-building", "campus-building-labels", "campus-sport"] },
		);
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"all",
			["==", ["get", "layer"], "building"],
			["==", ["get", "fid"], 40],
		]);
	});

	it("selects places when clicking a building label layer", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toBeInTheDocument();
		await waitForMapClickListener();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValueOnce([
			renderedFeature({ fid: 41, layer: "building", renderedLayerId: "campus-building-labels" }),
		]);

		act(() => emitMapEvent("click", { x: 120, y: 220 }));

		expect(await screen.findByRole("dialog", { name: "荟贤食堂" })).toBeInTheDocument();
		expect(window.location.search).toContain("place=fengtai-huixian-canteen");
	});

	it("selects Fengtai sport places by clicking bound sport polygons", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toBeInTheDocument();
		await waitForMapClickListener();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValueOnce([
			renderedFeature({ fid: 2, layer: "sport", renderedLayerId: "campus-sport" }),
		]);

		act(() => emitMapEvent("click", { x: 140, y: 260 }));

		expect(await screen.findByRole("dialog", { name: "篮球场" })).toBeInTheDocument();
		expect(window.location.search).toContain("place=fengtai-basketball-court");
		expect(maplibreRuntimeMock.queryRenderedFeatures).toHaveBeenCalledWith(
			[
				[132, 252],
				[148, 268],
			],
			{ layers: ["campus-building", "campus-building-labels", "campus-sport"] },
		);
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"all",
			["==", ["get", "layer"], "sport"],
			["==", ["get", "fid"], 2],
		]);
	});

	it("selects newly bound Fengtai building places by clicking their polygons", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toBeInTheDocument();
		await waitForMapClickListener();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValueOnce([
			renderedFeature({ fid: 6, layer: "building" }),
		]);

		act(() => emitMapEvent("click", { x: 160, y: 210 }));

		expect(await screen.findByRole("dialog", { name: "博雅楼" })).toBeInTheDocument();
		expect(window.location.search).toContain("place=fengtai-boya-building");
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"all",
			["==", ["get", "layer"], "building"],
			["==", ["get", "fid"], 6],
		]);
	});

	it("selects the Fengtai south gate from either bound gatehouse polygon", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toBeInTheDocument();
		await waitForMapClickListener();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValueOnce([
			renderedFeature({ fid: 61, layer: "building" }),
		]);

		act(() => emitMapEvent("click", { x: 190, y: 290 }));

		expect(await screen.findByRole("dialog", { name: "丰台南门" })).toBeInTheDocument();
		expect(window.location.search).toContain("place=fengtai-main-gate");
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"any",
			["all", ["==", ["get", "layer"], "building"], ["==", ["get", "fid"], 60]],
			["all", ["==", ["get", "layer"], "building"], ["==", ["get", "fid"], 61]],
		]);
	});

	it("selects Haidian places by clicking OSM-backed building features", async () => {
		window.history.pushState({}, "", "/map?campus=haidian");
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toBeInTheDocument();
		await waitForMapClickListener();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValueOnce([
			renderedFeature({
				fid: 849087992,
				layer: "building",
				name: "民大图书馆",
				source: "haidian-campus",
			}),
		]);

		act(() => emitMapEvent("click", { x: 180, y: 240 }));

		expect(await screen.findByRole("dialog", { name: "图书馆" })).toBeInTheDocument();
		expect(window.location.search).toContain("place=library");
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"all",
			["==", ["get", "layer"], "building"],
			["==", ["get", "fid"], 849087992],
		]);
	});

	it("does not select unbound building features or guess by name", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toBeInTheDocument();
		await waitForMapClickListener();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValueOnce([
			renderedFeature({ fid: 999, layer: "building", name: "聚雅食堂" }),
		]);

		act(() => emitMapEvent("click", { x: 180, y: 240 }));

		expect(screen.queryByRole("dialog", { name: "聚雅食堂" })).toBeNull();
		expect(window.location.search).not.toContain("place=");
	});

	it("shows hover affordance for bound building features and clears it on mouseout", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toBeInTheDocument();
		await waitForMapClickListener();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValueOnce([
			renderedFeature({ fid: 40, layer: "building" }),
		]);

		act(() => emitMapEvent("mousemove", { x: 180, y: 240 }));

		expect(maplibreRuntimeMock.canvas?.style.cursor).toBe("pointer");
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-hover-outline", [
			"all",
			["==", ["get", "layer"], "building"],
			["==", ["get", "fid"], 40],
		]);
		expect(window.location.search).not.toContain("place=");

		act(() => emitMapEvent("mouseout", { x: 0, y: 0 }));

		expect(maplibreRuntimeMock.canvas?.style.cursor).toBe("");
		expect(maplibreRuntimeMock.setFilter).toHaveBeenLastCalledWith("campus-place-hover-outline", [
			"==",
			["get", "fid"],
			-1,
		]);
	});
});

function renderedFeature(input: {
	fid: number;
	layer: string;
	name?: string;
	renderedLayerId?: string;
	source?: string;
}) {
	return {
		layer: { id: input.renderedLayerId ?? "campus-building" },
		properties: { fid: input.fid, layer: input.layer, name: input.name ?? "" },
		source: input.source ?? "fengtai-campus",
	};
}

function emitMapEvent(eventName: MapEventName, point: { x: number; y: number }) {
	const listeners = maplibreRuntimeMock.eventListeners.get(eventName) ?? [];
	for (const listener of listeners) {
		listener({ point });
	}
}

async function waitForMapClickListener() {
	await waitFor(() =>
		expect(maplibreRuntimeMock.eventListeners.get("click")?.length ?? 0).toBeGreaterThan(0),
	);
}

function setMapTokens() {
	document.documentElement.style.setProperty("--map-style-background", "#edf1f4");
	document.documentElement.style.setProperty("--map-style-boundary", "#a20000");
	document.documentElement.style.setProperty("--map-style-building-fill", "#f9fafb");
	document.documentElement.style.setProperty("--map-style-building-outline", "#98a2b3");
	document.documentElement.style.setProperty("--map-style-green-fill", "#d9eadf");
	document.documentElement.style.setProperty("--map-style-label", "#101828");
	document.documentElement.style.setProperty("--map-style-road-fill", "#d6dce3");
	document.documentElement.style.setProperty(
		"--map-style-selection-fill",
		"rgba(26, 115, 232, 0.14)",
	);
	document.documentElement.style.setProperty(
		"--map-style-selection-halo",
		"rgba(255, 255, 255, 0.92)",
	);
	document.documentElement.style.setProperty("--map-style-selection-outline", "#1a73e8");
	document.documentElement.style.setProperty("--map-style-sport-fill", "#dce8f8");
}
