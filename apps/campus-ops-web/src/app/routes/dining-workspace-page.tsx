import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FloorplanCanvas } from "../../components/dining/floorplan-canvas";
import {
	assignDiningWindow,
	createDiningMenuItem,
	createDiningMenuOffering,
	getDiningOpsFloor,
	getDiningOpsHalls,
	updateDiningMenuItem,
	updateDiningMenuOffering,
} from "../../features/dining/api";
import type { DiningOpsFloorResponse, DiningWindow } from "../../features/dining/model";

export function DiningWorkspacePage() {
	const params = useParams({ strict: false }) as Partial<{ floorId: string; hallId: string }>;
	const hallsQuery = useQuery({
		queryFn: getDiningOpsHalls,
		queryKey: ["dining-ops", "halls"],
	});
	const firstHall = hallsQuery.data?.halls[0] ?? null;
	const activeHallId = params.hallId ?? firstHall?.hallId ?? "";
	const activeFloorId =
		params.floorId ??
		hallsQuery.data?.halls.find((hall) => hall.hallId === activeHallId)?.floors[0]?.floorId ??
		"";
	const floorQuery = useQuery({
		enabled: Boolean(activeHallId && activeFloorId),
		queryFn: () => getDiningOpsFloor({ floorId: activeFloorId, hallId: activeHallId }),
		queryKey: ["dining-ops", "floor", activeHallId, activeFloorId],
	});
	const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null);

	useEffect(() => {
		if (!selectedWindowId && floorQuery.data?.windows[0]) {
			setSelectedWindowId(floorQuery.data.windows[0].windowId);
		}
	}, [floorQuery.data, selectedWindowId]);

	const selectedWindow =
		floorQuery.data?.windows.find((window) => window.windowId === selectedWindowId) ?? null;

	return (
		<section className="grid gap-6 xl:grid-cols-[260px_1fr_340px]">
			<aside className="ops-panel p-4">
				<p className="ops-eyebrow">Dining Tree</p>
				<h2 className="mb-4 font-semibold text-lg">食堂楼层</h2>
				{hallsQuery.isLoading ? <p className="ops-muted">加载中</p> : null}
				<div className="space-y-4">
					{hallsQuery.data?.halls.map((hall) => (
						<div key={hall.hallId}>
							<p className="font-medium text-sm">{hall.name}</p>
							<p className="mb-2 text-xs text-zinc-500">{hall.campus}</p>
							<div className="grid gap-1">
								{hall.floors.map((floor) => (
									<Link
										className="rounded-md px-2 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
										key={floor.floorId}
										to="/dining/$hallId/$floorId"
										params={{ floorId: floor.floorId, hallId: hall.hallId }}
									>
										{floor.label}
									</Link>
								))}
							</div>
						</div>
					))}
				</div>
			</aside>
			<div className="ops-panel p-4">
				<div className="mb-4 flex items-center justify-between">
					<div>
						<p className="ops-eyebrow">Floor Draft</p>
						<h2 className="font-semibold text-lg">{floorQuery.data?.floor.label ?? "食堂楼层"}</h2>
					</div>
					<span className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-500">
						draft
					</span>
				</div>
				{floorQuery.data ? (
					<FloorplanCanvas
						onSelectWindow={setSelectedWindowId}
						selectedWindowId={selectedWindowId}
						windows={floorQuery.data.windows}
					/>
				) : (
					<div className="flex min-h-[420px] items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
						选择一个食堂楼层
					</div>
				)}
			</div>
			<WindowEditor
				floor={floorQuery.data ?? null}
				selectedWindow={selectedWindow}
				selectedWindowId={selectedWindowId}
			/>
		</section>
	);
}

function WindowEditor(input: {
	floor: DiningOpsFloorResponse | null;
	selectedWindow: DiningWindow | null;
	selectedWindowId: string | null;
}) {
	const queryClient = useQueryClient();
	const current = useMemo(() => {
		if (!(input.floor && input.selectedWindow)) {
			return null;
		}
		const assignment = input.floor.assignments.find(
			(item) => item.windowId === input.selectedWindow?.windowId,
		);
		const stall = assignment
			? input.floor.stallProfiles.find((item) => item.stallProfileId === assignment.stallProfileId)
			: null;
		const offering = assignment
			? input.floor.menuOfferings.find((item) => item.assignmentId === assignment.assignmentId)
			: null;
		const menu = offering
			? input.floor.menuItems.find((item) => item.menuItemId === offering.menuItemId)
			: null;
		return { assignment, menu, offering, stall };
	}, [input.floor, input.selectedWindow]);
	const [stallName, setStallName] = useState("");
	const [menuName, setMenuName] = useState("");
	const [priceLabel, setPriceLabel] = useState("");

	useEffect(() => {
		setStallName(current?.stall?.displayName ?? input.selectedWindow?.label ?? "");
		setMenuName(current?.menu?.name ?? "");
		setPriceLabel(current?.offering?.priceLabel ?? "");
	}, [current, input.selectedWindow]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			if (!input.selectedWindowId) {
				throw new Error("window is required");
			}
			const assignment = await assignDiningWindow({
				stallProfile: {
					displayName: stallName,
					stallType: current?.stall?.stallType ?? "food_window",
					tags: current?.stall?.tags ?? input.selectedWindow?.tags ?? [],
				},
				windowId: input.selectedWindowId,
			});
			const menuItem = current?.menu
				? await updateDiningMenuItem({
						menuItemId: current.menu.menuItemId,
						name: menuName,
						tags: current.menu.tags,
					})
				: await createDiningMenuItem({
						name: menuName,
						tags: [],
					});
			if (current?.offering) {
				await updateDiningMenuOffering({
					offeringId: current.offering.offeringId,
					priceLabel,
					saleStatus: "available",
					specLabel: current.offering.specLabel,
				});
				return;
			}
			await createDiningMenuOffering({
				assignmentId: assignment.assignment.assignmentId,
				menuItemId: menuItem.menuItem.menuItemId,
				priceLabel,
				saleStatus: "available",
				specLabel: null,
			});
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["dining-ops", "floor"] });
		},
	});

	return (
		<aside className="ops-panel p-4">
			<p className="ops-eyebrow">Window Detail</p>
			<h2 className="font-semibold text-lg">窗口详情</h2>
			{input.selectedWindow ? (
				<form
					className="mt-4 space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						saveMutation.mutate();
					}}
				>
					<div>
						<p className="text-xs text-zinc-500">{input.selectedWindow.locationLabel}</p>
						<p className="font-medium text-sm">{input.selectedWindow.windowId}</p>
					</div>
					<label className="ops-field">
						<span>档口名称</span>
						<input value={stallName} onChange={(event) => setStallName(event.target.value)} />
					</label>
					<label className="ops-field">
						<span>菜品名称</span>
						<input value={menuName} onChange={(event) => setMenuName(event.target.value)} />
					</label>
					<label className="ops-field">
						<span>价格</span>
						<input value={priceLabel} onChange={(event) => setPriceLabel(event.target.value)} />
					</label>
					<button className="ops-primary-button" disabled={saveMutation.isPending} type="submit">
						<Save aria-hidden="true" className="size-4" />
						保存草稿
					</button>
					{saveMutation.isError ? <p className="text-red-600 text-sm">保存失败</p> : null}
					{saveMutation.isSuccess ? <p className="text-emerald-700 text-sm">草稿已保存</p> : null}
				</form>
			) : (
				<p className="mt-4 text-sm text-zinc-500">选择窗口后编辑档口与菜品。</p>
			)}
		</aside>
	);
}
