'use strict';
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = process.env.COURSE_DESK_TEST_OUTPUT || path.join(root, '.test-data');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, '学校账号测试-'));
const vault = path.join(profile, 'school-credentials.bin');
const example = { account: 'fixture-2026', password: 'fixture-password " spaced' };
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'));
let app;
async function launch() {
  const packaged = process.env.COURSE_DESK_EXECUTABLE;
  app = await electron.launch({
    executablePath: packaged || require('electron'),
    args: [...(packaged ? [] : [root]), '--test-mode', '--profile=' + profile],
    env
  });
  const page = await app.firstWindow();
  await expect(page.locator('#startup-intro')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#manage-login')).toBeVisible();
  return page;
}
async function accountDialog(page) {
  await page.locator('#manage-login').click();
  return page.locator('#school-account-dialog');
}
(async () => {
  try {
    let page = await launch();
    let dialog = await accountDialog(page);
    await expect(dialog.getByText('本机尚未保存账号')).toBeVisible();
    await dialog.getByLabel('学校账号', { exact: true }).fill(example.account);
    await dialog.getByLabel('学校密码', { exact: true }).fill(example.password);
    await dialog.getByRole('button', { name: '保存到本机' }).click();
    await expect(dialog.getByText('已保存一个学校账号')).toBeVisible();
    await expect(dialog.getByLabel('学校密码', { exact: true })).toHaveValue('');
    assert.ok(!fs.readFileSync(vault).includes(Buffer.from(example.password)));
    await app.close();

    page = await launch();
    dialog = await accountDialog(page);
    await expect(dialog.getByText('已保存一个学校账号')).toBeVisible();
    await app.evaluate(({ session }) => {
      const partition = session.fromPartition('persist:dufe-school');
      partition.protocol.handle('https', request => {
        const login = 'https://sso.dufe.edu.cn/auth/oauth/authorize';
        if (request.url.startsWith('https://ginkgostu.dufe.edu.cn/')) return Response.redirect(login, 302);
        if (request.url !== login || request.method !== 'GET') return new Response('Unexpected request', { status: 400 });
        return new Response(`<!doctype html><form id="normal_login_form" method="post" action="${login}">
          <input id="username" type="text" name="username"><input id="password_" type="password">
          <button type="submit">登录</button></form>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      });
    });
    const newWindow = app.waitForEvent('window');
    await dialog.getByRole('button', { name: '打开学校并一键填写' }).click();
    const school = await newWindow;
    await expect(school.locator('#username')).toHaveValue(example.account);
    await expect(school.locator('#password_')).toHaveValue(example.password);
    await expect(dialog).toBeHidden();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('https://sso.dufe.edu.cn/')).hide();
    });
    dialog = await accountDialog(page);
    await dialog.getByRole('button', { name: '清除已保存账号' }).click();
    await expect(dialog.getByText('本机尚未保存账号')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '打开学校并一键填写' })).toBeDisabled();
    assert.ok(!fs.existsSync(vault));
    console.log('Windows 本机加密、重启后识别、一键填入官方表单样式、清除与按钮状态通过');
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
