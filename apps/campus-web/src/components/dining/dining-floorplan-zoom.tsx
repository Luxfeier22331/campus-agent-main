import { Button, cn } from "@campus-agent/ui";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	type ReactZoomPanPinchRef,
	TransformComponent,
	TransformWrapper,
} from "react-zoom-pan-pinch";

import {
	createDiningGesture,
	type DiningMapViewport,
	diningMaxScale,
} from "./dining-map-interaction";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const BUTTON_ZOOM_STEP = 0.25;
const WHEEL_ZOOM_STEP = 0.002;
const ZOOM_ANIMATION_MS = 220;
const RESET_ANIMATION_MS = 280;

export function DiningFloorplanZoom({
	aspectRatio,
	canvas,
	floorId,
	initialViewport,
	onViewportChange,
	onReady,
	children,
	overlay,
}: {
	aspectRatio: string;
	canvas: { width: number; height: number };
	floorId: string;
	initialViewport?: DiningMapViewport | undefined;
	onViewportChange?: ((viewport: DiningMapViewport) => void) | undefined;
	onReady?: (() => void) | undefined;
	children(isZoomed: boolean): ReactNode;
	overlay?: ReactNode;
}) {
	const [scale, setScale] = useState(initialViewport?.scale ?? 1);
	const [maxScale, setMaxScale] = useState(0);
	const viewportRef = useRef<HTMLDivElement>(null);
	const transformRef = useRef<ReactZoomPanPinchRef>(null);
	const gesture = useRef(createDiningGesture());
	const ready = useRef(false);
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) {
			return;
		}
		const measure = () =>
			setMaxScale(
				diningMaxScale(element.clientWidth, element.clientHeight, canvas.width, canvas.height),
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [canvas.width, canvas.height]);
	useEffect(() => {
		const move = (event: PointerEvent) =>
			gesture.current.move(event.pointerId, event.clientX, event.clientY);
		const end = (event: PointerEvent) =>
			gesture.current.end(event.pointerId, event.type === "pointercancel");
		window.addEventListener("pointermove", move, true);
		window.addEventListener("pointerup", end, true);
		window.addEventListener("pointercancel", end, true);
		return () => {
			window.removeEventListener("pointermove", move, true);
			window.removeEventListener("pointerup", end, true);
			window.removeEventListener("pointercancel", end, true);
		};
	}, []);
	useEffect(() => {
		const ref = transformRef.current;
		const element = viewportRef.current;
		if (!(ref && element?.clientWidth && maxScale)) {
			return;
		}
		const saved = ready.current ? ref.instance.state : initialViewport;
		const nextScale = Math.min(maxScale, Math.max(1, saved?.scale ?? 1));
		const x = Math.max(element.clientWidth * (1 - nextScale), Math.min(0, saved?.positionX ?? 0));
		const y = Math.max(element.clientHeight * (1 - nextScale), Math.min(0, saved?.positionY ?? 0));
		void ref.setTransform(x, y, nextScale, 0);
		onViewportChange?.({ floorId, scale: nextScale, positionX: x, positionY: y });
		if (!ready.current) {
			ready.current = true;
			onReady?.();
		}
	}, [maxScale, initialViewport, onReady, onViewportChange, floorId]);
	const prefersReducedMotion = usePrefersReducedMotion();
	const zoomAnimationMs = prefersReducedMotion ? 0 : ZOOM_ANIMATION_MS;
	const resetAnimationMs = prefersReducedMotion ? 0 : RESET_ANIMATION_MS;
	return (
		<TransformWrapper
			ref={transformRef}
			customTransform={(x, y) => `translate(${x}px, ${y}px)`}
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
			maxScale={maxScale || 2}
			minScale={1}
			onTransform={(ref, state) => {
				ref.instance.contentComponent?.style.setProperty("--dining-map-scale", String(state.scale));
				// TransformComponent renders its default scale again on React updates.
				// Keep the display transform separate from the library's logical bounds.
				ref.instance.contentComponent?.style.setProperty(
					"--dining-map-transform",
					`translate(${state.positionX}px, ${state.positionY}px)`,
				);
				setScale(state.scale);
				if (ready.current) {
					onViewportChange?.({ floorId, ...state });
				}
			}}
			onPinchStart={() => gesture.current.suppress()}
			panning={{ disabled: scale <= 1, velocityDisabled: prefersReducedMotion }}
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
			wheel={{ step: WHEEL_ZOOM_STEP, wheelDisabled: true }}
			trackPadPanning={{ disabled: true }}
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
						ref={viewportRef}
						onPointerDownCapture={(event) =>
							gesture.current.start(event.pointerId, event.clientX, event.clientY)
						}
						onClickCapture={(event) => {
							if (event.detail !== 0 && gesture.current.shouldSuppressClick()) {
								event.preventDefault();
								event.stopPropagation();
							}
						}}
						className="relative min-w-0 overflow-hidden bg-[var(--dining-svg-canvas-bg)]"
						data-testid="dining-inline-floorplan"
						style={{ aspectRatio, touchAction: scale > 1 ? "none" : "pan-y" }}
					>
						{overlay}
						<TransformComponent
							contentClass="!h-full !w-full relative ![transform:var(--dining-map-transform,none)]"
							wrapperStyle={{ transform: "none" }}
							wrapperClass="!h-full !w-full"
						>
							<div
								className="absolute left-0 top-0"
								style={{
									width: "calc(100% * var(--dining-map-scale, 1))",
									height: "calc(100% * var(--dining-map-scale, 1))",
								}}
							>
								{children(scale > 1)}
							</div>
						</TransformComponent>
					</div>
					<div
						className="flex min-h-14 items-center gap-1 border-border/70 border-t bg-card px-3 py-1.5"
						data-testid="dining-zoom-controls"
					>
						<span className="mr-auto text-[var(--sys-text-muted)] text-xs">
							<span className="sm:hidden">双指缩放，放大后拖动</span>
							<span className="hidden sm:inline">Ctrl + 滚轮缩放</span>
						</span>
						<Button
							aria-label="缩小地图"
							disabled={scale <= 1}
							onClick={() =>
								zoomOut(scale * (1 - 1 / (1 + BUTTON_ZOOM_STEP)), zoomAnimationMs, "easeOutCubic")
							}
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
							disabled={scale >= maxScale}
							onClick={() => zoomIn(scale * BUTTON_ZOOM_STEP, zoomAnimationMs, "easeOutCubic")}
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
