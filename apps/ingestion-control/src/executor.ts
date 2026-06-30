import { buildIngestionExecutorRuntimeConfig, startIngestionControlExecutor } from "./runtime";

const config = buildIngestionExecutorRuntimeConfig(process.env);
const stop = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		stop.abort();
	});
}

console.info(
	JSON.stringify({
		source: "ingestion-control.executor",
		status: "starting",
		workerId: config.workerId,
	}),
);

await startIngestionControlExecutor(config, { stopSignal: stop.signal });

console.info(
	JSON.stringify({
		source: "ingestion-control.executor",
		status: "stopped",
		workerId: config.workerId,
	}),
);
