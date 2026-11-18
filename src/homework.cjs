const { EventEmitter } = require('node:events');
const { ORIGIN, MonitorError, timeValue } = require('./core.cjs');

const INTERVAL = 5 * 60000;
const HOUR = 3600000;
const identifier = value => /^\d+$/.test(String(value ?? ''));
const protocolError = () => new MonitorError('protocol', '作业数据格式无法识别，请打开学校作业页面核对');

function normalizeHomework(data) {
  if (data === null) return [];
  if (!Array.isArray(data)) throw protocolError();
  const items = data.map(row => {
    const fields = ['courseNo', 'courseSeq', 'paperId', 'weekTimeId', 'weekTime', 'week', 'section', 'continunity'];
    if (!row || !/^[a-z0-9]+$/i.test(String(row.courseNo ?? '')) || fields.filter(key => key !== 'courseNo').some(key => !identifier(row[key])) || !['1','2','3','4'].includes(String(row.homeworkStatus))) throw protocolError();
    const item = Object.fromEntries(fields.map(key => [key, String(row[key])]));
    if (Number(item.week) < 1 || Number(item.week) > 7) throw protocolError();
    // The official global list uses weekdays 1–7; its detail page uses 0–6.
    item.week = String(Number(item.week) - 1);
    const deadline = row.endDate ? timeValue(row.endDate) : null;
    if (row.endDate && deadline === null) throw protocolError();
    const status = String(row.homeworkStatus);
    const routeStatus = status === '3' ? '1' : status === '4' ? '2' : status;
    const route = [item.courseNo,item.courseSeq,item.weekTime,item.week,item.section,item.continunity,routeStatus,item.paperId,item.weekTimeId].join('-');
    return {
      ...item, id: [item.courseNo,item.courseSeq,item.weekTimeId,item.paperId].join(':'),
      courseTitle: String(row.courseName || '未命名课程').slice(0,100),
      teacher: String(row.teacherName || '').slice(0,80),
      title: `第 ${item.weekTime} 周作业`, status, deadline,
      score: status === '2' && row.score != null ? String(row.score) : null,
      url: `${ORIGIN}/homework/${btoa(route)}`
    };
  });
  return [...new Map(items.map(item => [item.id,item])).values()];
}

function homeworkState(item, now = Date.now()) {
  if (item.status === '2') return 'graded';
  if (item.status === '3') return 'submitted';
  if (item.status === '4' || item.deadline !== null && item.deadline <= now) return 'overdue';
  if (item.deadline !== null && item.deadline - now <= 24 * HOUR) return 'due';
  return 'pending';
}

