import { useEffect, useState } from "react";

import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import { Card } from "@/components/ui/card";
import { getDiningFloor, getDiningHalls } from "@/features/dining/api";
import type { DiningFloorResponse, DiningHallSummary } from "@/features/dining/model";
import { cn } from "@/lib/utils";

export function DiningPage() {
	const [halls, setHalls] = useState<DiningHallSummary[]>([]);
	const [selectedHallId, setSelectedHallId] = useState("");
	const [selectedFloorId, setSelectedFloorId] = useState("");
	const [floor, setFloor] = useState<DiningFloorResponse | null>(null);
	const [selectedStallId, setSelectedStallId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		getDiningHalls()
			.then((payload) => {
				setHalls(payload.halls);
				const firstHall = payload.halls[0];
				if (firstHall) {
					setSelectedHallId(firstHall.hallId);
					setSelectedFloorId(firstHall.floors[0]?.floorId ?? "1f");
				}
			})
			.catch((reason: unknown) => {
				setError(reason instanceof Error ? reason.message : "食堂列表加载失败。");
			});
	}, []);

	useEffect(() => {
		if (!(selectedFloorId && selectedHallId)) {
			return;
		}
		getDiningFloor({ floorId: selectedFloorId, hallId: selectedHallId })
			.then((nextFloor) => {
				setFloor(nextFloor);
				setSelectedStallId(nextFloor.stalls[0]?.id ?? null);
				setError(null);
			})
			.catch((reason: unknown) => {
				setFloor(null);
				setError(reason instanceof Error ? reason.message : "食堂平面图加载失败。");
			});
	}, [selectedFloorId, selectedHallId]);

	const selectedHall = halls.find((hall) => hall.hallId === selectedHallId);

	return (
		<section className="mx-auto max-w-[1440px] px-5 py-6 pb-24 lg:px-6">
			<div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div>
					<p className="text-sm font-medium text-primary">饭堂分布图</p>
					<h1 className="mt-1 text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
						食堂与档口
					</h1>
				</div>
				<div className="flex flex-wrap gap-2">
					<select
						className="min-h-11 rounded-lg border border-input bg-white px-3 text-sm"
						onChange={(event) => setSelectedHallId(event.target.value)}
						value={selectedHallId}
					>
						{halls.map((hall) => (
							<option key={hall.hallId} value={hall.hallId}>
								{hall.name}
							</option>
						))}
					</select>
					<select
						className="min-h-11 rounded-lg border border-input bg-white px-3 text-sm"
						onChange={(event) => setSelectedFloorId(event.target.value)}
						value={selectedFloorId}
					>
						{selectedHall?.floors.map((item) => (
							<option key={item.floorId} value={item.floorId}>
								{item.label}
							</option>
						))}
					</select>
				</div>
			</div>
			{error ? <ErrorPanel message={error} /> : null}
			{floor ? (
				<div className="grid gap-4 lg:grid-cols-[1fr_360px]">
					<Card className="min-h-[var(--layout-dining-svg-min-height)] overflow-hidden p-4">
						<DiningFloorProjection floor={floor} selectedStallId={selectedStallId} />
					</Card>
					<Card className="overflow-hidden">
						<div className="border-b border-border p-4">
							<p className="text-sm font-medium text-[var(--sys-text-strong)]">
								{floor.floor.label}
							</p>
							<p className="mt-1 text-xs text-[var(--sys-text-muted)]">
								{floor.source.label} ·{" "}
								{new Date(floor.source.updatedAt).toLocaleDateString("zh-CN")}
							</p>
						</div>
						{floor.stalls.length > 0 ? (
							<div className="divide-y divide-border">
								{floor.stalls.map((stall) => (
									<button
										className={cn(
											"grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left hover:bg-[var(--sys-bg-subtle)]",
											selectedStallId === stall.id && "bg-[var(--sys-brand-interactive-subtle)]",
										)}
										key={stall.id}
										onClick={() => setSelectedStallId(stall.id)}
										type="button"
									>
										<span>
											<span className="block text-sm font-medium text-[var(--sys-text-strong)]">
												{stall.name}
											</span>
											<span className="mt-1 block text-xs text-[var(--sys-text-muted)]">
												{stall.locationLabel}
											</span>
										</span>
										<span className="text-sm font-medium text-primary">{stall.priceLabel}</span>
									</button>
								))}
							</div>
						) : (
							<EmptyPanel message="当前楼层没有档口投影。" />
						)}
					</Card>
				</div>
			) : (
				<LoadingPanel label="正在读取食堂平面图" />
			)}
		</section>
	);
}

function DiningFloorProjection({
	floor,
	selectedStallId,
}: {
	floor: DiningFloorResponse;
	selectedStallId: string | null;
}) {
	const selectedStall = floor.stalls.find((stall) => stall.id === selectedStallId) ?? null;
	return (
		<div className="flex min-h-[520px] flex-col gap-4 rounded-xl bg-[var(--dining-svg-canvas-bg)] p-4">
			<img
				alt={`${floor.floor.label}平面图`}
				className="min-h-0 flex-1 rounded-lg border border-border bg-white object-contain"
				src={floor.floor.svgAssetUrl}
			/>
			{selectedStall ? (
				<div className="rounded-lg border border-border bg-white px-4 py-3">
					<p className="text-sm font-medium text-[var(--sys-text-strong)]">{selectedStall.name}</p>
					<p className="mt-1 text-xs text-[var(--sys-text-muted)]">
						{selectedStall.locationLabel} · {selectedStall.priceLabel}
					</p>
				</div>
			) : null}
		</div>
	);
}
