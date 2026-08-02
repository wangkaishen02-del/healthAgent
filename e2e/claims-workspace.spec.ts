import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("healthAgent 承保管理系统")).toBeVisible();
  await expect(page.locator(".current-user")).toContainText("默认用户");
});

test("查询保单并打开三类只读详情", async ({ page }) => {
  const activePage = page.locator(".page-section:not(.hidden)");
  await activePage.getByRole("textbox", { name: "保单号", exact: true }).fill("GI2026000001");
  const policyResponse = page.waitForResponse((response) => response.url().includes("/api/policies?") && response.ok());
  await activePage.locator(".query-panel").getByRole("button", { name: "查询", exact: true }).click();
  await policyResponse;

  const row = activePage.locator(".result-panel tbody tr").filter({ hasText: "GI2026000001" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("华曜科技");

  await row.getByRole("button", { name: "详细信息" }).click();
  const drawer = page.locator(".drawer-overlay.open .drawer-panel");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("保单基本信息");

  await drawer.getByRole("button", { name: "责任信息" }).click();
  await expect(drawer).toContainText("保障计划、险种与责任");

  await drawer.getByRole("button", { name: "被保人信息" }).click();
  await expect(drawer).toContainText("被保人清单");
});

test("案件查询展示处理人并打开只读案件详情", async ({ page }) => {
  await page.getByRole("button", { name: "综合查询 ▾" }).click();
  await page.locator(".dropdown:not(.hidden)").getByRole("button", { name: "案件查询", exact: true }).click();
  await expect(page.locator('.tab-button[aria-current="page"]')).toHaveText("案件查询");

  const claimResponse = page.waitForResponse((response) => response.url().includes("/api/claim-registrations?") && response.ok());
  await page.locator(".claim-query-form").getByRole("button", { name: "查询", exact: true }).click();
  await claimResponse;

  const table = page.locator(".page-section:not(.hidden) .result-panel table");
  await expect(table.getByRole("columnheader", { name: "当前处理人" })).toBeVisible();
  const firstRow = table.locator("tbody tr").first();
  await expect(firstRow).not.toContainText("没有找到符合条件的案件");
  await firstRow.getByRole("button", { name: "查看详情" }).click();

  const detail = page.locator(".claim-query-review-drawer");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("处理状态");
  await expect(detail).toContainText("当前处理人");
  await expect(detail.getByRole("button", { name: "返回上一页" })).toBeVisible();
  await expect(detail.getByRole("button", { name: /保存|提交|撤件|开始理算|审核结案/ })).toHaveCount(0);
});

test("顶部菜单点击页面空白处后自动收起", async ({ page }) => {
  await page.getByRole("button", { name: "理赔处理 ▾" }).click();
  const dropdown = page.locator(".menu-item").filter({ hasText: "理赔处理" }).locator(".dropdown");
  await expect(dropdown).not.toHaveClass(/hidden/);
  await page.locator(".workspace").click({ position: { x: 5, y: 5 } });
  await expect(dropdown).toHaveClass(/hidden/);
});
