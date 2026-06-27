import type { ChatSessionSlot } from "../chat";
import type { ToolExecutionContextProjection } from "../integration";
import type { RequestDiagnosticsSummary } from "../request-diagnostics";

export const CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family";
export const CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program";
export const CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester";
export const SELECTED_NOTICE_ID_SLOT_NAME = "selected_notice_id";
export const SELECTED_NOTICE_SOURCE_FAMILY_SLOT_NAME = "selected_notice_source_family";
export const SELECTED_NOTICE_TARGET_SURFACE_SLOT_NAME = "selected_notice_target_surface";
export const SELECTED_NOTICE_TITLE_SLOT_NAME = "selected_notice_title";

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
		selectedNoticeRef: resolveSelectedNoticeRef(input.sessionSlots),
		turnCount: Math.max(0, Math.floor(input.turnCount)),
	};
}

function resolveSelectedNoticeRef(
	sessionSlots: readonly Pick<ChatSessionSlot, "confirmed" | "name" | "value">[],
): ToolExecutionContextProjection["session"]["selectedNoticeRef"] {
	const values = new Map<string, string>();
	for (const slot of sessionSlots) {
		if (!(slot.confirmed && slot.value.trim())) {
			continue;
		}
		values.set(slot.name, slot.value.trim());
	}
	const noticeId = values.get(SELECTED_NOTICE_ID_SLOT_NAME) ?? "";
	if (!noticeId) {
		return null;
	}
	return {
		noticeId,
		sourceFamily: values.get(SELECTED_NOTICE_SOURCE_FAMILY_SLOT_NAME) ?? "",
		targetSurface: values.get(SELECTED_NOTICE_TARGET_SURFACE_SLOT_NAME) ?? "",
		title: values.get(SELECTED_NOTICE_TITLE_SLOT_NAME) ?? "",
	};
}

export function deriveCurriculumSessionSlots(input: {
	diagnostics: RequestDiagnosticsSummary | null;
	existingSlots: readonly ChatSessionSlot[];
	finalizedAt: string;
	status: string;
}): ChatSessionSlot[] {
	if (input.status !== "completed" || !input.diagnostics) {
		return [];
	}

	const nextState = {
		programFamily: input.diagnostics.sessionProgramFamily?.trim() || "",
		program: input.diagnostics.sessionProgram?.trim() || "",
		semester: input.diagnostics.sessionSemester?.trim() || "",
	};

	if (!(nextState.programFamily || nextState.program || nextState.semester)) {
		return [];
	}

	const baseState = resolveCurriculumFollowUpState(input.existingSlots);
	const mergedState: CurriculumFollowUpState = {
		programFamily: nextState.programFamily || baseState.programFamily,
		program: nextState.program || baseState.program,
		semester: nextState.semester || baseState.semester,
	};

	const slots: ChatSessionSlot[] = [];
	if (mergedState.programFamily) {
		slots.push({
			confirmed: true,
			name: CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
			updatedAt: input.finalizedAt,
			value: mergedState.programFamily,
		});
	}
	if (mergedState.program) {
		slots.push({
			confirmed: true,
			name: CURRICULUM_PROGRAM_SLOT_NAME,
			updatedAt: input.finalizedAt,
			value: mergedState.program,
		});
	}
	if (mergedState.semester) {
		slots.push({
			confirmed: true,
			name: CURRICULUM_SEMESTER_SLOT_NAME,
			updatedAt: input.finalizedAt,
			value: mergedState.semester,
		});
	}
	return slots;
}
