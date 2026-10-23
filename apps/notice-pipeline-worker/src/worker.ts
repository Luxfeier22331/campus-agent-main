import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.ts";
import { RAG_TASK_QUEUE } from "./schedule.ts";

const connection = await NativeConnection.connect({
	address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
});
try {
	const worker = await Worker.create({
		connection,
		namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
		taskQueue: RAG_TASK_QUEUE,
		activities,
		...(import.meta.url.endsWith(".js")
			? { workflowBundle: { codePath: fileURLToPath(new URL("./workflows.cjs", import.meta.url)) } }
			: { workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)) }),
		maxConcurrentActivityTaskExecutions: 1,
	});
	await worker.run();
} finally {
	await connection.close();
}
