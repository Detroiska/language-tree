import { expect, test } from "@playwright/test";

test("boots, adds a language, edits a rule, and saves", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app-shell")).toHaveClass(/is-ready/);

  // Add a root language through the sidebar.
  await page.locator("#sidebar-add-root").click();
  const nameInput = page.locator("#prompt-form input");
  await expect(nameInput).toBeVisible();
  await nameInput.fill("Smoke Test Language");
  await page.locator('button[type="submit"][form="prompt-form"]').click();
  await expect(page).toHaveURL(/#\/language\/[^/]+\/overview/);
  await expect(page.locator("h1")).toHaveText("Smoke Test Language");

  // Add and edit a sound-change rule.
  await page.getByRole("link", { name: /Sound changes/ }).click();
  await expect(page).toHaveURL(/\/changes$/);
  await page.locator("[data-add-rule]").first().click();
  const ruleInput = page.locator(".rule-input").first();
  await expect(ruleInput).toBeVisible();
  await ruleInput.fill("p > f");

  // The edit is autosaved; read it back through the API to prove it landed.
  await expect
    .poll(
      async () => {
        const project = await page.evaluate(() => fetch("/api/project").then((response) => response.json()));
        const language = project.languages.find((item) => item.name === "Smoke Test Language");
        return language?.soundChanges?.some((rule) => rule.notation === "p > f") ?? false;
      },
      { timeout: 10_000 }
    )
    .toBe(true);
  await expect(page.locator("#save-state")).toContainText("Saved");
});
