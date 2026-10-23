import { readFileSync } from "node:fs";
import { ThemeProvider } from "@campus-agent/ui";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapPage } from "../src/app/routes/map-page";
import { getCampusMapScaleZoom } from "../src/features/map/campus-map-style";
import {
	expandMapResults,
	installMapStyleTokens,
	mockMapWorkspaceWidth,
} from "./map-page-test-utils";

const stylesSource = readFileSync("src/campus-styles.css", "utf8");
const FENGTAI_CAMPUS_CENTER = [120.05, 30.05] as const;
// 丰台校区 keeps the published bounds unpadded (see createCampusMapProfile).
const FENGTAI_CAMPUS_MAX_BOUNDS = [
	[120, 30],
	[120.1, 30.1],
] as const;
// Derived from the same formula the app uses, so the fixture latitude (30.05)
// cannot drift from the expectation.
const FENGTAI_CAMPUS_SCALE_ZOOM = getCampusMapScaleZoom(30.05);

const maplibreRuntimeMock = vi.hoisted(() => ({
	canvas: null as HTMLElement | null,
	easeTo: vi.fn(),
	fitBounds: vi.fn(),
	flyTo: vi.fn(),
	getZoom: vi.fn().mockReturnValue(16),
	zoomTo: vi.fn(),
	deferInitialLoad: false,
	loadMapLibre: vi.fn(),
	mapLoadListeners: [] as Array<() => void>,
	mapOptions: null as null | {
		center?: [number, number];
		container?: HTMLElement;
		localIdeographFontFamily?: string;
		maxBounds?: unknown;
		maxZoom?: number;
		minZoom?: number;
		style?: {
			glyphs?: string;
			layers?: Array<{ id: string; layout?: Record<string, unknown> }>;
			sources?: Record<string, unknown>;
		};
		zoom?: number;
	},
	mapClickListeners: [] as Array<(event: { point: { x: number; y: number } }) => void>,
	mapErrorListeners: [] as Array<() => void>,
	markerElements: [] as HTMLElement[],
	navigationControlCount: 0,
	queryRenderedFeatures: vi.fn(),
	resize: vi.fn(),
	scaleControlCount: 0,
	setFilter: vi.fn(),
	setMaxBounds: vi.fn(),
	setMaxZoom: vi.fn(),
	setMinZoom: vi.fn(),
	setStyle: vi.fn(),
	styleLoadListeners: [] as Array<() => void>,
}));

vi.mock("@/components/auth/user/product-account-entry", () => ({
	ProductAccountEntry: () => null,
}));

vi.mock("../src/features/map/api", async () => {
	const { mapPageManifest } = await import("./fixtures/map-manifest");
	const { mapPagePlaces } = await import("./fixtures/map-page-data");
	return {
		getCampusMapManifest: vi.fn().mockResolvedValue(mapPageManifest),
		getCampusMapPlaces: vi.fn().mockResolvedValue({
			campus: {
				defaultCenter: [116.3216, 39.9519],
				id: "haidian",
				name: "海淀校区",
			},
			places: mapPagePlaces,
		}),
	};
});

