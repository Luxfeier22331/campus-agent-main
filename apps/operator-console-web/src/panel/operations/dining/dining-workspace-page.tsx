import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDiningFloorplanByFloor } from "dining-floorplans";
import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type FieldErrors, useFieldArray, useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";
import { z } from "zod/v4";

import { type DiningSvgAnchor, SvgFloorplanWorkspace } from "./components/svg-floorplan-workspace";
import {
	assignDiningWindow,
	createDiningMenuItem,
	createDiningMenuOffering,
	getDiningOpsFloor,
	getDiningOpsHalls,
	updateDiningMenuItem,
	updateDiningMenuOffering,
	updateDiningWindow,
} from "./model/api";
import type {
	DiningMenuItem,
	DiningMenuOffering,
	DiningOpsFloorResponse,
	DiningWindow,
} from "./model/model";

const windowEditorSchema = z.object({
	locationLabel: z.string().trim().min(1, "餐饮点位置不能为空。"),
	offerings: z.array(
		z.object({
			key: z.string(),
			menuItemId: z.string().nullable(),
			name: z.string().trim().min(1, "菜品名称和价格不能为空。"),
			offeringId: z.string().nullable(),
			priceLabel: z.string().trim().min(1, "菜品名称和价格不能为空。"),
			saleStatus: z.enum(["available", "paused", "seasonal", "removed"]),
			specLabel: z.string(),
			tags: z.array(z.string()),
		}),
	),
	stallName: z.string().trim().min(1, "对外名称不能为空。"),
	stallType: z.string().trim().min(1, "餐饮类型不能为空。"),
	windowLabel: z.string().trim().min(1, "餐饮点名称不能为空。"),
	windowStatus: z.enum(["active", "closed", "maintenance"]),
});

type WindowEditorValues = z.infer<typeof windowEditorSchema>;
type OfferingDraft = WindowEditorValues["offerings"][number];

