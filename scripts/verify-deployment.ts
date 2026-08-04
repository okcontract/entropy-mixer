import { HOST_CSP, PRODUCTION_CSP } from "../build.ts";

const exactHeaders = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

export const deploymentHeaderProblems = (headers: Headers): string[] => {
  const problems: string[] = [];
  const csp = headers.get("content-security-policy");
  if (!csp) {
    problems.push("missing Content-Security-Policy response header");
  } else {
    for (const directive of HOST_CSP.split("; ")) {
      if (
        !csp
          .split(";")
          .map((part) => part.trim())
          .includes(directive)
      ) {
        problems.push(`Content-Security-Policy is missing: ${directive}`);
      }
    }
  }

  for (const [name, expected] of Object.entries(exactHeaders)) {
    const actual = headers.get(name);
    if (actual !== expected) {
      problems.push(
        `${name} must be ${JSON.stringify(expected)} (got ${JSON.stringify(actual)})`,
      );
    }
  }
  return problems;
};

export const deploymentDocumentProblems = (html: string): string[] => {
  const policies = [
    ...html.matchAll(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/g,
    ),
  ];
  if (policies.length !== 1) {
    return [`expected one CSP meta element, found ${policies.length}`];
  }
  return policies[0]?.[1] === PRODUCTION_CSP
    ? []
    : ["the CSP meta element does not contain the production policy"];
};

const isLocalhost = (url: URL): boolean =>
  url.hostname === "localhost" ||
  url.hostname === "127.0.0.1" ||
  url.hostname === "[::1]";

export const verifyDeployment = async (rawUrl: string): Promise<void> => {
  const requestedUrl = new URL(rawUrl);
  if (requestedUrl.protocol !== "https:" && !isLocalhost(requestedUrl)) {
    throw new Error("Deployment URLs must use HTTPS (localhost is exempt)");
  }

  const response = await fetch(requestedUrl, {
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Deployment returned HTTP ${response.status}`);
  }

  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== "https:" && !isLocalhost(finalUrl)) {
    throw new Error(`Deployment redirected to an insecure URL: ${finalUrl}`);
  }

  const problems = deploymentHeaderProblems(response.headers);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    problems.push(
      `content-type must be HTML (got ${JSON.stringify(contentType)})`,
    );
  }
  problems.push(...deploymentDocumentProblems(await response.text()));

  if (problems.length > 0) {
    throw new Error(
      `Deployment verification failed for ${finalUrl}:\n- ${problems.join("\n- ")}`,
    );
  }
  console.log(`Verified production policy at ${finalUrl}`);
};

if (import.meta.main) {
  const rawUrl = Bun.argv[2];
  if (!rawUrl) {
    throw new Error(
      "Usage: bun run verify:deployment -- https://entropy.example/",
    );
  }
  await verifyDeployment(rawUrl);
}
