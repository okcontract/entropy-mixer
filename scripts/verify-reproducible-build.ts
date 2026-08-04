import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "../build.ts";

const outputDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

const buildDigests = async (): Promise<Record<string, string>> => {
  await buildApp();
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const result: Record<string, string> = {};

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isFile()) {
      throw new Error(`Build output contains a non-file entry: ${entry.name}`);
    }
    const bytes = await Bun.file(
      join(outputDirectory, entry.name),
    ).arrayBuffer();
    result[entry.name] = new Bun.CryptoHasher("sha256")
      .update(bytes)
      .digest("hex");
  }

  return result;
};

const first = await buildDigests();
const second = await buildDigests();
if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error(
    `Consecutive builds differ:\nfirst: ${JSON.stringify(first, null, 2)}\nsecond: ${JSON.stringify(second, null, 2)}`,
  );
}

console.log(
  `Verified reproducible build for ${Object.keys(first).length} files`,
);