export function DiningWorkspacePage() {
	const params = useParams<"hallId" | "floorId">();
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
	const [selectedAnchor, setSelectedAnchor] = useState<DiningSvgAnchor | null>(null);

	useEffect(() => {
		if (!(selectedAnchor || selectedWindowId) && floorQuery.data?.windows[0]) {
			setSelectedWindowId(floorQuery.data.windows[0].windowId);
		}
	}, [floorQuery.data, selectedAnchor, selectedWindowId]);

	const selectedWindow =
		floorQuery.data?.windows.find((window) => window.windowId === selectedWindowId) ?? null;
	const selectedAnchorId = selectedAnchor?.anchorId ?? selectedWindow?.svgAnchorId ?? null;
	const floorplan = floorQuery.data ? resolveRepoFloorplan(floorQuery.data) : null;

	return (
		<section className="grid gap-6 xl:grid-cols-[260px_1fr_340px]">
			<aside className="ops-panel p-4">
				<p className="ops-eyebrow">食堂目录</p>
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
										to={`/operations/dining/${encodeURIComponent(hall.hallId)}/${encodeURIComponent(
											floor.floorId,
										)}`}
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
						<p className="ops-eyebrow">楼层草稿</p>
						<h2 className="font-semibold text-lg">{floorQuery.data?.floor.label ?? "食堂楼层"}</h2>
					</div>
					<span className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-500">
						草稿
					</span>
				</div>
				{floorQuery.data ? (
					<SvgFloorplanWorkspace
						floorId={floorQuery.data.floor.floorId}
						floorplan={floorQuery.data.floor.floorplan}
						onSelectAnchor={(anchor) => {
							setSelectedAnchor(anchor);
							if (!anchor.windowId) {
								setSelectedWindowId(null);
							}
						}}
						onSelectWindow={(windowId) => {
							setSelectedAnchor(null);
							setSelectedWindowId(windowId);
						}}
						selectedAnchorId={selectedAnchorId}
						selectedWindowId={selectedWindowId}
						svgMarkup={floorplan?.svgMarkup ?? ""}
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
				onAnchorBound={() => {
					setSelectedAnchor(null);
				}}
				selectedAnchor={selectedAnchor}
				selectedWindow={selectedWindow}
				selectedWindowId={selectedWindowId}
			/>
		</section>
	);
}

function resolveRepoFloorplan(floor: DiningOpsFloorResponse) {
	const floorplan = getDiningFloorplanByFloor({
		floorId: floor.floor.floorId,
		hallId: floor.floor.hallId,
	});
	if (
		floorplan.floorplanId !== floor.floor.floorplan.floorplanId ||
		floorplan.sha256 !== floor.floor.floorplan.sha256
	) {
		throw new Error(
			`Dining floorplan manifest mismatch: ${floor.floor.hallId}/${floor.floor.floorId}`,
		);
	}
	return floorplan;
}

function WindowEditor(input: {
	floor: DiningOpsFloorResponse | null;
	onAnchorBound(): void;
	selectedAnchor: DiningSvgAnchor | null;
	selectedWindow: DiningWindow | null;
	selectedWindowId: string | null;
}) {
	const queryClient = useQueryClient();
	const [anchorBindingWindowId, setAnchorBindingWindowId] = useState("");
	const current = useMemo(
		() => resolveCurrentWindowState(input.floor, input.selectedWindow),
		[input.floor, input.selectedWindow],
	);
	const defaultAnchorBindingWindowId =
		input.floor?.windows.find((window) => !window.svgAnchorId)?.windowId ?? "";
	const form = useForm<WindowEditorValues>({
		defaultValues: buildWindowEditorValues(input.selectedWindow, current),
		resolver: zodResolver(windowEditorSchema),
	});
	const {
		control,
		formState: { errors },
		handleSubmit,
		register,
		reset,
	} = form;
	const { append, fields } = useFieldArray({
		control,
		keyName: "formRowId",
		name: "offerings",
	});
	const formErrorMessage = firstFormErrorMessage(errors);

	useEffect(() => {
		setAnchorBindingWindowId(defaultAnchorBindingWindowId);
		reset(buildWindowEditorValues(input.selectedWindow, current));
	}, [current, defaultAnchorBindingWindowId, input.selectedWindow, reset]);

	const bindAnchorMutation = useMutation({
		mutationFn: async () => {
			if (!(input.selectedAnchor && anchorBindingWindowId)) {
				throw new Error("anchor and dining point are required");
			}
			const window = input.floor?.windows.find((item) => item.windowId === anchorBindingWindowId);
			if (!window) {
				throw new Error("dining point is required");
			}
			await updateDiningWindow({
				geometry: window.geometry,
				label: window.label,
				locationLabel: window.locationLabel,
				status: window.status,
				svgAnchorId: input.selectedAnchor.anchorId,
				tags: window.tags,
				windowId: anchorBindingWindowId,
			});
		},
		onSuccess: () => {
			input.onAnchorBound();
			void queryClient.invalidateQueries({ queryKey: ["dining-ops", "floor"] });
		},
	});

	const saveMutation = useMutation({
		mutationFn: async (values: WindowEditorValues) => {
			if (!input.selectedWindowId) {
				throw new Error("window is required");
			}
			await updateDiningWindow({
				label: values.windowLabel,
				locationLabel: values.locationLabel,
				status: values.windowStatus,
				tags: input.selectedWindow?.tags ?? [],
				windowId: input.selectedWindowId,
			});
			const assignment = await assignDiningWindow({
				stallProfile: {
					displayName: values.stallName,
					stallType: values.stallType,
					tags: current?.stall?.tags ?? input.selectedWindow?.tags ?? [],
				},
				windowId: input.selectedWindowId,
			});
			for (const draft of values.offerings) {
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
			<p className="ops-eyebrow">餐饮点详情</p>
			<h2 className="font-semibold text-lg">餐饮点详情</h2>
			{input.selectedAnchor && !input.selectedAnchor.windowId ? (
				<form
					className="mt-4 space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						bindAnchorMutation.mutate();
					}}
				>
					<div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
						<p className="font-semibold text-sm">区块未绑定餐饮点</p>
						<p className="mt-1 break-all text-xs text-zinc-500">{input.selectedAnchor.anchorId}</p>
					</div>
					<label className="ops-field">
						<span>选择要绑定的餐饮点</span>
						<select
							value={anchorBindingWindowId}
							onChange={(event) => setAnchorBindingWindowId(event.target.value)}
						>
							<option value="">请选择</option>
							{input.floor?.windows.map((window) => (
								<option key={window.windowId} value={window.windowId}>
									{window.label} · {window.locationLabel}
								</option>
							))}
						</select>
					</label>
					<button
						className="ops-primary-button"
						disabled={!anchorBindingWindowId || bindAnchorMutation.isPending}
						type="submit"
					>
						绑定区块
					</button>
					{bindAnchorMutation.isError ? <p className="text-red-600 text-sm">区块绑定失败</p> : null}
					{bindAnchorMutation.isSuccess ? (
						<p className="text-emerald-700 text-sm">区块已绑定</p>
					) : null}
				</form>
			) : input.selectedWindow ? (
				<form
					className="mt-4 space-y-4"
					onSubmit={handleSubmit((values) => saveMutation.mutate(values))}
				>
					<div>
						<p className="text-xs text-zinc-500">{input.selectedWindow.locationLabel}</p>
						<p className="font-medium text-sm">{input.selectedWindow.windowId}</p>
					</div>
					<label className="ops-field">
						<span>餐饮点名称</span>
						<input aria-label="餐饮点名称" {...register("windowLabel")} />
					</label>
					<label className="ops-field">
						<span>餐饮点位置</span>
						<input aria-label="餐饮点位置" {...register("locationLabel")} />
					</label>
					<label className="ops-field">
						<span>餐饮点状态</span>
						<select aria-label="餐饮点状态" {...register("windowStatus")}>
							<option value="active">active</option>
							<option value="closed">closed</option>
							<option value="maintenance">maintenance</option>
						</select>
					</label>
					<label className="ops-field">
						<span>对外名称</span>
						<input aria-label="对外名称" {...register("stallName")} />
					</label>
					<label className="ops-field">
						<span>餐饮类型</span>
						<input aria-label="餐饮类型" {...register("stallType")} />
					</label>
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<p className="font-semibold text-sm">菜品价格</p>
							<button
								className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
								onClick={() => append(createEmptyOfferingDraft())}
								type="button"
							>
								新增菜品
							</button>
						</div>
						{fields.map((draft, index) => (
							<div className="rounded-lg border border-zinc-200 p-3" key={draft.formRowId}>
								<label className="ops-field">
									<span>菜品名称</span>
									<input
										aria-label={`菜品名称 ${draft.offeringId || draft.key}`}
										{...register(`offerings.${index}.name`)}
									/>
								</label>
								<div className="mt-3 grid gap-3 sm:grid-cols-2">
									<label className="ops-field">
										<span>价格</span>
										<input
											aria-label={`价格 ${draft.offeringId || draft.key}`}
											{...register(`offerings.${index}.priceLabel`)}
										/>
									</label>
									<label className="ops-field">
										<span>规格</span>
										<input {...register(`offerings.${index}.specLabel`)} />
									</label>
									<label className="ops-field sm:col-span-2">
										<span>售卖状态</span>
										<select
											aria-label={`售卖状态 ${draft.offeringId || draft.key}`}
											{...register(`offerings.${index}.saleStatus`)}
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
					{formErrorMessage ? <p className="text-red-600 text-sm">{formErrorMessage}</p> : null}
					{saveMutation.isError && !formErrorMessage ? (
						<p className="text-red-600 text-sm">保存失败</p>
					) : null}
					{saveMutation.isSuccess ? <p className="text-emerald-700 text-sm">草稿已保存</p> : null}
				</form>
			) : (
				<p className="mt-4 text-sm text-zinc-500">选择餐饮点后编辑名称、区块与菜品。</p>
			)}
		</aside>
	);
}

function buildWindowEditorValues(
	selectedWindow: DiningWindow | null,
	current: ReturnType<typeof resolveCurrentWindowState> | null,
): WindowEditorValues {
	return {
		locationLabel: selectedWindow?.locationLabel ?? "",
		offerings:
			current?.offerings.map(({ menu, offering }) => toOfferingDraft(offering, menu)) ?? [],
		stallName: current?.stall?.displayName ?? selectedWindow?.label ?? "",
		stallType: current?.stall?.stallType ?? "food_window",
		windowLabel: selectedWindow?.label ?? "",
		windowStatus: selectedWindow?.status ?? "active",
	};
}

function resolveCurrentWindowState(
	floor: DiningOpsFloorResponse | null,
	selectedWindow: DiningWindow | null,
) {
	if (!(floor && selectedWindow)) {
		return null;
	}
	const assignment = floor.assignments.find((item) => item.windowId === selectedWindow.windowId);
	const stall = assignment
		? floor.stallProfiles.find((item) => item.stallProfileId === assignment.stallProfileId)
		: null;
	const offerings = assignment
		? floor.menuOfferings
				.filter((item) => item.assignmentId === assignment.assignmentId)
				.map((offering) => ({
					menu: floor.menuItems.find((item) => item.menuItemId === offering.menuItemId) ?? null,
					offering,
				}))
		: [];
	return { assignment, offerings, stall };
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

function firstFormErrorMessage(errors: FieldErrors<WindowEditorValues>): string | null {
	return findErrorMessage(errors);
}

function findErrorMessage(value: unknown): string | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	if ("message" in value && typeof value.message === "string") {
		return value.message;
	}
	for (const nested of Object.values(value)) {
		const message = findErrorMessage(nested);
		if (message) {
			return message;
		}
	}
	return null;
}
