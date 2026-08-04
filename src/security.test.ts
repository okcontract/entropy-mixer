import { describe, expect, test } from "bun:test";

import {
  applyProductionPolicy,
  DEVELOPMENT_CSP,
  HOST_CSP,
  PRODUCTION_CSP,
} from "../build.ts";

const requiredDirectives = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
] as const;

const OKCONTRACT_LOGO_SHA256 =
  "b5e2755084b3a6109d940068b4b3c239d04a9a6eadbdc86f719d08905b8ad4bb";

describe("static delivery policy", () => {
  test("allows development HMR and produces a disconnected policy", async () => {
    const html = await Bun.file(
      new URL("../index.html", import.meta.url),
    ).text();
    const readPolicy = (document: string): string | undefined =>
      document.match(
        /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
      )?.[1];

    expect(readPolicy(html)).toBe(DEVELOPMENT_CSP);
    const productionHtml = applyProductionPolicy(html);
    const policy = readPolicy(productionHtml);
    expect(policy).toBe(PRODUCTION_CSP);
    for (const directive of requiredDirectives) {
      expect(policy).toContain(directive);
    }
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });

  test("ships the approved OKcontract logo", async () => {
    const html = await Bun.file(
      new URL("../index.html", import.meta.url),
    ).text();
    const logo = await Bun.file(
      new URL("../favicon.svg", import.meta.url),
    ).text();

    expect(new Bun.CryptoHasher("sha256").update(logo).digest("hex")).toBe(
      OKCONTRACT_LOGO_SHA256,
    );
    expect(html).toContain(
      '<link rel="icon" type="image/svg+xml" href="./favicon.svg" />',
    );
    expect(html).toContain('<a href="https://okcontract.com"');
    expect(html).toContain('class="site-logo" src="./favicon.svg"');
  });

  test("ships host-enforced isolation headers", async () => {
    const headers = await Bun.file(
      new URL("../_headers", import.meta.url),
    ).text();
    const policy = headers.match(/^\s*Content-Security-Policy: (.+)$/m)?.[1];

    expect(policy).toBe(HOST_CSP);
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(headers).toContain("Cross-Origin-Resource-Policy: same-origin");
  });

  test("keeps every private key and address on one physical line", async () => {
    const html = await Bun.file(
      new URL("../index.html", import.meta.url),
    ).text();

    for (const id of [
      "private-key-output",
      "bitcoin-address-output",
      "ethereum-address-output",
    ]) {
      const idOffset = html.indexOf(`id="${id}"`);
      const start = html.lastIndexOf("<textarea", idOffset);
      const end = html.indexOf(">", idOffset);
      expect(idOffset).toBeGreaterThan(-1);
      expect(html.slice(start, end + 1)).toContain('wrap="off"');
    }
  });

  test("offers both supported BIP-39 phrase lengths", async () => {
    const html = await Bun.file(
      new URL("../index.html", import.meta.url),
    ).text();

    expect(html).toContain('value="bip39-12"');
    expect(html).toContain('value="bip39-24"');
  });

  test("discloses the mnemonic preview passphrase", async () => {
    const html = await Bun.file(
      new URL("../index.html", import.meta.url),
    ).text();
    const main = await Bun.file(new URL("./main.ts", import.meta.url)).text();

    expect(html).toContain("BIP-39 passphrase: none");
    expect(html).toContain('id="mnemonic-preview-settings"');
    expect(main).toContain("mnemonicPreviewSettings.hidden = !isMnemonic");
  });

  test("discloses the experimental-use risk in the app footer", async () => {
    const html = await Bun.file(
      new URL("../index.html", import.meta.url),
    ).text();

    expect(html).toContain('<footer class="site-footer">');
    expect(html).toContain(
      "Experimental and unaudited — use at your own risk; not for meaningful",
    );
  });

  test("wraps mnemonic phrases without wrapping key rows", async () => {
    const main = await Bun.file(new URL("./main.ts", import.meta.url)).text();
    const style = await Bun.file(
      new URL("./style.css", import.meta.url),
    ).text();

    expect(main).toContain(
      'privateKeyOutput.classList.toggle("wrapped-output", isMnemonic)',
    );
    expect(main).toContain(
      'privateKeyOutput.wrap = isMnemonic ? "soft" : "off"',
    );
    expect(style).toMatch(
      /textarea\.wrapped-output\s*{[^}]*white-space:\s*pre-wrap;/,
    );
  });
});
