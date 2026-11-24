const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { schoolLoginForm } = require('../../src/shared/school-login-form.cjs');
const { readSchool } = require('../../src/shared/school-protocol.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'www');

(async () => {
  await fs.mkdir(output, { recursive: true });
  for (const folder of ['ui', 'assets', 'vendor']) {
    await fs.cp(path.join(root, '../src', folder), path.join(output, folder), {
      recursive: true,
      filter: source => !/sharing(?:-transport)?\.(?:js|css)$/.test(source) && !/campus-card-window\.(?:html|js|css)$/.test(source)
    });
  }
  let html = await fs.readFile(path.join(root, '../src/ui/index.html'), 'utf8');
  html = html.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .replace("connect-src 'none'", "connect-src 'self'")
    .replace('<script src="renderer.js">', '<script src="mobile-bridge.js"></script>\n  <script src="renderer.js">')
    .replace('</head>', '<link rel="stylesheet" href="mobile.css"></head>')
    .replace('关闭窗口后在托盘继续运行 · 电脑休眠期间暂停检查', '前台检查新消息 · 后台提醒已同步的作业期限')
    .replace('打开 Windows 通知设置', '打开通知设置')
    .replace('<button id="quit" class="text-button">退出软件</button>', '<button id="quit" class="text-button" hidden>返回桌面</button>');
  await fs.writeFile(path.join(output, 'ui/index.html'), html);
  await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><script src="start.js"></script>');
  await fs.writeFile(path.join(output, 'start.js'), "location.replace('./ui/index.html');");
  await fs.copyFile(path.join(root, 'src/mobile.css'), path.join(output, 'ui/mobile.css'));
  await fs.writeFile(path.join(output, 'school-request.js'), '(' + readSchool.toString() + ')');
  await fs.writeFile(path.join(output, 'school-login-form.js'), '(' + schoolLoginForm.toString() + ')');
  await build({
    entryPoints: [path.join(root, 'src/runtime.cjs')], outfile: path.join(output, 'ui/mobile-bridge.js'),
    bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    alias: { 'node:events': 'events' }, minify: false
  });
  console.log('Android 与 iPhone 客户端资源已构建');
})().catch(error => { console.error(error); process.exitCode = 1; });
