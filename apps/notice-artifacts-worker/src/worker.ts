import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.ts";
import { NOTICE_ARTIFACTS_TASK_QUEUE } from "./schedule.ts";

const connection = await NativeConnection.connect({
	address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
});
try {
	const worker = await Worker.create({
		connection,
		namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
		taskQueue: NOTICE_ARTIFACTS_TASK_QUEUE,
		activities,
		maxConcurrentActivityTaskExecutions: 1,
	});
	await worker.run();
} finally {
	await connection.close();
}
