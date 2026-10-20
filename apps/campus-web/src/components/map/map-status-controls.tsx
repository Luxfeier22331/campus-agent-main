import { Button, focusRing } from "@campus-agent/ui";
import { LocateFixed } from "lucide-react";

export function MapViewportControls({
	onResetViewport,
	showReset,
}: {
	onResetViewport: () => void;
	showReset: boolean;
}) {
	return (
		<div className="pointer-events-auto absolute bottom-12 right-3 z-[var(--layer-domain)] flex flex-col items-end gap-2">
			{showReset ? (
				<Button
					aria-label="回到当前校区"
					className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay-surface)] px-3 text-sm font-medium text-[var(--map-overlay-muted)] shadow-[var(--map-overlay-shadow)] outline-none backdrop-blur-md hover:bg-[var(--map-overlay-surface-hover)] hover:text-[var(--map-overlay-text)] ${focusRing}`}
					onClick={onResetViewport}
					variant="ghost"
				>
					<LocateFixed aria-hidden="true" className="size-4" />
					<span className="hidden sm:inline">当前校区</span>
				</Button>
			) : null}
		</div>
	);
}

export function MapAssetNotice({ campus, onRetry }: { campus: string; onRetry: () => void }) {
	return (
		<div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6">
			<div className="max-w-sm rounded-2xl border border-border bg-[var(--map-overlay-surface-strong)] p-4 text-sm leading-6 text-[var(--map-overlay-muted)] shadow-[var(--shadow-sm)]">
				<span className="block font-semibold text-[var(--sys-text-strong)]">{campus}</span>
				地图底图暂时无法显示，地点列表仍可继续使用。
				<Button className="pointer-events-auto mt-3" onClick={onRetry} size="sm" type="button">
					重新加载地图
				</Button>
			</div>
		</div>
	);
}

export function MapAssetLoading() {
	return (
		<div
			className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
			role="status"
		>
			<span className="rounded-full bg-[var(--map-overlay-surface-strong)] px-3 py-1.5 text-xs text-[var(--map-overlay-muted)] shadow-[var(--map-overlay-shadow)]">
				正在加载地图
			</span>
		</div>
	);
}
