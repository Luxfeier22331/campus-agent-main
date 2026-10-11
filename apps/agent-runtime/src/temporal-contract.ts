import type {
	TaskPlan,
	TaskPlanStep,
	TaskReplan,
	WorkflowOperation,
} from "./agent-run-contract.ts";

export const AGENT_WORKFLOW_QUEUE = "campus-agent.agent.workflow.v1";
export const AGENT_MODEL_QUEUE = "campus-agent.agent.model.v1";
export const AGENT_TOOL_QUEUE = "campus-agent.agent.tool.v1";
export interface AgentWorkflowInput {
	request_id: string;
	conversation_id: string;
	deadline_at: string;
	workflow_id: string;
	admission_snapshot: {
		provider_config_sha256: string;
		agent_budget: {
			max_plan_steps: number;
			max_replans: number;
			max_model_turns: number;
			max_function_tool_calls: number;
		};
		agent_capabilities: { visible_function_tool_names: string[]; hosted_web_search: boolean };
		agent_limits: {
			agent_deadline_ms: number;
			context_char_limit: number;
			current_input_char_limit: number;
			max_output_tokens: number;
		};
		tool_contract_fingerprint: {
			schema_version: string;
			tools_sha256: string;
			function_schema_sha256: string;
		};
	};
}
export interface StageInput {
	workflow: AgentWorkflowInput;
	key: string;
	operation: WorkflowOperation;
	plan?: TaskPlan;
	step?: TaskPlanStep;
	completedRefs: string[];
	solveRef?: string;
	citationStart: number;
	remaining?: TaskPlanStep[];
	replanIndex?: number;
	mode?: "planned" | "recovery";
	recoveryReason?: string;
	bufferAnswer?: boolean;
}
export interface StageDecision {
	ref: string;
	status: "completed" | "failed";
	solveOutcome?: "answer" | "plan";
	plan?: TaskPlan;
	replan?: TaskReplan;
	remainingFacts: string[];
	evidenceCount: number;
	nextCitation: number;
	sourceAttempts: { source: string; status: string; failureCode?: string }[];
	sourceSucceeded: boolean;
	failureCode?: string;
	answerStarted: boolean;
}
export interface TurnDecision {
	ref: string;
	calls: { index: number; name: string }[];
	done: boolean;
}
export interface AgentActivities {
	prepareStage(input: StageInput): Promise<{ ref: string }>;
	modelTurn(input: {
		requestId: string;
		stageRef: string;
		stateRef?: string;
		turn: number;
	}): Promise<TurnDecision>;
	executeTool(input: {
		requestId: string;
		stageRef: string;
		turnRef: string;
		index: number;
		priorToolRefs: string[];
	}): Promise<{ ref: string }>;
	completeTurn(input: {
		requestId: string;
		stageRef: string;
		turnRef: string;
		toolRefs: string[];
	}): Promise<{ ref: string }>;
	completeStage(input: {
		requestId: string;
		stageRef: string;
		turnRef: string;
		failureCode?: string;
	}): Promise<StageDecision>;
	finalizeAnswer(input: { workflow: AgentWorkflowInput; ref: string }): Promise<void>;
	finalizeFailure(input: {
		workflow: AgentWorkflowInput;
		stage: string;
		code: string;
		canceled: boolean;
	}): Promise<void>;
}
