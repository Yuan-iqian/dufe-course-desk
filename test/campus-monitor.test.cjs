const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {CampusMonitor}=require('../src/campus-monitor.cjs');
test('校园桌面提醒按账号去重，退出和休眠不会冒出旧账号通知',async t=>{
  const testRoot = path.resolve(__dirname, '../.test-data');
  fs.mkdirSync(testRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testRoot, 'campus-monitor-'));
  class Sharing extends EventEmitter{snapshot(){return {url:'https://course.test',data:{user:{id:this.user||'a'}}};}async campusRequest(){return this.response;}}
  const sharing=new Sharing();sharing.response={items:[{id:'notice',revision:1,title:'新公告',url:'https://jwc.dufe.edu.cn/'}],serverTime:100};let notified=[];
  const m=new CampusMonitor({sharing,directory,notify:items=>notified.push(...items),clock:()=>50,interval:999999});t.after(()=>m.close());
  clearTimeout(m.timer);await m.check();await m.check();assert.equal(notified.length,1);
  sharing.response.items[0].revision=2;await m.check();assert.equal(notified.length,2);
  m.suspend();await m.check();assert.equal(notified.length,2);m.suspended=false;
  sharing.user='b';sharing.emit('change');await m.check();assert.equal(notified.length,3,'另一个账号的去重独立');
  m.close();const again=new CampusMonitor({sharing,directory,notify:items=>notified.push(...items),clock:()=>100,interval:999999});t.after(()=>again.close());clearTimeout(again.timer);await again.check();assert.equal(notified.length,3,'重启后不会重复弹出');
});
