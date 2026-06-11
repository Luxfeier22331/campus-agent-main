import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SvgFloorplanWorkspace } from "../../components/dining/svg-floorplan-workspace";
import {
	assignDiningWindow,
	createDiningMenuItem,
	createDiningMenuOffering,
	getDiningOpsFloor,
	getDiningOpsHalls,
	updateDiningMenuItem,
	updateDiningMenuOffering,
	updateDiningWindow,
} from "../../features/dining/api";
import type {
	DiningMenuItem,
	DiningMenuOffering,
	DiningOpsFloorResponse,
	DiningWindow,
} from "../../features/dining/model";

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
					<SvgFloorplanWorkspace
						onSelectWindow={setSelectedWindowId}
						selectedWindowId={selectedWindowId}
						svgAssetUrl={floorQuery.data.floor.svgAssetUrl}
						svgMarkup={floorQuery.data.floor.svgMarkup}
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
		const offerings = assignment
			? input.floor.menuOfferings
					.filter((item) => item.assignmentId === assignment.assignmentId)
					.map((offering) => ({
						menu:
							input.floor?.menuItems.find((item) => item.menuItemId === offering.menuItemId) ??
							null,
						offering,
					}))
			: [];
		return { assignment, offerings, stall };
	}, [input.floor, input.selectedWindow]);
	const [windowLabel, setWindowLabel] = useState("");
	const [locationLabel, setLocationLabel] = useState("");
	const [windowStatus, setWindowStatus] = useState<DiningWindow["status"]>("active");
	const [stallName, setStallName] = useState("");
	const [stallType, setStallType] = useState("food_window");
	const [offeringDrafts, setOfferingDrafts] = useState<OfferingDraft[]>([]);
	const [draftValidationError, setDraftValidationError] = useState<string | null>(null);

	useEffect(() => {
		setWindowLabel(input.selectedWindow?.label ?? "");
		setLocationLabel(input.selectedWindow?.locationLabel ?? "");
		setWindowStatus(input.selectedWindow?.status ?? "active");
		setStallName(current?.stall?.displayName ?? input.selectedWindow?.label ?? "");
		setStallType(current?.stall?.stallType ?? "food_window");
		setOfferingDrafts(
			current?.offerings.map(({ menu, offering }) => toOfferingDraft(offering, menu)) ?? [],
		);
		setDraftValidationError(null);
	}, [current, input.selectedWindow]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			if (!input.selectedWindowId) {
				throw new Error("window is required");
			}
			const validationError = validateOfferingDrafts(offeringDrafts);
			if (validationError) {
				setDraftValidationError(validationError);
				throw new Error(validationError);
			}
			setDraftValidationError(null);
			await updateDiningWindow({
				label: windowLabel,
				locationLabel,
				status: windowStatus,
				tags: input.selectedWindow?.tags ?? [],
				windowId: input.selectedWindowId,
			});
			const assignment = await assignDiningWindow({
				stallProfile: {
					displayName: stallName,
					stallType,
					tags: current?.stall?.tags ?? input.selectedWindow?.tags ?? [],
				},
				windowId: input.selectedWindowId,
			});
			for (const draft of offeringDrafts.filter((item) => item.name.trim())) {
				const menuItem = draft.menuItemId
					? await updateDiningMenuItem({
							menuItemId: draft.menuItemId,
							name: draft.name,
							tags: draft.tags,
						})
					: await createDiningMenuItem({
							name: draft.name,
							tags: draft.tags,
						});
				if (draft.offeringId) {
					await updateDiningMenuOffering({
						offeringId: draft.offeringId,
						priceLabel: draft.priceLabel,
						saleStatus: draft.saleStatus,
						specLabel: draft.specLabel || null,
					});
				} else {
					await createDiningMenuOffering({
						assignmentId: assignment.assignment.assignmentId,
						menuItemId: menuItem.menuItem.menuItemId,
						priceLabel: draft.priceLabel,
						saleStatus: draft.saleStatus,
						specLabel: draft.specLabel || null,
					});
				}
			}
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
						setDraftValidationError(null);
						saveMutation.mutate();
					}}
				>
					<div>
						<p className="text-xs text-zinc-500">{input.selectedWindow.locationLabel}</p>
						<p className="font-medium text-sm">{input.selectedWindow.windowId}</p>
					</div>
					<label className="ops-field">
						<span>窗口名称</span>
						<input value={windowLabel} onChange={(event) => setWindowLabel(event.target.value)} />
					</label>
					<label className="ops-field">
						<span>窗口位置</span>
						<input
							value={locationLabel}
							onChange={(event) => setLocationLabel(event.target.value)}
						/>
					</label>
					<label className="ops-field">
						<span>窗口状态</span>
						<select
							value={windowStatus}
							onChange={(event) => setWindowStatus(event.target.value as DiningWindow["status"])}
						>
							<option value="active">active</option>
							<option value="closed">closed</option>
							<option value="maintenance">maintenance</option>
						</select>
					</label>
					<label className="ops-field">
						<span>档口名称</span>
						<input value={stallName} onChange={(event) => setStallName(event.target.value)} />
					</label>
					<label className="ops-field">
						<span>档口类型</span>
						<input value={stallType} onChange={(event) => setStallType(event.target.value)} />
					</label>
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<p className="font-semibold text-sm">菜品价格</p>
							<button
								className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
								onClick={() => setOfferingDrafts((items) => [...items, createEmptyOfferingDraft()])}
								type="button"
							>
								新增菜品
							</button>
						</div>
						{offeringDrafts.map((draft) => (
							<div className="rounded-lg border border-zinc-200 p-3" key={draft.key}>
								<label className="ops-field">
									<span>菜品名称</span>
									<input
										aria-label={`菜品名称 ${draft.offeringId || draft.key}`}
										value={draft.name}
										onChange={(event) =>
											setOfferingDrafts((items) =>
												updateOfferingDraft(items, draft.key, { name: event.target.value }),
											)
										}
									/>
								</label>
								<div className="mt-3 grid gap-3 sm:grid-cols-2">
									<label className="ops-field">
										<span>价格</span>
										<input
											aria-label={`价格 ${draft.offeringId || draft.key}`}
											value={draft.priceLabel}
											onChange={(event) =>
												setOfferingDrafts((items) =>
													updateOfferingDraft(items, draft.key, { priceLabel: event.target.value }),
												)
											}
										/>
									</label>
									<label className="ops-field">
										<span>规格</span>
										<input
											value={draft.specLabel}
											onChange={(event) =>
												setOfferingDrafts((items) =>
													updateOfferingDraft(items, draft.key, { specLabel: event.target.value }),
												)
											}
										/>
									</label>
									<label className="ops-field sm:col-span-2">
										<span>售卖状态</span>
										<select
											aria-label={`售卖状态 ${draft.offeringId || draft.key}`}
											value={draft.saleStatus}
											onChange={(event) =>
												setOfferingDrafts((items) =>
													updateOfferingDraft(items, draft.key, {
														saleStatus: event.target.value as OfferingDraft["saleStatus"],
													}),
												)
											}
										>
											<option value="available">available</option>
											<option value="paused">paused</option>
											<option value="seasonal">seasonal</option>
											<option value="removed">removed</option>
										</select>
									</label>
								</div>
							</div>
						))}
					</div>
					<button className="ops-primary-button" disabled={saveMutation.isPending} type="submit">
						<Save aria-hidden="true" className="size-4" />
						保存草稿
					</button>
					{draftValidationError ? (
						<p className="text-red-600 text-sm">{draftValidationError}</p>
					) : null}
					{saveMutation.isError && !draftValidationError ? (
						<p className="text-red-600 text-sm">保存失败</p>
					) : null}
					{saveMutation.isSuccess ? <p className="text-emerald-700 text-sm">草稿已保存</p> : null}
				</form>
			) : (
				<p className="mt-4 text-sm text-zinc-500">选择窗口后编辑档口与菜品。</p>
			)}
		</aside>
	);
}

