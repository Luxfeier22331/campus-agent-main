import { describe, expect, it } from "vitest";
import {
	createDiningGesture,
	diningMaxScale,
} from "../src/components/dining/dining-map-interaction";

describe("Dining map reading and selection", () => {
	it.each([272, 342, 900])("allows readable labels on a %ipx map", (width) => {
		const height = (width * 760) / 1280;
		const scale = diningMaxScale(width, height, 1280, 760);
		expect(((16 * width) / 1280) * scale).toBeGreaterThanOrEqual(16);
	});
	it("distinguishes a tap from a drag, including a drag back to its origin", () => {
		const gesture = createDiningGesture();
		gesture.start(1, 10, 10);
		gesture.move(1, 13, 12);
		gesture.end(1);
		expect(gesture.shouldSuppressClick()).toBe(false);
		gesture.start(2, 10, 10);
		gesture.move(2, 18, 10);
		gesture.move(2, 10, 10);
		gesture.end(2);
		expect(gesture.shouldSuppressClick()).toBe(true);
		gesture.start(3, 10, 10);
		gesture.end(3);
		expect(gesture.shouldSuppressClick()).toBe(false);
	});
	it("does not select on pinch or cancelled scroll gestures", () => {
		const gesture = createDiningGesture();
		gesture.start(1, 0, 0);
		gesture.start(2, 20, 20);
		gesture.end(1);
		gesture.end(2);
		expect(gesture.shouldSuppressClick()).toBe(true);
		gesture.start(3, 0, 0);
		gesture.end(3, true);
		expect(gesture.shouldSuppressClick()).toBe(true);
	});
});
