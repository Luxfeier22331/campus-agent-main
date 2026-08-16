import type { ChatSessionSlot } from "../chat";
import type { ToolExecutionContextProjection } from "../integration";

export const CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family";
export const CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program";
export const CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester";

export interface CurriculumFollowUpState {
	programFamily: string;
	program: string;
	semester: string;
}

export function resolveCurriculumFollowUpState(
	sessionSlots: readonly Pick<ChatSessionSlot, "confirmed" | "name" | "value">[],
): CurriculumFollowUpState {
	let programFamily = "";
	let program = "";
	let semester = "";

	for (const slot of sessionSlots) {
		if (!(slot.confirmed && slot.value.trim())) {
			continue;
		}
		if (slot.name === CURRICULUM_PROGRAM_FAMILY_SLOT_NAME) {
			programFamily = slot.value.trim();
		} else if (slot.name === CURRICULUM_PROGRAM_SLOT_NAME) {
			program = slot.value.trim();
		} else if (slot.name === CURRICULUM_SEMESTER_SLOT_NAME) {
			semester = slot.value.trim();
		}
	}

	return { programFamily, program, semester };
}

export function buildExecutionSessionProjection(input: {
	sessionSlots: readonly ChatSessionSlot[];
	turnCount: number;
}): ToolExecutionContextProjection["session"] {
	return {
		confirmedSlots: input.sessionSlots
			.filter((slot) => slot.confirmed && slot.value.trim())
			.map((slot) => ({
				confirmed: slot.confirmed,
				name: slot.name,
				value: slot.value,
			})),
		turnCount: Math.max(0, Math.floor(input.turnCount)),
	};
}
