import { buildIngestionControlRuntimeConfig, startIngestionControlServer } from "./runtime";

const config = buildIngestionControlRuntimeConfig(process.env);

await startIngestionControlServer(config);

console.info(
	JSON.stringify({
		host: config.host,
		port: config.port,
		source: "ingestion-control.server",
		status: "listening",
	}),
);
