import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapPage } from "../src/app/routes/map-page";
import {
	expandMapResults,
	installMapStyleTokens,
	mockMapWorkspaceWidth,
} from "./map-page-test-utils";

const stylesSource = readFileSync("src/styles.css", "utf8");

const maplibreRuntimeMock = vi.hoisted(() => ({
	canvas: null as HTMLElement | null,
	fitBounds: vi.fn(),
	flyTo: vi.fn(),
	loadMapLibre: vi.fn(),
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
}));

vi.mock("../src/features/map/api", async () => {
	const { mapPagePlaces } = await import("./fixtures/map-page-data");
	return {
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
			fitBounds(input: unknown, options?: unknown) {
				maplibreRuntimeMock.fitBounds(input, options);
				return this;
			}
			getCanvas() {
				return maplibreRuntimeMock.canvas;
			}
			once(_eventName: string, listener: () => void) {
				listener();
				return this;
			}
			on(eventName: string, listener: (event: { point: { x: number; y: number } }) => void) {
				if (eventName === "click") {
					maplibreRuntimeMock.mapClickListeners.push(listener);
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
		maplibreRuntimeMock.fitBounds.mockReset();
		maplibreRuntimeMock.flyTo.mockReset();
		maplibreRuntimeMock.resize.mockReset();
		maplibreRuntimeMock.mapClickListeners.length = 0;
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
		maplibreRuntimeMock.loadMapLibre.mockClear();
		installMapStyleTokens();
	});

	it("filters map places without exposing projection wording", async () => {
		render(<MapPage />);

		fireEvent.click(await screen.findByRole("radio", { name: "海淀校区" }));
		fireEvent.click(screen.getByRole("button", { name: "展开地点结果" }));
		expect(await screen.findByRole("button", { name: "选择图书馆" })).toBeInTheDocument();
		fireEvent.change(screen.getByRole("combobox", { name: "搜索地点" }), {
			target: { value: "学生" },
		});

		expect(await screen.findByRole("button", { name: "选择学生事务中心" })).toBeInTheDocument();
		expect(screen.queryByText("图书馆与自习、借阅相关服务的主要位置。")).not.toBeInTheDocument();
	});

	it("renders the campus map as a full viewport searchable map surface", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("region", { name: "校园地图" })).toHaveAttribute(
			"data-surface",
			"map-first",
		);
		expect(screen.queryByRole("link", { name: "返回校园问答" })).toBeNull();
		expect(screen.getByRole("navigation", { name: "地图页面导航" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "问答" })).toHaveAttribute("href", "/");
		expect(screen.getByRole("link", { name: "文档" })).toHaveAttribute("href", "/docs/");
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
		expect(resultPanel).toHaveClass("bg-white/80", "backdrop-blur-md");
		expect(resultPanel.className).toContain("w-[min(360px,calc(100vw-1.5rem))]");
		expect(resultPanel.className).toContain("max-h-[min(58dvh,430px)]");
		expect(resultPanel.className).not.toContain("w-[min(420px");
		expect(resultPanel.className).not.toContain("100dvh");
		expect(screen.getByRole("navigation", { name: "地图页面导航" })).toHaveClass(
			"bg-white/78",
			"backdrop-blur-md",
		);
		expect(screen.getByRole("combobox", { name: "搜索地点" })).toHaveClass("min-h-10");
		expect(screen.getByRole("heading", { name: "地点" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "丰台校区" })).toHaveClass("min-h-9", "text-sm");
		expect(screen.getByRole("radio", { name: "丰台校区" })).toHaveAttribute("aria-checked", "true");
		expect(screen.queryByText("海淀校区当前提供基础地点参考。")).toBeNull();
		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toHaveClass(
			"bg-white/58",
			"h-auto",
			"min-h-[76px]",
			"p-2.5",
		);
		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).not.toHaveClass("h-9");
		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toHaveTextContent("荟贤食堂");
		expect(screen.getByRole("button", { name: "选择博雅楼" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择静园一号楼" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择丰台南门" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择图书馆" })).toBeNull();
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
		expect(stylesSource).toContain("top: 54px");
		expect(stylesSource).toContain("@media (max-width: 959px)");
		expect(stylesSource).toContain("top: 133px");
	});

	it("keeps the map panel compact until the user opens search results", async () => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("combobox", { name: "搜索地点" })).toBeInTheDocument();
		const resultPanel = screen.getByRole("complementary", { name: "地点搜索与结果" });
		expect(resultPanel.className).toContain("max-h-[min(34dvh,220px)]");
		expect(screen.getByRole("button", { name: "展开地点结果" })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		expect(screen.queryByRole("heading", { name: "地点" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择荟贤食堂" })).toBeNull();

		fireEvent.focus(screen.getByRole("combobox", { name: "搜索地点" }));

		expect(screen.getByRole("button", { name: "收起地点结果" })).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		expect(screen.getByRole("heading", { name: "地点" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toBeInTheDocument();
		expect(resultPanel.className).toContain("max-h-[min(58dvh,430px)]");
	});

	it("keeps map navigation separate while allowing the place list to collapse", async () => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("combobox", { name: "搜索地点" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "展开地点结果" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "丰台校区" })).toHaveAttribute("aria-checked", "true");

		await expandMapResults();

		expect(screen.getByRole("form", { name: "地点搜索" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "收起地点结果" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "丰台校区" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "食堂" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "地点" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "地图画布" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "收起地点结果" }));

		expect(screen.queryByRole("heading", { name: "地点" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择荟贤食堂" })).toBeNull();
		expect(screen.getByRole("radio", { name: "丰台校区" })).toBeInTheDocument();
	});

	it("lets the user return to the current campus view from map controls", async () => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "回到当前校区" })).toBeInTheDocument();
		maplibreRuntimeMock.fitBounds.mockClear();

		fireEvent.click(screen.getByRole("button", { name: "回到当前校区" }));

		expect(maplibreRuntimeMock.fitBounds).toHaveBeenCalledWith(
			[
				[116.10132465599999, 39.803722832],
				[116.119836844, 39.816255268],
			],
			expect.objectContaining({
				maxZoom: 16.8,
				padding: { bottom: 80, left: 360, right: 96, top: 96 },
			}),
		);
	});

	it("loads the Fengtai campus base layers into MapLibre", async () => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "展开地点结果" })).toBeInTheDocument();
		await expandMapResults();
		expect(screen.getByRole("button", { name: "选择丰台东门" })).toBeInTheDocument();
		await waitFor(() => expect(maplibreRuntimeMock.mapOptions).not.toBeNull());

		expect(maplibreRuntimeMock.mapOptions?.localIdeographFontFamily).toBe("sans-serif");
		expect(maplibreRuntimeMock.mapOptions?.style?.sources).toHaveProperty("fengtai-campus");
		expect(
			(maplibreRuntimeMock.mapOptions?.style?.sources?.["fengtai-campus"] as { data?: string })
				.data,
		).toBe("/map-assets/fengtai-campus.geojson");
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
				center: [116.11058075, 39.80998905],
				maxBounds: [
					[116.10132465599999, 39.803722832],
					[116.119836844, 39.816255268],
				],
				maxZoom: 20.2,
				minZoom: 12.8,
				zoom: 15.8,
			}),
		);
		expect(maplibreRuntimeMock.navigationControlCount).toBe(1);
		expect(maplibreRuntimeMock.scaleControlCount).toBe(1);
	});

	it("syncs campus map selection between list, marker, details, polygon highlight, and flyTo", async () => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		await expandMapResults();
		expect(await screen.findByRole("button", { name: "选择丰台东门" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await waitFor(() => expect(maplibreRuntimeMock.markerElements).toHaveLength(1));
		expect(maplibreRuntimeMock.markerElements[0]?.dataset.selected).toBe("false");
		expect(maplibreRuntimeMock.markerElements[0]?.dataset.variant).toBe("transport");

		fireEvent.click(screen.getByRole("radio", { name: "海淀校区" }));
		await expandMapResults();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "选择图书馆" })).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByRole("button", { name: "选择学生事务中心" }));

		expect(screen.getByRole("button", { name: "选择学生事务中心" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("dialog", { name: "学生事务中心" })).toBeInTheDocument();
		expect(screen.queryByText("当前校区缺少可展示的地图底图。")).toBeNull();
		expect(maplibreRuntimeMock.setStyle).toHaveBeenCalledWith(
			expect.objectContaining({
				sources: {
					"haidian-campus": {
						data: "/map-assets/haidian-campus.geojson",
						type: "geojson",
					},
				},
			}),
		);
		expect(maplibreRuntimeMock.flyTo).toHaveBeenLastCalledWith({
			center: [116.3222, 39.9515],
			zoom: 17,
		});

		fireEvent.click(screen.getByRole("radio", { name: "丰台校区" }));
		await expandMapResults();
		await waitFor(() => expect(maplibreRuntimeMock.markerElements).toHaveLength(1));
		fireEvent.click(maplibreRuntimeMock.markerElements[0] as HTMLElement);

		expect(screen.getByRole("button", { name: "选择丰台东门" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"==",
			["get", "fid"],
			-1,
		]);

		fireEvent.click(screen.getByRole("button", { name: "选择荟贤食堂" }));

		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("heading", { name: "荟贤食堂" })).toBeInTheDocument();
		expect(screen.getByRole("dialog", { name: "荟贤食堂" })).toBeInTheDocument();
		expect(maplibreRuntimeMock.flyTo).toHaveBeenLastCalledWith({
			center: [116.10859555, 39.80931605],
			zoom: 17,
		});
		expect(screen.getByRole("dialog", { name: "荟贤食堂" })).toHaveAttribute("data-side", "right");
		expect(screen.getByRole("dialog", { name: "荟贤食堂" })).toHaveAttribute("data-align", "start");
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
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		await expandMapResults();
		fireEvent.click(await screen.findByRole("button", { name: "选择荟贤食堂" }));
		expect(screen.getByRole("dialog", { name: "荟贤食堂" })).toBeInTheDocument();

		act(() => {
			maplibreRuntimeMock.mapClickListeners.at(-1)?.({ point: { x: 0, y: 0 } });
		});

		expect(screen.queryByRole("dialog", { name: "荟贤食堂" })).toBeNull();
		expect(maplibreRuntimeMock.setFilter).toHaveBeenCalledWith("campus-place-selected-outline", [
			"==",
			["get", "fid"],
			-1,
		]);
		await expandMapResults();
		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("renders selected place in a closeable mobile bottom sheet", async () => {
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
		fireEvent.click(await screen.findByRole("button", { name: "选择荟贤食堂" }));
		expect(screen.getByRole("dialog", { name: "荟贤食堂" })).toHaveAttribute(
			"data-variant",
			"sheet",
		);
		expect(screen.queryByRole("button", { name: "回到当前校区" })).toBeNull();
		expect(screen.queryByRole("button", { name: "收起地点结果" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择丰台东门" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
		expect(screen.queryByRole("button", { name: "拖动关闭地点详情" })).toBeNull();
		expect(screen.getAllByRole("button", { name: "关闭地点详情" })).toHaveLength(2);

		fireEvent.click(screen.getAllByRole("button", { name: "关闭地点详情" })[1]);

		expect(screen.queryByRole("dialog", { name: "荟贤食堂" })).toBeNull();
		expect(screen.getByRole("button", { name: "回到当前校区" })).toBeInTheDocument();
		await expandMapResults();
		expect(screen.getByRole("button", { name: "选择丰台东门" })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "详情" })).toBeNull();
	});

	it("filters campus map places by campus and category without synthetic places", async () => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "展开地点结果" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "展开地点结果" }));
		expect(screen.getByRole("button", { name: "选择丰台东门" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("radio", { name: "丰台校区" }));
		await expandMapResults();

		expect(screen.queryByRole("button", { name: "选择图书馆" })).toBeNull();
		expect(screen.getByRole("button", { name: "选择丰台东门" })).toBeInTheDocument();
		await waitFor(() => {
			expect(maplibreRuntimeMock.fitBounds).toHaveBeenCalledWith(
				[
					[116.10132465599999, 39.803722832],
					[116.119836844, 39.816255268],
				],
				expect.objectContaining({
					maxZoom: 16.8,
					padding: { bottom: 80, left: 360, right: 96, top: 96 },
				}),
			);
		});

		fireEvent.click(screen.getByRole("radio", { name: "食堂" }));

		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择聚雅食堂" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择图书馆" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择丰台东门" })).toBeNull();
	});

	it("switches campus map context without mixing places or base maps", async () => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "展开地点结果" })).toBeInTheDocument();
		await expandMapResults();
		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择图书馆" })).toBeNull();

		fireEvent.click(screen.getByRole("radio", { name: "海淀校区" }));

		expect(await screen.findByRole("button", { name: "选择图书馆" })).toBeInTheDocument();
		expect(screen.getByText("海淀校区当前提供基础地点参考。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择学生事务中心" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "服务" })).toBeInTheDocument();
		expect(screen.queryByRole("radio", { name: "出入口" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择荟贤食堂" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择丰台东门" })).toBeNull();
		expect(screen.queryByText("当前校区缺少可展示的地图底图。")).toBeNull();
		expect(maplibreRuntimeMock.setStyle).toHaveBeenCalledWith(
			expect.objectContaining({
				sources: {
					"haidian-campus": {
						data: "/map-assets/haidian-campus.geojson",
						type: "geojson",
					},
				},
			}),
		);
	});

	it("restores campus map state from the URL and writes state changes back", async () => {
		window.history.pushState(
			{},
			"",
			"/map?campus=haidian&category=service&q=%E5%AD%A6%E7%94%9F&place=student-service",
		);

		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "选择学生事务中心" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("combobox", { name: "搜索地点" })).toHaveValue("学生");
		expect(screen.getByRole("radio", { name: "海淀校区" })).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("radio", { name: "服务" })).toHaveAttribute("aria-checked", "true");
		expect(screen.queryByRole("button", { name: "选择图书馆" })).toBeNull();

		fireEvent.click(screen.getByRole("radio", { name: "丰台校区" }));

		await waitFor(() => expect(window.location.search).toContain("campus=fengtai"));
		expect(window.location.search).not.toContain("place=student-service");
		expect(window.location.search).not.toContain("category=service");
	});

	it("does not match campus map search against internal source references", async () => {
		render(<MapPage />);

		fireEvent.click(await screen.findByRole("radio", { name: "海淀校区" }));
		await expandMapResults();
		expect(await screen.findByRole("button", { name: "选择图书馆" })).toBeInTheDocument();
		fireEvent.change(screen.getByRole("combobox", { name: "搜索地点" }), {
			target: { value: "projection" },
		});

		expect(await screen.findByText("没有找到匹配地点。")).toBeInTheDocument();
		expect(screen.queryByText("图书馆与自习、借阅相关服务的主要位置。")).not.toBeInTheDocument();
		expect(screen.queryByText("学生事务相关位置。")).not.toBeInTheDocument();
	});

	it("does not match campus map search against derived category labels", async () => {
		render(<MapPage />);

		fireEvent.click(await screen.findByRole("radio", { name: "海淀校区" }));
		await expandMapResults();
		expect(await screen.findByRole("button", { name: "选择图书馆" })).toBeInTheDocument();
		fireEvent.change(screen.getByRole("combobox", { name: "搜索地点" }), {
			target: { value: "建筑" },
		});

		expect(await screen.findByText("没有找到匹配地点。")).toBeInTheDocument();
		expect(screen.queryByText("图书馆与自习、借阅相关服务的主要位置。")).not.toBeInTheDocument();
	});

	it("renders only map error state when the campus map API fails", async () => {
		const { getCampusMapPlaces } = await import("../src/features/map/api");
		vi.mocked(getCampusMapPlaces).mockRejectedValueOnce(new Error("network"));

		render(<MapPage />);

		expect(await screen.findByText("校园地图暂时无法打开。")).toBeInTheDocument();
		expect(screen.queryByText("正在读取地图")).not.toBeInTheDocument();
	});
});
