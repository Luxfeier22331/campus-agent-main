import type { DiningMapResponse, DiningWindowMenuResponse } from "@campus-agent/dining/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { DiningPageView } from "@/components/dining/dining-page-view";
import type { DiningFloorResponse, DiningSearchResult } from "@/features/dining/model";
import { diningQueryKeys } from "@/features/dining/queries";
import type { StyleDevStory } from "../contracts";

const FLOORPLAN_SHA = `sha256:${"a".repeat(64)}` as const;

const DINING_MAP: DiningMapResponse = {
	halls: [
		{
			campus: "海淀校区",
			floors: [
				{
					floorId: "haidian-1f",
					floorplan: {
						canvas: { height: 360, width: 640 },
						floorplanId: "floorplan:haidian:1f",
						sha256: FLOORPLAN_SHA,
						svgAssetUrl: `/api/dining/floorplans/${"a".repeat(64)}.svg`,
					},
					label: "海淀一层",
					windows: [
						{ name: "兰州拉面", svgAnchorId: "haidian-1f-window-1", windowId: "window-1" },
						{ name: "桂林米粉", svgAnchorId: "haidian-1f-window-2", windowId: "window-2" },
					],
				},
			],
			hallId: "haidian",
			name: "海淀一食堂",
		},
		{
			campus: "丰台校区",
			floors: [
				{
					floorId: "fengtai-1f",
					floorplan: {
						canvas: { height: 360, width: 640 },
						floorplanId: "floorplan:fengtai:1f",
						sha256: FLOORPLAN_SHA,
						svgAssetUrl: `/api/dining/floorplans/${"a".repeat(64)}.svg`,
					},
					label: "荟贤一层",
					windows: [{ name: "清真风味", svgAnchorId: "fengtai-1f-window-1", windowId: "window-3" }],
				},
				{
					floorId: "fengtai-2f",
					floorplan: {
						canvas: { height: 360, width: 640 },
						floorplanId: "floorplan:fengtai:2f",
						sha256: FLOORPLAN_SHA,
						svgAssetUrl: `/api/dining/floorplans/${"a".repeat(64)}.svg`,
					},
					label: "荟贤二层",
					windows: [{ name: "风味小炒", svgAnchorId: "fengtai-2f-window-1", windowId: "window-4" }],
				},
			],
			hallId: "fengtai",
			name: "荟贤食堂",
		},
	],
	releaseId: "style-dev-dining",
	updatedAt: "2026-08-20T09:30:00+08:00",
};

const MENUS: Record<string, DiningWindowMenuResponse> = {
	"window-1": {
		items: [
			{ menuItemId: "beef-noodles", name: "牛肉拉面", priceText: "¥15", sortOrder: 0 },
			{ menuItemId: "tomato-noodles", name: "番茄鸡蛋面", priceText: "¥13", sortOrder: 1 },
		],
		windowId: "window-1",
	},
	"window-2": { items: [], windowId: "window-2" },
	"window-3": { items: [], windowId: "window-3" },
	"window-4": { items: [], windowId: "window-4" },
};

const SEARCH_RESULTS: DiningSearchResult[] = DINING_MAP.halls.flatMap((hall) =>
	hall.floors.flatMap((floor) =>
		floor.windows.map((window) => ({
			campus: hall.campus,
			floorId: floor.floorId,
			floorLabel: floor.label,
			hallId: hall.hallId,
			hallName: hall.name,
			windowId: window.windowId,
			windowName: window.name,
		})),
	),
);

function createDiningQueryClient(): QueryClient {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	for (const [windowId, menu] of Object.entries(MENUS)) {
		client.setQueryData(diningQueryKeys.menu(windowId), menu);
	}
	for (const hall of DINING_MAP.halls) {
		for (const floor of hall.floors) {
			client.setQueryData(
				diningQueryKeys.floorplan(floor.floorplan.svgAssetUrl),
				renderFloorplan(floor.windows.map((window) => window.svgAnchorId)),
			);
		}
	}
	return client;
}

