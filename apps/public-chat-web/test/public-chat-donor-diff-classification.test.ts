import { describe, expect, it } from "vitest";

import donorDiffClassificationDocSource from "../../../docs/reference/public-chat-web-donor-diff-classification.md?raw";
import tsconfigSource from "../tsconfig.json?raw";
import viteConfigSource from "../vite.config.ts?raw";
import {
  acceptedProductDiffPaths,
  exactCompatSeams,
  expectedVendorDiffPaths,
  historicalDebtDiffPaths,
  acceptedRuntimeCompatibilityDiffPaths,
} from "./donor-diff-classification";

const donorSourceModules = import.meta.glob<string>(
  "../../../.tmp/vercel-ai-chatbot/**/*.{css,ts,tsx,d.ts}",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);

const vendorSourceModules = import.meta.glob<string>(
  "../vendor/vercel-ai-chatbot/**/*.{css,ts,tsx,d.ts}",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);

function normalizeDonorKey(moduleKey: string): string {
  return moduleKey.replace(/^..\/..\/..\/\.tmp\/vercel-ai-chatbot\//, "");
}

function normalizeVendorKey(moduleKey: string): string {
  return moduleKey.replace(/^\.\.\/vendor\/vercel-ai-chatbot\//, "");
}

function collectDonorDiff() {
  const donorFiles = new Map(
    Object.entries(donorSourceModules).map(([moduleKey, source]) => [normalizeDonorKey(moduleKey), source]),
  );
  const vendorFiles = new Map(
    Object.entries(vendorSourceModules).map(([moduleKey, source]) => [normalizeVendorKey(moduleKey), source]),
  );
  const allPaths = [...new Set([...donorFiles.keys(), ...vendorFiles.keys()])].sort();
  const onlyLeft: string[] = [];
  const onlyRight: string[] = [];
  const differ: string[] = [];

  for (const relativePath of allPaths) {
    const donorSource = donorFiles.get(relativePath);
    const vendorSource = vendorFiles.get(relativePath);

    if (donorSource !== undefined && vendorSource === undefined) {
      onlyLeft.push(relativePath);
      continue;
    }

    if (donorSource === undefined && vendorSource !== undefined) {
      onlyRight.push(relativePath);
      continue;
    }

    if (donorSource !== vendorSource) {
      differ.push(relativePath);
    }
  }

  return {
    differ,
    donorSnapshotAvailable: donorFiles.size > 0,
    onlyLeft,
    onlyRight,
    vendorPaths: [...vendorFiles.keys()].sort(),
  };
}

describe("public chat donor diff classification", () => {
  it("classifies every remaining vendor diff into accepted categories and leaves no historical debt", () => {
    const { differ, donorSnapshotAvailable, onlyLeft, onlyRight, vendorPaths } = collectDonorDiff();

    if (donorSnapshotAvailable) {
      expect(onlyLeft).toEqual([]);
      expect(onlyRight).toEqual([]);
      expect(differ).toEqual(expectedVendorDiffPaths.filter((relativePath) => relativePath !== "app/globals.css"));
    } else {
      expect(onlyLeft).toEqual([]);
      for (const relativePath of expectedVendorDiffPaths) {
        expect(vendorPaths).toContain(relativePath);
      }
    }

    expect(acceptedProductDiffPaths.length).toBeGreaterThan(0);
    expect(acceptedRuntimeCompatibilityDiffPaths.length).toBeGreaterThan(0);
    expect(historicalDebtDiffPaths).toEqual([]);
  });

  it("keeps exact compat seam ownership explicit in vite and tsconfig", () => {
    for (const seam of exactCompatSeams) {
      expect(viteConfigSource).toContain(seam.ownerPath);
      expect(viteConfigSource).toContain(seam.viteNeedle);

      if (seam.importerNeedle) {
        expect(viteConfigSource).toContain(seam.importerNeedle);
      }

      if (seam.tsconfigNeedle) {
        expect(tsconfigSource).toContain(seam.tsconfigNeedle);
      }
    }
  });

  it("keeps the classification doc aligned with the machine-readable inventory", () => {
    expect(donorDiffClassificationDocSource).toContain("## 当前结论");
    expect(donorDiffClassificationDocSource).toContain("## Accepted Product Diffs");
    expect(donorDiffClassificationDocSource).toContain("## Accepted Runtime Compatibility Diffs");
    expect(donorDiffClassificationDocSource).toContain("## Exact Compat Seam Owners");
    expect(donorDiffClassificationDocSource).toContain("## Historical Debt");
    expect(donorDiffClassificationDocSource).toContain("当前 remaining historical debt 路径数为 `0`");

    for (const relativePath of expectedVendorDiffPaths) {
      expect(donorDiffClassificationDocSource).toContain(relativePath);
    }

    for (const seam of exactCompatSeams) {
      expect(donorDiffClassificationDocSource).toContain(seam.specifier);
      expect(donorDiffClassificationDocSource).toContain(seam.ownerPath);
    }
  });
});
