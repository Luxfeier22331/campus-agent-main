import net from "node:net";

export type LocalPortProbe = "available" | "occupied" | "unknown";

const PORT_PROBE_TIMEOUT_MS = 1_000;

export async function probeLocalPort(port: number): Promise<LocalPortProbe> {
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		return "unknown";
	}

	return await new Promise<LocalPortProbe>((resolve) => {
		const server = net.createServer();
		let settled = false;
		let timeout: NodeJS.Timeout | undefined;
		const finish = (result: LocalPortProbe): void => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeout) {
				clearTimeout(timeout);
			}
			server.removeAllListeners();
			if (server.listening) {
				server.close(() => resolve(result));
				return;
			}
			resolve(result);
		};
		timeout = setTimeout(() => finish("unknown"), PORT_PROBE_TIMEOUT_MS);
		server.once("error", (error: NodeJS.ErrnoException) => {
			finish(error.code === "EADDRINUSE" ? "occupied" : "unknown");
		});
		server.listen({ host: "127.0.0.1", port }, () => finish("available"));
	});
}

export async function probeLocalPorts(ports: readonly number[]): Promise<{
	occupied: number[];
	unknown: number[];
}> {
	const results = await Promise.all(
		ports.map(async (port) => ({ port, result: await probeLocalPort(port) })),
	);
	return {
		occupied: results.filter(({ result }) => result === "occupied").map(({ port }) => port),
		unknown: results.filter(({ result }) => result === "unknown").map(({ port }) => port),
	};
}
