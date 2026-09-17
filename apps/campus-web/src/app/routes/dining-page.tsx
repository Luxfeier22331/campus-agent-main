import { Button } from "@campus-agent/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { DiningMySubmissions } from "@/components/dining/dining-my-submissions";
import { DiningPageView } from "@/components/dining/dining-page-view";
import { DiningSubmissionExitProvider } from "@/components/dining/dining-submission-exit";
import { DiningSubmissionSheet } from "@/components/dining/dining-submission-sheet";
import { DiningWindowSubmissions } from "@/components/dining/dining-window-submissions";
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
		if (routeSearch.mine || routeSearch.submission || !(selectedHall && selectedFloor)) {
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

	function openSubmission(submissionId: string, own = false) {
		void navigate({
			search: {
				...routeSearch,
				item: undefined,
				submission: submissionId,
				mine: own ? "1" : undefined,
			},
		});
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
	return (
		<>
			{routeSearch.mine ? (
				<section className="mx-auto max-w-[var(--layout-page-form-width)] px-4 py-6 pb-28">
					<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
						<h1 className="ui-page-title">我的投稿</h1>
						<Button asChild variant="outline">
							<a data-dining-home href="/dining">
								返回食堂地图
							</a>
						</Button>
					</div>
					<DiningMySubmissions
						onOpenSubmission={(submission) => openSubmission(submission.submissionId, true)}
					/>
				</section>
			) : (
				<DiningPageView
					headerActions={
						<Button asChild variant="outline">
							<a
								data-dining-home
								href="/dining?mine=1"
								onClick={(event) => {
									if (!(event.ctrlKey || event.metaKey || event.shiftKey) && event.button === 0) {
										event.preventDefault();
										void navigate({ search: { mine: "1" } });
									}
								}}
							>
								我的投稿
							</a>
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
			)}
			{routeSearch.submission ? (
				<DiningSubmissionSheet
					key={`${Boolean(routeSearch.mine)}:${routeSearch.submission}`}
					submissionId={routeSearch.submission}
					own={Boolean(routeSearch.mine)}
					windowName={windowName}
					onClose={() => void navigate({ search: { ...routeSearch, submission: undefined } })}
				/>
			) : null}
		</>
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
