import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campusMcpConfig, createCampusMcpServer } from "./server.js";

describe("campus MCP bridge", () => {
	afterEach(() => vi.restoreAllMocks());

	it("exposes campus_search and forwards the public HTTP contract", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ outcome: "matched", results: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const server = createCampusMcpServer({
			upstreamUrl: "http://retrieval.test/",
			upstreamToken: "mcp-upstream-token",
			timeoutMs: 1000,
			fetchImpl,
		});
		const client = new Client({ name: "test-client", version: "0.1.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name)).toEqual(["campus_search"]);
		const result = await client.callTool({
			name: "campus_search",
			arguments: { query: "学籍规定", search_goal: "确认转专业条件" },
		});
		expect(result.isError).not.toBe(true);
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://retrieval.test/v1/search");
		expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
			method: "POST",
			headers: expect.objectContaining({ authorization: "Bearer mcp-upstream-token" }),
			body: JSON.stringify({ query: "学籍规定", search_goal: "确认转专业条件" }),
		});

		await client.close();
		await server.close();
	});

	it("loads MCP upstream credentials from the MCP-specific environment", () => {
		expect(
			campusMcpConfig({
				CAMPUS_MCP_UPSTREAM_URL: "http://retrieval.test",
				CAMPUS_MCP_UPSTREAM_TOKEN: "mcp-upstream-token",
				CAMPUS_MCP_UPSTREAM_TIMEOUT_MS: "1234",
			}),
		).toMatchObject({
			upstreamUrl: "http://retrieval.test",
			upstreamToken: "mcp-upstream-token",
			timeoutMs: 1234,
		});
	});
});
