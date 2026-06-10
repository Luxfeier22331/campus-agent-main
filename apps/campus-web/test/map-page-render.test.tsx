import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapPage } from "../src/app/routes/map-page";

const maplibreRuntimeMock = vi.hoisted(() => ({
	flyTo: vi.fn(),
	loadMapLibre: vi.fn(),
	markerElements: [] as HTMLElement[],
}));

vi.mock("../src/features/map/api", () => ({
	getCampusMapPlaces: vi.fn().mockResolvedValue({
		campus: {
			defaultCenter: [116.3216, 39.9519],
			id: "haidian",
			name: "海淀校区",
		},
		places: [
			{
				accessNote: null,
				campus: "海淀校区",
				category: "building",
				description: "图书馆与自习、借阅相关服务的主要位置。",
				geojson: {
					geometry: { coordinates: [116.3211, 39.9524], type: "Point" },
					properties: { category: "building", placeId: "library", title: "图书馆" },
					type: "Feature",
				},
				id: "library",
				sourceRefs: ["campus-map:projection:library"],
				tags: ["学习"],
				title: "图书馆",
			},
			{
				accessNote: null,
				campus: "海淀校区",
				category: "service",
				description: "学生事务相关位置。",
				geojson: {
					geometry: { coordinates: [116.3222, 39.9515], type: "Point" },
					properties: { category: "service", placeId: "student-service", title: "学生事务中心" },
					type: "Feature",
				},
				id: "student-service",
				sourceRefs: ["campus-map:projection:student-service"],
				tags: ["办事"],
				title: "学生事务中心",
			},
			{
				accessNote: "从东门进入后沿主路步行约 3 分钟。",
				campus: "丰台校区",
				category: "transport",
				description: "丰台校区通勤和到访的主要入口。",
				geojson: {
					geometry: { coordinates: [116.289, 39.837], type: "Point" },
					properties: { category: "transport", placeId: "fengtai-east-gate", title: "丰台东门" },
					type: "Feature",
				},
				id: "fengtai-east-gate",
				sourceRefs: ["campus-map:projection:fengtai-east-gate"],
				tags: ["出入口", "交通"],
				title: "丰台东门",
			},
		],
	}),
}));

vi.mock("../src/features/map/maplibre-runtime", () => ({
	loadMapLibre: maplibreRuntimeMock.loadMapLibre.mockResolvedValue({
		Map: class {
			container: HTMLElement;
			constructor(options: { container: HTMLElement }) {
				this.container = options.container;
			}
			flyTo(input: unknown) {
				maplibreRuntimeMock.flyTo(input);
				return this;
			}
			remove() {
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
	}),
}));

describe("campus map page", () => {
	beforeEach(() => {
		maplibreRuntimeMock.flyTo.mockReset();
		maplibreRuntimeMock.markerElements.length = 0;
		maplibreRuntimeMock.loadMapLibre.mockClear();
		document.documentElement.style.setProperty("--neutral-150", "#eef0f3");
	});

	it("filters map places without exposing projection wording", async () => {
		render(<MapPage />);

		expect(await screen.findByText("图书馆")).toBeInTheDocument();
		fireEvent.change(screen.getByPlaceholderText("搜索地点"), {
			target: { value: "学生" },
		});

		expect(await screen.findByText("学生事务中心")).toBeInTheDocument();
		expect(screen.queryByText("图书馆与自习、借阅相关服务的主要位置。")).not.toBeInTheDocument();
	});

	it("renders the campus map as searchable campus and category workspace", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("heading", { name: "校园地图" })).toBeInTheDocument();
		expect(screen.getByRole("form", { name: "地点搜索" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "全部校区" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "海淀校区" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "丰台校区" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "建筑" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "服务" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "交通" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "地标" })).toBeNull();
		expect(screen.getByRole("button", { name: "选择图书馆" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择学生事务中心" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "选择丰台东门" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "校园地图画布" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "询问这个地点" })).toHaveAttribute(
			"href",
			"/?prompt=%E8%AF%B7%E4%BB%8B%E7%BB%8D%E4%B8%80%E4%B8%8B%E3%80%8C%E5%9B%BE%E4%B9%A6%E9%A6%86%E3%80%8D%E5%9C%A8%E5%93%AA%E9%87%8C%E3%80%82",
		);
		expect(screen.getByRole("link", { name: "反馈地点信息" })).toHaveAttribute(
			"href",
			"/feedback?source=map&placeId=library",
		);
		await waitFor(() => expect(maplibreRuntimeMock.loadMapLibre).toHaveBeenCalled());
	});

	it("syncs campus map selection between list, marker, details, and flyTo", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "选择图书馆" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await waitFor(() => expect(maplibreRuntimeMock.markerElements).toHaveLength(3));
		expect(maplibreRuntimeMock.markerElements[0]?.dataset.selected).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: "选择丰台东门" }));

		expect(screen.getByRole("button", { name: "选择丰台东门" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByText("从东门进入后沿主路步行约 3 分钟。")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "反馈地点信息" })).toHaveAttribute(
			"href",
			"/feedback?source=map&placeId=fengtai-east-gate",
		);
		expect(maplibreRuntimeMock.flyTo).toHaveBeenLastCalledWith({
			center: [116.289, 39.837],
			zoom: 17,
		});

		fireEvent.click(maplibreRuntimeMock.markerElements[1] as HTMLElement);

		expect(screen.getByRole("button", { name: "选择学生事务中心" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(screen.getByRole("heading", { name: "学生事务中心" })).toBeInTheDocument();
	});

	it("filters campus map places by campus and category without synthetic places", async () => {
		render(<MapPage />);

		expect(await screen.findByRole("button", { name: "选择图书馆" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "丰台校区" }));

		expect(screen.queryByRole("button", { name: "选择图书馆" })).toBeNull();
		expect(screen.getByRole("button", { name: "选择丰台东门" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "建筑" }));

		expect(screen.getByText("没有找到匹配地点。")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "选择图书馆" })).toBeNull();
		expect(screen.queryByRole("button", { name: "选择丰台东门" })).toBeNull();
	});

	it("does not match campus map search against internal source references", async () => {
		render(<MapPage />);

		expect(await screen.findByText("图书馆")).toBeInTheDocument();
		fireEvent.change(screen.getByPlaceholderText("搜索地点"), {
			target: { value: "projection" },
		});

		expect(await screen.findByText("没有找到匹配地点。")).toBeInTheDocument();
		expect(screen.queryByText("图书馆与自习、借阅相关服务的主要位置。")).not.toBeInTheDocument();
		expect(screen.queryByText("学生事务相关位置。")).not.toBeInTheDocument();
	});

	it("does not match campus map search against derived category labels", async () => {
		render(<MapPage />);

		expect(await screen.findByText("图书馆")).toBeInTheDocument();
		fireEvent.change(screen.getByPlaceholderText("搜索地点"), {
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
