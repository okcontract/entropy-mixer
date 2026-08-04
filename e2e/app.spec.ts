import { expect, type Page, test } from "@playwright/test";

const target = (page: Page) => page.locator("#target");

const completeCollection = async (
  page: Page,
  input: "keyboard" | "pointer",
): Promise<void> => {
  const start = page.locator("#start-game");
  if (input === "keyboard") {
    await start.focus();
    await start.press("Enter");
  } else {
    await start.click();
  }

  for (let sample = 1; sample <= 16; sample += 1) {
    await expect(target(page)).toBeVisible();
    await expect(target(page)).toHaveAttribute(
      "aria-label",
      `Target ${sample} of 16`,
    );

    if (input === "keyboard") {
      await target(page).press("Enter");
    } else {
      const bounds = await target(page).boundingBox();
      if (!bounds) throw new Error(`Target ${sample} has no bounding box`);
      await page.mouse.click(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
    }
  }

  await expect(page.locator("#generation-stage")).toBeVisible();
  await expect(page.locator("#generate-keys")).toBeEnabled();
  await expect(page.locator("#crypto-status")).toHaveText(
    "HMAC counter: 0 blocks used",
  );
};

const generate = async (page: Page, keyType: string): Promise<string> => {
  await page.locator("#key-type").selectOption(keyType);
  await expect(page.locator("#private-key-output")).toHaveValue("");
  await page.locator("#generate-keys").click();
  await expect(page.locator("#generate-keys")).toBeEnabled();
  await expect(page.locator("#private-key-output")).not.toHaveValue("");
  return page.locator("#private-key-output").inputValue();
};

test("generates every supported output in the production bundle", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");
  await expect(page.locator(".site-footer")).toContainText(
    "Experimental and unaudited — use at your own risk",
  );
  await completeCollection(page, "pointer");

  const raw128 = await generate(page, "raw-128");
  expect(raw128).toMatch(/^[0-9a-f]{32}$/);
  await page.getByLabel("Base64").check();
  await expect(page.locator("#private-key-output")).toHaveValue(
    /^[A-Za-z0-9+/]{22}==$/,
  );

  await page.getByLabel("Hex").check();
  const raw256 = await generate(page, "raw-256");
  expect(raw256).toMatch(/^[0-9a-f]{64}$/);

  const phrase12 = await generate(page, "bip39-12");
  expect(phrase12.trim().split(/\s+/)).toHaveLength(12);
  await expect(page.locator("#mnemonic-preview-settings")).toHaveText(
    "BIP-39 passphrase: none",
  );
  expect(await page.locator("#bitcoin-address-output").inputValue()).toMatch(
    /^bc1q[0-9a-z]{38}$/,
  );
  expect(await page.locator("#ethereum-address-output").inputValue()).toMatch(
    /^0x[0-9A-Fa-f]{40}$/,
  );

  const phrase24 = await generate(page, "bip39-24");
  expect(phrase24.trim().split(/\s+/)).toHaveLength(24);

  const bitcoinWif = await generate(page, "bitcoin");
  expect(bitcoinWif).toMatch(/^[KL][1-9A-HJ-NP-Za-km-z]{51}$/);
  expect(await page.locator("#bitcoin-address-output").inputValue()).toMatch(
    /^bc1q[0-9a-z]{38}$/,
  );
  await expect(page.locator("#ethereum-output-area")).toBeHidden();

  const ethereumKey = await generate(page, "ethereum");
  expect(ethereumKey).toMatch(/^0x[0-9a-f]{64}$/);
  expect(await page.locator("#ethereum-address-output").inputValue()).toMatch(
    /^0x[0-9A-Fa-f]{40}$/,
  );
  await expect(page.locator("#bitcoin-output-area")).toBeHidden();

  expect(pageErrors).toEqual([]);
});

test("supports keyboard collection, copy cancellation, and reset", async ({
  page,
}) => {
  await page.goto("/");
  await completeCollection(page, "keyboard");
  await generate(page, "raw-256");

  let prompt = "";
  page.once("dialog", async (dialog) => {
    prompt = dialog.message();
    await dialog.dismiss();
  });
  await page.locator("#copy-private-keys").click();
  expect(prompt).toContain("Copy secret material");
  await expect(page.locator("#private-copy-feedback")).toHaveText(
    "Copy cancelled",
  );

  await page.locator("#reset-game").click();
  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#generation-stage")).toBeHidden();
  await expect(page.locator("#private-key-output")).toHaveValue("");
  await expect(page.locator("#click-progress")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
});

test("makes no runtime request outside its own origin", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("/");
  await completeCollection(page, "pointer");
  await generate(page, "raw-128");

  const appOrigin = new URL(page.url()).origin;
  expect(requests.length).toBeGreaterThan(1);
  expect(
    requests.filter((request) => new URL(request).origin !== appOrigin),
  ).toEqual([]);
  await expect(
    page.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveAttribute("content", /connect-src 'none'/);
});
