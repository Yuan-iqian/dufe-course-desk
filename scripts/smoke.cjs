const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const output = process.env.COURSE_DESK_TEST_OUTPUT || path.join(root,'课堂签到提醒-交付','验证截图');
const profile = path.join(output,`桌面测试数据-${Date.now()}`);
fs.mkdirSync(output,{recursive:true});
const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE'));
(async()=>{
 let instance;
 const errors=[];
 const checks=[];
 try{
  instance=await electron.launch({executablePath:require('electron'),args:[root,'--demo','--test-mode',`--profile=${profile}`],env,timeout:30000});
  const page=await instance.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  const intro=page.locator('#startup-intro');
  const skip=page.locator('#startup-skip');
  await expect(intro).toBeVisible();
  await expect(intro.getByRole('heading',{name:'东财课历',exact:true})).toBeVisible();
  await expect(intro).toContainText('东北财经大学');
  await expect(intro).toContainText('博学济世');
  await expect(intro.locator('#startup-campus-gate')).toHaveAttribute('src','../assets/dufe-campus.jpg');
  await expect(intro.locator('#startup-campus-cherry')).toHaveAttribute('src','../assets/dufe-cherry.webp');
  await expect(intro.locator('#startup-campus-aerial')).toHaveAttribute('src','../assets/dufe-aerial.webp');
  await expect(skip).toHaveText('跳过');
  await skip.click();
  await expect(intro).toBeHidden();
  await expect(page.locator('#tab-today')).toBeFocused();
  await page.evaluate(()=>{
    window.startupReplays=0;
    new MutationObserver(records=>{window.startupReplays+=records.filter(record=>record.oldValue===null).length;})
      .observe(document.getElementById('startup-intro'),{attributes:true,attributeOldValue:true,attributeFilter:['open']});
  });
  await instance.evaluate(({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows()[0];
    window.hide();
    window.show();
  });
  await expect(intro).toBeHidden();
  assert.equal(await page.evaluate(()=>window.startupReplays),0);
  checks.push('启动显示东财校名与校训，跳过后焦点回到今天，恢复窗口不重播');
  await expect(page.getByRole('heading',{name:'东财课历',exact:true})).toBeVisible();
  await expect(page.locator('#today-panel')).toBeVisible();
  await page.locator('.app-header').screenshot({path:path.join(output,'打赏入口-桌面.png'),animations:'disabled'});
  await page.getByRole('button', {name:'切换主题'}).click();
  const theme = page.getByRole('dialog', {name:'显示主题'});
  const themes = theme.locator('#theme-choices');
  const backgrounds = theme.locator('#background-choices');
  const backdrop = page.locator('#app-background');
  const photo = page.locator('#app-background-photo');
  await expect(themes.getByRole('radio')).toHaveCount(5);
  await expect(backgrounds.getByRole('radio')).toHaveCount(6);
  await expect(theme.getByRole('radio', {name:'白天'})).toBeChecked();
  await expect(backgrounds.locator('input[value="gate"]')).toBeChecked();
  await expect(backdrop).toHaveCSS('pointer-events','none');
  const gradients = new Set();
  for (const [name, value, background, panel] of [
    ['黑夜','night','rgb(15, 20, 29)','rgb(23, 31, 43)'],
    ['白天','day','rgb(255, 255, 255)','rgb(255, 255, 255)'],
    ['雾蓝','mist','rgb(227, 237, 247)','rgb(247, 251, 255)'],
    ['浅绿','green','rgb(227, 239, 229)','rgb(247, 252, 247)'],
    ['米色','beige','rgb(243, 231, 212)','rgb(255, 250, 240)']
  ]) {
    await theme.getByRole('radio', {name}).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
    await expect(page.locator('body')).toHaveCSS('background-color', background);
    await expect(page.locator('.today-timetable')).toHaveCSS('background-color', panel);
    await expect(theme).toHaveCSS('background-color', panel);
    await expect(theme.locator(`[data-choice="${value}"] .theme-preview`)).toHaveCSS('background-color', background);
    const gradient = await backdrop.evaluate(element => getComputedStyle(element).backgroundImage);
    assert.match(gradient,/linear-gradient\(/);
    gradients.add(gradient);
  }
  assert.equal(gradients.size,5,'各主题的整页渐变应当不同');
  for (const [scene, file] of [
    ['cherry','dufe-cherry.webp'],['aerial','dufe-aerial.webp'],['ginkgo','dufe-ginkgo.webp'],
    ['gate','dufe-campus.jpg'],['snow','dufe-snow.webp'],['garden','dufe-garden.webp']
  ]) {
    await backgrounds.locator(`input[value="${scene}"]`).check();
    await expect(page.locator('html')).toHaveAttribute('data-background',scene);
    await expect(photo).toHaveAttribute('src',`../assets/${file}`);
    await expect.poll(()=>photo.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  }
  await backgrounds.evaluate(fieldset=>{
    for (const scene of ['gate','cherry','aerial','snow']) fieldset.querySelector(`input[value="${scene}"]`).click();
  });
  await expect(backgrounds.locator('input[value="snow"]')).toBeChecked();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('course-desk-background'))).toBe('snow');
  await expect(photo).toHaveAttribute('src','../assets/dufe-snow.webp');
  await expect(themes.locator('input[value="beige"]')).toBeChecked();
  await expect(page.locator('#today-panel .campus-hero')).toHaveAttribute('data-scene','gate');
  await page.screenshot({path:path.join(output,'主题选择-桌面.png'),animations:'disabled'});
  await page.keyboard.press('Escape');
  await expect(theme).toBeHidden();
  await expect(page.getByRole('button', {name:'切换主题'})).toBeFocused();
  checks.push('五种主题即时切换页面、卡片和弹窗的背景，键盘关闭后焦点返回入口');
  checks.push('五套不同整页渐变，六张校园背景可独立选择，连续选图保留最后选择，首页横幅保持原场景');
  const sidebar = page.getByRole('navigation', {name:'事务分类'});
  await expect(sidebar.getByRole('button', {name:'今天'})).toHaveAttribute('aria-pressed','true');
  await sidebar.getByRole('button', {name:'课程表'}).focus();
  await expect(sidebar.getByRole('button', {name:'课程表'})).toBeFocused();
  assert.ok(await sidebar.getByRole('button', {name:'课程表'}).evaluate(button => getComputedStyle(button).outlineStyle !== 'none'));
  await page.emulateMedia({reducedMotion:'no-preference'});
  const motionResult=await page.evaluate(()=>{
    const click=view=>document.getElementById(`tab-${view}`).click();
    const timetable=document.getElementById('timetable-panel');
    const events=[];
    const listen=event=>events.push(event.detail);
    window.addEventListener('course-view-change',listen);
    click('timetable');
    const first=timetable.getAnimations()[0];
    click('timetable');
    const reused=timetable.getAnimations()[0]===first;
    click('today');
    click('homework');
    click('timetable');
    window.removeEventListener('course-view-change',listen);
    const leaving=document.querySelector('.view-panel-exit');
    return {events,reused,cancelled:first.playState==='idle',
      leavingHidden:leaving.hidden&&leaving.inert&&leaving.getAttribute('aria-hidden')==='true',
      newVisible:!timetable.hidden&&!timetable.inert,
      indicatorMoves:getComputedStyle(document.querySelector('.view-tab-indicator')).transitionProperty==='transform'};
  });
  assert.deepEqual(motionResult,{events:['timetable','today','homework','timetable'],reused:true,cancelled:true,
    leavingHidden:true,newVisible:true,indicatorMoves:true});
  await expect(page.locator('.view-panel-exit')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>{
    const tab=document.getElementById('tab-timetable').getBoundingClientRect();
    const marker=document.querySelector('.view-tab-indicator').getBoundingClientRect();
    return Math.abs(tab.top-marker.top)<1&&Math.abs(tab.left-marker.left)<1;
  })).toBe(true);
  await page.locator('#tab-today').click();
  checks.push('连续切换和返回能立刻响应，选中标记跟随，重复点当前页面不会重新播放');
  await page.getByRole('button',{name:'登录学校',exact:true}).click();
  await expect(page.locator('#today-current')).toContainText('市场调查与分析');
  await expect(page.locator('#today-next')).toContainText('数理统计');
  await expect(page.locator('#today-agenda-count')).toHaveText('2 项作业 · 0 项待办');
  await expect(page.locator('#today-sync-schedule-time')).toContainText('上次成功');
  await expect(page.locator('#today-sync-homework-time')).toContainText('上次成功');
  await page.locator('#tab-timetable').click();
  await expect(page.locator('#timetable-week-content .timetable-day')).toHaveCount(7);
  await expect(page.locator('#timetable-panel .campus-hero')).toHaveAttribute('data-scene','cherry');
  await expect(page.locator('html')).toHaveAttribute('data-background','snow');
  await expect(photo).toHaveAttribute('src','../assets/dufe-snow.webp');
  await expect(page.locator('#timetable-week-content')).toContainText('市场调查与分析');
  await expect(page.locator('#timetable-week-content')).toContainText('教学楼 A301');
  await page.screenshot({path:path.join(output,'本周课表-桌面.png'),animations:'disabled'});
  await page.locator('#timetable-prev-week').click();
  await expect(page.locator('#timetable-week-number')).toHaveValue('1');
  await expect(page.locator('#timetable-week-content')).toContainText('市场调查与分析');
  await page.locator('#timetable-current-week').click();
  await expect(page.locator('#timetable-week-number')).toHaveValue('2');
  await page.locator('#timetable-term').click();
  await expect(page.locator('#timetable-week-picker')).toBeHidden();
  await expect(page.locator('#timetable-term-content .timetable-day')).toHaveCount(7);
  await expect(page.locator('#timetable-term-content article.timetable-lesson')).toHaveCount(2);
  await expect(page.locator('#timetable-term-content article').filter({hasText:'市场调查与分析'})).toContainText('第 1–2 周');
  await page.screenshot({path:path.join(output,'总课表-桌面.png'),animations:'disabled'});
  await page.locator('#tab-today').click();
  checks.push('每周课表可切换教学周，总课表使用同款七日布局并标明周次');
  await page.locator('#today-monitor-toggle').click();
  await expect(page.locator('#today-status-label')).toHaveText('监控中');
  await expect(page.locator('#today-last-check')).toContainText('市场调查与分析');
  await expect(page.locator('#today-next-check')).toContainText('秒后');
  await page.screenshot({path:path.join(output,'今天-桌面.png'),animations:'disabled'});
  await page.locator('#today-monitor-toggle').click();
  await expect(page.locator('#today-status-label')).toHaveText('监控未开启');
  checks.push('默认打开今天首页、当前与下一节课、未来七天作业、监控启停和检查时间');
  await page.locator('#tab-homework').click();
  await expect(page.locator('.homework-row')).toHaveCount(4);
  await expect(page.locator('#hw-pending')).toHaveText('2');
  await expect(page.locator('#hw-submitted')).toHaveText('1');
  await page.locator('#homework-status').selectOption('pending');
  await expect(page.locator('.homework-row')).toHaveCount(2);
  await page.locator('#homework-query').fill('问卷');
  await expect(page.locator('.homework-row')).toHaveCount(1);
  await page.locator('#homework-query').fill('不存在的作业');
  await expect(page.locator('.homework-empty')).toContainText('没有符合筛选条件');
  await page.locator('#homework-query').fill('');
  await page.locator('#homework-status').selectOption('all');
  await page.screenshot({path:path.join(output,'作业汇总-模拟桌面.png'),fullPage:true,animations:"disabled"});
  checks.push('作业汇总、提交状态、搜索筛选和空结果');
  await page.locator('#tab-signin').click();
  await expect(page.locator('#connection-label')).toHaveText('学校登录有效');
  await page.getByRole('button',{name:'开始监控',exact:true}).click();
  await expect(page.locator('#status-label')).toHaveText('正在监控');
  await page.screenshot({path:path.join(output,'桌面-监控中.png'),fullPage:true,animations:"disabled"});checks.push('启动、连接、开始监控');
  await page.getByRole('button',{name:'模拟发起签到',exact:true}).click();
  await expect(page.locator('#history-count')).toHaveText('1 条');
  await expect(page.locator('#watch-title')).toHaveText('1 个签到正在进行');
  await page.getByRole('button',{name:'同步课表并检查',exact:true}).click();
  await expect(page.locator('#history-count')).toHaveText('1 条');
  await page.screenshot({path:path.join(output,'桌面-签到提醒.png'),fullPage:true,animations:"disabled"});checks.push('新签到提醒和重复查询去重');
  await page.getByRole('button',{name:'断网',exact:true}).click();
  await expect(page.locator('#error-banner')).toBeVisible();
  await expect(page.locator('#status-label')).toHaveText('检查遇到问题');
  await page.locator('#tab-today').click();
  await expect(page.locator('#today-sync-schedule-time')).toContainText('上次成功');
  await expect(page.locator('#today-sync-schedule-status')).toHaveText('同步失败，显示上次结果');
  await page.getByRole('button',{name:'重试同步课表'}).click();
  await expect(page.getByRole('button',{name:'重试同步课表'})).toBeEnabled();
  await page.getByRole('button',{name:'恢复正常',exact:true}).click();
  await expect(page.locator('#error-banner')).toBeHidden();
  await expect(page.getByRole('button',{name:'重试同步课表'})).toBeHidden();
  checks.push('首页显示课表和作业各自上次成功时间，课表失败时保留时间并提供重试');
  await page.getByRole('button',{name:'登录过期',exact:true}).click();
  await expect(page.getByRole('button',{name:'重新登录',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'重新登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'重新登录',exact:true})).toBeHidden();
  await page.locator('#tab-signin').click();
  await expect(page.locator('#connection-label')).toHaveText('学校登录有效');checks.push('登录过期暂停和重新连接');
  await page.locator('#mode').selectOption('manual');
  await expect(page.locator('#lesson')).toBeVisible();
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('设置已保存');
  await page.getByRole('button',{name:'开始监控',exact:true}).click();
  await expect(page.locator('#status-label')).toHaveText('正在监控');checks.push('指定课次和保存设置');
  const preferences=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.sandbox,true);checks.push('桌面页面权限隔离');
  await page.emulateMedia({reducedMotion:'reduce'});
  await instance.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setMinimumSize(375,600);BrowserWindow.getAllWindows()[0].setContentSize(375,760);});
  await expect(page.locator('#settings-title')).toBeVisible();
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(overflow.scroll<=overflow.width,JSON.stringify(overflow));
  await page.screenshot({path:path.join(output,'窄屏-375px.png'),fullPage:true,animations:"disabled"});checks.push('375 像素窄屏无横向溢出、减少动画');
  const reducedResult=await page.evaluate(()=>{
    document.getElementById('tab-homework').click();
    const entrance=document.getElementById('homework-panel').getAnimations()[0].effect;
    return {duration:entrance.getTiming().duration,
      stationary:entrance.getKeyframes().every(frame=>frame.transform==='none'),
      markerDuration:getComputedStyle(document.querySelector('.view-tab-indicator')).transitionDuration};
  });
  assert.deepEqual(reducedResult,{duration:95,stationary:true,markerDuration:'0s'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(output,'作业汇总-模拟窄屏.png'),fullPage:true,animations:"disabled"});
  checks.push('作业页面375像素窄屏无横向溢出');
  await page.locator('#tab-signin').click();
  await page.getByRole('button',{name:'暂停监控',exact:true}).click();
  await expect(page.locator('#status-label')).toHaveText('监控已暂停');
  await expect(page.locator('#feedback-open, #feedback-dialog')).toHaveCount(0);
  const supportButton=page.locator('.header-actions').getByRole('button',{name:'查看赞赏码',exact:true});
  await expect(page.locator('#support-open')).toHaveCount(1);
  await supportButton.focus();
  await page.keyboard.press('Enter');
  const support=page.getByRole('dialog',{name:'赞赏码',exact:true});
  await expect(support.locator('.support-code')).toBeVisible();
  await expect.poll(()=>support.locator('.support-code').evaluate(img=>[img.naturalWidth,img.naturalHeight])).toEqual([1599,1599]);
  await support.screenshot({path:path.join(output,'赞赏码-电脑.png'),animations:'disabled'});
  await page.keyboard.press('Escape');
  await expect(support).toBeHidden();
  await expect(supportButton).toBeFocused();
  checks.push('页首咖啡杯支持键盘打开新版赞赏码，关闭后焦点回到入口');
  await instance.close();instance=null;
  instance=await electron.launch({executablePath:require('electron'),args:[root,'--demo','--test-mode',`--profile=${profile}`],env,timeout:30000});
  const restart=await instance.firstWindow();
  await expect(restart.locator('#startup-intro')).toBeVisible();
  await expect(restart.locator('html')).toHaveAttribute('data-theme','beige');
  await expect(restart.locator('#startup-intro')).toBeHidden({timeout:4000});
  checks.push('完整重启后开场沿用上次主题并自然结束');
  await expect(restart.locator('html')).toHaveAttribute('data-background','snow');
  await expect(restart.locator('#app-background-photo')).toHaveAttribute('src','../assets/dufe-snow.webp');
  await expect(restart.locator('body')).toHaveCSS('background-color','rgb(243, 231, 212)');
  await restart.getByRole('button',{name:'登录学校',exact:true}).click();
  await expect(restart.locator('#history-count')).toHaveText('1 条');
  await expect(restart.locator('#mode')).toHaveValue('manual');checks.push('重启保留设置和提醒历史');
  await instance.close();instance=null;
  // Exercise the real SchoolApi inside its isolated school window. All HTTPS is served
  // by a controlled in-process fixture: no request or account data goes to the school.
  instance=await electron.launch({executablePath:require('electron'),args:[root,'--test-mode',`--profile=${profile}-protocol`],env,timeout:30000});
  await instance.evaluate(({session})=>{
    globalThis.fixture={active:false,expired:false,requests:[],opened:[]};
    session.fromPartition('persist:dufe-school').protocol.handle('https',async request=>{
      const u=new URL(request.url),f=globalThis.fixture;
      if(u.origin!=='https://ginkgostu.dufe.edu.cn')return new Response('blocked',{status:403});
      if(u.pathname==='/')return new Response('<!doctype html><title>学校登录测试样本</title><script>localStorage.setItem("token","test-only-secret");localStorage.setItem("STUDENTNO","test-user");localStorage.setItem("batch","test-term");localStorage.setItem("fingerprint","test-fingerprint");</script><p>仅测试样本</p>',{headers:{'Content-Type':'text/html'}});
      if(u.pathname.startsWith('/course/detail/') || u.pathname.startsWith('/homework/')) {
        f.opened.push(u.pathname);
        return new Response('<!doctype html><title>学校详情测试样本</title>',{headers:{'Content-Type':'text/html'}});
      }
      f.requests.push({path:u.pathname,query:u.search,method:request.method,hasExpectedToken:request.headers.get('token')==='test-only-secret',body:request.method==='POST'?await request.text():null});
      if(f.expired)return new Response('{}',{status:401,headers:{'Content-Type':'application/json'}});
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()).replaceAll('-','');
      const endOfDay=Date.parse(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T23:59:59.999+08:00');
      let data;
      if(u.pathname==='/student/currentDate')data={theWeek:10};
      else if(u.pathname==='/student/queryCourseList')data=u.searchParams.get('weekNo')==='11'?[]:[{dayList:[{date,courseList:[{courseNo:'31090083',courseSeq:'01',courseName:'市场调查与分析',weekTimeId:2128489,beginTime:'00:00',endTime:'23:59'}]}]}];
      else if(u.pathname==='/student/signIn/getStuSignInList')data=f.active?[{id:81234,title:'学校接口样本签到',type:2,signStatus:'1'}]:null;
      else if(u.pathname==='/student/signIn/getSignInInfo')data={signStatus:0,signInModel:{status:1,startTime:new Date(Date.now()-60000).toISOString(),endTime:new Date(Date.now()+600000).toISOString()}};
      else if(u.pathname==='/student/HomeworkList')data=[{courseNo:'31090083',courseSeq:'01',paperId:'7654',weekTimeId:'2128489',weekTime:'10',week:'2',section:'1',continunity:'2',courseName:'市场调查与分析',homeworkStatus:'1',endDate:new Date(endOfDay).toISOString()}];
      else if(u.pathname==='/student/getWeekTimePaper')data={paperId:'7654',paperName:'受控样本作业'};
      else return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
      return new Response(JSON.stringify({code:'2000',message:'成功',data}),{headers:{'Content-Type':'application/json'}});
    });
  });
  const live=await instance.firstWindow();live.on('pageerror',error=>errors.push(error.message));
  await expect(live.locator('#startup-intro')).toBeHidden();
  await live.getByRole('button',{name:'登录学校',exact:true}).click();
  await live.locator('#tab-homework').click();
  await expect(live.locator('.homework-row')).toHaveCount(1);
  await expect(live.locator('.homework-row h3')).toHaveText('受控样本作业');
  await live.locator('#tab-signin').click();
  await expect(live.locator('#connection-label')).toHaveText('学校登录有效',{timeout:15000});
  await live.getByRole('button',{name:'开始监控',exact:true}).click();
  await expect(live.locator('#status-label')).toHaveText('正在监控');
  await instance.evaluate(()=>{globalThis.fixture.active=true;});
  await live.getByRole('button',{name:'同步课表并检查',exact:true}).click();
  await expect(live.locator('#history-count')).toHaveText('1 条');
  await live.locator('#tab-today').click();
  const urgent=live.locator('#today-urgent-list').getByRole('button');
  await expect(urgent).toHaveCount(2);
  await expect(urgent.first()).toContainText('学校接口样本签到');
  await expect(urgent.last()).toContainText('受控样本作业');
  await expect(live.locator('#today-agenda-list')).not.toContainText('受控样本作业');
  await live.screenshot({path:path.join(output,'首页优先处理-桌面.png'),animations:'disabled'});
  await urgent.first().click();
  await expect.poll(()=>instance.evaluate(()=>globalThis.fixture.opened)).toContain('/course/detail/31090083/01/2128489/signin/81234/2');
  await urgent.last().click();
  await expect.poll(()=>instance.evaluate(()=>globalThis.fixture.opened.some(path=>path.startsWith('/homework/')))).toBe(true);
  checks.push('首页优先展示进行中的签到和今日待交作业，点击打开对应学校详情');
  await live.locator('#tab-signin').click();
  const requests=await instance.evaluate(()=>globalThis.fixture.requests);
  assert.ok(requests.every(x=>x.hasExpectedToken));
  assert.ok(requests.some(x=>x.path==='/student/currentDate'));
  const timetableQueries=requests.filter(x=>x.path==='/student/queryCourseList');
  assert.deepEqual(new Set(timetableQueries.map(x=>x.query)),new Set(['?weekNo=10','?weekNo=11']));
  assert.ok(requests.some(x=>x.path==='/student/signIn/getStuSignInList'&&x.method==='POST'&&x.body==='weekTimeId=2128489'));
  assert.ok(requests.some(x=>x.path==='/student/signIn/getSignInInfo'&&x.body==='signInId=81234'));
  assert.ok(requests.some(x=>x.path==='/student/getWeekTimePaper'&&new URLSearchParams(x.body).get('week')==='1'));
  checks.push('学校作业适配器：全部课程列表、名称详情及星期转换');
  const appSnapshot=await live.evaluate(()=>window.reminder.invoke('snapshot'));
  assert.ok(!JSON.stringify(appSnapshot).includes('test-only-secret'));checks.push('真实学校适配器：隔离窗口内携带登录信息、读取列表及详情，凭据不返回界面');
  await instance.evaluate(()=>{globalThis.fixture.expired=true;});
  await live.getByRole('button',{name:'同步课表并检查',exact:true}).click();
  await expect(live.locator('#status-label')).toHaveText('需要重新登录');checks.push('真实学校适配器：401 登录失效处理');
  await instance.evaluate(({BrowserWindow})=>{globalThis.fixture.expired=false;for(const w of BrowserWindow.getAllWindows())if(w.webContents.getURL().startsWith('https:'))w.destroy();});
  await live.getByRole('button',{name:'开始监控',exact:true}).click();
  await expect(live.locator('#status-label')).toHaveText('正在监控',{timeout:15000});
  await expect(live.locator('#connection-label')).toHaveText('学校登录有效');checks.push('学校窗口重新创建时等待加载完成，已保存登录状态可直接恢复监控');
  assert.deepEqual(errors,[]);
  const report={date:new Date().toISOString(),result:'passed',checks,rendererErrors:errors,scope:'Electron 模拟场景；不代表真实课堂发起签到验证，也不验证 Windows 实际通知送达'};
  fs.writeFileSync(path.join(output,'界面验证.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
 }finally{if(instance)await instance.close();}
})().catch(error=>{fs.writeFileSync(path.join(output,'界面验证.json'),JSON.stringify({date:new Date().toISOString(),result:'failed',message:error.message},null,2));console.error(error);process.exitCode=1;});
