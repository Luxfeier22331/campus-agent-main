import { generateDiningFloorplanAssets } from "./floorplan-files";

const check = process.argv.includes("--check");
const result = await generateDiningFloorplanAssets({ check });
console.log(
	`${check ? "Checked" : "Generated"} ${result.assets.length} dining floorplan assets.${
		result.removedUntrackedAssets.length > 0
			? ` Removed ${result.removedUntrackedAssets.length} untracked intermediate assets.`
			: ""
	}`,
);
