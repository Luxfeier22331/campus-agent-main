import { createServer, type Server } from "node:http";

export class RuntimeLifecycle {
	#activeRequests = 0;
	#draining = false;

	get draining(): boolean {
		return this.#draining;
	}
	get activeRequests(): number {
		return this.#activeRequests;
	}

	startDraining(): void {
		this.#draining = true;
	}

	accept(): () => void {
		this.#activeRequests += 1;
		let completed = false;
		return () => {
			if (completed) {
				return;
			}
			completed = true;
			this.#activeRequests -= 1;
		};
	}

	metrics(): string {
		return (
			"# HELP agent_runtime_active_requests Accepted execution requests whose HTTP response has not finished.\n" +
			"# TYPE agent_runtime_active_requests gauge\n" +
			`agent_runtime_active_requests ${this.#activeRequests}\n`
		);
	}
}

export function createRuntimeMetricsServer(lifecycle: RuntimeLifecycle): Server {
	return createServer((request, response) => {
		if (request.method !== "GET" || request.url !== "/metrics") {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
		response.end(lifecycle.metrics());
	});
}

// The deadline includes waiting for responses; callers close shared resources afterwards.
export function drainRuntimeServer(
	server: Server,
	lifecycle: RuntimeLifecycle,
	timeoutMs = 350_000,
): Promise<boolean> {
	lifecycle.startDraining();
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			server.closeAllConnections();
			resolve(false);
		}, timeoutMs);
		server.close(() => {
			clearTimeout(timeout);
			resolve(true);
		});
	});
}
