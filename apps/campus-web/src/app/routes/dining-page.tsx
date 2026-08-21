import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { DiningPageView } from "@/components/dining/dining-page-view";
import type {
	DiningFloorResponse,
	DiningHallSummary,
	DiningSearchResult,
} from "@/features/dining/model";
import { diningMapQueryOptions } from "@/features/dining/queries";
import { diningQueryClient } from "@/features/dining/query-client";

export function DiningPage() {
	return (
		<QueryClientProvider client={diningQueryClient}>
			<DiningPageContent />
		</QueryClientProvider>
	);
}

export function DiningPageContent() {
	const navigate = useNavigate({ from: "/dining" });
	const routeSearch = useSearch({ from: "/dining" });
	const detailRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const dining = useQuery(diningMapQueryOptions());
	const halls = dining.data?.halls ?? [];
	const selectedHall = halls.find((hall) => hall.hallId === routeSearch.hall) ?? halls[0] ?? null;
	const selectedFloor =
		selectedHall?.floors.find((floor) => floor.floorId === routeSearch.floor) ??
		selectedHall?.floors[0] ??
		null;
	const selectedWindow =
		selectedFloor?.windows.find((window) => window.windowId === routeSearch.window) ?? null;
	const activeFloor: DiningFloorResponse | null =
		selectedHall && selectedFloor
			? {
					floor: { ...selectedFloor, hallId: selectedHall.hallId },
					windows: selectedFloor.windows,
				}
			: null;
	const searchResults = useMemo(
		() => searchDiningWindows(selectedHall, query),
		[query, selectedHall],
	);
	const matchedWindowIds = useMemo(() => {
		if (!(query.trim() && selectedFloor)) {
			return null;
		}
		return new Set(
			searchResults
				.filter((result) => result.floorId === selectedFloor.floorId)
				.map((result) => result.windowId),
		);
	}, [query, searchResults, selectedFloor]);

	useEffect(() => {
		if (!(selectedHall && selectedFloor)) {
			return;
		}
		if (
			routeSearch.hall !== selectedHall.hallId ||
			routeSearch.floor !== selectedFloor.floorId ||
			(routeSearch.window && !selectedWindow)
		) {
			void navigate({
				replace: true,
				search: {
					floor: selectedFloor.floorId,
					hall: selectedHall.hallId,
					item: selectedWindow ? routeSearch.item : undefined,
					window: selectedWindow?.windowId,
				},
			});
		}
	}, [
		navigate,
		routeSearch.floor,
		routeSearch.hall,
		routeSearch.item,
		routeSearch.window,
		selectedFloor,
		selectedHall,
		selectedWindow,
	]);

	function selectHall(hall: DiningHallSummary): void {
		const floor = hall.floors[0];
		void navigate({
			search: { floor: floor?.floorId, hall: hall.hallId, item: undefined, window: undefined },
		});
	}

	function selectFloor(floorId: string): void {
		if (!selectedHall) {
			return;
		}
		void navigate({
			search: { floor: floorId, hall: selectedHall.hallId, item: undefined, window: undefined },
		});
	}

	function selectWindow(windowId: string): void {
		if (!(selectedHall && selectedFloor)) {
			return;
		}
		void navigate({
			search: {
				floor: selectedFloor.floorId,
				hall: selectedHall.hallId,
				item: undefined,
				window: windowId,
			},
		});
		if (window.matchMedia("(max-width: 1023px)").matches) {
			window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start" }));
		}
	}

	function selectSearchResult(result: DiningSearchResult): void {
		void navigate({
			search: {
				floor: result.floorId,
				hall: result.hallId,
				item: undefined,
				window: result.windowId,
			},
		});
	}

	return (
		<DiningPageView
			activeFloor={activeFloor}
			data={dining.data ?? null}
			detailRef={detailRef}
			isError={dining.isError}
			isPending={dining.isPending}
			matchedWindowIds={matchedWindowIds}
			onQueryChange={setQuery}
			onRetry={() => void dining.refetch()}
			onSelectFloor={selectFloor}
			onSelectHall={selectHall}
			onSelectMenuItem={(item) =>
				void navigate({
					search: {
						floor: selectedFloor?.floorId,
						hall: selectedHall?.hallId,
						item: item ?? undefined,
						window: selectedWindow?.windowId,
					},
				})
			}
			onSelectResult={selectSearchResult}
			onSelectWindow={selectWindow}
			query={query}
			searchResults={searchResults}
			selectedFloor={selectedFloor}
			selectedHall={selectedHall}
			selectedMenuItemId={routeSearch.item ?? null}
			selectedWindow={selectedWindow}
		/>
	);
}

export function searchDiningWindows(
	hall: DiningHallSummary | null,
	query: string,
): DiningSearchResult[] {
	const normalized = query.trim().toLocaleLowerCase("zh-CN");
	if (!(hall && normalized)) {
		return [];
	}
	return hall.floors.flatMap((floor) =>
		floor.windows.flatMap((window) =>
			window.name.toLocaleLowerCase("zh-CN").includes(normalized)
				? [
						{
							campus: hall.campus,
							floorId: floor.floorId,
							floorLabel: floor.label,
							hallId: hall.hallId,
							hallName: hall.name,
							windowId: window.windowId,
							windowName: window.name,
						},
					]
				: [],
		),
	);
}
