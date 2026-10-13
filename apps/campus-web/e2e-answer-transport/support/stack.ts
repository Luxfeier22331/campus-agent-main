import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import {
	calculateLocalDevRuntimePorts,
	loadLocalDevProfile,
} from "../../../../scripts/dev/lifecycle/profile";

const root = resolve(import.meta.dirname, "../../../..");
const require = createRequire(resolve(root, "apps/app-api/package.json"));
const { Client } = require("pg") as {
	Client: new (input: {
		connectionString: string;
	}) => {
		connect(): Promise<void>;
		end(): Promise<void>;
		query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
	};
};
const profile = loadLocalDevProfile(root);
const ports = calculateLocalDevRuntimePorts(profile.slot);
const origin = (port: number) => `http://127.0.0.1:${port}`;
const environment = (app: string) => {
	const path = resolve(root, `apps/${app}/.env.local`);
	return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
};
export const answerText = "临时传输验收 😀 中文正文。".repeat(100);
export class AnswerTransportStack {
	readonly webOrigin = origin(profile.ports.campusWeb);
	readonly controlBPort = ports.executionControl + 30;
	readonly providerPort = ports.executionControl + 31;
	readonly proxyPort = ports.executionControl + 32;
	readonly processes = new Map<string, ChildProcess>();
	modelCalls = 0;
	deltaCalls = 0;
	unavailable = false;
	private savedConfig: Record<string, unknown> | undefined;
	private readonly servers: ReturnType<typeof createServer>[] = [];
	private readonly logRoot = resolve(root, "var/dev/answer-transport");
	private async launch(
		name: string,
		app: string,
		command: string,
		args: string[],
		overrides: Record<string, string> = {},
	) {
		const env = { ...process.env, ...environment(app), ...overrides };
		for (const key of [
			"HTTP_PROXY",
			"HTTPS_PROXY",
			"ALL_PROXY",
			"http_proxy",
			"https_proxy",
			"all_proxy",
		]) {
			delete env[key];
		}
		const log = createWriteStream(resolve(this.logRoot, `${name}.log`), { flags: "a" });
		const child = spawn(command, args, {
			cwd: resolve(root, `apps/${app}`),
			env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		child.stdout?.pipe(log);
		child.stderr?.pipe(log);
		child.once("exit", () => log.end());
		this.processes.set(name, child);
	}
	private async build(app: string, entry: string, name: string) {
		const child = spawn("go", ["build", "-o", resolve(this.logRoot, name), entry], {
			cwd: resolve(root, `apps/${app}`),
			stdio: "inherit",
		});
		const [code] = await once(child, "exit");
		if (code !== 0) {
			throw new Error(`build ${app}: ${code}`);
		}
	}
	async wait(url: string) {
		const end = Date.now() + 120_000;
		while (Date.now() < end) {
			for (const [name, child] of this.processes) {
				if (child.exitCode !== null || child.signalCode !== null) {
					throw new Error(`${name} exited; logs: ${this.logRoot}`);
				}
			}
			try {
				if ((await fetch(url, { signal: AbortSignal.timeout(10_000) })).ok) {
					return;
				}
			} catch {
				/* retry until the service is ready */
			}
			await delay(200);
		}
		throw new Error(`service not ready: ${url}; logs: ${this.logRoot}`);
	}
	async start() {
		mkdirSync(this.logRoot, { recursive: true });
		await Promise.all([
			this.build("agent-control", "./cmd/agent-control", "control"),
			this.build("model-config", "./cmd/model-config", "model-config"),
			this.build("memory-service", "./cmd/memory-api", "memory-api"),
			this.build("cluster-private-ingress", "./cmd/cluster-private-ingress", "ingress"),
		]);
		const provider = createServer(async (req, res) => {
			if (req.method !== "POST") {
				res.end("ok");
				return;
			}
			for await (const _chunk of req) {
				/* consume provider request */
			}
			const chunk = (text: string, finished: boolean) => ({
				candidates: [
					{
						index: 0,
						content: { role: "model", parts: [{ text }] },
						...(finished ? { finishReason: "STOP" } : {}),
					},
				],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100, totalTokenCount: 110 },
			});
			if (!req.url?.includes("streamGenerateContent")) {
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify(chunk("OK", true)));
				return;
			}
			this.modelCalls++;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const output = Array.from(
				JSON.stringify({ result: { outcome: "answer", answer: answerText } }),
			);
			for (let i = 0; i < output.length; i += 80) {
				if (res.destroyed) {
					return;
				}
				res.write(
					`data: ${JSON.stringify(chunk(output.slice(i, i + 80).join(""), i + 80 >= output.length))}\n\n`,
				);
				await delay(100);
			}
			res.end();
		});
		provider.listen(this.providerPort, "127.0.0.1");
		await once(provider, "listening");
		this.servers.push(provider);
		const proxy = createServer(async (req, res) => {
			if (req.url?.endsWith("answer/delta")) {
				this.deltaCalls++;
				if (this.unavailable) {
					res.writeHead(503, { "content-type": "application/json" });
					res.end(JSON.stringify({ code: "runtime_control_failed", retryable: true }));
					return;
				}
			}
			try {
				const chunks: Buffer[] = [];
				for await (const part of req) {
					chunks.push(Buffer.from(part));
				}
				const headers = new Headers();
				for (const [key, value] of Object.entries(req.headers)) {
					if (
						value &&
						!["host", "content-length", "connection", "transfer-encoding"].includes(key)
					) {
						headers.set(key, Array.isArray(value) ? value.join(",") : value);
					}
				}
				const out = await fetch(origin(ports.executionControl) + (req.url ?? "/"), {
					method: req.method ?? "GET",
					headers,
					...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
				});
				res.writeHead(out.status, { "content-type": "application/json" });
				res.end(Buffer.from(await out.arrayBuffer()));
			} catch {
				res.writeHead(503);
				res.end();
			}
		});
		proxy.listen(this.proxyPort, "127.0.0.1");
		await once(proxy, "listening");
		this.servers.push(proxy);
		await this.launch("model-config", "model-config", resolve(this.logRoot, "model-config"), []);
		await this.wait(`${origin(ports.modelConfig)}/healthz`);
		const modelUrl = origin(ports.modelConfig);
		const database = new Client({
			connectionString: environment("model-config").MODEL_CONFIG_DATABASE_URL ?? "",
		});
		await database.connect();
		try {
			const result = await database.query(
				"select to_jsonb(m) as config from model_config.model_configs m where name='primary_agent'",
			);
			this.savedConfig = result.rows[0]?.config as Record<string, unknown> | undefined;
			if (!this.savedConfig || this.savedConfig.model === "answer-transport-test") {
				throw new Error(
					"Seed a real local primary_agent config before answer transport acceptance",
				);
			}
		} finally {
			await database.end();
		}
		const configure = await fetch(`${modelUrl}/internal/admin/model-configs/primary_agent`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				provider: "google",
				api_protocol: "google.generate_content",
				base_url: origin(this.providerPort),
				model: "answer-transport-test",
				api_key: "local-test",
			}),
		});
		if (!configure.ok) {
			throw new Error(`local model setup failed: ${configure.status} ${await configure.text()}`);
		}
		await this.launch("memory-api", "memory-service", resolve(this.logRoot, "memory-api"), []);
		await this.launch("control-a", "agent-control", resolve(this.logRoot, "control"), [], {
			EXECUTION_CONTROL_ANSWER_TRANSPORT: "stream",
		});
		await this.startControlB();
		await this.launch("ingress", "cluster-private-ingress", resolve(this.logRoot, "ingress"), [], {
			EXECUTION_CONTROL_BASE_URL: origin(this.controlBPort),
		});
		await this.launch("runtime", "agent-runtime", "node", ["--import=tsx", "src/worker.ts"], {
			AGENT_CONTROL_BASE_URL: origin(this.proxyPort),
		});
		await this.launch("app-api", "app-api", "pnpm", ["dev", "--inspector-port", "0"]);
		await this.wait(`${origin(profile.ports.appApi)}/readyz`);
		await this.launch(
			"campus-web",
			"campus-web",
			"pnpm",
			[
				"exec",
				"wrangler",
				"dev",
				"--config",
				"dist/campus_web/wrangler.json",
				"--local",
				"--inspector-port",
				"0",
				"--ip",
				"127.0.0.1",
				"--port",
				String(profile.ports.campusWeb),
				"--env-file",
				".dev.vars.local",
				"--var",
				"APP_API_BASE_URL:https://app-api.internal",
			],
			{
				...parseEnv(readFileSync(resolve(root, "apps/campus-web/.dev.vars.local"), "utf8")),
				WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1",
				XDG_CONFIG_HOME: resolve(root, ".wrangler-home"),
			},
		);
		await Promise.all([
			this.wait(`${origin(ports.executionControl)}/readyz`),
			this.wait(`${origin(this.controlBPort)}/readyz`),
			this.wait(`${origin(profile.ports.appApi)}/readyz`),
			this.wait(`${this.webOrigin}/theme-bootstrap.js`),
		]);
	}
	private startControlB() {
		return this.launch("control-b", "agent-control", resolve(this.logRoot, "control"), [], {
			PORT: String(this.controlBPort),
			EXECUTION_CONTROL_ANSWER_TRANSPORT: "stream",
		});
	}
	async restartReader() {
		await this.stop("control-b");
		await this.startControlB();
		await this.wait(`${origin(this.controlBPort)}/readyz`);
	}
	private async stop(name: string) {
		const child = this.processes.get(name);
		if (!child?.pid) {
			return;
		}
		const pid = child.pid;
		const signalGroup = (signal: NodeJS.Signals) => {
			try {
				process.kill(-pid, signal);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
					throw error;
				}
			}
		};
		const done =
			child.exitCode === null && child.signalCode === null
				? once(child, "exit")
				: Promise.resolve();
		signalGroup("SIGTERM");
		await Promise.race([done, delay(5000)]);
		// Launchers may exit before their workerd children; retire the entire owned group.
		signalGroup("SIGKILL");
		this.processes.delete(name);
	}

	async restoreProviderConfig() {
		if (!this.savedConfig) {
			throw new Error("No local primary_agent configured for real-provider acceptance");
		}
		const database = new Client({
			connectionString: environment("model-config").MODEL_CONFIG_DATABASE_URL ?? "",
		});
		await database.connect();
		try {
			// Restore the exact encrypted local row without revalidating an external provider.
			await database.query(
				`update model_config.model_configs set
				(provider,api_protocol,base_url,model,encrypted_api_key,updated_at,updated_by,
				validation_status,validation_error_code,validation_message,validation_observed_dimensions,validated_at,validated_by) =
				(select provider,api_protocol,base_url,model,encrypted_api_key,updated_at,updated_by,
				validation_status,validation_error_code,validation_message,validation_observed_dimensions,validated_at,validated_by
				from jsonb_populate_record(null::model_config.model_configs,$1::jsonb)) where name='primary_agent'`,
				[JSON.stringify(this.savedConfig)],
			);
		} finally {
			await database.end();
		}
	}
	async close() {
		try {
			if (this.savedConfig) {
				await this.restoreProviderConfig();
			}
		} finally {
			await this.stop("runtime");
			await Promise.all([...this.processes.keys()].map((name) => this.stop(name)));
			for (const server of this.servers) {
				server.closeAllConnections();
				server.close();
			}
		}
	}
}
