import { fireEvent, render, screen, within } from "@testing-library/react";
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
	const { mapPagePlaces } = await import("./fixtures/map-page-data");
	return {
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
		render(<MapPage />);

		await expandMapResults();
		const search = await screen.findByRole("searchbox", { name: "搜索地点" });
		fireEvent.change(search, { target: { value: "食堂" } });

		const results = within(screen.getByRole("region", { name: "地点结果" })).getAllByRole(
			"button",
			{ name: /^选择/ },
		);
		expect(results.map((button) => button.textContent)).toEqual([
			expect.stringContaining("聚雅食堂"),
			expect.stringContaining("荟贤食堂"),
		]);
		expect(screen.getByRole("button", { name: "清除搜索" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));

		expect(search).toHaveValue("");
		expect(screen.getByRole("button", { name: "选择博雅楼" })).toBeInTheDocument();
	});

	it("supports keyboard navigation and escape behavior in search results", async () => {
		render(<MapPage />);

		await expandMapResults();
		const search = await screen.findByRole("searchbox", { name: "搜索地点" });
		fireEvent.change(search, { target: { value: "食堂" } });
		fireEvent.keyDown(search, { key: "ArrowDown" });
		fireEvent.keyDown(search, { key: "ArrowDown" });
		fireEvent.keyDown(search, { key: "Enter" });

		expect(await screen.findByRole("dialog", { name: "荟贤食堂" })).toBeInTheDocument();
		expect(window.location.search).toContain("place=fengtai-huixian-canteen");
		expect(maplibreRuntimeMock.flyTo).toHaveBeenLastCalledWith({
			center: [116.10859555, 39.80931605],
			zoom: 17,
		});

		fireEvent.keyDown(search, { key: "Escape" });

		expect(screen.queryByRole("dialog", { name: "荟贤食堂" })).toBeNull();
		expect(search).toHaveValue("食堂");

		fireEvent.keyDown(search, { key: "Escape" });

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
			within(groups[0] as HTMLElement).getByRole("button", { name: "选择聚雅食堂" }),
		).toBeInTheDocument();
		expect(
			within(groups[1] as HTMLElement).getByRole("button", { name: "选择博雅楼" }),
		).toBeInTheDocument();
		expect(
			within(groups[2] as HTMLElement).getByRole("button", { name: "选择静园一号楼" }),
		).toBeInTheDocument();
	});

	it("uses student task filters instead of backend category labels", async () => {
		render(<MapPage />);

		await expandMapResults();
		const typeFilters = screen.getByRole("group", { name: "地点类型" });

		expect(
			within(typeFilters)
				.getAllByRole("button")
				.map((button) => button.textContent),
		).toEqual(["全部", "食堂", "教学楼", "宿舍", "出入口", "服务", "运动"]);
		expect(within(typeFilters).queryByRole("button", { name: "建筑" })).toBeNull();
		expect(within(typeFilters).queryByRole("button", { name: "校门" })).toBeNull();
		expect(within(typeFilters).queryByRole("button", { name: "地标" })).toBeNull();
		expect(within(typeFilters).queryByRole("button", { name: "交通" })).toBeNull();

		fireEvent.click(within(typeFilters).getByRole("button", { name: "食堂" }));

		expect(screen.getByRole("button", { name: "选择聚雅食堂" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择荟贤食堂" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择博雅楼" })).toBeNull();
		expect(window.location.search).toContain("category=dining");
	});

	it("keeps long Fengtai groups collapsed by default and expands them on demand", async () => {
		render(<MapPage />);

		await expandMapResults();
		const dormGroup = screen.getByRole("group", { name: "宿舍" });

		expect(within(dormGroup).getByRole("button", { name: "选择静园一号楼" })).toBeInTheDocument();
		expect(within(dormGroup).getByRole("button", { name: "选择静园五号楼" })).toBeInTheDocument();
		expect(within(dormGroup).queryByRole("button", { name: "选择静园六号楼" })).toBeNull();
		expect(within(dormGroup).queryByRole("button", { name: "选择教师公寓区" })).toBeNull();
		expect(within(dormGroup).getByRole("button", { name: "展开宿舍" })).toHaveTextContent(
			"展开宿舍",
		);

		fireEvent.click(within(dormGroup).getByRole("button", { name: "展开宿舍" }));

		expect(within(dormGroup).getByRole("button", { name: "选择静园六号楼" })).toBeInTheDocument();
		expect(within(dormGroup).getByRole("button", { name: "选择教师公寓区" })).toBeInTheDocument();
		expect(within(dormGroup).getByRole("button", { name: "收起宿舍" })).toBeInTheDocument();
	});

	it("shows concise place detail without repeating campus or raw category tags", async () => {
		render(<MapPage />);

		await expandMapResults();
		fireEvent.click(await screen.findByRole("button", { name: "选择聚雅食堂" }));
		const detail = await screen.findByRole("dialog", { name: "聚雅食堂" });

		expect(within(detail).getByText("食堂")).toBeInTheDocument();
		expect(within(detail).getByText("生活")).toBeInTheDocument();
		expect(within(detail).queryByText("丰台")).toBeNull();
		expect(within(detail).queryByText("建筑")).toBeNull();
		expect(within(detail).queryByText("校区")).toBeNull();
		expect(within(detail).queryByText("类型")).toBeNull();
	});

	it("renders mobile detail as a constrained sheet with a drag handle and keeps results collapsed", async () => {
		mockMapWorkspaceWidth(false, vi.fn);
		render(<MapPage />);

		await expandMapResults();
		fireEvent.click(await screen.findByRole("button", { name: "选择聚雅食堂" }));
		const sheet = await screen.findByRole("dialog", { name: "聚雅食堂" });

		expect(sheet).toHaveAttribute("data-variant", "sheet");
		expect(sheet.className).toContain("max-h-[48dvh]");
		expect(screen.getByLabelText("拖动关闭地点详情")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择博雅楼" })).toBeNull();
	});

	it("uses product copy for Haidian basic reference state", async () => {
		render(<MapPage />);

		fireEvent.click(await screen.findByRole("button", { name: "海淀校区" }));

		expect(await screen.findByText("海淀校区当前提供基础地点参考。")).toBeInTheDocument();
		expect(screen.queryByText("开发中")).toBeNull();
		expect(screen.queryByText("暂未接入")).toBeNull();
	});
});