interface OfferingDraft {
	key: string;
	menuItemId: string | null;
	name: string;
	offeringId: string | null;
	priceLabel: string;
	saleStatus: DiningMenuOffering["saleStatus"];
	specLabel: string;
	tags: string[];
}

function toOfferingDraft(offering: DiningMenuOffering, menu: DiningMenuItem | null): OfferingDraft {
	return {
		key: offering.offeringId,
		menuItemId: offering.menuItemId,
		name: menu?.name ?? "",
		offeringId: offering.offeringId,
		priceLabel: offering.priceLabel,
		saleStatus: offering.saleStatus,
		specLabel: offering.specLabel ?? "",
		tags: menu?.tags ?? [],
	};
}

function createEmptyOfferingDraft(): OfferingDraft {
	return {
		key: `new:${crypto.randomUUID()}`,
		menuItemId: null,
		name: "",
		offeringId: null,
		priceLabel: "",
		saleStatus: "available",
		specLabel: "",
		tags: [],
	};
}

function updateOfferingDraft(
	items: OfferingDraft[],
	key: string,
	patch: Partial<OfferingDraft>,
): OfferingDraft[] {
	return items.map((item) => (item.key === key ? { ...item, ...patch } : item));
}

function validateOfferingDrafts(items: OfferingDraft[]): string | null {
	for (const item of items) {
		if (!(item.name.trim() && item.priceLabel.trim())) {
			return "菜品名称和价格不能为空。";
		}
	}
	return null;
}
