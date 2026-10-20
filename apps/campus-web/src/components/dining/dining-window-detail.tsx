import type { DiningMenuItem } from "@campus-agent/dining/domain";
import { Button, cn, focusRing } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, LoaderCircle, MapPin, Utensils } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect } from "react";
import type { DiningWindowProjection } from "@/features/dining/model";
import { diningWindowMenuQueryOptions } from "@/features/dining/queries";

const DiningReviewSheet = lazy(() =>
	import("./dining-review-sheet").then((module) => ({ default: module.DiningReviewSheet })),
);

export function DiningWindowDetail(props: {
	/** 手机底部面板收起时只保留标题行。 */
	collapsed?: boolean;
	headerAction?: ReactNode;
	noMatches?: boolean;
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
			<section className="flex min-h-32 items-start gap-3 py-5" data-testid="dining-window-detail">
				<span
					aria-hidden="true"
					className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-muted text-[var(--sys-text-muted)]"
				>
					<MapPin className="size-4" />
				</span>
				<div className="min-w-0 space-y-1">
					<h2 className="text-sm font-semibold text-[var(--sys-text-strong)]">
						{props.noMatches ? "本层没有匹配的窗口" : "选择窗口"}
					</h2>
					<p className="text-sm text-[var(--sys-text-muted)]">
						{props.noMatches ? "请切换楼层或清除搜索。" : "选择一个窗口查看菜单。"}
					</p>
				</div>
			</section>
		);
	}
	const menuEmpty = menu.isSuccess && menu.data.items.length === 0;
	return (
		<section
			className={cn("pb-1 lg:py-5", props.collapsed && "max-lg:pb-0")}
			data-testid="dining-window-detail"
		>
			<div className="flex items-start justify-between gap-3 max-lg:sticky max-lg:top-0 max-lg:z-[1] max-lg:-mx-4 max-lg:bg-card max-lg:px-4 max-lg:py-3">
				<div className="min-w-0">
					<h2 className="break-words text-xl font-semibold text-[var(--sys-text-strong)]">
						{props.window.name}
					</h2>
					{props.floorLabel ? (
						<p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--sys-text-muted)]">
							<MapPin aria-hidden="true" className="size-4 shrink-0 text-selected-foreground" />
							<span>{props.floorLabel}</span>
						</p>
					) : null}
				</div>
				{props.headerAction}
			</div>
			{/* An empty menu yields to the submissions section, which owns the combined empty state. */}
			{menuEmpty ? null : (
				<div
					className={cn(
						"mt-4 border-border/70 border-t pt-4 max-lg:mt-1",
						props.collapsed && "max-lg:hidden",
					)}
				>
					<div className="flex items-center gap-2">
						<Utensils aria-hidden="true" className="size-4 text-selected-foreground" />
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
								className="mt-3 min-h-11"
								onClick={() => void menu.refetch()}
								size="sm"
								variant="outline"
							>
								重试
							</Button>
						</div>
					) : (
						<ul className="mt-1 divide-y divide-border/70">
							{menu.data.items.map((item: DiningMenuItem) => (
								<li key={item.menuItemId}>
									<button
										className={`flex min-h-12 w-full items-center gap-3 py-2 text-left hover:text-link ${focusRing}`}
										onClick={() => props.onSelectMenuItem(item.menuItemId)}
										type="button"
									>
										<span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
										<span
											className={cn(
												"shrink-0 tabular-nums",
												item.priceText
													? "text-sm text-[var(--sys-text-default)]"
													: "text-xs text-[var(--sys-text-subtle)]",
											)}
										>
											{item.priceText ?? "价格暂未提供"}
										</span>
										<ChevronRight
											aria-hidden="true"
											className="size-4 shrink-0 text-[var(--sys-text-subtle)]"
										/>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
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
