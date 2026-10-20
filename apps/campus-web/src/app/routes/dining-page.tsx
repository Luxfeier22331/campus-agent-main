import { Button } from "@campus-agent/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiningMapViewport } from "@/components/dining/dining-map-interaction";
import { DiningMySubmissions } from "@/components/dining/dining-my-submissions";
import { DiningPageView } from "@/components/dining/dining-page-view";
import { DiningSubmissionExitProvider } from "@/components/dining/dining-submission-exit";
import { DiningSubmissionSheet } from "@/components/dining/dining-submission-sheet";
import { DiningWindowSubmissions } from "@/components/dining/dining-window-submissions";
import { FeedbackSheet } from "@/components/feedback/feedback-sheet";
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
			<DiningSubmissionExitProvider>
				<DiningPageContent />
			</DiningSubmissionExitProvider>
		</QueryClientProvider>
	);
}

export function DiningPageContent() {
	const navigate = useNavigate({ from: "/dining" });
	const routeSearch = useSearch({ from: "/dining" });
	const mapRef = useRef<HTMLElement>(null);
	const router = useRouter();
	const mapViewport = useRef<DiningMapViewport | undefined>(undefined);
	const mapScroll = useRef(0);
	const restoreMap = useRef(false);
	const wasMine = useRef(Boolean(routeSearch.mine));
	const selectionSequence = useRef(0);
	const [selectionIntent, setSelectionIntent] = useState<{
		windowId: string;
		sequence: number;
	} | null>(null);
	const detailSource = useRef<{ index: number; submissionId: string } | null>(null);
	const onViewportChange = useCallback((viewport: DiningMapViewport) => {
		mapViewport.current = viewport;
	}, []);
	const onMapReady = useCallback(() => {
		if (restoreMap.current) {
			restoreMap.current = false;
			window.scrollTo({ top: mapScroll.current, behavior: "instant" });
		}
	}, []);
	useEffect(
		() =>
			router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
				if (
					fromLocation?.pathname === "/dining" &&
					!("mine" in fromLocation.search && fromLocation.search.mine) &&
					"mine" in toLocation.search &&
					toLocation.search.mine
				) {
					mapScroll.current = window.scrollY;
				}
			}),
		[router],
	);
	useLayoutEffect(() => {
		const mine = Boolean(routeSearch.mine);
		if (mine !== wasMine.current) {
			if (mine) {
				window.scrollTo({ top: 0, behavior: "instant" });
			} else {
				restoreMap.current = true;
			}
			wasMine.current = mine;
		}
	}, [routeSearch.mine]);
	useEffect(() => {
		if (!selectionIntent || selectionIntent.windowId !== routeSearch.window || routeSearch.mine) {
			return;
		}

		const frame = window.requestAnimationFrame(() => {
			setSelectionIntent(null);
			if (!window.matchMedia("(max-width: 1023px)").matches) {
				return;
			}
			// The detail panel floats over the lower part of the screen; keep the floorplan above it.
			const map = mapRef.current;
			const stage =
				map?.querySelector<HTMLElement>('[data-testid="dining-inline-floorplan"]') ?? map;
			if (!(map && stage)) {
				return;
			}
			const rect = stage.getBoundingClientRect();
			const top = Number.parseFloat(getComputedStyle(map).scrollMarginTop) || 80;
			if (rect.top >= top && rect.bottom <= window.innerHeight * 0.45) {
				return;
			}
			map.scrollIntoView({
				block: "start",
				behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
					? "instant"
					: "smooth",
			});
		});
		return () => window.cancelAnimationFrame(frame);
	}, [routeSearch.window, routeSearch.mine, selectionIntent]);
	const [query, setQuery] = useState("");
	const [storedHallId] = useState(readStoredDiningHall);
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	const dining = useQuery(diningMapQueryOptions());
	const halls = dining.data?.halls ?? [];
	const selectedHall =
		halls.find((hall) => hall.hallId === routeSearch.hall) ??
		halls.find((hall) => hall.hallId === storedHallId) ??
		halls[0] ??
		null;
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
		() => searchDiningWindows(halls, query, selectedHall?.hallId ?? null),
		[halls, query, selectedHall?.hallId],
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
		if (routeSearch.mine || routeSearch.submission || !(selectedHall && selectedFloor)) {
			return;
		}
		if (
			routeSearch.hall !== selectedHall.hallId ||
			routeSearch.floor !== selectedFloor.floorId ||
			(routeSearch.window && !selectedWindow)
		) {
			void navigate({
				resetScroll: false,
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
		routeSearch.mine,
		routeSearch.submission,
		routeSearch.floor,
		routeSearch.hall,
		routeSearch.item,
		routeSearch.window,
		selectedFloor,
		selectedHall,
		selectedWindow,
	]);

	function selectHall(hall: DiningHallSummary): void {
		writeStoredDiningHall(hall.hallId);
		const floor = hall.floors[0];
		void navigate({
			resetScroll: false,
			search: { floor: floor?.floorId, hall: hall.hallId, item: undefined, window: undefined },
		});
	}

	function selectFloor(floorId: string): void {
		if (!selectedHall) {
			return;
		}
		void navigate({
			resetScroll: false,
			search: { floor: floorId, hall: selectedHall.hallId, item: undefined, window: undefined },
		});
	}

	function selectWindow(windowId: string): void {
		if (!(selectedHall && selectedFloor)) {
			return;
		}
		selectSearchResult({
			hallId: selectedHall.hallId,
			floorId: selectedFloor.floorId,
			windowId,
		});
	}

	function selectSearchResult(
		result: Pick<DiningSearchResult, "hallId" | "floorId" | "windowId">,
	): void {
		const sequence = ++selectionSequence.current;
		writeStoredDiningHall(result.hallId);
		void navigate({
			resetScroll: false,
			search: {
				floor: result.floorId,
				hall: result.hallId,
				window: result.windowId,
			},
		}).then(() => {
			if (
				sequence === selectionSequence.current &&
				router.state.location.search.window === result.windowId
			) {
				setSelectionIntent({ windowId: result.windowId, sequence });
			}
		});
	}

	function openSubmission(submissionId: string, own = false) {
		detailSource.current =
			Boolean(routeSearch.mine) === own
				? { index: router.state.location.state.__TSR_index, submissionId }
				: null;
		void navigate({
			resetScroll: false,
			search: {
				...routeSearch,
				item: undefined,
				submission: submissionId,
				mine: own ? "1" : undefined,
			},
		});
	}
	function closeSubmission() {
		const source = detailSource.current;
		if (
			source &&
			source.submissionId === routeSearch.submission &&
			router.state.location.state.__TSR_index === source.index + 1
		) {
			router.history.back();
		} else {
			void navigate({
				resetScroll: false,
				replace: true,
				search: { ...routeSearch, submission: undefined },
			});
		}
	}
	function windowName(windowId: string) {
		for (const hall of halls) {
			for (const floor of hall.floors) {
				const window = floor.windows.find((item) => item.windowId === windowId);
				if (window) {
					return `${hall.name} · ${floor.label} · ${window.name}`;
				}
			}
		}
		return "原投稿窗口";
	}
	function feedbackLabel() {
		if (!selectedHall) {
			return "食堂地图";
		}
		const parts = ["食堂地图", selectedHall.name];
		if (selectedFloor) {
			parts.push(selectedFloor.label);
		}
		if (selectedWindow) {
			parts.push(selectedWindow.name);
		}
		return parts.join(" · ");
	}
	return (
		<>
			{routeSearch.mine ? (
				<section className="mx-auto max-w-[var(--layout-page-form-width)] px-4 py-6 pb-28">
					<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
						<h1 className="ui-page-title">我的投稿</h1>
						<Button asChild variant="secondary">
							<Link
								data-dining-home
								to="/dining"
								resetScroll={false}
								search={{ ...routeSearch, mine: undefined, submission: undefined }}
							>
								返回食堂地图
							</Link>
						</Button>
					</div>
					<DiningMySubmissions
						onOpenSubmission={(submission) => openSubmission(submission.submissionId, true)}
					/>
				</section>
			) : (
				<DiningPageView
					initialViewport={mapViewport.current}
					onViewportChange={onViewportChange}
					onMapReady={onMapReady}
					headerActions={
						<Button asChild variant="secondary">
							<Link
								data-dining-home
								to="/dining"
								resetScroll={false}
								search={{ ...routeSearch, mine: "1", submission: undefined }}
							>
								我的投稿
							</Link>
						</Button>
					}
					windowExtra={
						selectedWindow ? (
							<DiningWindowSubmissions
								key={selectedWindow.windowId}
								windowId={selectedWindow.windowId}
								windowName={selectedWindow.name}
								onOpen={(id) => openSubmission(id)}
								onSaved={(submission) => openSubmission(submission.submissionId, true)}
							/>
						) : null
					}
					activeFloor={activeFloor}
					data={dining.data ?? null}
					mapRef={mapRef}
					onClearWindow={() =>
						void navigate({
							resetScroll: false,
							search: {
								floor: selectedFloor?.floorId,
								hall: selectedHall?.hallId,
								item: undefined,
								window: undefined,
							},
						})
					}
					isError={dining.isError}
					isPending={dining.isPending}
					matchedWindowIds={matchedWindowIds}
					onOpenFeedback={() => setFeedbackOpen(true)}
					onQueryChange={setQuery}
					onRetry={() => void dining.refetch()}
					onSelectFloor={selectFloor}
					onSelectHall={selectHall}
					onSelectMenuItem={(item) =>
						void navigate({
							resetScroll: false,
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
			)}
			{routeSearch.submission ? (
				<DiningSubmissionSheet
					key={`${Boolean(routeSearch.mine)}:${routeSearch.submission}`}
					submissionId={routeSearch.submission}
					own={Boolean(routeSearch.mine)}
					windowName={windowName}
					onClose={closeSubmission}
				/>
			) : null}
			{feedbackOpen ? (
				<FeedbackSheet
					defaultCategory="dining_issue"
					onOpenChange={setFeedbackOpen}
					open={feedbackOpen}
					sourceLabel={feedbackLabel()}
				/>
			) : null}
		</>
	);
}

export function searchDiningWindows(
	halls: readonly DiningHallSummary[],
	query: string,
	currentHallId: string | null,
): DiningSearchResult[] {
	const normalized = query.trim().toLocaleLowerCase("zh-CN");
	if (!normalized) {
		return [];
	}
	// The current hall leads so its matches stay first; other halls keep map order.
	const ordered = [
		...halls.filter((hall) => hall.hallId === currentHallId),
		...halls.filter((hall) => hall.hallId !== currentHallId),
	];
	return ordered.flatMap((hall) =>
		hall.floors.flatMap((floor) =>
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
		),
	);
}

const DINING_HALL_STORAGE_KEY = "campus-dining-last-hall";

// Only the hall is remembered: a URL hall always wins, and a stale id falls back to the first hall.
function readStoredDiningHall(): string | null {
	try {
		return window.localStorage.getItem(DINING_HALL_STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeStoredDiningHall(hallId: string): void {
	try {
		window.localStorage.setItem(DINING_HALL_STORAGE_KEY, hallId);
	} catch {
		return;
	}
}
