import type {
	DiningWayfindingDiagnostic,
	DiningWayfindingDiagnosticEntity,
	DiningWayfindingLayout,
	DiningWayfindingPoint,
	DiningWayfindingRect,
	DiningWayfindingWindow,
} from "./wayfinding-types.ts";

export function polygonSignedArea(points: DiningWayfindingPoint[]): number {
	return (
		points.reduce((area, point, index) => {
			const next = points[(index + 1) % points.length];
			return next ? area + point.x * next.y - next.x * point.y : area;
		}, 0) / 2
	);
}

export function polygonSelfIntersects(points: DiningWayfindingPoint[]): boolean {
	for (let left = 0; left < points.length; left += 1) {
		const leftEnd = (left + 1) % points.length;
		for (let right = left + 1; right < points.length; right += 1) {
			const rightEnd = (right + 1) % points.length;
			if (left === right || leftEnd === right || rightEnd === left) {
				continue;
			}
			const a = points[left];
			const b = points[leftEnd];
			const c = points[right];
			const d = points[rightEnd];
			if (a && b && c && d && segmentsIntersect(a, b, c, d)) {
				return true;
			}
		}
	}
	return false;
}

function segmentsIntersect(
	a: DiningWayfindingPoint,
	b: DiningWayfindingPoint,
	c: DiningWayfindingPoint,
	d: DiningWayfindingPoint,
): boolean {
	const abC = orientation(a, b, c);
	const abD = orientation(a, b, d);
	const cdA = orientation(c, d, a);
	const cdB = orientation(c, d, b);
	if (abC === 0 && pointOnSegment(a, b, c)) {
		return true;
	}
	if (abD === 0 && pointOnSegment(a, b, d)) {
		return true;
	}
	if (cdA === 0 && pointOnSegment(c, d, a)) {
		return true;
	}
	if (cdB === 0 && pointOnSegment(c, d, b)) {
		return true;
	}
	return abC !== abD && cdA !== cdB;
}

function orientation(
	a: DiningWayfindingPoint,
	b: DiningWayfindingPoint,
	c: DiningWayfindingPoint,
): -1 | 0 | 1 {
	const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	if (Math.abs(cross) < 0.000_001) {
		return 0;
	}
	return cross > 0 ? 1 : -1;
}

function pointOnSegment(
	a: DiningWayfindingPoint,
	b: DiningWayfindingPoint,
	point: DiningWayfindingPoint,
): boolean {
	return (
		point.x >= Math.min(a.x, b.x) &&
		point.x <= Math.max(a.x, b.x) &&
		point.y >= Math.min(a.y, b.y) &&
		point.y <= Math.max(a.y, b.y)
	);
}

export function samePoint(left: DiningWayfindingPoint, right: DiningWayfindingPoint): boolean {
	return left.x === right.x && left.y === right.y;
}

export function collectWindowClearanceDiagnostics(
	value: DiningWayfindingLayout,
): DiningWayfindingDiagnostic[] {
	const diagnostics: DiningWayfindingDiagnostic[] = [];
	for (const [index, window] of value.windows.entries()) {
		for (const blocker of value.windows.slice(index + 1)) {
			if (rectanglesOverlap(window, blocker)) {
				diagnostics.push(windowOverlapDiagnostic(window, blocker, "window"));
			}
		}
		for (const blocker of value.regions) {
			if (rectanglesOverlap(window, blocker)) {
				diagnostics.push(windowOverlapDiagnostic(window, blocker, "region"));
			}
		}
		for (const blocker of value.landmarks) {
			if (rectanglesOverlap(window, blocker)) {
				diagnostics.push(windowOverlapDiagnostic(window, blocker, "landmark"));
			}
		}
	}
	return diagnostics;
}

function windowOverlapDiagnostic(
	window: DiningWayfindingWindow,
	blocker: DiningWayfindingWindow | DiningWayfindingRect,
	blockerKind: DiningWayfindingDiagnosticEntity["kind"],
): DiningWayfindingDiagnostic {
	const blockerId = "anchorId" in blocker ? blocker.anchorId : blocker.id;
	return {
		code: "window_overlap",
		entities: [
			{ id: window.anchorId, kind: "window", label: window.label },
			{ id: blockerId, kind: blockerKind, label: blocker.label },
		],
		message: `${window.label}与${blocker.label}重叠`,
	};
}

export function rectanglesOverlap(
	left: { height: number; width: number; x: number; y: number },
	right: { height: number; width: number; x: number; y: number },
): boolean {
	const leftX = left.x;
	const leftY = left.y;
	const rightX = right.x;
	const rightY = right.y;
	return (
		leftX < rightX + right.width &&
		leftX + left.width > rightX &&
		leftY < rightY + right.height &&
		leftY + left.height > rightY
	);
}
