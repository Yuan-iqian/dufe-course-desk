const {chromium,expect}=require('@playwright/test');
const {build}=require('../mobile/node_modules/esbuild');
const {DemoApi}=require('../src/demo.cjs');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.COURSE_DESK_TEST_OUTPUT || path.join(root,'客户端整合-交付','验证'),www=path.join(root,'mobile/www');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now());
 const fixtureStart=Date.parse(date+'T11:00:00+08:00');
 const demo=new DemoApi(()=>fixtureStart),identity={id:'test-school-profile',nickname:'学校账号 · 0001'};
 const homework=await demo.homeworkList(),schedule=await demo.schedule();
 const { firstMonday } = schedule.calendar;
 const term = {theWeek:2,startDate:new Date(firstMonday+28800000).toISOString().slice(0,10),
  endDate:new Date(firstMonday+27*86400000+28800000).toISOString().slice(0,10),batchName:'测试学期'};
 const schedules = {};
 for (const entry of schedule.data[0].dayList) {
  const weekNo = Math.floor((Date.parse(entry.date+'T00:00:00+08:00')-firstMonday)/(7*86400000))+1;
  (schedules[weekNo] ||= [{dayList:[]}])[0].dayList.push(entry);
 }
 const sources=[{id:'jwc',name:'教务处',status:'ok',statusLabel:'正常',successAt:Date.now()}];
 const item={id:'a'.repeat(64),title:'测试公告：材料提交',sourceId:'jwc',category:'academic',url:'https://jwc.dufe.edu.cn/',publishedAt:'2026-11-13',updatedAt:Date.now(),revision:1,summary:'请在截止时间前提交材料',detailStatus:'ok',detectedDeadline:'2026-11-20',read:true,completed:false};
 const shim=`
 const listeners={};const saved=JSON.parse(sessionStorage.getItem('nativeFixturePrefs')||'{}');const notifications=new Map();let login=true;let homeworkError='';let savedLogin=false;let exercisePublished=false;
 let fixtureNow=${fixtureStart};Date.now=()=>fixtureNow;
 window.nativeFixture={listeners,saved,notifications,loginOpens:0,cardOpens:0,cardCloses:0,cardFailure:false,reconnects:0,requests:0,savedSession:true,epoch:0,holdRecovery:false,pendingRecovery:null,loseSession:valid=>{login=false;window.nativeFixture.savedSession=valid},setHomeworkError:error=>{homeworkError=error},publishExercise:(value=true)=>{exercisePublished=value},advance:ms=>{fixtureNow+=ms;for(const [id,row] of notifications)if(row.schedule?.at.getTime()<=fixtureNow)notifications.delete(id)}};
 const school={credentialsStatus:async()=>({saved:savedLogin}),saveCredentials:async()=>{savedLogin=true},clearCredentials:async()=>{savedLogin=false},reconnect:async()=>{const f=window.nativeFixture;f.reconnects++;const epoch=f.epoch;if(f.holdRecovery)await new Promise(r=>{f.pendingRecovery=r});if(epoch===f.epoch)login=f.savedSession;return {started:true}},openCampusCard:async()=>{if(window.nativeFixture.cardFailure)throw new Error('校园码连接测试失败');window.nativeFixture.cardOpens++},closeCampusCard:async()=>{window.nativeFixture.cardCloses++},addListener:async(name,fn)=>{listeners[name]=fn},open:async()=>{window.nativeFixture.loginOpens++;login=true;window.nativeFixture.savedSession=true;listeners.schoolPageReady?.()},logout:async()=>{login=false;window.nativeFixture.savedSession=false;window.nativeFixture.epoch++},openExternal:async()=>{},settings:async()=>{},request:async({path,params})=>{
 window.nativeFixture.requests++;
 if(!login)return {error:'auth'};
 if(path==='/student/HomeworkList'&&homeworkError)return {error:homeworkError};
 let data=null;if(path==='/student/HomeworkList')data=${JSON.stringify(homework.data)};else if(path==='/student/currentDate')data=${JSON.stringify(term)};else if(path==='/student/queryCourseList')data=(${JSON.stringify(schedules)})[params.weekNo]||[];else if(path==='/student/exercise/getExerciseList')data=exercisePublished?[{id:551,description:'手机课堂练习',exerciseStatus:1,studentExerciseStatus:0}]:[];else if(path==='/student/getWeekTimePaper')data={paperId:params.paperId,paperName:'测试作业 '+params.paperId};
 return {scope:'test-term',identity:${JSON.stringify(identity)},data};}};
 const core={registerPlugin:()=>school,CapacitorHttp:{get:async({url})=>{const op=new URL(url).pathname.split('/').pop();return {status:200,data:{ok:true,data:op==='overview'?{sources:${JSON.stringify(sources)},categories:{academic:'教务'},disabledSources:[]}:op==='notice'?{notice:${JSON.stringify(item)}}:{items:[${JSON.stringify(item)}],cursor:'1:',more:false}}}}}};
 const app={App:{addListener:async(name,fn)=>{listeners[name]=fn},minimizeApp:async()=>{}}};
 const prefs={Preferences:{get:async({key})=>({value:saved[key]||null}),set:async({key,value})=>{saved[key]=value;sessionStorage.setItem('nativeFixturePrefs',JSON.stringify(saved))}}};
 const local={LocalNotifications:{checkPermissions:async()=>({display:'granted'}),requestPermissions:async()=>({display:'granted'}),getPending:async()=>({notifications:[...notifications.values()]}),schedule:async({notifications:rows})=>{for(const row of rows)notifications.set(row.id,row)},cancel:async({notifications:rows})=>{for(const row of rows)notifications.delete(row.id)},addListener:async()=>{}}};
 module.exports = KIND==='core'?core:KIND==='app'?app:KIND==='preferences'?prefs:local;
 `;
 // Every native module shares one fixture, while the complete real runtime and UI run unchanged.
 const common=shim.replace("module.exports = KIND==='core'?core:KIND==='app'?app:KIND==='preferences'?prefs:local;","window.__mobileMocks={core,app,preferences:prefs,'local-notifications':local};");
 const result=await build({entryPoints:[path.join(root,'mobile/src/runtime.cjs')],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',alias:{'node:events':path.join(root,'mobile/node_modules/events/events.js')},plugins:[{name:'native-test',setup(api){api.onResolve({filter:/^@capacitor\//},args=>({path:args.path.split('/')[1],namespace:'mock'}));api.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:`module.exports=window.__mobileMocks[${JSON.stringify(args.path)}];`}));}}]});
 const bridge=Buffer.from(common+'\n'+result.outputFiles[0].text);
 const server=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(rel==='/ui/mobile-bridge.js'){res.setHeader('content-type','text/javascript');res.end(bridge);return;}const file=path.resolve(www,'.'+rel);if(!file.startsWith(www+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({channel:'msedge'});
  const viewport={viewport:{width:390,height:844},isMobile:true,hasTouch:true};
  const url=`http://127.0.0.1:${server.address().port}/ui/index.html`;
  const page=await browser.newPage({...viewport,reducedMotion:'no-preference'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.startupTimes=[];
    new MutationObserver(records=>{
      for(const record of records) {
        if(record.target.id==='startup-intro') window.startupTimes.push(performance.now());
      }
    }).observe(document,{subtree:true,attributes:true,attributeFilter:['open']});
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const intro=page.locator('#startup-intro');
  await expect(intro).toBeVisible();
  await expect(page.locator('#startup-skip')).toBeVisible();
  await expect(intro).toBeHidden({timeout:4000});
  const [started,ended]=await page.evaluate(()=>window.startupTimes);
  assert.ok(ended-started>=1000&&ended-started<=2400,'常规开场约 1.5 秒');
  await expect(page.locator('#today-panel')).toBeVisible();
  await page.getByRole('button', {name:'打开我的校园码'}).click();
  assert.equal(await page.evaluate(()=>nativeFixture.cardOpens),1);
  await expect(page.locator('#today-panel')).toBeVisible();
  await page.evaluate(()=>{nativeFixture.cardFailure=true});
  await page.locator('#campus-card-open').click();
  await expect(page.locator('#notice')).toContainText('校园码');
  await expect(page.locator('#campus-card-open')).toBeEnabled();
  await page.evaluate(()=>{nativeFixture.cardFailure=false});
  await page.locator('#campus-card-open').click();
  assert.equal(await page.evaluate(()=>nativeFixture.cardOpens),2);
  await page.getByRole('button', {name:'切换主题'}).click();
  const theme = page.getByRole('dialog', {name:'显示主题'});
  const backgrounds = theme.locator('#background-choices');
  const photo = page.locator('#app-background-photo');
  await expect(theme.locator('#theme-choices').getByRole('radio')).toHaveCount(5);
  await expect(backgrounds.getByRole('radio')).toHaveCount(6);
  await expect(backgrounds.locator('input[value="gate"]')).toBeChecked();
  await expect(theme.getByRole('radio', {name:'白天'})).toBeChecked();
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await theme.getByRole('radio', {name:'黑夜'}).check();
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme','dark');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(15, 20, 29)');
  await expect(theme).toHaveCSS('background-color','rgb(23, 31, 43)');
  await expect.poll(() => page.evaluate(() => window.reminder.themePreference())).toBe('night');
  for (const [name, value, background] of [
    ['雾蓝','mist','rgb(227, 237, 247)'],
    ['浅绿','green','rgb(227, 239, 229)'],
    ['米色','beige','rgb(243, 231, 212)']
  ]) {
    await theme.getByRole('radio', {name}).check();
    await expect(page.locator('body')).toHaveCSS('background-color', background);
    await expect.poll(() => page.evaluate(() => window.reminder.themePreference())).toBe(value);
  }
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme','light');
  await backgrounds.locator('input[value="garden"]').check();
  await expect(page.locator('html')).toHaveAttribute('data-background','garden');
  await expect(photo).toHaveAttribute('src','../assets/dufe-garden.webp');
  await expect.poll(()=>photo.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await expect(page.locator('#app-background')).toHaveCSS('background-image',/linear-gradient\(/);
  await expect.poll(()=>page.evaluate(()=>window.reminder.backgroundPreference())).toBe('garden');
  await expect(theme.locator('#theme-choices input[value="beige"]')).toBeChecked();
  assert.ok(await theme.evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth));
  await page.screenshot({path:path.join(out,'主题选择-手机.png'),animations:'disabled'});
  await theme.getByRole('button', {name:'完成'}).click();
  await expect(theme).toBeHidden();
  const nav = page.getByRole('navigation', {name:'事务分类'});
  await expect(nav).toHaveCSS('background-color','rgb(255, 250, 240)');
  await expect(nav.getByRole('button')).toHaveCount(5);
  assert.ok(await nav.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return Math.abs(rect.bottom - innerHeight) < 2 && rect.height <= 85;
  }), '手机导航固定在屏幕底部，且不遮挡主要内容');
  const homeStage=page.locator('#today-panel .campus-hero');
  const nextScene=homeStage.getByRole('button',{name:'换一景'});
  await expect(homeStage).toHaveAttribute('data-scene','gate');
  await expect(homeStage.locator('.campus-hero-caption')).toHaveText('校门与之远楼 · 实景');
  for (const scene of ['cherry','aerial','ginkgo','garden','snow','gate']) {
    await nextScene.tap();
    await expect(homeStage).toHaveAttribute('data-scene',scene);
    await expect.poll(()=>homeStage.locator('.campus-hero-image').last().evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(photo).toHaveAttribute('src','../assets/dufe-garden.webp');
  await expect(page.locator('#today-current')).toContainText('市场调查与分析');
  await expect(page.locator('#today-next')).toContainText('数理统计');
  await expect(page.locator('#today-agenda-count')).toHaveText('2 项作业 · 0 项待办');
  const scheduleTime=page.locator('#today-sync-schedule-time');
  const homeworkTime=page.locator('#today-sync-homework-time');
  await expect(scheduleTime).toContainText('上次成功');
  await expect(homeworkTime).toContainText('上次成功');
  const previousSchedule=await scheduleTime.textContent();
  const previousHomework=await homeworkTime.textContent();
  await page.evaluate(async()=>{nativeFixture.setHomeworkError('network');await window.reminder.invoke('homework-refresh');});
  await expect(homeworkTime).toHaveText(previousHomework);
  await expect(page.locator('#today-sync-homework-status')).toHaveText('同步失败，显示上次结果');
  await expect(page.getByRole('button',{name:'重试同步课表'})).toBeHidden();
  await page.evaluate(()=>nativeFixture.setHomeworkError(''));
  await page.getByRole('button',{name:'重试同步作业'}).click();
  await expect(page.getByRole('button',{name:'重试同步作业'})).toBeHidden();
  await expect(scheduleTime).toHaveText(previousSchedule);
  await page.locator('#tab-timetable').click();
  await expect(page.locator('#timetable-panel .campus-hero')).toHaveAttribute('data-scene','cherry');
  await page.evaluate(async()=>{
    window.startupReplays=0;
    new MutationObserver(records=>{window.startupReplays+=records.filter(record=>record.oldValue===null).length;})
      .observe(document.getElementById('startup-intro'),{attributes:true,attributeOldValue:true,attributeFilter:['open']});
    await nativeFixture.listeners.appStateChange({isActive:false});
    await nativeFixture.listeners.appStateChange({isActive:true});
  });
  await expect(intro).toBeHidden();
  await expect(page.locator('#tab-timetable')).toHaveAttribute('aria-pressed','true');
  assert.equal(await page.evaluate(()=>window.startupReplays),0);
  await expect(photo).toHaveAttribute('src','../assets/dufe-garden.webp');
  await expect(page.locator('#timetable-week-content .timetable-day')).toHaveCount(7);
  await expect(page.locator('#timetable-week-content')).toContainText('教学楼 A301');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'本周课表-手机.png'),fullPage:true,animations:'disabled'});
  await page.locator('#timetable-term').click();
  await expect(page.locator('#timetable-term-content .timetable-day')).toHaveCount(7);
  await expect(page.locator('#timetable-term-content .timetable-course-weeks')).toHaveCount(2);
  await expect(page.locator('#timetable-week-picker')).toBeHidden();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'总课表-手机.png'),fullPage:true,animations:'disabled'});
  await page.locator('#tab-homework').click();
  await expect(page.locator('.homework-row')).toHaveCount(4);
  await page.locator('#tab-signin').click();
  await expect(page.locator('#course-title')).toHaveText('市场调查与分析');
  await expect(page.locator('#mode').locator('option:checked')).toHaveText('跟随全部课程');
  await page.locator('#tab-homework').click();
  assert.equal(await page.locator('#tab-sharing').count(),0);
  await page.locator('#homework-toggle').click();
  await expect.poll(()=>page.evaluate(()=>[...nativeFixture.notifications.values()].filter(n=>n.extra.kind==='homework-deadline').length)).toBe(4);
  await page.locator('#tab-signin').click();
  await expect(page.locator('#status-label')).toHaveText('正在监控');
  await page.evaluate(() => nativeFixture.publishExercise());
  await page.locator('#refresh').click();
  await expect(page.locator('#history')).toContainText('手机课堂练习');
  await expect.poll(() => page.evaluate(() => [...nativeFixture.notifications.values()].filter(n => n.extra.kind === 'exercise').length)).toBe(1);
  await page.evaluate(() => nativeFixture.publishExercise(false));
  await page.locator('#refresh').click();
  await page.locator('#tab-homework').click();
  await page.screenshot({path:path.join(out,'手机-作业.png'),fullPage:true,animations:'disabled'});
  await page.locator('#tab-campus').click();await expect(page.locator('#cp-user')).toContainText('0001');
  await expect(page.locator('#cp-list')).toContainText('测试公告');
  await page.locator('#cp-list .cp-title').first().click();
  const deadline = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(Date.now() + 86400000));
  await page.locator('#cp-deadline-value').fill(deadline);
  await page.locator('.cp-deadline-form button[type=submit]').click();
  await expect(page.locator('#cp-detail-body')).toContainText('已由你确认');
  await page.locator('#cp-detail-close').click();
  await page.locator('#tab-today').click();
  await expect(page.locator('#today-agenda-count')).toHaveText('2 项作业 · 1 项待办');
  await expect(page.locator('#today-agenda-list')).toContainText('仅日期');
  await expect(page.locator('#today-status-label')).toHaveText('监控中');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'今天-手机.png'),fullPage:true,animations:'disabled'});
  await page.locator('#today-agenda-list').getByRole('button',{name:/测试公告/}).click();
  await expect(page.locator('#cp-detail')).toBeVisible();
  await page.getByRole('button',{name:'标记完成',exact:true}).click();
  await expect(page.getByRole('button',{name:'撤销完成',exact:true})).toBeVisible();
  await page.locator('#cp-detail-close').click();
  await page.locator('#tab-today').click();
  await expect(page.locator('#today-agenda-count')).toHaveText('2 项作业 · 0 项待办');
  await page.evaluate(async()=>{
   nativeFixture.advance(25*3600000);
   await window.reminder.invoke('homework-refresh');
  });
  await expect.poll(()=>page.evaluate(()=>[...nativeFixture.notifications.values()].filter(n=>n.extra.kind==='homework-deadline').length)).toBe(2);
  await expect(page.locator('#today-urgent-list .today-kind-urgent')).toHaveCount(1);
  await expect(page.locator('#today-urgent-list')).toContainText('作业今日截止');
  await page.screenshot({path:path.join(out,'首页优先处理-手机.png'),fullPage:true,animations:'disabled'});
  assert.equal(await page.evaluate(()=>[...nativeFixture.notifications.values()].filter(n=>n.extra.kind==='homework').length),0,'已经由系统安排的截止提醒不能在返回前台时重复弹出');
  await page.locator('#tab-campus').click();
  await page.locator('#cp-settings').click();await page.locator('#cp-keywords').fill('提交');await page.locator('#cp-preferences-save').click();
  await expect(page.locator('#cp-preferences')).not.toBeVisible();
  assert.ok((await page.evaluate(()=>nativeFixture.saved['campus-state'])).includes('提交'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'手机-校园通知.png'),fullPage:true,animations:'disabled'});
  await page.locator('#cp-logout').click();await expect(page.locator('#cp-auth')).toBeVisible();
  assert.ok(await page.evaluate(()=>nativeFixture.cardCloses>0));
  await expect.poll(() => page.evaluate(() => window.reminder.themePreference())).toBe('beige');
  await expect(page.locator('html')).toHaveAttribute('data-theme','beige');
  await expect(page.locator('html')).toHaveAttribute('data-background','garden');
  await expect.poll(()=>page.evaluate(()=>[...nativeFixture.notifications.values()].filter(n=>n.extra.kind==='homework-deadline').length)).toBe(0);
  await page.locator('#tab-homework').click();await expect(page.locator('.homework-row')).toHaveCount(0);
  await page.locator('#tab-today').click();
  await expect(page.getByRole('button',{name:'重新登录',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'重新登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'重新登录',exact:true})).toBeHidden();
  await page.locator('#tab-homework').click();await expect(page.locator('.homework-row')).toHaveCount(4);
  await expect(page.locator('#feedback-open, #feedback-dialog')).toHaveCount(0);
  const supportButton=page.locator('.header-actions').getByRole('button',{name:'查看赞赏码',exact:true});
  await page.setViewportSize({width:320,height:720});
  const toolbar=await page.locator('.app-header').evaluate(header=>{
    const rect=header.getBoundingClientRect();
    const buttons=[...header.querySelectorAll('button')].map(button=>button.getBoundingClientRect());
    const brandMark=header.querySelector('.brand-mark').getBoundingClientRect();
    const brandTitle=header.querySelector('h1').getBoundingClientRect();
    return {fits:buttons.every(button=>button.left>=rect.left&&button.right<=rect.right),
      touchSize:buttons[0].width>=44&&buttons[0].height>=44,
      separate:buttons.every((button,index)=>index===0||buttons[index-1].right<=button.left),
      brandOnOneLine:brandTitle.top>=brandMark.top&&brandTitle.bottom<=brandMark.bottom,
      viewFits:document.documentElement.scrollWidth<=innerWidth};
  });
  assert.deepEqual(toolbar,{fits:true,touchSize:true,separate:true,brandOnOneLine:true,viewFits:true});
  await page.locator('.app-header').screenshot({path:path.join(out,'打赏入口-手机窄屏.png'),animations:'disabled'});
  await page.locator('#manage-login').tap();
  const accountDialog = page.getByRole('dialog', { name: '本机学校账号' });
  await expect(accountDialog.getByText('本机尚未保存账号')).toBeVisible();
  await accountDialog.getByLabel('学校账号', { exact: true }).fill('test-student');
  await accountDialog.getByLabel('学校密码', { exact: true }).fill('fake-credentials');
  await accountDialog.getByRole('button', { name: '保存到本机' }).tap();
  await expect(accountDialog.getByText('已保存一个学校账号')).toBeVisible();
  await accountDialog.getByRole('button', { name: '打开学校并一键填写' }).tap();
  await expect(accountDialog).toBeHidden();
  await page.locator('#manage-login').tap();
  await accountDialog.getByRole('button', { name: '清除已保存账号' }).tap();
  await expect(accountDialog.getByText('本机尚未保存账号')).toBeVisible();
  await accountDialog.getByRole('button', { name: '关闭' }).tap();
  await supportButton.tap();
  const support=page.getByRole('dialog',{name:'赞赏码',exact:true});
  const supportCode=support.locator('.support-code');
  await expect(supportCode).toBeVisible();
  await expect.poll(()=>supportCode.evaluate(img=>[img.naturalWidth,img.naturalHeight])).toEqual([1599,1599]);
  await expect(supportCode).toBeInViewport({ratio:1});
  await support.screenshot({path:path.join(out,'赞赏码-手机窄屏.png'),animations:'disabled'});
  await page.evaluate(()=>nativeFixture.listeners.backButton());
  await expect(support).toBeHidden();
  await page.setViewportSize(viewport.viewport);
  await page.evaluate(()=>localStorage.removeItem('course-desk-background'));
  await page.reload();
  await expect(intro).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme','beige');
  await expect(page.locator('html')).toHaveAttribute('data-background','garden');
  await expect(photo).toHaveAttribute('src','../assets/dufe-garden.webp');
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('course-desk-background'))).toBe('garden');
  await page.evaluate(async()=>{
    await window.reminder.invoke('pause');
    nativeFixture.advance(61000);nativeFixture.loseSession(true);
    await window.reminder.invoke('refresh');
  });
  assert.equal((await page.evaluate(()=>window.reminder.invoke('snapshot'))).data.connected,true);
  assert.equal(await page.evaluate(()=>nativeFixture.reconnects),1,'并发同步共用一次恢复');
  const normalOpens=await page.evaluate(()=>nativeFixture.loginOpens);
  await page.evaluate(()=>{nativeFixture.loseSession(true);nativeFixture.listeners.schoolSessionChanged()});
  await expect.poll(async()=>(await page.evaluate(()=>window.reminder.invoke('snapshot'))).data.connected).toBe(true);
  await expect.poll(()=>page.evaluate(()=>nativeFixture.reconnects)).toBe(2);
  assert.equal(await page.evaluate(()=>nativeFixture.loginOpens),normalOpens,'校园码返回后无需再次打开登录界面');
  await page.evaluate(async()=>{
    nativeFixture.advance(61000);nativeFixture.loseSession(false);
    await window.reminder.invoke('refresh');
  });
  assert.equal((await page.evaluate(()=>window.reminder.invoke('snapshot'))).data.connected,false);
  const failedAttempts=await page.evaluate(()=>nativeFixture.reconnects);
  await page.evaluate(()=>window.reminder.invoke('refresh'));
  assert.equal(await page.evaluate(()=>nativeFixture.reconnects),failedAttempts,'失效会话不会连续重试恢复');
  await page.evaluate(async()=>{
    nativeFixture.advance(61000);nativeFixture.loseSession(true);nativeFixture.holdRecovery=true;
    window.pendingRefresh=window.reminder.invoke('refresh');
  });
  await expect.poll(()=>page.evaluate(()=>!!nativeFixture.pendingRecovery)).toBe(true);
  await page.evaluate(()=>window.reminder.invoke('logout-school'));
  const requestsAfterLogout=await page.evaluate(()=>nativeFixture.requests);
  await page.evaluate(async()=>{nativeFixture.pendingRecovery();await window.pendingRefresh});
  assert.equal(await page.evaluate(()=>nativeFixture.requests),requestsAfterLogout,'退出后不再重试旧请求');
  assert.equal((await page.evaluate(()=>window.reminder.invoke('snapshot'))).data.connected,false);
  const memoryChecks=['手机隐藏课程页复用已保存会话，并发同步只恢复一次','校园码登录返回后自动重新确认课程身份','学校会话失效仍要求登录且限制重复恢复','恢复中退出账号后丢弃旧响应，不重试或复活旧账号'];
  fs.writeFileSync(path.join(out,'手机登录记忆验证.json'),JSON.stringify({result:'passed',checks:memoryChecks,scope:'真实手机运行层与模拟原生接口，未代替 Android/iPhone 真机验证'},null,2));
  const reducedPage=await browser.newPage({...viewport,reducedMotion:'reduce'});
  try {
    await reducedPage.addInitScript(()=>{
      window.startupAnimations=[];
      const animate=Element.prototype.animate;
      Element.prototype.animate=function(...args){
        const animation=animate.apply(this,args);
        if(this.closest('#startup-intro')){
          const effect=animation.effect;
          window.startupAnimations.push({duration:effect.getTiming().duration,
            frames:effect.getKeyframes().map(({opacity,computedOffset,...frame})=>({opacity,offset:computedOffset,
              properties:Object.keys(frame).filter(key=>!['offset','easing','composite'].includes(key))}))});
        }
        return animation;
      };
    });
    await reducedPage.goto(url,{waitUntil:'domcontentloaded'});
    await expect.poll(()=>reducedPage.evaluate(()=>window.startupAnimations.length)).toBeGreaterThan(0);
    await expect(reducedPage.locator('#startup-intro')).toBeHidden({timeout:3000});
    const animations=await reducedPage.evaluate(()=>window.startupAnimations);
    assert.ok(animations.every(({duration,frames})=>duration<=350&&frames.every(frame=>frame.properties.length===0)&&
      frames.filter(frame=>Number(frame.opacity)===1).every(frame=>frame.offset<=.5)),
      '减少动态效果只保留短淡出，淡出覆盖至少一半的时长');
  } finally { await reducedPage.close(); }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'手机逻辑验证.json'),JSON.stringify({result:'passed',checks:['校园码入口调用独立原生窗口，失败可重试，退出账号清理旧窗口','开场自然结束，手机前后台切换不重播，减少动态效果只做短淡入淡出','默认打开今天首页并显示当前和下一节课','整页校园背景独立于主题颜色和横幅，清除网页设置后可从手机偏好恢复','显示签到监控状态与七天作业','首页优先展示今日截止作业','课表与作业同步时间分别显示，作业失败可单独重试','已确认的日期型待办出现在首页','首页待办打开对应通知并在标记完成后消失','真实移动运行层同步作业','已知截止时间登记四条系统提醒','返回前台不重复已安排的截止提醒','学校身份通用入口','公告关注保存','退出清空数据并取消提醒','首页重新登录后恢复作业','390px无横向溢出','咖啡杯打开新版赞赏码，320 像素窄屏可完整显示'],scope:'浏览器模拟手机原生接口，未代替 Android/iPhone 真机测试'},null,2));
  console.log('手机运行层、通知安排、退出与界面验证通过');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
