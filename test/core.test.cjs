const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Monitor, MonitorError, DEFAULTS, parseCourseUrl, normalizeSchedule, normalizeList, classifyDetail, selectLessons, timeValue, signinActivityUrl } = require('../src/core.cjs');
const { FileStore } = require('../src/store.cjs');
const { loadTimetable, loadTermTimetable, summarizeCourses } = require('../src/shared/timetable.cjs');
const now = Date.parse('2026-11-10T13:05:00+08:00');
const schedule = [{dayList:[{date:'20261110',courseList:[{courseNo:'31090083',courseSeq:'01',weekTimeId:2128489,beginTime:'13:00',endTime:'15:25'}]},{date:'20261117',courseList:[{courseNo:'31090083',courseSeq:'01',weekTimeId:2131022,beginTime:'13:00',endTime:'15:25'}]}]}];
const list = [{id:123,type:2,title:'课堂签到',signStatus:'1'}];
const detail = {signStatus:0,signInModel:{status:1,startTime:'2026-11-10 13:04:00',endTime:'2026-11-10 13:10:00'}};
test('学期汇总保留停课周、同课异时段与同名不同班', () => {
 const firstMonday = Date.parse('2026-09-07T00:00:00+08:00');
 const weekMs = 7 * 86400000;
 const lesson = { title:'统计学', courseNo:'A01', courseSeq:'01', beginTime:'08:00', endTime:'09:30', room:'A301', teacher:'张老师' };
 const rows = [
   {...lesson,start:firstMonday + 8 * 3600000},
   {...lesson,start:firstMonday + weekMs + 8 * 3600000},
   {...lesson,start:firstMonday + 3 * weekMs + 8 * 3600000,room:'B204'},
   {...lesson,start:firstMonday + 3 * weekMs + 86400000,courseSeq:'02'}
 ];
 const [a,b] = summarizeCourses(rows,firstMonday);
 assert.equal(a.weeks,'第 1–2、4 周');
 assert.deepEqual(a.slots.map(slot=>[slot.room,slot.weeks]),[['A301','第 1–2 周'],['B204','第 4 周']]);
 assert.equal(b.weeks,'第 4 周');
 assert.equal(b.courseSeq,'02');
});
test('总课表覆盖学期首尾、保留空周并拒绝切换账号后的课表', async () => {
 const scope = 'accountA:term1';
 const readWeeks = [];
 let changed = false;
 const request = async (path, method, params) => {
   assert.equal(method, 'GET');
   if (path === '/student/currentDate') {
     return { scope, data: { theWeek: '2', startDate: '2026-11-03', endDate: '2026-11-22', batchName: '测试学期' } };
   }
   readWeeks.push(params.weekNo);
   const dayList = params.weekNo === 2 ? schedule[0].dayList.slice(0,1) : [];
   return { scope: changed && params.weekNo === 2 ? 'other' : scope, data: [{ dayList }] };
 };
 const result = await loadTermTimetable(request, value => assert.equal(value, scope));
 assert.deepEqual(readWeeks, [1,2,3]);
 assert.equal(result.weekCount, 3);
 assert.equal(result.firstMonday, Date.parse('2026-11-02T00:00:00+08:00'));
 assert.equal(result.lessons.length, 1);
 assert.equal(result.name, '测试学期');
 changed = true;
 readWeeks.length = 0;
 await assert.rejects(loadTermTimetable(request, () => {}), /账号或学期已变化/);
 assert.deepEqual(readWeeks, [1,2]);
});
function harness(overrides={}){
 let saved={}, clock=now, scope='accountA:term1', failure;
 const notifications=[], timers={setTimeout:(_fn,ms)=>({ms,unref(){}}),clearTimeout(){} };
 const store={read:()=>structuredClone(saved),write:value=>{saved=structuredClone(value);}};
 const api={schedule:async()=>{if(failure)throw failure;return {scope,data:schedule};},list:async()=>{if(failure)throw failure;return {scope,data:list};},detail:async()=>({scope,data:detail}),...overrides};
 const create=()=>new Monitor({api,store,notify:async event=>{notifications.push(event);},now:()=>clock,timers});
 return {create,api,store,notifications,setNow:v=>{clock=v;},setScope:v=>{scope=v;},fail:v=>{failure=v;}};
}
test('课程链接保留课序号前导零，并拒绝伪造域名和任意路径',()=>{
 assert.deepEqual(parseCourseUrl('https://ginkgostu.dufe.edu.cn/course/detail/31090083/01/2128489/signin'),{courseNo:'31090083',courseSeq:'01',lessonId:'2128489'});
 for(const url of ['https://ginkgostu.dufe.edu.cn.evil.test/course/detail/1/01/2/signin','https://ginkgostu.dufe.edu.cn/student/signIn/InTheSign','http://ginkgostu.dufe.edu.cn/course/detail/1/01/2/signin','https://u:p@ginkgostu.dufe.edu.cn/course/detail/1/01/2/signin'])assert.throws(()=>parseCourseUrl(url));
});
test('根据中国时间切换课次，跨周不能一直查询旧编号',()=>{
 const lessons=normalizeSchedule(schedule,DEFAULTS);
 assert.equal(selectLessons(lessons,DEFAULTS,now)[0].id,'2128489');
 assert.equal(selectLessons(lessons,DEFAULTS,now+7*86400000)[0].id,'2131022');
 assert.equal(selectLessons(lessons,DEFAULTS,Date.parse('2026-11-10T12:49:00+08:00')).length,0);
 assert.equal(selectLessons(lessons,DEFAULTS,Date.parse('2026-11-10T15:41:00+08:00')).length,0);
 assert.equal(timeValue('2026-11-10 13:05:00'),now);
});
test('旧版自动配置可跨课程、跨教学周接续，并且签到链接和去重分别使用实际课次', async () => {
 const scope = 'accountA:term1';
 const first = { ...schedule[0].dayList[0].courseList[0], courseName:'市场调查', endTime:'13:50' };
 const second = { ...first, courseNo:'STATS02', courseSeq:'03', courseName:'统计学', weekTimeId:90002, beginTime:'14:00', endTime:'14:50' };
 const third = { ...second, courseNo:'43001', courseSeq:'01', courseName:'大学英语', weekTimeId:90003 };
 const queries = [], checked = [];
 const h = harness({
   schedule: config => loadTimetable(async (path, method, params) => {
     queries.push({path, method, params});
     if (path === '/student/currentDate') return {scope, data:{theWeek:'10',startDate:'2026-09-07',endDate:'2027-01-15'}};
     const day = params.weekNo === 10
       ? {date:'20261110',courseList:[second,first]}
       : {date:'20261116',courseList:[third]};
     return {scope,data:[{dayList:[day]}]};
   }, config),
   list: async lesson => { checked.push(lesson.id); return {scope,data:list}; },
   detail: async () => ({scope,data:{signStatus:0,signInModel:{status:1}}})
 });
 h.store.write({config:{...DEFAULTS,courseNo:first.courseNo,courseSeq:first.courseSeq},records:[]});
 const monitor = h.create();
 await monitor.start();
 assert.deepEqual(queries.map(x=>x.params), [{},{weekNo:10},{weekNo:11}]);
 assert.equal(monitor.snapshot().upcoming.title, second.courseName);
 assert.deepEqual(checked, ['2128489']);

 h.setNow(Date.parse('2026-11-10T14:00:00+08:00'));
 checked.length = 0;
 await monitor.check();
 assert.deepEqual(checked, ['90002','2128489'], '上课中的课程优先，同时保留上一节的签到窗口');
 assert.equal(monitor.snapshot().lessons[0].title, second.courseName);
 assert.match(h.notifications[1].url, /\/STATS02\/03\/90002\/signin\/123\/2$/);

 h.setNow(Date.parse('2026-11-10T14:06:00+08:00'));
 checked.length = 0;
 await monitor.check();
 assert.deepEqual(checked, ['90002']);
 assert.equal(monitor.snapshot().upcoming.title, third.courseName);

 h.setNow(Date.parse('2026-11-16T14:00:00+08:00'));
 await monitor.check();
 assert.equal(monitor.snapshot().lessons[0].title, third.courseName);
 assert.equal(h.notifications.length, 3);
 assert.equal(new Set(h.notifications.map(item=>item.key)).size, 3);
});
test('缺失课表结构或时间拒绝当作空结果，手动课次必须属于课表',()=>{
 assert.throws(()=>normalizeSchedule({},DEFAULTS));assert.throws(()=>normalizeSchedule([{dayList:null}],DEFAULTS));
 assert.throws(()=>selectLessons(normalizeSchedule(schedule,DEFAULTS),{...DEFAULTS,mode:'manual',lessonId:'999'},now));
});
test('成功的 null 是空签到，异常结构和陌生状态会报错',()=>{
 assert.deepEqual(normalizeList(null),[]);assert.throws(()=>normalizeList({}));assert.throws(()=>normalizeList([{...list[0],signStatus:'99'}]));
});
test('个人参与状态和活动状态分别判断，未开始/已结束/已参与不提醒',()=>{
 assert.equal(classifyDetail(detail,now).state,'active');
 assert.equal(classifyDetail({...detail,signStatus:1},now).state,'completed');
 for(const [status,state] of [[0,'scheduled'],[2,'ended']])assert.equal(classifyDetail({...detail,signInModel:{...detail.signInModel,status}},now).state,state);
 assert.equal(classifyDetail(detail,now+600000).state,'ended');
 assert.equal(classifyDetail(detail,now-120000).state,'scheduled');
 assert.throws(()=>classifyDetail({signStatus:'1',status:1},now));
});
test('开始时已有的进行中签到也提醒，重复查询和重启不重复提醒',async()=>{
 const h=harness();const m=h.create();await m.start();await m.check();assert.equal(h.notifications.length,1);m.stop();const restarted=h.create();await restarted.start();assert.equal(h.notifications.length,1);restarted.stop();
});
test('未发起变为进行中会提醒，同课次第二次签到使用独立编号',async()=>{
 const h=harness({list:async()=>({scope:'accountA:term1',data:null})}),m=h.create();await m.start();assert.equal(h.notifications.length,0);
 h.api.list=async()=>({scope:'accountA:term1',data:list});await m.check();assert.equal(h.notifications.length,1);
 h.api.list=async()=>({scope:'accountA:term1',data:[{...list[0],id:124}]});await m.check();assert.equal(h.notifications.length,2);m.stop();
});
test('仅同步和暂停状态不发签到提醒',async()=>{
 const h=harness(),m=h.create();await m.check({refresh:true});assert.equal(h.notifications.length,0);assert.equal(m.snapshot().activities[0].state,'active');
});
test('紧急签到只打开当前仍有效的活动详情', async () => {
 const h = harness(), monitor = h.create();
 await monitor.check({ refresh: true });
 const target = { lessonId: '2128489', id: '123', url: 'https://invalid.test/' };
 assert.equal(signinActivityUrl(monitor, target), 'https://ginkgostu.dufe.edu.cn/course/detail/31090083/01/2128489/signin/123/2');
 assert.throws(() => signinActivityUrl(monitor, { ...target, lessonId: '2131022' }), /此签到当前无法打开/);
 h.setNow(Date.parse('2026-11-10T13:10:00+08:00'));
 assert.throws(() => signinActivityUrl(monitor, target), /此签到当前无法打开/);
});
test('课表同步完成时间独立于签到检查，重试失败后保留上次成功时间', async () => {
 const h = harness(), monitor = h.create();
 let resolveSchedule;
 h.api.schedule = () => new Promise(resolve => { resolveSchedule = resolve; });
 h.api.list = async () => { throw new MonitorError('network', '签到检查中断'); };
 const check = monitor.check({ refresh: true });
 assert.equal(monitor.snapshot().scheduleSync.status, 'syncing');
 await Promise.resolve();
 h.setNow(now + 2000);
 resolveSchedule({ scope: 'accountA:term1', data: schedule });
 await check;
 assert.equal(monitor.snapshot().phase, 'error');
 assert.deepEqual(monitor.snapshot().scheduleSync, { status: 'ok', lastSuccessAt: now + 2000, error: '' });
 h.api.schedule = async () => { throw new MonitorError('network', '课表连接中断'); };
 await monitor.check({ refresh: true });
 assert.deepEqual(monitor.snapshot().scheduleSync, { status: 'error', lastSuccessAt: now + 2000, error: '课表连接中断' });
 h.api.schedule = async () => { throw new MonitorError('auth', '请重新登录'); };
 await monitor.check({ refresh: true });
 assert.deepEqual(monitor.snapshot().scheduleSync, { status: 'login-required', lastSuccessAt: null, error: '请重新登录' });
});
test('签到检查使用缓存时，手动同步课表仍会重新读取', async () => {
 let reads = 0, finishSignin;
 const scope = 'accountA:term1';
 const h = harness({ schedule: async () => { reads++; return { scope, data: schedule }; } });
 const monitor = h.create();
 await monitor.check();
 h.api.list = () => new Promise(resolve => { finishSignin = resolve; });
 const pending = monitor.check();
 while (!finishSignin) await new Promise(resolve => setImmediate(resolve));
 const refresh = monitor.check({ refresh: true });
 h.api.list = async () => ({ scope, data: list });
 finishSignin({ scope, data: list });
 await Promise.all([pending, refresh]);
 assert.equal(reads, 2);
});
test('登录过期会暂停，不伪装成没有签到',async()=>{
 const h=harness(),m=h.create();await m.start();h.fail(new MonitorError('auth','登录过期'));await m.check({refresh:true});assert.equal(m.state.phase,'login-required');assert.equal(m.state.running,false);assert.equal(m.state.connected,false);assert.equal(m.state.nextCheck,null);
});
test('断网保留上次成功时间，退避后恢复检查且不重复提醒',async()=>{
 const h=harness(),m=h.create();await m.start();const checked=m.state.lastChecked;h.setNow(now+30000);h.fail(new MonitorError('network','网络中断'));await m.check();await m.check();assert.equal(m.state.phase,'error');assert.equal(m.state.lastChecked,checked);assert.equal(m.state.nextCheck-(now+30000),60000);h.fail(null);await m.check();assert.equal(m.state.phase,'watching');assert.equal(h.notifications.length,1);m.stop();
});
test('课表窗口外反复检查不会卡在检查中',async()=>{
 const h=harness();h.setNow(now+86400000);const m=h.create();await m.start();await m.check();await m.check();assert.equal(m.state.phase,'waiting');assert.equal(m.inflight,null);m.stop();
});
test('等待上课时本地核对课次不能冒充一次成功的学校数据读取',async()=>{
 const h=harness();h.setNow(now+86400000);const m=h.create();await m.start();const checked=m.state.lastChecked;h.setNow(now+86400000+60000);await m.check();assert.equal(m.state.lastChecked,checked);h.setNow(now+86400000+301000);await m.check();assert.equal(m.state.lastChecked,now+86400000+301000);m.stop();
});
test('课表同步不冒充签到检查，进行中的检查标明课次，失败保留上次成功时间',async()=>{
 const h=harness(),m=h.create();
 h.setNow(now-30*60000);await m.start();
 assert.equal(m.snapshot().lastSigninCheck,null);
 h.setNow(now);
 let finish;
 h.api.list=()=>new Promise(resolve=>{finish=resolve;});
 const pending=m.check();
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(m.snapshot().checkingLesson.id,'2128489');
 finish({scope:'accountA:term1',data:list});await pending;
 assert.equal(m.snapshot().lastSigninCheck,now);
 assert.equal(m.snapshot().checkingLesson,null);
 h.setNow(now+15000);
 h.api.list=async()=>{throw new MonitorError('network','连接中断');};
 await m.check();
 assert.equal(m.snapshot().lastSigninCheck,now);
 assert.equal(m.snapshot().lastSigninLesson.id,'2128489');
});
test('请求进行中暂停，延迟响应不能再发提醒',async()=>{
 let resolve;const h=harness({list:()=>new Promise(r=>{resolve=r;})}),m=h.create();const pending=m.start();while(!resolve)await new Promise(r=>setImmediate(r));m.stop();resolve({scope:'accountA:term1',data:list});await pending;assert.equal(h.notifications.length,0);assert.equal(m.state.running,false);assert.equal(m.state.nextCheck,null);
});
test('重叠检查合并为单个请求',async()=>{
 let count=0,resolve;const h=harness({schedule:()=>{count++;return new Promise(r=>{resolve=r;});}}),m=h.create();const a=m.check(),b=m.check();await new Promise(r=>setImmediate(r));assert.equal(count,1);resolve({scope:'accountA:term1',data:schedule});await Promise.all([a,b]);
});
test('相同签到编号在另一个账号或学期不会被旧记录吞掉',async()=>{
 const h=harness(),m=h.create();await m.start();h.setScope('accountB:term2');await m.check({refresh:true});assert.equal(h.notifications.length,2);assert.equal(m.snapshot().history.length,1);m.stop();
});
test('检查中切换账号会暂停，避免拿旧账号状态做判断',async()=>{
 const h=harness(),m=h.create();await m.start();h.setScope('accountB:term1');await m.check();assert.equal(m.state.phase,'login-required');assert.equal(h.notifications.length,1);
});
test('提醒发送失败会保留待发送记录，下次成功后去重',async()=>{
 const h=harness(),m=h.create();let failed=true;m.notify=async()=>{if(failed)throw new Error('notification failure');h.notifications.push(1);};await m.start();assert.equal(m.records[0].delivery,'pending');failed=false;await m.check();await m.check();assert.equal(h.notifications.length,1);assert.equal(m.records[0].delivery,'emitted');m.stop();
});
test('休眠停止定时，唤醒重新获取课表和签到',async()=>{
 const h=harness(),m=h.create();await m.start();m.suspend();assert.equal(m.state.nextCheck,null);assert.equal(m.state.phase,'sleeping');await m.resume();assert.equal(m.state.phase,'watching');assert.equal(h.notifications.length,1);m.stop();
});
test('落盘记录支持重启恢复，损坏文件不能静默清空去重记录',()=>{
 const base=path.resolve(__dirname,'../.test-data');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'store-'));const store=new FileStore(dir);store.write({config:DEFAULTS,records:[{key:'one'}]});assert.equal(new FileStore(dir).read().records[0].key,'one');fs.writeFileSync(store.file,'broken');assert.throws(()=>store.read(),/无法读取/);assert.equal(path.dirname(path.resolve(dir)),base);fs.rmSync(dir,{recursive:true,force:true});
});
