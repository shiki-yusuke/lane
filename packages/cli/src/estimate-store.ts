import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Estimate, EstimateSchema } from "@lane/schemas";

export function estimatePath(specDir: string, intentId: string): string {
  return join(specDir, intentId, "estimate.json");
}

export function readEstimateIfExists(specDir: string, intentId: string): Estimate | null {
  const path = estimatePath(specDir, intentId);
  if (!existsSync(path)) return null;
  return EstimateSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
}

export function writeEstimate(specDir: string, intentId: string, estimate: Estimate): void {
  const validated = EstimateSchema.parse(estimate);
  const path = estimatePath(specDir, intentId);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(validated, null, 2));
}
