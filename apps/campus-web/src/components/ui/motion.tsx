import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

export const campusMotionTransition = {
	duration: 0.18,
	ease: [0.22, 1, 0.36, 1],
} as const;

export const panelPresence = {
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0, y: 8 },
	initial: { opacity: 0, y: 8 },
} as const;

export const popoverPresence = {
	animate: { opacity: 1, x: 0 },
	exit: { opacity: 0, x: -8 },
	initial: { opacity: 0, x: -8 },
} as const;

export const sheetPresence = {
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0, y: 12 },
	initial: { opacity: 0, y: 12 },
} as const;

export const contentSwap = {
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0, y: 4 },
	initial: { opacity: 0, y: 4 },
} as const;

export const stateSwap = {
	animate: { opacity: 1, y: 0 },
	initial: { opacity: 0, y: 4 },
} as const;

export function CampusMotionProvider({ children }: { children: ReactNode }) {
	return (
		<MotionConfig reducedMotion="user" transition={campusMotionTransition}>
			{children}
		</MotionConfig>
	);
}