class HomeworkMonitor extends EventEmitter {
  constructor({ api, store, notify, config, now = Date.now, timers = globalThis }) {
    super();
    Object.assign(this, { api, store, notify, config, now, timers });
    const saved = store.read();
    this.accounts = saved.accounts || {};
    this.records = saved.records || [];
    this.state = { running:false, checking:false, phase:'idle', error:'', scope:'', items:[], lastChecked:null, nextCheck:null, failures:0,
      sync: { status:'idle', lastSuccessAt:null, error:'' } };
    this.epoch = 0;
    this.inflight = null;
    this.suspended = false;
    this.syncPending = false;
  }
  snapshot() {
    const { scope, ...state } = this.state;
    const sync = this.syncPending ? { ...state.sync, status:'syncing', error:'' } : state.sync;
    return structuredClone({ ...state, sync, items:state.items.map(item => ({ ...item, state:homeworkState(item,this.now()) })), history:this.records.filter(row => row.scope === scope && row.delivery === 'emitted').slice(-30).reverse() });
  }
  publish() { this.emit('change', this.snapshot()); }
  persist() { this.store.write({ accounts:this.accounts, records:this.records }); }
  async start() {
    if (this.suspended) return;
    if (this.inflight) await this.inflight;
    this.state.running = true;
    return this.check();
  }
  stop(phase = 'paused') { this.epoch++; this.syncPending = false; this.state.running = false; this.state.nextCheck = null; this.state.phase = phase; this.timers.clearTimeout(this.timer); this.publish(); }
  invalidateLogin(message = '登录已失效，请重新登录学校') {
    Object.assign(this.state, { error:message, scope:'', items:[], lastChecked:null,
      sync: { status:'login-required', lastSuccessAt:null, error:message } });
    this.stop('login-required');
  }
  suspend() { this.suspended = true; this.epoch++; this.timers.clearTimeout(this.timer); this.state.nextCheck = null; this.state.phase = 'sleeping'; this.publish(); }
  async resume() { this.suspended = false; if (this.inflight) await this.inflight; if (this.state.running) return this.check(); }
  schedule() {
    this.timers.clearTimeout(this.timer);
    if (!this.state.running || this.suspended) return;
    const delay = Math.min(30 * 60000, INTERVAL * 2 ** Math.min(this.state.failures, 3));
    this.state.nextCheck = this.now() + delay;
    this.timer = this.timers.setTimeout(() => this.check(), delay);
    this.timer?.unref?.();
  }
  check() {
    if (this.suspended) return Promise.resolve();
    if (this.inflight) return this.inflight;
    const epoch = this.epoch;
    const valid = () => { if (epoch !== this.epoch || this.suspended) throw new MonitorError('cancelled','同步已取消'); };
    this.state.checking = true;
    this.syncPending = true;
    this.state.nextCheck = null;
    this.timers.clearTimeout(this.timer);
    this.publish();
    this.inflight = Promise.resolve().then(async () => {
      try {
        const response = await this.api.homeworkList();
        valid();
        if (typeof response.scope !== 'string' || !response.scope) throw protocolError();
        if (this.state.scope !== response.scope) {
          this.state.scope = response.scope;
          this.state.items = [];
          this.state.lastChecked = null;
          this.state.sync = { status:'idle', lastSuccessAt:null, error:'' };
          this.publish();
        }
        const scope = response.scope;
        const previous = this.accounts[scope];
        const known = new Set(previous?.known || []);
        const items = normalizeHomework(response.data).map(item => {
          const old = previous?.items.find(row => row.id === item.id);
          return { ...item, firstSeen:old?.firstSeen || this.now(), title:old?.title || item.title, titleChecked:old?.titleChecked || 0 };
        });
        let titleRequests = 0;
        for (const item of items) {
          if (this.now() - item.titleChecked < 30 * 60000) continue;
          if (titleRequests >= 20) break;
          titleRequests++;
          try {
            const detail = await this.api.homeworkDetail(item);
            valid();
            if (detail.scope !== scope) throw new MonitorError('auth','登录账号或学期已变化，请重新同步作业');
            if (detail.data && String(detail.data.paperId) === item.paperId && detail.data.paperName) {
              item.title = String(detail.data.paperName).slice(0,200);
              item.titleChecked = this.now();
            }
          } catch (error) {
            if (['auth','cancelled'].includes(error.kind)) throw error;
            // The global list still supplies authoritative deadlines and status.
            break;
          }
        }
        valid();
        for (const item of items) {
          if (previous && !known.has(item.id)) this.queue(item, 'new', '发现新作业');
          known.add(item.id);
          if (homeworkState(item,this.now()) === 'due') {
            const bucket = item.deadline - this.now() <= HOUR ? '1h' : '24h';
            this.queue(item, `due:${item.deadline}:${bucket}`, bucket === '1h' ? '作业将在 1 小时内截止' : '作业将在 24 小时内截止');
          }
        }
        this.accounts[scope] = { known:[...known], items };
        this.persist();
        this.state.items = items;
        this.state.lastChecked = this.now();
        this.state.sync = { status:'ok', lastSuccessAt:this.state.lastChecked, error:'' };
        this.syncPending = false;
        this.publish();
        for (const record of this.records.filter(row => row.scope === scope && row.delivery === 'pending')) {
          valid();
          const item = items.find(row => row.id === record.itemId);
          if (!item || !['pending','due'].includes(homeworkState(item,this.now())) || record.event.startsWith('due:') && record.deadline !== item.deadline || record.event.endsWith(':24h') && item.deadline - this.now() <= HOUR) {
            record.delivery = 'cancelled';
            continue;
          }
          if (!this.state.running) continue;
          await this.notify({ ...record, url:item.url }, this.config());
          valid();
          record.delivery = 'emitted';
          record.notifiedAt = this.now();
          this.persist();
        }
        this.persist();
        this.state.failures = 0;
        this.state.error = '';
        this.state.phase = this.state.running ? 'watching' : 'ready';
      } catch (error) {
        if (error.kind === 'cancelled' || epoch !== this.epoch && (error.kind !== 'auth' || this.state.phase !== 'login-required')) return;
        this.state.failures++;
        this.state.error = error instanceof MonitorError ? error.message : '作业同步失败，请稍后重试';
        this.state.phase = error.kind === 'auth' ? 'login-required' : 'error';
        if (error.kind === 'auth') {
          this.invalidateLogin(this.state.error);
        } else if (this.syncPending) {
          this.state.sync = { ...this.state.sync, status:'error', error:this.state.error };
        }
        if (error.kind === 'storage') this.state.running = false;
      } finally {
        this.syncPending = false;
        this.state.checking = false;
        this.inflight = null;
        this.schedule();
        this.publish();
      }
    });
    return this.inflight;
  }
  queue(item, event, label) {
    const key = [this.state.scope,item.id,event].join(':');
    if (this.records.some(record => record.key === key)) return;
    this.records.push({ key, scope:this.state.scope, itemId:item.id, event, kind:'homework', title:`${label} · ${item.title}`, courseTitle:item.courseTitle, url:item.url, deadline:item.deadline, detectedAt:this.now(), delivery:'pending' });
  }
}
module.exports = { HomeworkMonitor, normalizeHomework, homeworkState };
