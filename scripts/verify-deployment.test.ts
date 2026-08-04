import { describe, expect, test } from "bun:test";

import { HOST_CSP, PRODUCTION_CSP } from "../build.ts";
import {
  deploymentDocumentProblems,
  deploymentHeaderProblems,
} from "./verify-deployment.ts";

const productionHeaders = (): Headers =>
  new Headers({
    "Content-Security-Policy": HOST_CSP,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });

describe("deployment verification", () => {
  test("accepts the complete production header policy", () => {
    expect(deploymentHeaderProblems(productionHeaders())).toEqual([]);
  });

  test("reports missing frame protection", () => {
    const headers = productionHeaders();
    headers.set(
      "Content-Security-Policy",
      HOST_CSP.replace("; frame-ancestors 'none'", ""),
    );
    headers.delete("X-Frame-Options");

    expect(deploymentHeaderProblems(headers)).toEqual([
      "Content-Security-Policy is missing: frame-ancestors 'none'",
      'x-frame-options must be "DENY" (got null)',
    ]);
  });

  test("requires the exact production meta policy", () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`;
    expect(deploymentDocumentProblems(html)).toEqual([]);
    expect(
      deploymentDocumentProblems(
        html.replace("connect-src 'none'", "connect-src *"),
      ),
    ).toEqual(["the CSP meta element does not contain the production policy"]);
  });
});
