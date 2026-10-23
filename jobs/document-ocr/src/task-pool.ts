/**
 * Runs tasks with bounded concurrency while discovery is still adding to the
 * queue. Workers wait for discovery instead of exiting on a momentarily empty
 * queue, so tasks discovered after the initial batch still get a worker.
 */
export async function runTaskPool<Task>(
	initial: readonly Task[],
	concurrency: number,
	discover: (push: (task: Task) => void) => Promise<void>,
	run: (task: Task) => Promise<void>,
): Promise<void> {
	const queue = [...initial];
	const waiting: (() => void)[] = [];
	let discovering = true;
	const wake = () => {
		for (const resume of waiting.splice(0)) {
			resume();
		}
	};
	const next = async () => {
		for (;;) {
			const task = queue.shift();
			if (task !== undefined || !discovering) {
				return task;
			}
			await new Promise<void>((resume) => waiting.push(resume));
		}
	};
	const worker = async () => {
		for (let task = await next(); task !== undefined; task = await next()) {
			await run(task);
		}
	};
	const discovery = discover((task) => {
		queue.push(task);
		wake();
	}).finally(() => {
		discovering = false;
		wake();
	});
	await Promise.all([discovery, ...Array.from({ length: concurrency }, worker)]);
}
