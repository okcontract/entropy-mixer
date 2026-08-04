import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateArtifact } from "../build.ts";

const outputDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
const files = await validateArtifact(outputDirectory);

const lines: string[] = [];
for (const file of files) {
  const bytes = await Bun.file(join(outputDirectory, file)).arrayBuffer();
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  lines.push(`${digest}  ${file}`);
}

await writeFile(join(outputDirectory, "SHA256SUMS"), `${lines.join("\n")}\n`);
console.log(`Wrote SHA256SUMS for ${files.length} files`);