vi.mock("../src/features/map/maplibre-runtime", () => ({
	loadMapLibre: maplibreRuntimeMock.loadMapLibre.mockResolvedValue({
		Map: class {
			container: HTMLElement;
			constructor(options: {
				center?: [number, number];
				container: HTMLElement;
				localIdeographFontFamily?: string;
				maxBounds?: unknown;
				maxZoom?: number;
				minZoom?: number;
				style?: {
					glyphs?: string;
					layers?: Array<{ id: string; layout?: Record<string, unknown> }>;
					sources?: Record<string, unknown>;
				};
				zoom?: number;
			}) {
				this.container = options.container;
				maplibreRuntimeMock.canvas = document.createElement("canvas");
				maplibreRuntimeMock.mapOptions = options;
			}
			flyTo(input: unknown) {
				maplibreRuntimeMock.flyTo(input);
				return this;
			}
			easeTo(input: unknown) {
				maplibreRuntimeMock.easeTo(input);
				return this;
			}
			getZoom() {
				return maplibreRuntimeMock.getZoom();
			}
			zoomTo(zoom: number, options?: unknown) {
				maplibreRuntimeMock.zoomTo(zoom, options);
				return this;
			}
			fitBounds(input: unknown, options?: unknown) {
				maplibreRuntimeMock.fitBounds(input, options);
				return this;
			}
			getCanvas() {
				return maplibreRuntimeMock.canvas;
			}
			once(eventName: string, listener: () => void) {
				if (eventName === "load" && maplibreRuntimeMock.deferInitialLoad) {
					maplibreRuntimeMock.mapLoadListeners.push(listener);
					return this;
				}
				if (eventName === "style.load") {
					maplibreRuntimeMock.styleLoadListeners.push(listener);
					return this;
				}
				listener();
				return this;
			}
			on(eventName: string, listener: (event: { point: { x: number; y: number } }) => void) {
				if (eventName === "click") {
					maplibreRuntimeMock.mapClickListeners.push(listener);
				}
				if (eventName === "error") {
					maplibreRuntimeMock.mapErrorListeners.push(listener as () => void);
				}
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
				maplibreRuntimeMock.styleLoadListeners.shift()?.();
				return this;
			}
			setFilter(layerId: string, filter: unknown) {
				maplibreRuntimeMock.setFilter(layerId, filter);
				return this;
			}
			addControl(control: unknown) {
				if (control) {
					return this;
				}
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
				const index = maplibreRuntimeMock.markerElements.indexOf(this.element);
				if (index >= 0) {
					maplibreRuntimeMock.markerElements.splice(index, 1);
				}
				return this;
			}
			setLngLat() {
				return this;
			}
		},
		NavigationControl: class {
			constructor() {
				maplibreRuntimeMock.navigationControlCount += 1;
			}
		},
		ScaleControl: class {
			constructor() {
				maplibreRuntimeMock.scaleControlCount += 1;
			}
		},
	}),
}));

