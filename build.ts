import {
  chmod,
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const policy = (connectSource: string, frameAncestors = false): string =>
  [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    ...(frameAncestors ? ["frame-ancestors 'none'"] : []),
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'none'",
    connectSource,
    "worker-src 'none'",
    "manifest-src 'none'",
  ].join("; ");

export const DEVELOPMENT_CSP = policy("connect-src ws: wss:");
export const PRODUCTION_CSP = policy("connect-src 'none'");
export const HOST_CSP = policy("connect-src 'none'", true);

export const applyProductionPolicy = (html: string): string => {
  const developmentPolicy = `content="${DEVELOPMENT_CSP}"`;
  if (
    !html.includes(developmentPolicy) ||
    html.indexOf(developmentPolicy) !== html.lastIndexOf(developmentPolicy)
  ) {
    throw new Error("Expected exactly one development CSP in built HTML");
  }
  return html.replace(developmentPolicy, `content="${PRODUCTION_CSP}"`);
};

const isMissingPath = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export const validateArtifact = async (
  directory: string,
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error("Build output must contain files only");
  }

  const files = entries.map(({ name }) => name).sort();
  const scripts = files.filter((name) => /^[a-z0-9-]+\.js$/.test(name));
  const styles = files.filter((name) => /^[a-z0-9-]+\.css$/.test(name));
  const images = files.filter((name) => /^[a-z0-9-]+\.svg$/.test(name));
  if (
    files.length !== 7 ||
    !files.includes("_headers") ||
    !files.includes("index.html") ||
    !files.includes("LICENSE") ||
    !files.includes("TRADEMARKS.md") ||
    scripts.length !== 1 ||
    styles.length !== 1 ||
    images.length !== 1
  ) {
    throw new Error(`Unexpected build output: ${files.join(", ")}`);
  }
  return files;
};

export const buildApp = async (): Promise<void> => {
  const packageDirectory = dirname(fileURLToPath(import.meta.url));
  const outputDirectory = join(packageDirectory, "dist");
  const temporaryDirectory = await mkdtemp(
    join(packageDirectory, ".dist-build-"),
  );
  const backupDirectory = join(
    packageDirectory,
    `.dist-backup-${process.pid}-${Date.now()}`,
  );
  let outputInstalled = false;
  let outputBackedUp = false;

  try {
    const result = await Bun.build({
      entrypoints: [join(packageDirectory, "index.html")],
      minify: true,
      outdir: temporaryDirectory,
      target: "browser",
    });
    if (!result.success) {
      throw new Error(result.logs.map(String).join("\n") || "Build failed");
    }

    const htmlPath = join(temporaryDirectory, "index.html");
    const html = await readFile(htmlPath, "utf8");
    await writeFile(htmlPath, applyProductionPolicy(html));
    await copyFile(
      join(packageDirectory, "_headers"),
      join(temporaryDirectory, "_headers"),
    );
    await copyFile(
      join(packageDirectory, "LICENSE"),
      join(temporaryDirectory, "LICENSE"),
    );
    await copyFile(
      join(packageDirectory, "TRADEMARKS.md"),
      join(temporaryDirectory, "TRADEMARKS.md"),
    );
    const files = await validateArtifact(temporaryDirectory);
    await chmod(temporaryDirectory, 0o755);

    try {
      await rename(outputDirectory, backupDirectory);
      outputBackedUp = true;
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }

    try {
      await rename(temporaryDirectory, outputDirectory);
      outputInstalled = true;
    } catch (error) {
      if (outputBackedUp) await rename(backupDirectory, outputDirectory);
      throw error;
    }

    if (outputBackedUp) await rm(backupDirectory, { recursive: true });
    console.log(`Built ${files.join(", ")}`);
  } finally {
    if (!outputInstalled) {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }
};

if (import.meta.main) await buildApp();
