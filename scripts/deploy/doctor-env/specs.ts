import { discoverEnvContracts } from "../../../packages/contracts/scripts/contracts/env-contracts.ts";

export type Env = Record<string, string | undefined>;
type SettingSpec = Record<string, readonly string[]>;
type FileSpec = Record<
	string,
	{ optional_keys?: readonly string[]; required_keys?: readonly string[] }
>;

export interface SurfaceSpec {
	files: FileSpec;
	optional_settings: SettingSpec;
	providers: Record<string, { checked_keys: readonly string[]; surface_name: string }>;
	required_settings: SettingSpec;
}

const definitions = new Map<string, SurfaceSpec>();

for (const { contract } of discoverEnvContracts()) {
	for (const consumer of contract.consumers) {
		for (const surface of consumer.doctor_surfaces ?? []) {
			const spec = definitions.get(surface) ?? emptySpec();
			for (const key of contract.keys) {
				const required = key.required_by.includes(consumer.id);
				const optional = key.optional_by?.includes(consumer.id) ?? false;
				if (!(required || optional)) {
					continue;
				}
				const file = doctorFileForKey(surface, key.templates ?? []);
				if (file) {
					const fileSpec = spec.files[file] ?? {};
					const field = required ? "required_keys" : "optional_keys";
					fileSpec[field] = [...(fileSpec[field] ?? []), key.name].sort();
					spec.files[file] = fileSpec;
				} else {
					const target = required ? spec.required_settings : spec.optional_settings;
					target[key.name.toLowerCase()] = [key.name];
				}
			}
			definitions.set(surface, spec);
		}
	}
}

export const surfaceSpecs = Object.fromEntries(definitions) as Record<string, SurfaceSpec>;
export type Surface = keyof typeof surfaceSpecs;

function emptySpec(): SurfaceSpec {
	return { files: {}, optional_settings: {}, providers: {}, required_settings: {} };
}

function doctorFileForKey(surface: string, templates: string[]): string | null {
	if (!(surface === "query" || surface === "worker-observability-local")) {
		return null;
	}
	const template = templates.find(
		(path) => path.startsWith("apps/app-api/") || path.startsWith("apps/campus-web/"),
	);
	return template?.endsWith(".example") ? template.slice(0, -".example".length) : null;
}
