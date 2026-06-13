import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ViteDevServer } from "vite";
import { describe, expect, it, vi } from "vitest";

import { createChatKitDevProxyPlugin } from "../scripts/chatkit-dev-proxy-plugin";

const appDir = join(__dirname, "..");

describe("campus-web vite local dev proxy", () => {
	it("registers the ChatKit dev proxy before the Cloudflare worker plugin", () => {
		const configSource = readFileSync(join(appDir, "vite.config.ts"), "utf8");

		expect(configSource.indexOf("createChatKitDevProxyPlugin()")).toBeGreaterThanOrEqual(0);
		expect(configSource.indexOf("createChatKitDevProxyPlugin()")).toBeLessThan(
			configSource.indexOf("cloudflare("),
		);
	});

	it("returns product JSON when local ChatKit proxy forwarding fails", async () => {
		const plugin = createChatKitDevProxyPlugin();
		const middlewareHandlers: Array<{
			handler: (request: unknown, response: unknown, next: () => void) => void;
			route: string;
		}> = [];
		const server = {
			middlewares: {
				use(
					route: string,
					handler: (request: unknown, response: unknown, next: () => void) => void,
				) {
					middlewareHandlers.push({ handler, route });
				},
			},
		} as unknown as ViteDevServer;
		(plugin.configureServer as (server: ViteDevServer) => void)(server);
		const proxy = middlewareHandlers.find((entry) => entry.route === "/api/chatkit");
		if (!proxy) {
			throw new Error("ChatKit proxy middleware was not registered.");
		}
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
		const response = {
			end: vi.fn(),
			setHeader: vi.fn(),
			statusCode: 200,
		};
		const request = new EventEmitter() as EventEmitter & {
			headers: Record<string, string>;
			method: string;
			url: string;
		};
		request.headers = { "content-type": "application/json" };
		request.method = "POST";
		request.url = "/api/chatkit";

		proxy.handler(request, response, vi.fn());
		request.emit("data", Buffer.from('{"type":"threads.list"}'));
		request.emit("end");
		await vi.waitFor(() => expect(response.end).toHaveBeenCalled());

		expect(response.statusCode).toBe(503);
		expect(response.setHeader).toHaveBeenCalledWith(
			"content-type",
			"application/json; charset=utf-8",
		);
		expect(response.end).toHaveBeenCalledWith(
			JSON.stringify({
				error: { code: "dependency_not_ready", message: "服务暂不可用，请稍后再试。" },
			}),
		);
	});
});
