import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir } from "@lane/core";
import { type KnowledgeRecord, KnowledgeRecordSchema } from "@lane/schemas";

// design.md §2.8 — 1-record-1-file under $LANE_DATA_DIR/knowledge/records/<id>.json.
export function knowledgeDir(): string {
  return join(resolveDataDir(), "knowledge", "records");
}

export function knowledgeRecordPath(id: string): string {
  return join(knowledgeDir(), `${id}.json`);
}

export function writeKnowledgeRecord(record: KnowledgeRecord): void {
  const validated = KnowledgeRecordSchema.parse(record);
  mkdirSync(knowledgeDir(), { recursive: true });
  writeFileSync(knowledgeRecordPath(validated.id), JSON.stringify(validated, null, 2));
}

export function listKnowledgeRecords(): KnowledgeRecord[] {
  const dir = knowledgeDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => KnowledgeRecordSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf-8"))));
}
