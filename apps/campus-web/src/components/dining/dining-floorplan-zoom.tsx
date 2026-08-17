import { Button, cn } from "@campus-agent/ui";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const BUTTON_ZOOM_STEP = 0.16;
const WHEEL_ZOOM_STEP = 0.002;
const ZOOM_ANIMATION_MS = 220;
const RESET_ANIMATION_MS = 280;

export function DiningFloorplanZoom({
	aspectRatio,
	children,
	overlay,
}: {
	aspectRatio: string;
	children(isZoomed: boolean): ReactNode;
	overlay?: ReactNode;
}) {
	const [scale, setScale] = useState(1);
	const prefersReducedMotion = usePrefersReducedMotion();
	const zoomAnimationMs = prefersReducedMotion ? 0 : ZOOM_ANIMATION_MS;
	const resetAnimationMs = prefersReducedMotion ? 0 : RESET_ANIMATION_MS;
	return (
		<TransformWrapper
			autoAlignment={{
				animationTime: zoomAnimationMs,
				animationType: "easeOutCubic",
				disabled: prefersReducedMotion,
				velocityAlignmentTime: zoomAnimationMs,
			}}
			centerOnInit
			centerZoomedOut
			disablePadding
			doubleClick={{ disabled: true }}
			initialScale={1}
			limitToBounds
			maxScale={2}
			minScale={1}
			onTransform={(_, state) => setScale(state.scale)}
			panning={{ velocityDisabled: prefersReducedMotion }}
			smooth
			velocityAnimation={{
				animationTime: zoomAnimationMs,
				animationType: "easeOutCubic",
				disabled: prefersReducedMotion,
				maxAnimationTime: resetAnimationMs,
				maxStrengthMouse: 8,
				maxStrengthTouch: 12,
				sensitivityMouse: 0.35,
				sensitivityTouch: 0.55,
			}}
			wheel={{ step: WHEEL_ZOOM_STEP }}
			zoomAnimation={{
				animationTime: zoomAnimationMs,
				animationType: "easeOutCubic",
				disabled: prefersReducedMotion,
				size: BUTTON_ZOOM_STEP,
			}}
		>
			{({ resetTransform, zoomIn, zoomOut }) => (
				<>
					<div
						className="relative min-w-0 overflow-hidden bg-[var(--dining-svg-canvas-bg)]"
						data-testid="dining-inline-floorplan"
						style={{ aspectRatio }}
					>
						{overlay}
						<TransformComponent
							contentClass="!h-full !w-full will-change-transform"
							wrapperClass="!h-full !w-full"
						>
							{children(scale > 1)}
						</TransformComponent>
					</div>
					<div
						className="flex min-h-14 items-center gap-1 border-border/70 border-t bg-card px-3 py-1.5"
						data-testid="dining-zoom-controls"
					>
						<span className="mr-auto text-[var(--sys-text-muted)] text-xs">位置示意</span>
						<Button
							aria-label="缩小地图"
							disabled={scale <= 1}
							onClick={() => zoomOut(BUTTON_ZOOM_STEP, zoomAnimationMs, "easeOutCubic")}
							size="icon-lg"
							title="缩小"
							type="button"
							variant="ghost"
						>
							<Minus aria-hidden="true" />
						</Button>
						<output
							aria-label="地图缩放比例"
							className={cn(
								"min-w-12 text-center text-xs tabular-nums transition-colors duration-150 motion-reduce:transition-none",
								scale > 1 ? "text-selected-foreground" : "text-[var(--sys-text-muted)]",
							)}
						>
							{Math.round(scale * 100)}%
						</output>
						<Button
							aria-label="重置地图缩放"
							disabled={scale <= 1}
							onClick={() => resetTransform(resetAnimationMs, "easeInOutCubic")}
							size="icon-lg"
							title="重置"
							type="button"
							variant="ghost"
						>
							<RotateCcw aria-hidden="true" />
						</Button>
						<Button
							aria-label="放大地图"
							disabled={scale >= 2}
							onClick={() => zoomIn(BUTTON_ZOOM_STEP, zoomAnimationMs, "easeOutCubic")}
							size="icon-lg"
							title="放大"
							type="button"
							variant="ghost"
						>
							<Plus aria-hidden="true" />
						</Button>
					</div>
				</>
			)}
		</TransformWrapper>
	);
}

function usePrefersReducedMotion(): boolean {
	const [prefersReducedMotion, setPrefersReducedMotion] = useState(
		() => typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches,
	);
	useEffect(() => {
		const media = window.matchMedia(REDUCED_MOTION_QUERY);
		const updatePreference = () => setPrefersReducedMotion(media.matches);
		updatePreference();
		media.addEventListener("change", updatePreference);
		return () => media.removeEventListener("change", updatePreference);
	}, []);
	return prefersReducedMotion;
}
