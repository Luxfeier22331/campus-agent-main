import type { ChatSessionSlot } from "../chat";
import type { RequestDiagnosticsSummary } from "../request-diagnostics";
import type { SupervisorContextProjection } from "../integration";

export const CURRICULUM_PROGRAM_FAMILY_SLOT_NAME = "curriculum_program_family";
export const CURRICULUM_PROGRAM_SLOT_NAME = "curriculum_program";
export const CURRICULUM_SEMESTER_SLOT_NAME = "curriculum_semester";

export interface CurriculumFollowUpState {
  programFamily: string;
  program: string;
  semester: string;
}

export function resolveCurriculumFollowUpState(
  sessionSlots: ReadonlyArray<Pick<ChatSessionSlot, "confirmed" | "name" | "value">>,
): CurriculumFollowUpState {
  let programFamily = "";
  let program = "";
  let semester = "";

  for (const slot of sessionSlots) {
    if (!slot.confirmed || !slot.value.trim()) {
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

export function buildSupervisorSessionProjection(input: {
  sessionSlots: ReadonlyArray<ChatSessionSlot>;
  turnCount: number;
}): SupervisorContextProjection["session"] {
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

export function deriveCurriculumSessionSlots(input: {
  diagnostics: RequestDiagnosticsSummary | null;
  existingSlots: ReadonlyArray<ChatSessionSlot>;
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

  if (!nextState.programFamily && !nextState.program && !nextState.semester) {
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