describe("campus map page", () => {
	beforeEach(() => {
		window.history.pushState({}, "", "/map");
		mockMapWorkspaceWidth(true, vi.fn);
		maplibreRuntimeMock.easeTo.mockReset();
		maplibreRuntimeMock.fitBounds.mockReset();
		maplibreRuntimeMock.flyTo.mockReset();
		maplibreRuntimeMock.getZoom.mockReset().mockReturnValue(16);
		maplibreRuntimeMock.zoomTo.mockReset();
		maplibreRuntimeMock.deferInitialLoad = false;
		maplibreRuntimeMock.resize.mockReset();
		maplibreRuntimeMock.mapClickListeners.length = 0;
		maplibreRuntimeMock.mapErrorListeners.length = 0;
		maplibreRuntimeMock.mapLoadListeners.length = 0;
		maplibreRuntimeMock.mapOptions = null;
		maplibreRuntimeMock.markerElements.length = 0;
		maplibreRuntimeMock.navigationControlCount = 0;
		maplibreRuntimeMock.queryRenderedFeatures.mockReset();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValue([]);
		maplibreRuntimeMock.scaleControlCount = 0;
		maplibreRuntimeMock.setFilter.mockReset();
		maplibreRuntimeMock.setMaxBounds.mockReset();
		maplibreRuntimeMock.setMaxZoom.mockReset();
		maplibreRuntimeMock.setMinZoom.mockReset();
		maplibreRuntimeMock.setStyle.mockReset();
		maplibreRuntimeMock.styleLoadListeners.length = 0;
		maplibreRuntimeMock.loadMapLibre.mockClear();
		installMapStyleTokens();
	});

	it("uses shared loading state while reading map places", () => {
		render(<MapPage />);

		expect(screen.getByRole("status", { name: "正在加载校园地图" })).toHaveAttribute(
			"aria-busy",
			"true",
		);
	});

	it("filters map places without exposing projection wording", async () => {
		const user = userEvent.setup();
		render(<MapPage />);

		await user.click(await screen.findByRole("radio", { name: "海淀校区" }));
		await user.click(screen.getByRole("button", { name: "展开地点结果" }));
		expect(await screen.findByRole("button", { name: "选择示例图书馆" })).toBeInTheDocument();
		await user.type(screen.getByRole("searchbox", { name: "搜索地点" }), "学生");

		expect(await screen.findByRole("button", { name: "选择示例服务中心" })).toBeInTheDocument();
		expect(
			screen.queryByText("示例图书馆与自习、借阅相关服务的主要位置。"),
		).not.toBeInTheDocument();
	});

	it("renders the campus map as a full viewport searchable map surface", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toHaveAttribute(
			"data-surface",
			"map-first",
		);
		expect(screen.queryByRole("link", { name: "返回校园问答" })).toBeNull();
		expect(screen.getByRole("navigation", { name: "产品导航" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "问答" })).toHaveAttribute("href", "/");
		expect(screen.getByRole("link", { name: "文档" })).toHaveAttribute("href", "/docs");
		expect(screen.getByRole("link", { name: "食堂" })).toHaveAttribute("href", "/dining");
		expect(screen.getByRole("link", { name: "反馈" })).toHaveAttribute("href", "/feedback");
		expect(screen.queryByText("MUC Campus Q&A")).toBeNull();
		expect(screen.queryByText("支撑页面内容")).toBeNull();
		expect(screen.queryByRole("heading", { name: "详情" })).toBeNull();
		expect(screen.getByRole("form", { name: "地点搜索" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "全部校区" })).toBeNull();
		expect(screen.getByRole("radiogroup", { name: "选择校区" })).toBeInTheDocument();
		expect(screen.queryByRole("radiogroup", { name: "地点类型" })).toBeNull();
		expect(screen.getByRole("radio", { name: "海淀校区" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "丰台校区" })).toBeInTheDocument();
		expect(
			within(screen.getByRole("radiogroup", { name: "选择校区" }))
				.getAllByRole("radio")
				.map((button) => button.textContent),
		).toEqual(["丰台校区", "海淀校区"]);
		await expandMapResults();
		expect(screen.getByRole("radiogroup", { name: "地点类型" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "食堂" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "教学楼" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "宿舍" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "服务" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "出入口" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "地图画布" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "地图画布" })).toHaveClass("h-full", "w-full");
		expect(screen.getByRole("region", { name: "地图画布" })).not.toHaveClass("absolute", "inset-0");
		const resultPanel = screen.getByRole("complementary", { name: "地点搜索与结果" });
		expect(resultPanel).toBeInTheDocument();
		expect(resultPanel).toHaveClass(
			"border-2",
			"border-[var(--map-overlay-border-strong)]",
			"bg-[var(--map-overlay-surface-strong)]",
			"backdrop-blur-md",
		);
		expect(resultPanel.className).toContain("w-[min(360px,calc(100vw-1.5rem))]");
		expect(resultPanel.className).toContain("max-h-[min(58dvh,430px)]");
		expect(resultPanel.className).not.toContain("w-[min(420px");
		expect(resultPanel.className).not.toContain("100dvh");
		expect(
			screen.getByRole("navigation", { name: "产品导航" }).closest(".campus-top-nav-inner"),
		).toHaveClass("bg-[var(--map-overlay-surface)]", "backdrop-blur-md");
		expect(screen.getByRole("searchbox", { name: "搜索地点" })).toHaveClass("min-h-10");
		expect(screen.getByRole("searchbox", { name: "搜索地点" })).toHaveAttribute("name", "q");
		expect(screen.getByRole("heading", { name: "地点" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "丰台校区" })).toHaveClass("min-h-9", "text-sm");
		expect(screen.getByRole("radio", { name: "丰台校区" })).toHaveAttribute("aria-checked", "true");
		expect(screen.queryByText("海淀校区当前提供基础地点参考。")).toBeNull();
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toHaveClass(
			"bg-[var(--map-overlay-surface-soft)]",
			"h-auto",
			"min-h-[76px]",
			"p-2.5",
		);
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).not.toHaveClass("h-9");
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toHaveTextContent("示例二食堂");
		expect(screen.getByRole("button", { name: "选择示例教学楼" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择静园一号楼" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择示例南门" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择示例图书馆" })).toBeNull();
		expect(screen.queryByRole("link", { name: "询问这个地点" })).toBeNull();
		expect(screen.queryByRole("link", { name: "反馈地点信息" })).toBeNull();
		expect(screen.queryByRole("link", { name: "询问" })).toBeNull();
		expect(screen.getByRole("button", { name: "回到当前校区" }).parentElement).toHaveClass(
			"bottom-12",
		);
		await waitFor(() => expect(maplibreRuntimeMock.loadMapLibre).toHaveBeenCalled());
	});

	it("offsets native MapLibre controls away from map overlays", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toBeInTheDocument();
		expect(stylesSource).toContain('[data-surface="map-first"] .maplibregl-ctrl-top-right');
		expect(stylesSource).toContain("top: calc(0.75rem + var(--layout-campus-topnav-height))");
		expect(stylesSource).toContain("@media (max-width: 959px)");
		expect(stylesSource).toContain("top: 133px");
	});

	it("keeps the map panel compact until the user opens search results", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		const search = await screen.findByRole("searchbox", { name: "搜索地点" });
		expect(search).not.toHaveAttribute("aria-controls");
		const resultPanel = screen.getByRole("complementary", { name: "地点搜索与结果" });
		expect(resultPanel.className).toContain("max-h-[min(34dvh,220px)]");
		const expandResultsButton = screen.getByRole("button", { name: "展开地点结果" });
		expect(expandResultsButton).toHaveAttribute("aria-expanded", "false");
		expect(expandResultsButton).toHaveClass("bg-selected", "font-semibold", "min-h-10");
		expect(screen.queryByRole("heading", { name: "地点" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择示例二食堂" })).toBeNull();

		await user.click(search);

		expect(screen.getByRole("button", { name: "收起地点结果" })).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		expect(search).toHaveAttribute("aria-controls", "campus-map-results");
		expect(document.querySelector("#campus-map-results")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "地点" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toBeInTheDocument();
		expect(resultPanel.className).toContain("max-h-[min(58dvh,430px)]");
	});

	it("keeps map navigation separate while allowing the place list to collapse", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("searchbox", { name: "搜索地点" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "展开地点结果" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "丰台校区" })).toHaveAttribute("aria-checked", "true");

		await expandMapResults();

		expect(screen.getByRole("form", { name: "地点搜索" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "收起地点结果" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "丰台校区" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "食堂" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "地点" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "地图画布" })).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "收起地点结果" }));

		expect(screen.queryByRole("heading", { name: "地点" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择示例二食堂" })).toBeNull();
		expect(screen.getByRole("radio", { name: "丰台校区" })).toBeInTheDocument();
	});

	it("provides explicit controls for zooming the campus map", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		const zoomIn = await screen.findByRole("button", { name: "放大地图" });
		const zoomOut = screen.getByRole("button", { name: "缩小地图" });
		expect(zoomIn).toHaveClass("min-h-11", "min-w-11");
		expect(zoomOut).toHaveClass("min-h-11", "min-w-11");

		await user.click(zoomIn);
		expect(maplibreRuntimeMock.zoomTo).toHaveBeenCalledWith(17, { duration: 220 });
		await user.click(zoomOut);
		expect(maplibreRuntimeMock.zoomTo).toHaveBeenCalledWith(15, { duration: 220 });
	});

	it("lets the user return to the current campus view from map controls", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "回到当前校区" })).toBeInTheDocument();
		maplibreRuntimeMock.easeTo.mockClear();

		await user.click(screen.getByRole("button", { name: "回到当前校区" }));

		// The overview camera is fixed rather than fitted, so the scale bar reads
		// the same distance on a phone and on a desktop.
		expect(maplibreRuntimeMock.easeTo).toHaveBeenCalledWith(
			expect.objectContaining({
				center: FENGTAI_CAMPUS_CENTER,
				zoom: FENGTAI_CAMPUS_SCALE_ZOOM,
			}),
		);
	});

	it("loads the Fengtai campus base layers into MapLibre", async () => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "展开地点结果" })).toBeInTheDocument();
		await expandMapResults();
		expect(screen.getByRole("button", { name: "选择示例东门" })).toBeInTheDocument();
		await waitFor(() => expect(maplibreRuntimeMock.mapOptions).not.toBeNull());

		expect(maplibreRuntimeMock.mapOptions?.localIdeographFontFamily).toBe("sans-serif");
		expect(maplibreRuntimeMock.mapOptions?.style?.sources).toHaveProperty("fengtai-campus");
		const fengtaiSource = maplibreRuntimeMock.mapOptions?.style?.sources?.["fengtai-campus"] as
			| { data?: string }
			| undefined;
		expect(fengtaiSource?.data).toBe(
			"/campus-map/assets/7a0cc069cc7c9044bb088e4b41afb742d8e8faf03c2906292ce846185128b993.geojson",
		);
		expect(maplibreRuntimeMock.mapOptions?.style?.layers?.map((layer) => layer.id)).toEqual(
			expect.arrayContaining([
				"campus-green",
				"campus-road",
				"campus-building",
				"campus-place-selected-fill",
				"campus-place-selected-halo",
				"campus-place-selected-outline",
				"campus-sport",
				"campus-boundary",
				"campus-building-labels",
			]),
		);
		expect(maplibreRuntimeMock.mapOptions?.style?.glyphs).toBeUndefined();
		expect(
			maplibreRuntimeMock.mapOptions?.style?.layers?.find(
				(layer) => layer.id === "campus-building-labels",
			)?.layout?.["text-field"],
		).toEqual(["get", "name"]);
		expect(maplibreRuntimeMock.mapOptions?.style?.layers?.map((layer) => layer.id)).not.toContain(
			"campus-raster-preview",
		);
		expect(maplibreRuntimeMock.mapOptions?.style?.sources).not.toHaveProperty(
			"fengtai-campus-preview",
		);
		expect(maplibreRuntimeMock.mapOptions).toEqual(
			expect.objectContaining({
				center: FENGTAI_CAMPUS_CENTER,
				maxBounds: FENGTAI_CAMPUS_MAX_BOUNDS,
				maxZoom: 20.2,
				minZoom: 12.8,
				zoom: FENGTAI_CAMPUS_SCALE_ZOOM,
			}),
		);
		expect(maplibreRuntimeMock.navigationControlCount).toBe(1);
		expect(maplibreRuntimeMock.scaleControlCount).toBe(1);
	});

	it("applies the resolved theme tokens when reloading the MapLibre style", async () => {
		const user = userEvent.setup();
		const tokenNames = [
			"--map-style-background",
			"--map-style-boundary",
			"--map-style-building-fill",
			"--map-style-building-outline",
			"--map-style-green-fill",
			"--map-style-label",
			"--map-style-road-fill",
			"--map-style-selection-fill",
			"--map-style-selection-halo",
			"--map-style-selection-outline",
			"--map-style-sport-fill",
		];
		for (const tokenName of tokenNames) {
			document.documentElement.style.removeProperty(tokenName);
		}
		const tokenStyle = document.createElement("style");
		tokenStyle.textContent = `
			:root {
				--map-style-background: #efeff2;
				--map-style-boundary: #262627;
				--map-style-building-fill: #fafafb;
				--map-style-building-outline: #8e8e93;
				--map-style-green-fill: #dfeee4;
				--map-style-label: #1c1c1e;
				--map-style-road-fill: #d1d1d6;
				--map-style-selection-fill: #e8e8eb;
				--map-style-selection-halo: #ffffff;
				--map-style-selection-outline: #6f6f76;
				--map-style-sport-fill: #e1e8f5;
			}
			:root[data-theme="dark"] {
				--map-style-background: #1c1c1e;
				--map-style-boundary: #e8e8eb;
				--map-style-building-fill: #151517;
				--map-style-building-outline: #48484a;
				--map-style-green-fill: #274532;
				--map-style-label: #e5e5ea;
				--map-style-road-fill: #343438;
				--map-style-selection-fill: #3d3d41;
				--map-style-selection-halo: #242426;
				--map-style-selection-outline: #8c8c94;
				--map-style-sport-fill: #2d3341;
			}
		`;
		document.head.appendChild(tokenStyle);
		window.localStorage.removeItem("campus-agent.theme");
		window.history.pushState({}, "", "/map?campus=fengtai");

		try {
			render(
				<ThemeProvider defaultMode="light">
					<MapPage />
				</ThemeProvider>,
			);

			await screen.findByRole("region", { name: "校园地图" });
			await waitFor(() => expect(maplibreRuntimeMock.mapOptions).not.toBeNull());
			const initialStyle = maplibreRuntimeMock.mapOptions?.style as
				| { layers?: Array<{ id?: string; paint?: Record<string, unknown> }> }
				| undefined;
			expect(
				initialStyle?.layers?.find((layer) => layer.id === "background")?.paint?.[
					"background-color"
				],
			).toBe("#efeff2");

			maplibreRuntimeMock.setStyle.mockClear();
			const mapCanvas = screen.getByRole("region", { name: "地图画布" });
			expect(mapCanvas).toHaveClass("opacity-100");
			await user.click(screen.getByRole("button", { name: /外观，当前浅色/u }));
			await user.click(screen.getByRole("menuitemradio", { name: "深色" }));
			await waitFor(() => expect(maplibreRuntimeMock.setStyle).toHaveBeenCalled());
			await waitFor(() => expect(mapCanvas).toHaveClass("opacity-100"));
			const darkStyle = maplibreRuntimeMock.setStyle.mock.lastCall?.[0] as
				| { layers?: Array<{ id?: string; paint?: Record<string, unknown> }> }
				| undefined;
			expect(
				darkStyle?.layers?.find((layer) => layer.id === "background")?.paint?.["background-color"],
			).toBe("#1c1c1e");
		} finally {
			tokenStyle.remove();
			installMapStyleTokens();
			window.localStorage.removeItem("campus-agent.theme");
		}
	});

	it("places the mobile product menu in the map tool area", async () => {
		mockMapWorkspaceWidth(false, vi.fn);
		render(<MapPage />);

		await screen.findByRole("complementary", { name: "地点搜索与结果" });
		const menu = screen.getByRole("button", { name: "打开全局菜单" });

		expect(menu).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "打开全局菜单" })).toHaveLength(1);
	});

	it("keeps place search available when the base map source fails and retries locally", async () => {
		const user = userEvent.setup();
		render(<MapPage />);
		await expandMapResults();
		expect(await screen.findByRole("button", { name: "选择示例二食堂" })).toBeInTheDocument();

		act(() => maplibreRuntimeMock.mapErrorListeners[0]?.());

		expect(
			await screen.findByText("地图底图暂时无法显示，地点列表仍可继续使用。"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "重新加载地图" }));

		await waitFor(() => expect(maplibreRuntimeMock.loadMapLibre).toHaveBeenCalledTimes(2));
	});

	it("syncs campus map selection between list, marker, details, polygon highlight, and flyTo", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		await expandMapResults();
		expect(await screen.findByRole("button", { name: "选择示例东门" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await waitFor(() => expect(maplibreRuntimeMock.markerElements).toHaveLength(1));
		expect(maplibreRuntimeMock.markerElements[0]?.dataset.selected).toBe("false");
		expect(maplibreRuntimeMock.markerElements[0]?.dataset.variant).toBe("transport");

		await user.click(screen.getByRole("radio", { name: "海淀校区" }));
		await expandMapResults();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "选择示例图书馆" })).toBeInTheDocument(),
		);
		await user.click(screen.getByRole("button", { name: "选择示例服务中心" }));

		expect(screen.getByRole("button", { name: "选择示例服务中心" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("dialog", { name: "示例服务中心" })).toBeInTheDocument();
		expect(screen.queryByText("当前校区缺少可展示的地图底图。")).toBeNull();
		expect(maplibreRuntimeMock.setStyle).toHaveBeenCalledWith(
			expect.objectContaining({
				sources: {
					"haidian-campus": {
						attribution: "Synthetic map data",
						data: "/campus-map/assets/02f064bd8c11bc56133ef7f1456ec91da8d40107f4a8d55800d85a585f879cc5.geojson",
						type: "geojson",
					},
				},
			}),
		);
		expect(maplibreRuntimeMock.flyTo).toHaveBeenLastCalledWith({
			center: [121.0002, 31.0002],
			zoom: 17,
		});

		await user.click(screen.getByRole("radio", { name: "丰台校区" }));
		await expandMapResults();
		await waitFor(() => expect(maplibreRuntimeMock.markerElements).toHaveLength(1));
		await user.click(maplibreRuntimeMock.markerElements[0] as HTMLElement);

		expect(screen.getByRole("button", { name: "选择示例东门" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"==",
			["get", "fid"],
			-1,
		]);

		await user.click(screen.getByRole("button", { name: "选择示例二食堂" }));

		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("heading", { name: "示例二食堂" })).toBeInTheDocument();
		expect(screen.getByRole("dialog", { name: "示例二食堂" })).toBeInTheDocument();
		expect(maplibreRuntimeMock.flyTo).toHaveBeenLastCalledWith({
			center: [120.0002, 30.0002],
			zoom: 17,
		});
		expect(screen.getByRole("dialog", { name: "示例二食堂" })).toHaveAttribute(
			"data-side",
			"right",
		);
		expect(screen.getByRole("dialog", { name: "示例二食堂" })).toHaveAttribute(
			"data-align",
			"start",
		);
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-fill", [
			"all",
			["==", ["get", "layer"], "building"],
			["==", ["get", "fid"], 41],
		]);
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-halo", [
			"all",
			["==", ["get", "layer"], "building"],
			["==", ["get", "fid"], 41],
		]);
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"all",
			["==", ["get", "layer"], "building"],
			["==", ["get", "fid"], 41],
		]);
	});

	it("closes the place popover when the map canvas is clicked", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		await expandMapResults();
		await user.click(await screen.findByRole("button", { name: "选择示例二食堂" }));
		expect(screen.getByRole("dialog", { name: "示例二食堂" })).toBeInTheDocument();

		act(() => {
			maplibreRuntimeMock.mapClickListeners.at(-1)?.({ point: { x: 0, y: 0 } });
		});

		expect(screen.queryByRole("dialog", { name: "示例二食堂" })).toBeNull();
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"==",
			["get", "fid"],
			-1,
		]);
		await expandMapResults();
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("renders selected place in a closeable mobile bottom sheet", async () => {
		const user = userEvent.setup();
		mockMapWorkspaceWidth(false, vi.fn);
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "展开地点结果" })).toHaveClass("min-h-11");
		expect(screen.getByRole("radio", { name: "丰台校区" })).toHaveClass("min-h-11");
		await expandMapResults();
		expect(screen.getByRole("complementary", { name: "地点搜索与结果" })).toHaveClass(
			"flex",
			"flex-col",
			"overflow-hidden",
		);
		expect(document.querySelector("#campus-map-results")).toHaveClass(
			"min-h-0",
			"flex-1",
			"overflow-y-auto",
			"overscroll-contain",
		);
		await user.click(await screen.findByRole("button", { name: "选择示例二食堂" }));
		expect(screen.getByRole("dialog", { name: "示例二食堂" })).toHaveAttribute(
			"data-variant",
			"sheet",
		);
		expect(screen.queryByRole("button", { name: "回到当前校区" })).toBeNull();
		expect(screen.queryByRole("button", { name: "收起地点结果" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择示例东门" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
		expect(screen.queryByRole("button", { name: "拖动关闭地点详情" })).toBeNull();
		const closeButtons = screen.getAllByRole("button", { name: "关闭地点详情" });
		expect(closeButtons).toHaveLength(2);
		const closeSheetButton = closeButtons[1];
		if (!closeSheetButton) {
			throw new Error("expected the sheet close button");
		}

		await user.click(closeSheetButton);

		expect(screen.queryByRole("dialog", { name: "示例二食堂" })).toBeNull();
		expect(screen.getByRole("button", { name: "回到当前校区" })).toBeInTheDocument();
		await expandMapResults();
		expect(screen.getByRole("button", { name: "选择示例东门" })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "详情" })).toBeNull();
	});

	it("filters campus map places by campus and category without synthetic places", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "展开地点结果" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "展开地点结果" }));
		expect(screen.getByRole("button", { name: "选择示例东门" })).toBeInTheDocument();
		await user.click(screen.getByRole("radio", { name: "丰台校区" }));
		await expandMapResults();

		expect(screen.queryByRole("button", { name: "选择示例图书馆" })).toBeNull();
		expect(screen.getByRole("button", { name: "选择示例东门" })).toBeInTheDocument();
		await waitFor(() => {
			// Switching campus restores the fixed overview camera, so the scale
			// bar is identical on every device instead of viewport-dependent.
			expect(maplibreRuntimeMock.easeTo).toHaveBeenCalledWith(
				expect.objectContaining({
					center: FENGTAI_CAMPUS_CENTER,
					zoom: FENGTAI_CAMPUS_SCALE_ZOOM,
				}),
			);
		});

		await user.click(screen.getByRole("radio", { name: "食堂" }));

		await waitFor(() => {
			expect(maplibreRuntimeMock.fitBounds).toHaveBeenCalledWith(
				[
					[expect.any(Number), expect.any(Number)],
					[expect.any(Number), expect.any(Number)],
				],
				expect.objectContaining({
					maxZoom: 16.8,
					padding: { bottom: 80, left: 360, right: 96, top: 96 },
				}),
			);
		});

		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择示例一食堂" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择示例图书馆" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择示例东门" })).toBeNull();
	});

	it("switches campus map context without mixing places or base maps", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "展开地点结果" })).toBeInTheDocument();
		await expandMapResults();
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择示例图书馆" })).toBeNull();

		await user.click(screen.getByRole("radio", { name: "海淀校区" }));

		expect(await screen.findByRole("button", { name: "选择示例图书馆" })).toBeInTheDocument();
		expect(screen.getByText("海淀校区当前提供基础地点参考。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择示例服务中心" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "服务" })).toBeInTheDocument();
		expect(screen.queryByRole("radio", { name: "出入口" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择示例二食堂" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择示例东门" })).toBeNull();
		expect(screen.queryByText("当前校区缺少可展示的地图底图。")).toBeNull();
		expect(maplibreRuntimeMock.setStyle).toHaveBeenCalledWith(
			expect.objectContaining({
				sources: {
					"haidian-campus": {
						attribution: "Synthetic map data",
						data: "/campus-map/assets/02f064bd8c11bc56133ef7f1456ec91da8d40107f4a8d55800d85a585f879cc5.geojson",
						type: "geojson",
					},
				},
			}),
		);
	});

	it("finishes initial map loading after the campus changes", async () => {
		const user = userEvent.setup();
		window.history.pushState({}, "", "/map?campus=fengtai");
		maplibreRuntimeMock.deferInitialLoad = true;
		render(<MapPage />);

		expect(await screen.findByRole("radio", { name: "丰台校区" })).toHaveAttribute(
			"aria-checked",
			"true",
		);
		await waitFor(() => expect(maplibreRuntimeMock.mapLoadListeners).toHaveLength(1));

		await user.click(screen.getByRole("radio", { name: "海淀校区" }));
		act(() => maplibreRuntimeMock.mapLoadListeners[0]?.());

		await waitFor(() =>
			expect(maplibreRuntimeMock.setStyle).toHaveBeenCalledWith(
				expect.objectContaining({
					sources: expect.objectContaining({
						"haidian-campus": expect.any(Object),
					}),
				}),
			),
		);
		expect(screen.queryByText("正在加载地图")).toBeNull();
	});

	it("restores campus map state from the URL and writes state changes back", async () => {
		const user = userEvent.setup();
		window.history.pushState(
			{},
			"",
			"/map?campus=haidian&category=service&q=%E5%AD%A6%E7%94%9F&place=sample-service-center",
		);

		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "选择示例服务中心" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("searchbox", { name: "搜索地点" })).toHaveValue("学生");
		expect(screen.getByRole("radio", { name: "海淀校区" })).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("radio", { name: "服务" })).toHaveAttribute("aria-checked", "true");
		expect(screen.queryByRole("button", { name: "选择示例图书馆" })).toBeNull();

		await user.click(screen.getByRole("radio", { name: "丰台校区" }));

		await waitFor(() => expect(window.location.search).toContain("campus=fengtai"));
		expect(window.location.search).not.toContain("place=sample-service-center");
		expect(window.location.search).not.toContain("category=service");
	});

	it("does not match campus map search against internal source references", async () => {
		const user = userEvent.setup();
		render(<MapPage />);

		await user.click(await screen.findByRole("radio", { name: "海淀校区" }));
		await expandMapResults();
		expect(await screen.findByRole("button", { name: "选择示例图书馆" })).toBeInTheDocument();
		await user.type(screen.getByRole("searchbox", { name: "搜索地点" }), "projection");

		expect(await screen.findByText("没有找到匹配地点。")).toBeInTheDocument();
		expect(
			screen.queryByText("示例图书馆与自习、借阅相关服务的主要位置。"),
		).not.toBeInTheDocument();
		expect(screen.queryByText("学生事务相关位置。")).not.toBeInTheDocument();
	});

	it("does not match campus map search against derived category labels", async () => {
		const user = userEvent.setup();
		render(<MapPage />);

		await user.click(await screen.findByRole("radio", { name: "海淀校区" }));
		await expandMapResults();
		expect(await screen.findByRole("button", { name: "选择示例图书馆" })).toBeInTheDocument();
		await user.type(screen.getByRole("searchbox", { name: "搜索地点" }), "建筑");

		expect(await screen.findByText("没有找到匹配地点。")).toBeInTheDocument();
		expect(
			screen.queryByText("示例图书馆与自习、借阅相关服务的主要位置。"),
		).not.toBeInTheDocument();
	});

	it("renders only map error state when the campus map API fails", async () => {
		const { getCampusMapPlaces } = await import("../src/features/map/api");
		vi.mocked(getCampusMapPlaces).mockRejectedValueOnce(new Error("network"));

		render(<MapPage />);

		expect(await screen.findByText("校园地图暂时无法打开。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "打开全局菜单" })).toBeInTheDocument();
		expect(screen.queryByText("正在读取地图")).not.toBeInTheDocument();
	});
	it("renders an empty map when no places are published", async () => {
		const { getCampusMapPlaces } = await import("../src/features/map/api");
		vi.mocked(getCampusMapPlaces).mockResolvedValueOnce({
			campus: { defaultCenter: [116.3216, 39.9519], id: "haidian", name: "海淀校区" },
			places: [],
		});
		render(<MapPage />);
		expect(await screen.findByText("暂无校园地点")).toBeInTheDocument();
	});
});