function renderFloorplan(anchorIds: string[]): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">${anchorIds
		.map(
			(anchorId, index) =>
				`<g data-dining-anchor-id="${anchorId}"><rect data-dining-anchor-hit="true" x="${48 + index * 220}" y="92" width="170" height="96" rx="12"/><text data-dining-anchor-number="true">${index + 1}</text></g>`,
		)
		.join("")}</svg>`;
}

function DiningPageExample({ mode }: { mode: "empty" | "error" | "loading" | "ready" }) {
	const [selectedHallId, setSelectedHallId] = useState(DINING_MAP.halls[0]?.hallId ?? "");
	const selectedHall =
		DINING_MAP.halls.find((hall) => hall.hallId === selectedHallId) ?? DINING_MAP.halls[0] ?? null;
	const [selectedFloorId, setSelectedFloorId] = useState(selectedHall?.floors[0]?.floorId ?? "");
	const selectedFloor =
		selectedHall?.floors.find((floor) => floor.floorId === selectedFloorId) ??
		selectedHall?.floors[0] ??
		null;
	const [query, setQuery] = useState("");
	const [selectedWindowId, setSelectedWindowId] = useState<string | null>(
		mode === "empty" ? null : "window-1",
	);
	const [selectedMenuItemId, setSelectedMenuItemId] = useState<string | null>(null);
	const selectedWindow =
		selectedFloor?.windows.find((window) => window.windowId === selectedWindowId) ?? null;
	const activeFloor: DiningFloorResponse | null =
		selectedHall && selectedFloor
			? {
					floor: { ...selectedFloor, hallId: selectedHall.hallId },
					windows: selectedFloor.windows,
				}
			: null;
	const searchResults = query.trim()
		? SEARCH_RESULTS.filter((result) =>
				result.windowName
					.toLocaleLowerCase("zh-CN")
					.includes(query.trim().toLocaleLowerCase("zh-CN")),
			)
		: [];
	const matchedWindowIds = query.trim()
		? new Set(
				searchResults
					.filter((result) => result.floorId === selectedFloor?.floorId)
					.map((result) => result.windowId),
			)
		: null;
	const mapRef = useRef<HTMLElement>(null);
	const queryClient = useMemo(createDiningQueryClient, []);

	return (
		<QueryClientProvider client={queryClient}>
			<div className="style-dev-dining-page-example">
				<DiningPageView
					activeFloor={activeFloor}
					data={mode === "loading" || mode === "error" ? null : DINING_MAP}
					mapRef={mapRef}
					isError={mode === "error"}
					isPending={mode === "loading"}
					matchedWindowIds={matchedWindowIds}
					onClearWindow={() => setSelectedWindowId(null)}
					onQueryChange={setQuery}
					onRetry={() => undefined}
					onSelectFloor={(floorId) => {
						setSelectedFloorId(floorId);
						setSelectedWindowId(null);
					}}
					onSelectHall={(hall) => {
						setSelectedHallId(hall.hallId);
						setSelectedFloorId(hall.floors[0]?.floorId ?? "");
						setSelectedWindowId(null);
					}}
					onSelectMenuItem={setSelectedMenuItemId}
					onSelectResult={(result) => {
						setSelectedHallId(result.hallId);
						setSelectedFloorId(result.floorId);
						setSelectedWindowId(result.windowId);
					}}
					onSelectWindow={setSelectedWindowId}
					query={query}
					searchResults={searchResults}
					selectedFloor={selectedFloor}
					selectedHall={selectedHall}
					selectedMenuItemId={selectedMenuItemId}
					selectedWindow={selectedWindow}
				/>
			</div>
		</QueryClientProvider>
	);
}

export const DINING_ENTRIES: readonly StyleDevStory[] = [
	{
		defaultVariant: "ready",
		variants: [
			{ id: "ready", label: "页面", render: () => <DiningPageExample mode="ready" /> },
			{ id: "empty", label: "未选窗口", render: () => <DiningPageExample mode="empty" /> },
			{ id: "loading", label: "加载", render: () => <DiningPageExample mode="loading" /> },
			{ id: "error", label: "失败", render: () => <DiningPageExample mode="error" /> },
		],
		group: "食堂",
		id: "style-dev-dining-page",
		title: "食堂页面",
	},
];
