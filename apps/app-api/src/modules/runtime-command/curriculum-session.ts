import type { ChatSessionSlot } from "../chat";
import type { ToolExecutionContextProjection } from "../integration";

export const CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family";
export const CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program";
export const CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester";

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
