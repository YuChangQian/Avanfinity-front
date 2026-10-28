import { expect, test } from "@playwright/test";

test("login renders and refreshes the PNG CAPTCHA", async ({ page }) => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  let requests = 0;
  await page.route("**/api/auth/captcha", (route) => {
    requests += 1;
    return route.fulfill({ json: { code: 0, data: { required: true, id: `captcha-${requests}`, image: png, expiresIn: 300 } } });
  });

  await page.goto("/login");

  await expect(page.getByAltText("登录图形验证码")).toHaveAttribute("src", png, { timeout: 10_000 });
  await page.getByPlaceholder("输入图中 5 位数字").fill("1a234");
  await page.getByPlaceholder("输入图中 5 位数字").pressSequentially("56");
  await expect(page.getByPlaceholder("输入图中 5 位数字")).toHaveValue("12345");
  await page.getByRole("button", { name: "刷新验证码" }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByPlaceholder("输入图中 5 位数字")).toHaveValue("");
});

test("email verification removes the one-time token from browser history", async ({ page }) => {
  const token = "a".repeat(64);
  let requests = 0;
  let finishVerification!: () => void;
  const verificationPending = new Promise<void>((resolve) => { finishVerification = resolve; });
  await page.addInitScript(() => sessionStorage.setItem("avanfinity.email-verification.v1", JSON.stringify({
    email: "pending@security.invalid", resendAt: Date.now() + 60_000,
  })));
  await page.route("**/api/auth/email/verify", async (route) => {
    requests += 1;
    expect(route.request().postDataJSON()).toEqual({ token });
    await verificationPending;
    await route.fulfill({ json: { code: 0, msg: "邮箱验证成功，请登录" } });
  });

  await page.goto(`/verify-email?token=${token}`);

  await expect(page).toHaveURL(/\/verify-email$/);
  await expect.poll(() => requests).toBe(1);
  finishVerification();
  await expect(page.getByRole("link", { name: "继续登录" })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(window.history.state))).not.toContain(token);
  expect(await page.evaluate(() => sessionStorage.getItem("avanfinity.email-verification.v1"))).toBeNull();
});

test("email resend disables duplicate submits and keeps its cooldown across refresh", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/auth/email/resend", async (route) => {
    requests += 1;
    expect(route.request().postDataJSON()).toEqual({ email: "pending@security.invalid" });
    await route.fulfill({ json: {
      code: 0,
      msg: "如果账户需要验证，重发请求已受理",
      data: { cooldownSeconds: 60 },
    } });
  });

  await page.goto("/verify-email");
  await page.getByLabel("邮箱").fill("pending@security.invalid");
  await page.getByRole("button", { name: "重新发送验证邮件" }).dblclick();

  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole("button", { name: /秒后可重新发送/ })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel("邮箱")).toHaveValue("pending@security.invalid");
  await expect(page.getByRole("button", { name: /秒后可重新发送/ })).toBeDisabled();
  expect(requests).toBe(1);
});

test("email resend honors Retry-After after a rate limit", async ({ page }) => {
  await page.route("**/api/auth/email/resend", (route) => route.fulfill({
    status: 429,
    headers: { "retry-after": "2" },
    json: { error: "此设备请求过于频繁，请稍后再试" },
  }));

  await page.goto("/verify-email");
  await page.getByLabel("邮箱").fill("pending@security.invalid");
  await page.getByRole("button", { name: "重新发送验证邮件" }).click();

  await expect(page.getByRole("alert")).toContainText("此设备请求过于频繁");
  await expect(page.getByRole("button", { name: /秒后可重新发送/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "重新发送验证邮件" })).toBeEnabled({ timeout: 4_000 });
});

test("MFA enrollment displays secrets once and clears the enrollment session", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("language", "zh");
    localStorage.setItem("session", JSON.stringify({
      token: "enrollment-token",
      email: "identity@security.invalid",
      mfaEnrollmentRequired: true,
      mfaLevel: "enrollment",
    }));
  });
  await page.route("**/api/auth/mfa/status", (route) => route.fulfill({
    json: { code: 0, data: { state: "not_enrolled", required: true } },
  }));
  await page.route("**/api/auth/mfa/enroll", (route) => route.fulfill({
    json: { code: 0, data: {
      secret: "A".repeat(32),
      otpauthUri: `otpauth://totp/AVANFINITY:test?secret=${"A".repeat(32)}&algorithm=SHA256`,
    } },
  }));
  const recoveryCodes = Array.from({ length: 10 }, (_, index) =>
    `AVF-${index.toString(16).toUpperCase().padStart(4, "0")}-1111-2222-3333-4444-5555-6666-7777`);
  await page.route("**/api/auth/mfa/confirm", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ credential: "123456" });
    await route.fulfill({ json: { code: 0, data: { recoveryCodes, loginRequired: true } } });
  });

  await page.goto("/mfa/setup");
  await page.getByRole("button", { name: "开始设置 MFA" }).click();
  await expect(page.getByText("A".repeat(32), { exact: true })).toBeVisible();
  await page.getByLabel("输入验证器中的 6 位动态码").fill("123456");
  await page.getByRole("button", { name: "启用 MFA" }).click();

  await expect(page.getByRole("heading", { name: "保存一次性恢复码" })).toBeVisible();
  await expect(page.locator(".recovery-panel code")).toHaveCount(10);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("session") ?? "null"))).toBeNull();
  await expect(page.getByText("A".repeat(32), { exact: true })).toHaveCount(0);
});
