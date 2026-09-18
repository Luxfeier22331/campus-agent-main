export interface DiningMapViewport {
	floorId: string;
	scale: number;
	positionX: number;
	positionY: number;
}

export function diningMaxScale(
	width: number,
	height: number,
	canvasWidth: number,
	canvasHeight: number,
): number {
	const fit = Math.min(width / canvasWidth, height / canvasHeight);
	return fit > 0 ? Math.max(2, Math.ceil(1 / fit)) : 2;
}

/** Track a pointer sequence, including excursions that return to the starting point. */
export function createDiningGesture() {
	const pointers = new Map<number, { x: number; y: number }>();
	let suppressed = false;
	return {
		start(id: number, x: number, y: number) {
			if (pointers.size === 0) {
				suppressed = false;
			}
			pointers.set(id, { x, y });
			if (pointers.size > 1) {
				suppressed = true;
			}
		},
		move(id: number, x: number, y: number) {
			const start = pointers.get(id);
			if (start && Math.hypot(x - start.x, y - start.y) >= 8) {
				suppressed = true;
			}
		},
		end(id: number, cancelled = false) {
			if (cancelled && pointers.has(id)) {
				suppressed = true;
			}
			pointers.delete(id);
		},
		suppress() {
			suppressed = true;
		},
		shouldSuppressClick() {
			return suppressed;
		},
	};
}
