import { animate } from "motion/mini";
import { type ReactNode, useLayoutEffect, useRef } from "react";

export function DocsPageTransition({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || typeof element.animate !== "function") {
			return;
		}
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		if (reducedMotion.matches) {
			return;
		}
		const styles = getComputedStyle(element);
		const durationToken = styles.getPropertyValue("--motion-duration-standard").trim();
		const easingToken = styles.getPropertyValue("--motion-easing-standard").trim();
		const duration = Number.parseFloat(durationToken) / (durationToken.endsWith("ms") ? 1000 : 1);
		const easing = /^cubic-bezier\(([^)]+)\)$/u.exec(easingToken)?.[1]?.split(",").map(Number);
		if (
			!Number.isFinite(duration) ||
			duration <= 0 ||
			!easing ||
			easing.length !== 4 ||
			!easing.every(Number.isFinite)
		) {
			return;
		}

		// Keep prerendered content visible; only enhance the committed page in the browser.
		const animation = animate(
			element,
			{ opacity: [0, 1], transform: ["translateY(6px)", "none"] },
			{ duration, ease: easing as [number, number, number, number] },
		);
		const cancelForReducedMotion = () => {
			if (reducedMotion.matches) {
				animation.cancel();
			}
		};
		reducedMotion.addEventListener("change", cancelForReducedMotion);
		return () => {
			reducedMotion.removeEventListener("change", cancelForReducedMotion);
			animation.cancel();
		};
	}, []);

	return (
		<div className="docs-page-transition" ref={ref}>
			{children}
		</div>
	);
}
