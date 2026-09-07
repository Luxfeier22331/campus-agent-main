import { type ChildProcess, execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const PORT_FORWARD_READY_TIMEOUT_MS = 15_000;
const PORT_FORWARD_STOP_TIMEOUT_MS = 3_000;
const OBJECT_STORE_PORT = 9000;

export interface KubernetesObjectStoreConnection {
	accessKeyId: string;
	endpoint: string;
	secretAccessKey: string;
	close(): Promise<void>;
}

export interface KubectlDependencies {
	kubectlPath?: string;
	runKubectl?: (args: string[]) => Promise<string>;
	startPortForward?: (input: {
		context?: string;
		kubectlPath: string;
		namespace: string;
	}) => Promise<KubectlPortForward>;
}

export interface KubectlPortForward {
	close(): Promise<void>;
	port: number;
}

export async function connectToKubernetesObjectStore(input: {
	context?: string;
	dependencies?: KubectlDependencies;
	namespace: string;
	secretName?: string;
}): Promise<KubernetesObjectStoreConnection> {
	const namespace = required(input.namespace, "Kubernetes namespace");
	const kubectlPath = input.dependencies?.kubectlPath ?? "kubectl";
	const runKubectl =
		input.dependencies?.runKubectl ?? ((args: string[]) => runKubectlCommand(kubectlPath, args));
	const secretName = input.secretName ?? "object-store-secrets";
	const accessKeyId = decodeSecretValue(
		await runKubectl(
			secretArgs(input.context, namespace, secretName, "OBJECT_STORE_DERIVED_READ_ACCESS_KEY"),
		),
		"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
	);
	const secretAccessKey = decodeSecretValue(
		await runKubectl(
			secretArgs(input.context, namespace, secretName, "OBJECT_STORE_DERIVED_READ_SECRET_KEY"),
		),
		"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
	);
	const portForward = await (input.dependencies?.startPortForward ?? startKubectlPortForward)({
		...(input.context ? { context: input.context } : {}),
		kubectlPath,
		namespace,
	});
	return {
		accessKeyId,
		close: portForward.close,
		endpoint: `http://127.0.0.1:${portForward.port}`,
		secretAccessKey,
	};
}

export async function startKubectlPortForward(input: {
	context?: string;
	kubectlPath: string;
	namespace: string;
}): Promise<KubectlPortForward> {
	const child = spawn(
		input.kubectlPath,
		[
			...(input.context ? ["--context", input.context] : []),
			"--namespace",
			input.namespace,
			"port-forward",
			"--address=127.0.0.1",
			"service/object-store",
			`:${OBJECT_STORE_PORT}`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	try {
		const port = await waitForPortForward(child);
		return {
			close: () => stopChild(child),
			port,
		};
	} catch (error) {
		await stopChild(child);
		throw error;
	}
}

function secretArgs(
	context: string | undefined,
	namespace: string,
	secretName: string,
	key: string,
): string[] {
	return [
		...(context ? ["--context", context] : []),
		"--namespace",
		namespace,
		"get",
		"secret",
		secretName,
		"--output",
		`jsonpath={.data.${key}}`,
	];
}

async function runKubectlCommand(kubectlPath: string, args: string[]): Promise<string> {
	try {
		const result = await execFile(kubectlPath, args, {
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
		});
		return result.stdout;
	} catch {
		throw new Error("kubectl command failed");
	}
}

function decodeSecretValue(encoded: string, key: string): string {
	const normalized = encoded.trim();
	if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized) || normalized.length % 4 !== 0) {
		throw new Error(`Kubernetes secret does not contain a valid ${key}`);
	}
	const value = Buffer.from(normalized, "base64").toString("utf8").trim();
	if (!value) throw new Error(`Kubernetes secret does not contain a valid ${key}`);
	return value;
}

async function waitForPortForward(child: ChildProcess): Promise<number> {
	return await new Promise<number>((resolveReady, rejectReady) => {
		let output = "";
		let settled = false;
		const timeout = setTimeout(
			() => finish(new Error("kubectl port-forward did not become ready")),
			PORT_FORWARD_READY_TIMEOUT_MS,
		);
		const finish = (error?: Error, port?: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			child.off("error", onError);
			child.off("close", onClose);
			child.stdout?.off("data", onData);
			child.stderr?.off("data", onData);
			if (error) rejectReady(error);
			else if (port !== undefined) resolveReady(port);
			else rejectReady(new Error("kubectl port-forward did not report a local port"));
		};
		const onData = (chunk: Buffer | string) => {
			output = `${output}${String(chunk)}`.slice(-16 * 1024);
			const match = new RegExp(
				`Forwarding from 127\\.0\\.0\\.1:([1-9][0-9]*) -> ${OBJECT_STORE_PORT}`,
			).exec(output);
			if (match?.[1]) finish(undefined, Number(match[1]));
		};
		const onError = () => finish(new Error("kubectl port-forward failed to start"));
		const onClose = () => finish(new Error("kubectl port-forward exited before becoming ready"));
		child.on("error", onError);
		child.on("close", onClose);
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
	});
}

async function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	await waitForChildExit(child, PORT_FORWARD_STOP_TIMEOUT_MS);
	if (child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await waitForChildExit(child, PORT_FORWARD_STOP_TIMEOUT_MS);
	}
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	await Promise.race([
		new Promise<void>((resolveClosed) => child.once("close", () => resolveClosed())),
		new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, timeoutMs)),
	]);
}

function required(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${label} is required`);
	return normalized;
}
