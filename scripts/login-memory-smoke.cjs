'use strict';
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = process.env.COURSE_DESK_TEST_OUTPUT || path.join(root, '账号记忆-交付/工作过程/验证');
fs.mkdirSync(out, {recursive:true});
const profile = path.join(out, '登录记忆测试-' + Date.now());
const env = Object.fromEntries(Object.entries(process.env).filter(([name])=>name!=='ELECTRON_RUN_AS_NODE'));
const checks = [];
let instance;
async function launch() {
  const packaged = process.env.COURSE_DESK_EXECUTABLE;
  instance = await electron.launch({executablePath:packaged || require('electron'),
    args:[...(packaged?[]:[root]),'--test-mode','--profile='+profile],env,timeout:30000});
  const page = await instance.firstWindow();
  await expect(page.locator('#startup-intro')).toBeHidden({timeout:5000});
  return page;
}
// Remove only the browser cookie database in this newly created test profile,
// so the restart must use the encrypted backup instead of Chromium persistence.
function clearTestCookieDatabase(dir=profile) {
  assert.ok(dir===profile || dir.startsWith(profile+path.sep));
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if(entry.isSymbolicLink())continue;
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())clearTestCookieDatabase(file);
    else if(['Cookies','Cookies-journal','Cookies-wal','Cookies-shm'].includes(entry.name))fs.rmSync(file);
  }
}
(async()=>{
  try {
    await launch();
    const expires=Math.floor(Date.now()/1000)+3600;
    await instance.evaluate(async({session,safeStorage},expires)=>{
      if(!safeStorage.isEncryptionAvailable())throw new Error('Windows protected storage unavailable');
      const s=session.fromPartition('persist:dufe-school');
      await s.cookies.set({url:'https://sso.dufe.edu.cn/app.php/',name:'fixture-session',value:'FAKE-login-memory-secret',
        path:'/app.php',secure:true,httpOnly:true,sameSite:'lax'});
      await s.cookies.set({url:'https://ginkgostu.dufe.edu.cn/',name:'fixture-shared',value:'FAKE-shared-session',
        domain:'.dufe.edu.cn',secure:true,httpOnly:true,sameSite:'no_restriction'});
      await s.cookies.set({url:'https://ginkgostu.dufe.edu.cn/',name:'fixture-persistent',value:'FAKE-future',
        secure:true,expirationDate:expires});
      await s.cookies.set({url:'https://example.invalid/',name:'foreign',value:'FAKE-foreign-secret'});
    },expires);
    await instance.close();instance=null;
    const vault=path.join(profile,'school-login.bin');
    assert.ok(fs.existsSync(vault),'Graceful app quit writes the vault');
    assert.equal(fs.readFileSync(vault).includes(Buffer.from('FAKE-login-memory-secret')),false);
    clearTestCookieDatabase();
    let page=await launch();
    const restored=await instance.evaluate(async({session,safeStorage,app})=>{
      const require=process.mainModule.require.bind(process.mainModule);
      const fs=require('node:fs'),path=require('node:path');
      const cookies=await session.fromPartition('persist:dufe-school').cookies.get({});
      const saved=JSON.parse((await safeStorage.decryptStringAsync(fs.readFileSync(path.join(app.getPath('userData'),'school-login.bin')))).result);
      return {cookies,savedNames:saved.cookies.map(c=>c.name)};
    });
    const c=restored.cookies.find(c=>c.name==='fixture-session');
    assert.ok(c);assert.equal(c.value,'FAKE-login-memory-secret');
    assert.equal(c.hostOnly,true);assert.equal(c.path,'/app.php');assert.equal(c.httpOnly,true);
    assert.equal(c.secure,true);assert.equal(c.sameSite,'lax');assert.equal(c.session,true);
    assert.equal(c.expirationDate,undefined);
    assert.equal(restored.cookies.find(c=>c.name==='fixture-persistent').expirationDate,expires);
    const shared=restored.cookies.find(c=>c.name==='fixture-shared');
    assert.equal(shared.domain,'.dufe.edu.cn');assert.equal(shared.hostOnly,false);
    assert.equal(shared.sameSite,'no_restriction');
    assert.ok(!restored.savedNames.includes('foreign'));
    checks.push('真实 Windows 加密存储；完整退出重启、浏览器 Cookie 丢失后仍恢复学校会话，文件不含测试明文');
    checks.push('保留原来的路径、共享域、仅服务器可读、传输与跨站属性，过期时间未延长，不保存外部网站 Cookie');

    const edge=await instance.evaluate(async({app,session,safeStorage})=>{
      const require=process.mainModule.require.bind(process.mainModule);
      const fs=require('node:fs/promises'),path=require('node:path');
      const {LoginMemory}=require(path.join(app.getAppPath(),'src/login-memory.cjs'));
      const dir=path.join(app.getPath('userData'),'vault-edge');
      await fs.mkdir(dir,{recursive:true});
      const file=path.join(dir,'school-login.bin'),s=session.fromPartition('memory-edge');
      const base={domain:'sso.dufe.edu.cn',hostOnly:true,path:'/',secure:true,httpOnly:true,sameSite:'lax',value:'FAKE-old'};
      const saved={version:1,cookies:[
        {...base,name:'expired',expirationDate:Date.now()/1000-10},
        {...base,name:'current'},
        {...base,name:'session'},
        {...base,name:'foreign',domain:'dufe.edu.cn.attacker.invalid'}]};
      await fs.writeFile(file,await safeStorage.encryptStringAsync(JSON.stringify(saved)));
      await s.cookies.set({url:'https://sso.dufe.edu.cn/',name:'current',value:'FAKE-new',secure:true});
      let memory=new LoginMemory(s,dir);await memory.start();
      const cookies=await s.cookies.get({});
      // A save already in progress must finish before forgetting removes its file.
      const saving=memory.save();await memory.forget();await saving;
      await s.clearStorageData();await s.cookies.flushStore();memory.resume();await memory.close();
      const exists=await fs.stat(file).then(()=>true,()=>false);
      await fs.writeFile(file,Buffer.from('not-an-encrypted-vault'));
      memory=new LoginMemory(s,dir);await memory.start();
      const afterCorrupt=(await s.cookies.get({})).length;await memory.close();
      return {names:cookies.map(c=>c.name),current:cookies.find(c=>c.name==='current')?.value,exists,afterCorrupt};
    });
    assert.deepEqual(edge.names.sort(),['current','session']);
    assert.equal(edge.current,'FAKE-new');assert.equal(edge.exists,false);assert.equal(edge.afterCorrupt,0);
    checks.push('已过期和外部凭据不恢复，现有新会话不被旧快照覆盖，损坏文件不崩溃');
    checks.push('写入与退出同时发生也不会留下可恢复凭据');

    // A parked SSO page can reuse another school window's session by loading
    // the official root. All HTTPS traffic below stays inside this fixture.
    await instance.evaluate(async({app,session})=>{
      const require=process.mainModule.require.bind(process.mainModule);
      const path=require('node:path');
      const {SchoolApi}=require(path.join(app.getAppPath(),'src/school.cjs'));
      globalThis.loginFixture={authorized:true,roots:0,delay:0,identities:[]};
      const f=globalThis.loginFixture;
      session.fromPartition('persist:dufe-school').protocol.handle('https',async request=>{
        const u=new URL(request.url);
        if(u.hostname==='sso.dufe.edu.cn')return new Response('<!doctype html><title>测试学校登录</title><input aria-label="账号">',{headers:{'content-type':'text/html'}});
        if(u.hostname!=='ginkgostu.dufe.edu.cn')return new Response('blocked',{status:403});
        if(u.pathname==='/'){
          f.roots++;if(f.delay)await new Promise(r=>setTimeout(r,f.delay));
          if(!f.authorized)return Response.redirect('https://sso.dufe.edu.cn/login',302);
          return new Response('<!doctype html><script>localStorage.setItem("token","fixture-token");localStorage.setItem("STUDENTNO","fixture-0001");localStorage.setItem("batch","fixture-term")</script>',{headers:{'content-type':'text/html'}});
        }
        return new Response(JSON.stringify({code:f.authorized?'2000':'401',message:f.authorized?'':'登录失效',data:[]}),
          {status:f.authorized?200:401,headers:{'content-type':'application/json'}});
      });
      globalThis.loginApi=new SchoolApi({onSession:identity=>f.identities.push(identity?.id||null)});
      await globalThis.loginApi.open('https://sso.dufe.edu.cn/login',false);
    });
    const recovered=await instance.evaluate(async()=>{
      const result=await globalThis.loginApi.homeworkList();
      return {scope:!!result.scope,roots:loginFixture.roots};
    });
    assert.equal(recovered.scope,true);assert.equal(recovered.roots,1);
    checks.push('停留在旧登录页的隐藏课程窗口会重新连接官方入口，已有效的登录可直接继续使用');
    const visible=await instance.evaluate(async()=>{
      await loginApi.open('https://sso.dufe.edu.cn/login',true);
      const before=loginFixture.roots;
      const result=await loginApi.recoverLogin(true);
      loginApi.window.hide();
      return {result,unchanged:loginFixture.roots===before};
    });
    assert.equal(visible.result,false);assert.equal(visible.unchanged,true);
    checks.push('正在填写的学校登录窗口不会被后台恢复流程刷新');
    const expired=await instance.evaluate(async()=>{
      loginFixture.authorized=false;
      await loginApi.recoverLogin(true);
      try{await loginApi.homeworkList();return {error:null};}
      catch(error){return {error:error.code||error.kind,identity:loginFixture.identities.at(-1)};}
    });
    assert.equal(expired.error,'auth');assert.equal(expired.identity,null);
    checks.push('学校拒绝旧会话时仍要求重新登录，不把本地记录当作认证成功');
    const race=await instance.evaluate(async()=>{
      loginFixture.authorized=true;loginFixture.delay=300;
      loginApi.lastRecovery=0;
      const pending=loginApi.homeworkList().then(()=>false,()=>true);
      await new Promise(r=>setTimeout(r,50));
      await loginApi.logout();await pending;
      return {closed:!loginApi.window,identity:loginFixture.identities.at(-1)};
    });
    assert.equal(race.closed,true);assert.equal(race.identity,null);
    checks.push('恢复连接中退出账号后，旧请求不能重新打开学校窗口或恢复身份');

    await instance.evaluate(async({session})=>{
      await session.fromPartition('persist:dufe-school').cookies.set({url:'https://sso.dufe.edu.cn/',name:'logout-race',value:'FAKE-delete-me',secure:true});
    });
    const logout=await page.evaluate(()=>window.reminder.invoke('logout-school'));
    assert.equal(logout.ok,true);
    await instance.close();instance=null;
    assert.equal(fs.existsSync(vault),false);
    await launch();
    assert.equal(await instance.evaluate(async({session})=>(await session.fromPartition('persist:dufe-school').cookies.get({})).length),0);
    checks.push('应用内退出账号清空浏览器和加密副本，完整重启后不会自动登录旧账号');
    const report={result:'passed',version:require('../package.json').version,checks,
      scope:'真实 Electron 进程重启、Windows 系统加密与受控学校响应；没有读取用户真实凭据，不代替学校服务器有效期或手机真机验证'};
    fs.writeFileSync(path.join(out,'账号记忆专项验证.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally {if(instance)await instance.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
