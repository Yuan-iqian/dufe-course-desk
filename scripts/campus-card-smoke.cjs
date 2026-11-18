const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CAMPUS_CARD_URL, isCampusCardNavigation } = require('../src/shared/campus-card.cjs');
const root = path.resolve(__dirname,'..');
const output = process.env.COURSE_DESK_TEST_OUTPUT || path.join(root,'校园码接入-交付/工作过程/验证');
fs.mkdirSync(output,{recursive:true});
const checks = [];
const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='ELECTRON_RUN_AS_NODE'));
(async()=>{
  let app;
  try {
    assert.equal(new URL(CAMPUS_CARD_URL).search,'');
    for(const url of ['http://sso.dufe.edu.cn/','https://dufe.edu.cn.attacker.test/','https://x@dufe.edu.cn/','file:///tmp/test','https://sso.dufe.edu.cn:8443/'])assert.equal(isCampusCardNavigation(url),false);
    assert.equal(isCampusCardNavigation(CAMPUS_CARD_URL),true);
    checks.push('固定入口不带个人授权参数，拒绝非学校、明文、自定义端口和带账号的地址');
    const packaged = process.env.COURSE_DESK_EXECUTABLE;
    app = await electron.launch({executablePath:packaged || require('electron'),args:[...(packaged?[]:[root]),'--test-mode',`--profile=${path.join(output,'校园码测试数据')}`],env,timeout:30000});
    assert.equal(await app.evaluate(({app})=>app.getVersion()),require('../package.json').version);
    await app.evaluate(async({session})=>{
      globalThis.cardFixture={account:'测试甲',offline:false,delay:0,entries:[]};
      const s=session.fromPartition('persist:dufe-school');
      await s.cookies.set({url:'https://sso.dufe.edu.cn',name:'card-test',value:'shared-test-session',domain:'.dufe.edu.cn',secure:true});
      s.protocol.handle('https',async request=>{
        const u=new URL(request.url),f=globalThis.cardFixture;
        if(u.hostname==='sso.dufe.edu.cn'){
          f.entries.push(u.pathname+u.search);
          if(f.offline)throw new Error('test offline');
          if(f.delay)await new Promise(r=>setTimeout(r,f.delay));
          const label=f.account||'请在学校登录';
          return new Response(`<!doctype html><meta charset="utf-8"><title>校园码受控样本</title><body style="font:20px sans-serif;background:white;color:#182a40;padding:24px;text-align:center"><h2>${label}</h2><p>校园码受控样本</p><div style="width:240px;height:240px;background:#f1f5fa;margin:30px auto;display:grid;place-items:center">仅测试页面</div><a href="https://example.invalid/">外部链接</a></body>`,{headers:{'content-type':'text/html'}});
        }
        if(u.hostname==='ginkgostu.dufe.edu.cn'){
          if(u.pathname==='/')return new Response('<!doctype html><title>课程监控样本</title><script>localStorage.setItem("token","fixture-token");localStorage.setItem("STUDENTNO","fixture-user");localStorage.setItem("batch","fixture-term");</script>',{headers:{'content-type':'text/html'}});
          const data=u.pathname==='/student/currentDate'?{theWeek:10}:[];
          return new Response(JSON.stringify({code:'2000',data}),{headers:{'content-type':'application/json'}});
        }
        return new Response('blocked',{status:403});
      });
    });
    const main = await app.firstWindow();
    const errors=[];
    main.on('pageerror',e=>errors.push(e.message));
    await expect(main.locator('#startup-intro')).toBeHidden({timeout:5000});
    await expect(main.getByRole('button',{name:'打开我的校园码'})).toBeVisible();
    await main.screenshot({path:path.join(output,'校园码入口-桌面.png'),animations:'disabled'});
    await main.evaluate(()=>window.reminder.invoke('login'));
    await main.locator('#campus-card-open').click();
    const cardPage = async()=>{
      await expect.poll(()=>app.windows().filter(p=>p.url().endsWith('campus-card-window.html')).length).toBe(1);
      return app.windows().find(p=>p.url().endsWith('campus-card-window.html'));
    };
    let shell = await cardPage();
    await expect(shell.locator('#card-placeholder')).toBeHidden();
    const topology=await app.evaluate(({BrowserWindow,webContents,session})=>{
      const school=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('https://ginkgostu'));
      const card=webContents.getAllWebContents().find(w=>w.getURL().includes('/person_card/'));
      return {separate:school.webContents.id!==card.id,shared:school.webContents.session===card.session,courseOrigin:new URL(school.webContents.getURL()).origin,preload:card.getLastWebPreferences().preload||null};
    });
    assert.equal(topology.separate,true);assert.equal(topology.shared,true);assert.equal(topology.preload,null);
    assert.equal(topology.courseOrigin,'https://ginkgostu.dufe.edu.cn');
    checks.push('校园码使用独立窗口并共享学校登录，打开时不改变课程监控页面，无本地权限桥');
    const preview=await app.evaluate(async({BrowserWindow,desktopCapturer})=>{
      const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('campus-card-window.html'));
      w.show();w.focus();
      const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:840,height:1300}});
      const source=sources.find(s=>s.id===w.getMediaSourceId());
      if(!source)throw new Error('校园码测试窗口截图失败');
      return source.thumbnail.toPNG().toString('base64');
    });
    fs.writeFileSync(path.join(output,'校园码窗口-受控样本.png'),Buffer.from(preview,'base64'));
    await main.evaluate(()=>window.reminder.invoke('open-campus-card','https://example.invalid/?code=bad'));
    assert.equal(app.windows().filter(p=>p.url().endsWith('campus-card-window.html')).length,1);
    await shell.locator('#card-reload').click();
    await expect(shell.locator('#card-placeholder')).toBeHidden();
    assert.ok((await app.evaluate(()=>globalThis.cardFixture.entries)).every(s=>s==='/app.php/open_apps/person_card/index/index'));
    checks.push('连续打开只保留一个窗口，刷新始终进入官方固定地址');
    await main.evaluate(()=>window.reminder.invoke('refresh'));
    assert.equal((await main.evaluate(()=>window.reminder.invoke('snapshot'))).data.connected,true);
    await expect(shell.locator('#card-placeholder')).toBeHidden();
    checks.push('校园码展示期间仍可同步课程，监控没有误判登录失效');
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('suspend'));
    await expect(shell.locator('#card-status')).toHaveText('恢复后重新连接学校');
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));
    await expect(shell.locator('#card-placeholder')).toBeHidden();
    checks.push('休眠遮住旧画面，恢复后重新加载学校页面');
    await app.evaluate(()=>{globalThis.cardFixture.offline=true;});
    await shell.locator('#card-reload').click();
    await expect(shell.locator('#card-retry')).toBeVisible({timeout:10000});
    await app.evaluate(()=>{globalThis.cardFixture.offline=false;});
    await shell.locator('#card-retry').click();
    await expect(shell.locator('#card-placeholder')).toBeHidden();
    checks.push('连接失败隐藏旧码并提供重试，网络恢复可以重新显示');
    await app.evaluate(({webContents})=>{
      const card=webContents.getAllWebContents().find(w=>w.getURL().includes('/person_card/'));
      void card.executeJavaScript("document.querySelector('a').click()");
    });
    await expect(shell.locator('#card-retry')).toBeVisible();
    assert.equal(await app.evaluate(({webContents})=>webContents.getAllWebContents().some(w=>w.getURL().startsWith('https://example.invalid/'))),false);
    await shell.locator('#card-retry').click();
    await expect(shell.locator('#card-placeholder')).toBeHidden();
    checks.push('官方窗口拦截校外导航');
    await app.evaluate(({webContents})=>{globalThis.oldCardContents=webContents.getAllWebContents().find(w=>w.getURL().includes('/person_card/'));});
    await main.evaluate(()=>window.reminder.invoke('logout-school'));
    await expect.poll(()=>app.windows().filter(p=>p.url().endsWith('campus-card-window.html')).length).toBe(0);
    const cookies=await app.evaluate(({session})=>session.fromPartition('persist:dufe-school').cookies.get({name:'card-test'}));
    assert.equal(cookies.length,0);
    await app.evaluate(()=>{globalThis.cardFixture.account='';});
    await main.locator('#campus-card-open').click();
    shell=await cardPage();
    await expect(shell.locator('#card-placeholder')).toBeHidden();
    await app.evaluate(()=>{
      const old=globalThis.oldCardContents;
      old.emit('did-start-navigation',{},'about:blank',false,true);
      old.emit('did-fail-load',{},-2,'test late failure','about:blank',true);
      old.emit('did-finish-load');
    });
    await expect(shell.locator('#card-placeholder')).toBeHidden();
    checks.push('旧窗口迟到的加载和失败事件不能污染重开的新窗口');
    assert.equal(await app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.getURL().includes('/person_card/')).length),1);
    const cardText=await app.evaluate(async({webContents})=>webContents.getAllWebContents().find(w=>w.getURL().includes('/person_card/')).executeJavaScript('document.body.innerText'));
    assert.ok(cardText.includes('请在学校登录'));assert.ok(!cardText.includes('测试甲'));
    checks.push('退出账号关闭旧窗口并清除学校登录，再次打开不残留上个账号');
    await shell.locator('#card-close').click();
    await expect.poll(()=>app.windows().filter(p=>p.url().endsWith('campus-card-window.html')).length).toBe(0);
    await expect.poll(()=>app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.getURL().includes('/person_card/')).length)).toBe(0);
    checks.push('返回应用销毁二维码网页，避免后台缓存个人码');
    assert.deepEqual(errors,[]);
    const report={result:'passed',checks,scope:'Electron 实际窗口与受控学校响应，不代表手机原生窗口或校门通行验证'};
    fs.writeFileSync(path.join(output,'校园码专项验证.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally { if(app)await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
