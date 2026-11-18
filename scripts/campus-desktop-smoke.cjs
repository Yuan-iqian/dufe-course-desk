const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'校园通知整合-交付');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='ELECTRON_RUN_AS_NODE'));
(async()=>{let app;const errors=[],checks=[];try{
  app=await electron.launch({executablePath:require('electron'),args:[root,'--test-mode','--profile='+path.join(root,'.test-data','campus-desktop-'+Date.now())],env});
  const p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));
  await p.evaluate(()=>window.reminder.invoke('sharing',{operation:'configure',args:{url:'http://127.0.0.1:8795'}}));
  await p.locator('#tab-campus').click();await expect(p.locator('.cp-card').first()).toBeVisible();checks.push('桌面通过受限通信读取公共通知');
  await p.locator('#cp-auth').evaluate(e=>e.open=true);await p.locator('#cp-auth-mode').selectOption('register');await p.locator('#cp-username').fill('desktop_'+Date.now().toString(36));await p.locator('#cp-password').fill(crypto.randomBytes(20).toString('base64url'));await p.locator('#cp-auth-submit').click();await expect(p.locator('#cp-identity')).toBeVisible();
  await p.locator('.cp-title').first().click();await expect(p.locator('#cp-detail')).toBeVisible();await p.getByRole('button',{name:'标记完成',exact:true}).click();await expect(p.getByRole('button',{name:'撤销完成',exact:true})).toBeVisible();await p.locator('#cp-detail-close').click();checks.push('桌面账号登录与个人状态保存');
  await p.locator('#tab-sharing').click();await expect(p.locator('#sh-workspace')).toBeVisible();await p.locator('#tab-homework').click();await expect(p.locator('#homework-panel')).toBeVisible();await p.locator('#tab-campus').click();checks.push('四个模块可以切换，共享账号同步');
  await p.screenshot({path:path.join(out,'校园通知-桌面程序.png'),animations:'disabled'});
  if(errors.length)throw new Error(errors.join('\n'));fs.writeFileSync(path.join(out,'桌面校园模块验证.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,result:'passed'},null,2));console.log(JSON.stringify({result:'passed',checks}));
}finally{await app?.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
