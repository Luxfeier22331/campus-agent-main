import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { it } from "node:test";

import { probeLocalPort, probeLocalPorts } from "./ports";

it("detects a listener on a system-assigned port and its release", async () => {
	const server = net.createServer();
	server.listen({ host: "127.0.0.1", port: 0 });
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	try {
		assert.equal(await probeLocalPort(address.port), "occupied");
		assert.deepEqual(await probeLocalPorts([address.port]), {
			occupied: [address.port],
			unknown: [],
		});
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
	assert.equal(await probeLocalPort(address.port), "available");
});
