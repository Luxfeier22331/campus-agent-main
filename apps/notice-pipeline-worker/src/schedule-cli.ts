import { connectTemporal, initializeSchedule } from "./schedule.ts";

const { client, connection } = await connectTemporal();
try {
	await initializeSchedule(client);
} finally {
	await connection.close();
}
