import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import { startKubectlPortForward } from "../../../jobs/campus-rag-index-publisher/src/kubectl.ts";

const exec = promisify(execFile);

export async function readProductClusterSecret(
	context: string | undefined,
	namespace: string,
	name: string,
	signal?: AbortSignal,
): Promise<Record<string, string>> {
	if (!namespace.trim()) {
		throw new Error("Explicit cluster namespace is required");
	}
	let stdout: string;
	try {
		({ stdout } = await exec(
			"kubectl",
			[
				...(context?.trim() ? ["--context", context.trim()] : []),
				"-n",
				namespace,
				"get",
				"secret",
				name,
				"-o",
				"json",
			],
			{ maxBuffer: 1024 * 1024, ...(signal ? { signal } : {}) },
		));
	} catch {
		throw new Error(`Cannot read collaborator Secret ${name} in the selected context/namespace`);
	}
	const data = JSON.parse(stdout).data as Record<string, string>;
	return Object.fromEntries(
		Object.entries(data).map(([key, value]) => [
			key,
			Buffer.from(value, "base64").toString("utf8"),
		]),
	);
}

export async function connectProductDatabase(
	context: string | undefined,
	namespace: string,
	signal?: AbortSignal,
) {
	const pg = await readProductClusterSecret(context, namespace, "pg-product-data-ro", signal);
	if (!(pg["ca.crt"] && pg.host && pg.password && pg.database && /^[0-9]+$/u.test(pg.port ?? ""))) {
		throw new Error("Product PostgreSQL collaborator TLS configuration is incomplete");
	}
	if (pg.username !== "product_data_ro") {
		throw new Error("Product pull requires the product_data_ro identity");
	}
	const forward = await startKubectlPortForward({
		context,
		namespace,
		kubectlPath: "kubectl",
		service: "campus-agent-postgres-rw",
		remotePort: Number(pg.port),
		signal,
	});
	const database = new Client({
		host: "127.0.0.1",
		port: forward.port,
		user: pg.username,
		password: pg.password,
		database: pg.database,
		connectionTimeoutMillis: 15_000,
		ssl: { ca: pg["ca.crt"], servername: pg.host, rejectUnauthorized: true },
	});
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> =>
		(closing ??= (async () => {
			signal?.removeEventListener("abort", interrupt);
			await database.end().catch(() => undefined);
			await forward.close();
		})());
	const interrupt = () => {
		void close();
	};
	signal?.addEventListener("abort", interrupt, { once: true });
	try {
		signal?.throwIfAborted();
		await database.connect();
		signal?.throwIfAborted();
		return { database, close };
	} catch (error) {
		await close();
		throw error;
	}
}
