import type { DiningMenuItem } from "@campus-agent/dining/domain";
import { Button } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, LoaderCircle, MapPin, Utensils } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import type { DiningWindowProjection } from "@/features/dining/model";
import { diningWindowMenuQueryOptions } from "@/features/dining/queries";

const DiningReviewSheet = lazy(() =>
	import("./dining-review-sheet").then((module) => ({ default: module.DiningReviewSheet })),
);

export function DiningWindowDetail(props: {
	floorLabel: string | null;
	onSelectMenuItem(menuItemId: string | null): void;
	selectedMenuItemId: string | null;
	window: DiningWindowProjection | null;
}) {
	const windowId = props.window?.windowId ?? "";
	const menu = useQuery({ ...diningWindowMenuQueryOptions(windowId), enabled: Boolean(windowId) });
	const selectedItem =
		menu.data?.items.find((item) => item.menuItemId === props.selectedMenuItemId) ?? null;
	useEffect(() => {
		if (menu.data && props.selectedMenuItemId && !selectedItem) {
			props.onSelectMenuItem(null);
		}
	}, [menu.data, props.onSelectMenuItem, props.selectedMenuItemId, selectedItem]);
	if (!props.window) {
		return (
			<section
				className="grid min-h-32 place-content-center gap-1 px-2 py-6 text-center"
				data-testid="dining-window-detail"
			>
				<h2 className="text-sm font-semibold text-[var(--sys-text-strong)]">选择窗口</h2>
				<p className="text-sm text-[var(--sys-text-muted)]">在地图上选择一个窗口。</p>
			</section>
		);
	}
	return (
		<section className="min-h-32 px-1 py-5" data-testid="dining-window-detail">
			<h2 className="text-xl font-semibold text-[var(--sys-text-strong)]">{props.window.name}</h2>
			{props.floorLabel ? (
				<p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--sys-text-muted)]">
					<MapPin aria-hidden="true" className="size-4 shrink-0 text-primary" />
					<span>{props.floorLabel}</span>
				</p>
			) : null}
			<div className="mt-5 border-border border-t pt-4">
				<div className="flex items-center gap-2">
					<Utensils className="size-4 text-primary" />
					<h3 className="text-sm font-semibold">菜单</h3>
				</div>
				{menu.isPending ? (
					<div className="flex min-h-24 items-center justify-center gap-2 text-[var(--sys-text-muted)] text-sm">
						<LoaderCircle className="animate-spin" />
						正在读取菜单
					</div>
				) : menu.isError ? (
					<div className="py-6 text-center">
						<p className="text-destructive text-sm">菜单暂时无法读取。</p>
						<Button
							className="mt-3"
							onClick={() => void menu.refetch()}
							size="sm"
							variant="outline"
						>
							重试
						</Button>
					</div>
				) : menu.data.items.length === 0 ? (
					<p className="py-6 text-center text-[var(--sys-text-muted)] text-sm">暂无菜单信息</p>
				) : (
					<ul className="mt-2 divide-y divide-border">
						{menu.data.items.map((item: DiningMenuItem) => (
							<li key={item.menuItemId}>
								<button
									className="flex min-h-14 w-full items-center gap-3 py-2 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									onClick={() => props.onSelectMenuItem(item.menuItemId)}
									type="button"
								>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium">{item.name}</span>
										<span className="block truncate text-[var(--sys-text-subtle)] text-xs">
											{item.priceText ?? "价格暂未提供"}
										</span>
									</span>
									<ChevronRight className="size-4 shrink-0 text-[var(--sys-text-subtle)]" />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
			{selectedItem ? (
				<Suspense
					fallback={
						<span className="sr-only" role="status">
							正在打开评价
						</span>
					}
				>
					<DiningReviewSheet
						item={selectedItem}
						onOpenChange={(open) => !open && props.onSelectMenuItem(null)}
						open
					/>
				</Suspense>
			) : null}
		</section>
	);
}
