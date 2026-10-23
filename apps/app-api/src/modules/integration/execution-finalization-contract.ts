import {
	EXECUTION_STATUSES,
	type ExecutionStatus,
	STAGE_TIMING_FIELDS as GENERATED_STAGE_TIMING_FIELDS,
	type StageTimingField as GeneratedStageTimingField,
	type StageTimingWire as GeneratedStageTimingWire,
	type ToolExecutionResponseWire,
} from "./generated/tool-execution-contract";

export const EXECUTION_FINALIZATION_STATUSES = EXECUTION_STATUSES;
export const STAGE_TIMING_FIELDS = GENERATED_STAGE_TIMING_FIELDS;

export type ExecutionFinalizationStatus = ExecutionStatus;
export type StageTimingField = GeneratedStageTimingField;
export type StageTimingWire = GeneratedStageTimingWire;
export type ExecutionFinalizationResponseWire = ToolExecutionResponseWire;
