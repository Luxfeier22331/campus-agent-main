import { Button, focusRing } from "@campus-agent/ui";
import { LocateFixed, Minus, Plus } from "lucide-react";

const controlButtonClass = `inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay-surface)] px-3 text-sm font-medium text-[var(--map-overlay-muted)] shadow-[var(--map-overlay-shadow)] outline-none backdrop-blur-md hover:bg-[var(--map-overlay-surface-hover)] hover:text-[var(--map-overlay-text)] ${focusRing}`;

export function MapViewportControls({
	onResetViewport,
	onZoomIn,
	onZoomOut,
	showReset,
	zoomControlsAvailable,
}: {
	onResetViewport: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	showReset: boolean;
	zoomControlsAvailable: boolean;
}) {
	return (
		<div className="pointer-events-auto absolute bottom-12 right-3 z-[var(--layer-domain)] flex flex-col items-end gap-2 max-lg:bottom-28">
			{zoomControlsAvailable ? (
				<fieldset
					aria-label="地图缩放"
					className="m-0 flex flex-col overflow-hidden rounded-full border border-[var(--map-overlay-border)] bg-[var(--map-overlay-surface)] p-0 shadow-[var(--map-overlay-shadow)] backdrop-blur-md"
				>
					<Button
						aria-label="放大地图"
						className={`${controlButtonClass} rounded-b-none border-0 border-b border-[var(--map-overlay-divider)]`}
						onClick={onZoomIn}
						variant="ghost"
					>
						<Plus aria-hidden="true" className="size-5" />
					</Button>
					<Button
						aria-label="缩小地图"
						className={`${controlButtonClass} rounded-t-none border-0`}
						onClick={onZoomOut}
						variant="ghost"
					>
						<Minus aria-hidden="true" className="size-5" />
					</Button>
				</fieldset>
			) : null}
			{showReset ? (
				<Button
					aria-label="回到当前校区"
					className={controlButtonClass}
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
