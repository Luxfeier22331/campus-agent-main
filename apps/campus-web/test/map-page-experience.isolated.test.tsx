import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MapPage } from "../src/app/routes/map-page";
import {
	expandMapResults,
	installMapStyleTokens,
	mockMapWorkspaceWidth,
} from "./map-page-test-utils";

const maplibreRuntimeMock = vi.hoisted(() => ({
	canvas: null as HTMLElement | null,
	fitBounds: vi.fn(),
	flyTo: vi.fn(),
	loadMapLibre: vi.fn(),
	mapClickListeners: [] as Array<(event: { point: { x: number; y: number } }) => void>,
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
	const { mapPageManifest } = await import("./fixtures/map-manifest");
	const { mapPagePlaces } = await import("./fixtures/map-page-data");
	return {
		getCampusMapManifest: vi.fn().mockResolvedValue(mapPageManifest),
		getCampusMapPlaces: vi.fn().mockResolvedValue({
			campus: {
				defaultCenter: [116.3216, 39.9519],
				id: "muc-campuses",
				name: "中央民族大学校区",
			},
			places: mapPagePlaces,
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
			on(eventName: string, listener: (event: { point: { x: number; y: number } }) => void) {
				if (eventName === "click") {
					maplibreRuntimeMock.mapClickListeners.push(listener);
				}
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

describe("campus map product experience", () => {
	beforeEach(() => {
		window.history.pushState({}, "", "/map?campus=fengtai");
		mockMapWorkspaceWidth(true, vi.fn);
		maplibreRuntimeMock.fitBounds.mockReset();
		maplibreRuntimeMock.flyTo.mockReset();
		maplibreRuntimeMock.mapClickListeners.length = 0;
		maplibreRuntimeMock.markerElements.length = 0;
		maplibreRuntimeMock.queryRenderedFeatures.mockReset();
		maplibreRuntimeMock.queryRenderedFeatures.mockReturnValue([]);
		maplibreRuntimeMock.setFilter.mockReset();
		maplibreRuntimeMock.setStyle.mockReset();
		installMapStyleTokens();
	});

	it("clears search and ranks title matches before tag matches", async () => {
		const user = userEvent.setup();
		render(<MapPage />);

		await expandMapResults();
		const search = await screen.findByRole("searchbox", { name: "搜索地点" });
		await user.type(search, "食堂");

		const results = within(screen.getByRole("region", { name: "地点结果" })).getAllByRole(
			"button",
			{ name: /^选择/ },
		);
		expect(results.map((button) => button.textContent)).toEqual([
			expect.stringContaining("示例一食堂"),
			expect.stringContaining("示例二食堂"),
		]);
		expect(screen.getByRole("button", { name: "清除搜索" })).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "清除搜索" }));

		expect(search).toHaveValue("");
		expect(screen.getByRole("button", { name: "选择示例教学楼" })).toBeInTheDocument();
	});

	it("supports keyboard navigation and escape behavior in search results", async () => {
		const user = userEvent.setup();
		render(<MapPage />);

		await expandMapResults();
		const search = await screen.findByRole("searchbox", { name: "搜索地点" });
		await user.type(search, "食堂");
		await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

		expect(await screen.findByRole("dialog", { name: "示例二食堂" })).toBeInTheDocument();
		expect(window.location.search).toContain("place=sample-canteen-b");
		expect(maplibreRuntimeMock.flyTo).toHaveBeenLastCalledWith({
			center: [120.0002, 30.0002],
			zoom: 17,
		});

		await user.keyboard("{Escape}");

		expect(screen.queryByRole("dialog", { name: "示例二食堂" })).toBeNull();
		expect(search).toHaveValue("食堂");

		await user.click(search);
		await user.keyboard("{Escape}");

		expect(search).toHaveValue("");
	});

	it("groups Fengtai places by student tasks and keeps grouped ordering stable", async () => {
		render(<MapPage />);

		await expandMapResults();
		const groups = within(await screen.findByRole("region", { name: "地点结果" })).getAllByRole(
			"group",
		);

		const groupNames = ["食堂", "教学楼", "宿舍", "出入口", "服务", "运动"];
		expect(
			groupNames.map((name) =>
				within(screen.getByRole("region", { name: "地点结果" })).getByRole("group", {
					name,
				}),
			),
		).toEqual(groups);
		expect(
			within(groups[0] as HTMLElement).getByRole("button", { name: "选择示例一食堂" }),
		).toBeInTheDocument();
		expect(
			within(groups[1] as HTMLElement).getByRole("button", { name: "选择示例教学楼" }),
		).toBeInTheDocument();
		expect(
			within(groups[2] as HTMLElement).getByRole("button", { name: "选择静园一号楼" }),
		).toBeInTheDocument();
	});

	it("uses student task filters instead of backend category labels", async () => {
		const user = userEvent.setup();
		render(<MapPage />);

		await expandMapResults();
		const typeFilters = screen.getByRole("radiogroup", { name: "地点类型" });

		expect(
			within(typeFilters)
				.getAllByRole("radio")
				.map((button) => button.textContent),
		).toEqual(["全部", "食堂", "教学楼", "宿舍", "出入口", "服务", "运动"]);
		expect(within(typeFilters).queryByRole("radio", { name: "建筑" })).toBeNull();
		expect(within(typeFilters).queryByRole("radio", { name: "校门" })).toBeNull();
		expect(within(typeFilters).queryByRole("radio", { name: "地标" })).toBeNull();
		expect(within(typeFilters).queryByRole("radio", { name: "交通" })).toBeNull();

		await user.click(within(typeFilters).getByRole("radio", { name: "食堂" }));

		expect(screen.getByRole("button", { name: "选择示例一食堂" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择示例二食堂" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择示例教学楼" })).toBeNull();
		expect(window.location.search).toContain("category=dining");
	});

	it("keeps long Fengtai groups collapsed by default and expands them on demand", async () => {
		const user = userEvent.setup();
		render(<MapPage />);

		await expandMapResults();
		const dormGroup = screen.getByRole("group", { name: "宿舍" });

		expect(within(dormGroup).getByRole("button", { name: "选择静园一号楼" })).toBeInTheDocument();
		expect(within(dormGroup).getByRole("button", { name: "选择静园五号楼" })).toBeInTheDocument();
		expect(within(dormGroup).queryByRole("button", { name: "选择静园六号楼" })).toBeNull();
		expect(within(dormGroup).queryByRole("button", { name: "选择示例公寓区" })).toBeNull();
		expect(within(dormGroup).getByRole("button", { name: "展开宿舍" })).toHaveTextContent(
			"展开宿舍",
		);

		await user.click(within(dormGroup).getByRole("button", { name: "展开宿舍" }));

		expect(within(dormGroup).getByRole("button", { name: "选择静园六号楼" })).toBeInTheDocument();
		expect(within(dormGroup).getByRole("button", { name: "选择示例公寓区" })).toBeInTheDocument();
		expect(within(dormGroup).getByRole("button", { name: "收起宿舍" })).toBeInTheDocument();
	});

	it("shows concise place detail without repeating campus or raw category tags", async () => {
		const user = userEvent.setup();
		render(<MapPage />);

		await expandMapResults();
		await user.click(await screen.findByRole("button", { name: "选择示例一食堂" }));
		const detail = await screen.findByRole("dialog", { name: "示例一食堂" });

		expect(within(detail).getByText("食堂")).toBeInTheDocument();
		expect(within(detail).getByText("生活")).toBeInTheDocument();
		expect(within(detail).queryByText("丰台")).toBeNull();
		expect(within(detail).queryByText("建筑")).toBeNull();
		expect(within(detail).queryByText("校区")).toBeNull();
		expect(within(detail).queryByText("类型")).toBeNull();
	});

	it("renders mobile detail as a constrained sheet with close controls and keeps results collapsed", async () => {
		const user = userEvent.setup();
		mockMapWorkspaceWidth(false, vi.fn);
		render(<MapPage />);

		await expandMapResults();
		await user.click(await screen.findByRole("button", { name: "选择示例一食堂" }));
		const sheet = await screen.findByRole("dialog", { name: "示例一食堂" });

		expect(sheet).toHaveAttribute("data-variant", "sheet");
		expect(sheet.className).toContain("max-h-[48dvh]");
		expect(screen.queryByLabelText("拖动关闭地点详情")).toBeNull();
		expect(screen.getAllByRole("button", { name: "关闭地点详情" })).toHaveLength(2);
		expect(screen.queryByRole("button", { name: "选择示例教学楼" })).toBeNull();
	});

	it("uses product copy for Haidian basic reference state", async () => {
		const user = userEvent.setup();
		render(<MapPage />);

		await user.click(await screen.findByRole("radio", { name: "海淀校区" }));

		expect(await screen.findByText("海淀校区当前提供基础地点参考。")).toBeInTheDocument();
		expect(screen.queryByText("开发中")).toBeNull();
		expect(screen.queryByText("暂未接入")).toBeNull();
	});
});
