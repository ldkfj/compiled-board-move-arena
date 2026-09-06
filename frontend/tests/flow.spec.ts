import { expect, test } from "@playwright/test";

test("board-arena public journey is complete and honest", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A movement rule that cannot change mid-game." })).toBeVisible();
  await expect(page.getByText("COMPILE · CONSENT · PLAY")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create arena" })).toBeVisible();
  await expect(page.getByLabel("Coordinate movement rule")).toHaveValue("Move one square orthogonally; no diagonal moves.");
  await expect(page.getByText(/All submitted text is public and permanent/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  await expect(page.getByText(/never another model call/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transaction journal" })).toBeVisible();
  await expect(page.getByText(/never submit a replacement/)).toBeVisible();
});

test("wallet picker renders only detected supported wallets or exact empty state", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("dialog", { name: "Choose wallet" })).toBeVisible();
  await expect(page.getByText("No MetaMask, OKX Wallet, or Rabby provider detected.")).toBeVisible();
  await expect(page.getByText(/Injected wallet|Browser wallet/)).toHaveCount(0);
});

test("mobile layout keeps the complete public workflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Create arena" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inspect arena" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transaction journal" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});
