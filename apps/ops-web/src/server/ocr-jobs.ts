import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { BatchV1Api, KubeConfig } from "@kubernetes/client-node";
export async function launchOcrJob(env: NodeJS.ProcessEnv) {
	if (env.DEPLOYMENT_ENVIRONMENT === "local" || env.DEPLOYMENT_ENVIRONMENT === "development") {
		const child = spawn("pnpm", ["--filter", "document-ocr", "ocr", "resume"], {
			cwd: resolve(import.meta.dirname, "../../../.."),
			stdio: ["ignore", "inherit", "inherit"],
		});
		await new Promise<void>((resolve, reject) => {
			child.once("spawn", resolve);
			child.once("error", reject);
		});
		return;
	}
	const config = new KubeConfig();
	config.loadFromCluster();
	const batch = config.makeApiClient(BatchV1Api);
	const namespace = env.OPS_WEB_KUBERNETES_NAMESPACE || "default";
	const template = await batch.readNamespacedCronJob({ namespace, name: "document-ocr" });
	if (!(template.spec?.jobTemplate.spec && template.metadata?.uid)) {
		throw new Error("OCR CronJob template unavailable");
	}
	const spec = structuredClone(template.spec.jobTemplate.spec);
	const container = spec.template.spec?.containers.find((c) => c.name === "ocr");
	if (!container) {
		throw new Error("OCR container missing from template");
	}
	container.args = ["resume"];
	await batch.createNamespacedJob({
		namespace,
		body: {
			apiVersion: "batch/v1",
			kind: "Job",
			metadata: {
				generateName: "document-ocr-manual-",
				ownerReferences: [
					{
						apiVersion: "batch/v1",
						kind: "CronJob",
						name: "document-ocr",
						uid: template.metadata.uid,
					},
				],
			},
			spec: { ...spec, backoffLimit: 0, ttlSecondsAfterFinished: 86400 },
		},
	});
}
