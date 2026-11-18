const test = require('node:test');
const assert = require('node:assert/strict');
const { HomeworkMonitor, normalizeHomework, homeworkState } = require('../src/homework.cjs');
const { MonitorError } = require('../src/core.cjs');
const baseTime = Date.parse('2026-11-10T12:00:00+08:00');
function row(overrides = {}) {
  return { courseNo:'001',courseSeq:'02',paperId:'31',weekTimeId:'41',weekTime:'10',week:'2',section:'1',continunity:'2',courseName:'测试课程',homeworkStatus:'1',endDate:'2026-11-13 12:00:00',...overrides };
}
function harness(saved = {}) {
  let data = saved;
  const h = { now:baseTime, rows:[row()], scope:'account-a', notifications:[] };
  h.store = { read:()=>structuredClone(data),write:value=>{data=structuredClone(value);} };
  h.api = { homeworkList:async()=>({scope:h.scope,data:h.rows}),homeworkDetail:async item=>({scope:h.scope,data:{paperId:item.paperId,paperName:'统计作业'}}) };
  h.monitor = new HomeworkMonitor({api:h.api,store:h.store,notify:async record=>h.notifications.push(record),config:()=>({sound:false}),now:()=>h.now,timers:{setTimeout:()=>0,clearTimeout:()=>{}}});
  return h;
}
test('学校星期编号、前导零和重新提交链接与官方一致',()=>{
  const [item] = normalizeHomework([row({homeworkStatus:'3'})]);
  assert.equal(item.week,'1');
  assert.equal(Buffer.from(item.url.split('/').at(-1),'base64').toString(),'001-02-10-1-1-2-1-31-41');
  assert.equal(item.deadline,Date.parse('2026-11-13T12:00:00+08:00'));
});
test('已提交且超过截止仍然显示待批改，缺少时间不会误判过期',()=>{
  assert.equal(homeworkState(normalizeHomework([row({homeworkStatus:'3',endDate:'2026-11-01 12:00:00'})])[0],baseTime),'submitted');
  assert.equal(homeworkState(normalizeHomework([row({endDate:null})])[0],baseTime),'pending');
  assert.throws(()=>normalizeHomework({unexpected:[]}),/格式/);
  assert.throws(()=>normalizeHomework([row({endDate:'not a date'})]),/格式/);
});
test('带字母的课程编号仍纳入全课程作业，拒绝分隔符混入编号',()=>{
  const [item] = normalizeHomework([row({courseNo:'71079842K'})]);
  assert.equal(item.courseNo,'71079842K');
  assert.ok(Buffer.from(item.url.split('/').at(-1),'base64').toString().startsWith('71079842K-02-'));
  assert.throws(()=>normalizeHomework([row({courseNo:'abc-123'})]));
});
test('首次导入历史作业不刷屏，新作业提醒重启后仍去重',async()=>{
  const h=harness();await h.monitor.start();assert.equal(h.notifications.length,0);
  h.rows.push(row({paperId:'32'}));await h.monitor.check();assert.equal(h.notifications.length,1);
  const restarted=harness(h.store.read());restarted.rows=h.rows;await restarted.monitor.start();assert.equal(restarted.notifications.length,0);
});
test('24 小时和 1 小时分段提醒，已提交后停止提醒',async()=>{
  const h=harness();h.rows=[row({endDate:'2026-11-11 00:00:00'})];
  await h.monitor.start();assert.equal(h.notifications.length,1);assert.match(h.notifications[0].event,/:24h$/);
  await h.monitor.check();assert.equal(h.notifications.length,1);
  h.now=Date.parse('2026-11-10T23:30:00+08:00');await h.monitor.check();assert.equal(h.notifications.length,2);assert.match(h.notifications[1].event,/:1h$/);
  h.rows[0].homeworkStatus='3';await h.monitor.check();assert.equal(h.notifications.length,2);
});
test('暂停时导入的新作业恢复后提醒，失效的24小时提醒取消',async()=>{
  const h=harness();await h.monitor.check();h.rows.push(row({paperId:'32',endDate:'2026-11-11 00:00:00'}));await h.monitor.check();assert.equal(h.notifications.length,0);
  h.now=Date.parse('2026-11-10T23:30:00+08:00');await h.monitor.start();
  assert.equal(h.notifications.some(x=>x.event.endsWith(':24h')),false);
  assert.equal(h.notifications.some(x=>x.event.endsWith(':1h')),true);
});
test('账号切换隔离列表、首次导入和提醒历史',async()=>{
  const h=harness();await h.monitor.start();h.rows.push(row({paperId:'32'}));await h.monitor.check();
  h.scope='account-b';h.rows=[row({paperId:'50'})];await h.monitor.check();
  assert.equal(h.monitor.snapshot().history.length,0);assert.equal(h.monitor.snapshot().items.length,1);assert.equal(h.notifications.length,1);
});
test('同步过程中暂停不会继续通知或覆盖数据',async()=>{
  const h=harness();let resolve;h.api.homeworkList=()=>new Promise(r=>{resolve=r;});
  const check=h.monitor.start();await Promise.resolve();h.monitor.stop();resolve({scope:h.scope,data:h.rows});await check;
  assert.equal(h.monitor.state.items.length,0);assert.equal(h.notifications.length,0);
});
test('同步失败保留旧数据并显示失败，登录失效清空账号数据',async()=>{
  const h=harness();await h.monitor.start();
  h.api.homeworkList=async()=>{throw new MonitorError('network','连接失败');};await h.monitor.check();
  assert.equal(h.monitor.state.items.length,1);assert.equal(h.monitor.state.error,'连接失败');
  assert.deepEqual(h.monitor.snapshot().sync, { status:'error', lastSuccessAt:baseTime, error:'连接失败' });
  h.api.homeworkList=async()=>{throw new MonitorError('auth','登录失效');};await h.monitor.check();
  assert.equal(h.monitor.state.items.length,0);assert.equal(h.monitor.state.running,false);
  assert.deepEqual(h.monitor.snapshot().sync, { status:'login-required', lastSuccessAt:null, error:'登录失效' });
});
test('通知发送失败后重试，延期后取消旧截止提醒',async()=>{
  const h=harness();await h.monitor.check();h.rows=[row({endDate:'2026-11-11 00:00:00'})];
  h.monitor.notify=async()=>{throw new Error('temporary notification failure');};await h.monitor.start();
  assert.equal(h.monitor.records[0].delivery,'pending');
  assert.deepEqual(h.monitor.snapshot().sync, { status:'ok', lastSuccessAt:baseTime, error:'' });
  h.monitor.notify=async r=>h.notifications.push(r);await h.monitor.check();assert.equal(h.notifications.length,1);
  h.monitor.stop();h.rows=[row({endDate:'2026-11-10 12:30:00'})];await h.monitor.check();
  h.rows=[row({endDate:'2026-11-20 12:30:00'})];await h.monitor.start();assert.equal(h.notifications.length,1);
});
