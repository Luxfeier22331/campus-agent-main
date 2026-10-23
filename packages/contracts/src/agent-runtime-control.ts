import { z } from "zod";
import contract from "../schemas/agent-runtime-control.v1.schema.json" with { type: "json" };
import type { AgentRunRequest } from "./generated/agent-runtime-control.ts";

export type * from "./generated/agent-runtime-control.ts";
export const agentRunRequestWireSchema = z.fromJSONSchema(
	contract.$defs.AgentRunRequest as Parameters<typeof z.fromJSONSchema>[0],
) as z.ZodType<AgentRunRequest>;
