import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface CampusMcpOptions {
	upstreamUrl: string;
	upstreamToken: string;
	timeoutMs: number;
	fetchImpl?: typeof fetch;
}

export function createCampusMcpServer(options: CampusMcpOptions): McpServer {
	const upstreamUrl = options.upstreamUrl.replace(/\/$/, "");
	const fetchImpl = options.fetchImpl ?? fetch;

	if (!(upstreamUrl && options.upstreamToken)) {
		throw new Error("Campus MCP upstream URL and token are required");
	}

	const server = new McpServer({ name: "campus", version: "0.1.0" });
	server.registerTool(
		"campus_search",
		{
			description: "Search published campus documents and notices.",
			inputSchema: {
				query: z.string().trim().min(1).max(400),
				search_goal: z.string().trim().max(800).optional(),
			},
		},
		async ({ query, search_goal }) => {
			const response = await fetchImpl(`${upstreamUrl}/v1/search`, {
				method: "POST",
				headers: {
					accept: "application/json",
					authorization: `Bearer ${options.upstreamToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ query, search_goal }),
				signal: AbortSignal.timeout(options.timeoutMs),
			});
			const body = await response.text();
			if (!response.ok) {
				return {
					isError: true,
					content: [
						{ type: "text", text: body || `Campus Search returned HTTP ${response.status}` },
					],
				};
			}
			return {
				content: [{ type: "text", text: body }],
			};
		},
	);

	return server;
}

export function campusMcpConfig(env: NodeJS.ProcessEnv = process.env): CampusMcpOptions {
	const timeoutMs = Number.parseInt(env.CAMPUS_MCP_UPSTREAM_TIMEOUT_MS ?? "70000", 10);
	return {
		upstreamUrl: env.CAMPUS_MCP_UPSTREAM_URL ?? "",
		upstreamToken: env.CAMPUS_MCP_UPSTREAM_TOKEN ?? "",
		timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 70000,
	};
}
