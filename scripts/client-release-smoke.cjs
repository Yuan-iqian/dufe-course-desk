const {_electron,expect}=require('@playwright/test');
const path=require('node:path');const fs=require('node:fs');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'客户端整合-交付','验证');
(async()=>{
 let app;const errors=[];
 try{
  app=await _electron.launch({executablePath:path.join(root,'客户端整合-交付/Windows/课堂签到提醒-win32-x64/SignInReminder.exe'),args:['--demo','--test-mode','--profile='+path.join(out,'桌面测试数据')],env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='ELECTRON_RUN_AS_NODE'))});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.7.0');
  assert.equal(await page.locator('#tab-sharing').count(),0);
  await page.locator('#login').click();await expect(page.locator('.homework-row')).toHaveCount(4);
  await page.locator('#tab-campus').click();await expect(page.locator('#cp-list .cp-card')).not.toHaveCount(0,{timeout:30000});
  await expect(page.locator('#cp-user')).toContainText('演示学校账号');
  await page.locator('#cp-settings').click();await page.locator('#cp-keywords').fill('考试');await page.locator('#cp-preferences-save').click();
  await expect(page.locator('#cp-preferences')).not.toBeVisible();
  await expect(page.locator('#cp-message')).toContainText('已保存');
  await page.screenshot({path:path.join(out,'Windows-校园通知.png'),fullPage:true,animations:'disabled'});
  await page.locator('#cp-logout').click();await expect(page.locator('#cp-auth')).toBeVisible();
  await page.locator('#tab-homework').click();await expect(page.locator('.homework-row')).toHaveCount(0);
  await page.locator('#tab-signin').click();await expect(page.locator('#connection-label')).not.toHaveText('学校登录有效');
  assert.deepEqual(errors,[]);
  const result={version:'0.7.0',result:'passed',checks:['已打包Windows程序可启动','学校身份解锁本机公告设置','生产公开公告服务可同步','退出清空作业与课表','同课共享入口已移除'],errors};
  fs.writeFileSync(path.join(out,'Windows安装版验证.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
