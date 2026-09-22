import { Client, Connection } from "@temporalio/client";

export const NOTICE_ARTIFACTS_TASK_QUEUE = "notice-artifacts";
export async function connectTemporal(env = process.env) {
	const connection = await Connection.connect({
		address: env.TEMPORAL_ADDRESS ?? "localhost:7233",
	});
	return {
		connection,
		client: new Client({ connection, namespace: env.TEMPORAL_NAMESPACE ?? "default" }),
	};
}
