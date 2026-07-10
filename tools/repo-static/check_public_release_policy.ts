import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{
		label: "public fixture source cleanliness",
		script: "tools/repo-static/checks/check_public_fixture_source_clean.ts",
	},
	{
		label: "public asset source cleanliness",
		script: "tools/repo-static/checks/check_public_asset_source_clean.ts",
	},
	{
		label: "source-derived config cleanliness",
		script: "tools/repo-static/checks/check_source_derived_config_clean.ts",
	},
	{
		label: "public source-token cleanliness",
		script: "tools/repo-static/checks/check_public_source_tokens.ts",
	},
	{
		label: "open-source metadata",
		script: "tools/repo-static/checks/check_open_source_metadata.ts",
	},
	{
		label: "dependency license policy",
		script: "tools/repo-static/checks/check_dependency_license_policy.ts",
	},
	{
		label: "object-store bucket policy",
		script: "tools/repo-static/checks/check_object_store_bucket_policy.ts",
	},
]);
