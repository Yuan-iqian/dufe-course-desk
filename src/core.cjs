const { EventEmitter } = require('node:events');

const ORIGIN = 'https://ginkgostu.dufe.edu.cn';
const DEFAULTS = Object.freeze({ courseNo: '', courseSeq: '', interval: 30, mode: 'auto', lessonId: '', sound: true });
const BEFORE_CLASS = 10 * 60000;
const AFTER_CLASS = 15 * 60000;
class MonitorError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
const invalid = (message = '学校返回的数据格式发生变化，请暂停使用并检查更新') => new MonitorError('protocol', message);
const id = value => /^\d+$/.test(String(value ?? '')) ? String(value) : null;
const courseNumber = value => /^[a-z0-9]+$/i.test(String(value ?? '')) ? String(value) : null;

function parseCourseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new MonitorError('input', '请粘贴完整的白果云课堂签到页面链接'); }
  const match = url.pathname.match(/^\/course\/detail\/([a-z0-9]+)\/(\d+)\/(\d+)\/signin\/?$/i);
  if (url.origin !== ORIGIN || url.username || url.password || !match) throw new MonitorError('input', '请使用学校签到列表页面的链接');
  return { courseNo: match[1], courseSeq: match[2], lessonId: match[3] };
}
function validateConfig(value) {
  if (!value) throw new MonitorError('input', '监控设置无效');
  if (![15, 30, 60].includes(Number(value.interval))) throw new MonitorError('input', '检查间隔应为 15、30 或 60 秒');
  if (!['auto', 'manual'].includes(value.mode)) throw new MonitorError('input', '请选择监控方式');
  if (value.mode === 'manual' && !id(value.lessonId)) throw new MonitorError('input', '请先选择要监控的课次');
  const manual = value.mode === 'manual';
  return {
    courseNo: manual ? courseNumber(value.courseNo) || '' : '',
    courseSeq: manual ? id(value.courseSeq) || '' : '',
    lessonId: manual ? id(value.lessonId) : '',
    interval: Number(value.interval), mode: value.mode, sound: value.sound !== false
  };
}
function timeValue(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  // Server wall-clock dates are China time even on a computer in another zone.
  const s = value.trim().replace(' ', 'T');
  const timestamp = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(s) ? s : `${s}+08:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
}
function normalizeSchedule(data) {
  if (data === null) return [];
  if (!Array.isArray(data)) throw invalid();
  const lessons = [];
  for (const week of data) {
    if (!week || !Array.isArray(week.dayList)) throw invalid();
    for (const day of week.dayList) {
      if (!day || !Array.isArray(day.courseList)) throw invalid();
      for (const course of day.courseList) {
        const courseNo = courseNumber(course?.courseNo);
        const courseSeq = id(course?.courseSeq);
        const date = String(day.date).replaceAll('-', '');
        if (!courseNo || !courseSeq || !/^\d{8}$/.test(date) || !id(course.weekTimeId) || !/^\d{1,2}:\d\d(?::\d\d)?$/.test(course.beginTime) || !/^\d{1,2}:\d\d(?::\d\d)?$/.test(course.endTime)) throw invalid();
        const isoDate = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
        const begin = course.beginTime.replace(/^\d:/, '0$&');
        const finish = course.endTime.replace(/^\d:/, '0$&');
        const start = timeValue(`${isoDate} ${begin}`);
        const end = timeValue(`${isoDate} ${finish}`);
        if (!start || !end || end <= start) throw invalid('课表时间无法识别，请在学校页面核对课次');
        lessons.push({
          id: String(course.weekTimeId), date: isoDate, start, end, beginTime: begin.slice(0,5), endTime: finish.slice(0,5),
          title: String(course.courseName || course.name || courseNo).slice(0,80),
          room: typeof course.address === 'string' ? course.address.trim().slice(0,120) : '',
          teacher: typeof course.teacherName === 'string' ? course.teacherName.trim().slice(0,80) : '',
          courseNo, courseSeq
        });
      }
    }
  }
  return [...new Map(lessons.map(x => [x.id, x])).values()].sort((a,b) => a.start-b.start);
}
function selectLessons(lessons, config, now) {
  if (config.mode === 'manual') {
    const lesson = lessons.find(x => x.id === config.lessonId);
    if (!lesson) throw new MonitorError('input', '选中的课次不在当前课表中，请重新选择');
    return [lesson];
  }
  const priority = lesson => now < lesson.start ? 1 : now >= lesson.end ? 2 : 0;
  return lessons.filter(x => now >= x.start - BEFORE_CLASS && now <= x.end + AFTER_CLASS)
    .sort((a,b) => priority(a) - priority(b) || a.start - b.start);
}
function normalizeList(data) {
  if (data === null) return [];
  if (!Array.isArray(data)) throw invalid();
  return data.map(row => {
    if (!row || !id(row.id) || !['1','2','3'].includes(String(row.signStatus)) || !['0','1','2','3'].includes(String(row.type))) throw invalid('发现无法识别的签到类型或状态，请核对学校页面');
    return { id: String(row.id), type: Number(row.type), title: String(row.title || '课堂签到').slice(0,100), participation: String(row.signStatus) };
  });
}
function classifyDetail(data, now) {
  const model = data?.signInModel;
  if (!model || ![0,1,2].includes(model.status) || ![0,1,3,4].includes(data.signStatus)) throw invalid('签到详情格式尚未适配，请打开学校页面查看');
  if (data.signStatus !== 0) return { state: 'completed' };
  if (model.status === 0) return { state: 'scheduled' };
  if (model.status === 2) return { state: 'ended' };
  const start = timeValue(model.startTime), end = timeValue(model.endTime);
  if (model.startTime && start === null || model.endTime && end === null) throw invalid('签到时间格式无法识别');
  if (start !== null && start > now) return { state: 'scheduled' };
  if (end !== null && end <= now) return { state: 'ended' };
  return { state: 'active', endTime: end };
}
function lessonUrl(lesson) { return `${ORIGIN}/course/detail/${lesson.courseNo}/${lesson.courseSeq}/${lesson.id}/signin`; }

function timetableLessonUrl(monitor, id) {
  const lesson = monitor.state.schedule.find(item => item.id === id)
    || [...monitor.weekCache.values()].flatMap(entry => entry.lessons).find(item => item.id === id)
    || monitor.termCache?.lessons.find(item => item.id === id);
  if (!lesson) throw new MonitorError('input', '课表已变化，请同步后重新选择');
  return lessonUrl(lesson);
}

function schoolSigninUrl(monitor, recordKey) {
  if (recordKey) {
    const record = monitor.records.find(item => item.key === recordKey && item.scope === monitor.state.scope);
    if (!record) throw new MonitorError('input', '找不到这条签到记录，请重新同步');
    return record.url;
  }
  const lesson = monitor.state.lessons[0] || monitor.state.schedule.find(item => item.start > monitor.now());
  return lesson ? lessonUrl(lesson) : ORIGIN;
}

function signinActivityUrl(monitor, payload) {
  const { connected, activities } = monitor.state;
  const item = connected && activities.find(item => item.lessonId === payload?.lessonId && item.id === payload?.id);
  if (!item || item.state !== 'active' || item.endTime !== null && item.endTime <= monitor.now()) {
    throw new MonitorError('input', '此签到当前无法打开，请检查签到状态');
  }
  return item.url;
}

class Monitor extends EventEmitter {
  constructor({ api, store, notify, now = Date.now, timers = globalThis }) {
    super(); Object.assign(this, { api, store, notify, now, timers });
    const saved = store.read();
    try { this.config = validateConfig({ ...DEFAULTS, ...saved.config }); } catch { this.config = { ...DEFAULTS }; }
    this.records = Array.isArray(saved.records) ? saved.records : [];
    this.state = {
      running: false, phase: 'idle', connected: false, scope: '', error: '',
      schedule: [], manualLesson: null, lessons: [], activities: [],
      lastChecked: null, lastSchedule: null, nextCheck: null, failures: 0, checking: false,
      checkingLesson: null, lastSigninCheck: null, lastSigninLesson: null, timetableRevision: 0, calendar: null,
      scheduleSync: { status: 'idle', lastSuccessAt: null, error: '' }
    };
    this.epoch = 0; this.timer = null; this.inflight = null; this.suspended = false;
    this.refreshingSchedule = false;
    this.schedulePending = false;
    this.termCache = null;
    this.termRequest = null;
    this.weekCache = new Map();
  }
  clearTermTimetable() {
    this.termCache = null;
    this.termRequest = null;
    this.weekCache.clear();
    this.state.timetableRevision++;
  }
  async termTimetable(refresh = false) {
    const { scope, timetableRevision } = this.state;
    if (!scope || !this.state.connected) throw new MonitorError('auth', '登录学校并同步本周课表后再查看总课表');
    if (this.termRequest) return this.termRequest;
    if (this.termCache && !refresh) return this.termCache;
    const validateScope = responseScope => {
      if (responseScope !== scope || this.state.timetableRevision !== timetableRevision) {
        throw new MonitorError('auth', '登录账号或学期已变化，请重新同步课表');
      }
    };
    const pending = this.api.termSchedule(validateScope).then(result => {
      validateScope(scope);
      this.termCache = result;
      return result;
    });
    this.termRequest = pending;
    try { return await pending; }
    finally { if (this.termRequest === pending) this.termRequest = null; }
  }
  async weekTimetable(week, refresh = false) {
    const { scope, calendar, timetableRevision } = this.state;
    if (!scope || !this.state.connected) throw new MonitorError('auth', '请先登录学校');
    if (!calendar || !Number.isInteger(week) || week < 1 || week > calendar.weekCount) {
      throw new MonitorError('input', '请选择有效的教学周');
    }
    if (!refresh && this.weekCache.has(week)) return this.weekCache.get(week);
    const lessons = await this.api.weekSchedule(scope, week);
    if (this.state.timetableRevision !== timetableRevision) {
      throw new MonitorError('auth', '登录账号或学期已变化，请重新同步课表');
    }
    const result = { week, lessons, checkedAt: this.now() };
    this.weekCache.set(week, result);
    return result;
  }
  snapshot() {
    const { scope, ...state } = this.state;
    const scheduleSync = this.schedulePending ? { ...state.scheduleSync, status: 'syncing', error: '' } : state.scheduleSync;
    return structuredClone({ ...state, scheduleSync, config: this.config, history: this.records.filter(x => x.scope === scope).slice(-50).reverse(), upcoming: this.state.schedule.find(x => x.start > this.now()) || null });
  }
  publish() { this.emit('change', this.snapshot()); }
  persist() { this.store.write({ config: this.config, records: this.records.slice(-2000) }); }
  configure(config) {
    const next = validateConfig(config);
    if (this.state.checking) throw new MonitorError('busy', '正在检查，请稍后保存设置');
    this.stop();
    this.config = next;
    Object.assign(this.state, { lastSchedule: null, manualLesson: null, lessons: [], activities: [] });
    this.persist(); this.publish();
    return this.snapshot();
  }
  async start() {
    if (this.suspended) return this.snapshot();
    this.state.running = true; this.state.error = ''; this.publish();
    await this.check({ refresh: true }); return this.snapshot();
  }
  stop() { this.epoch++; this.schedulePending = false; this.state.running = false; this.state.nextCheck = null; this.state.phase = 'paused'; this.timers.clearTimeout(this.timer); this.publish(); }
  invalidateLogin(message = '请重新登录学校') {
    this.epoch++; this.timers.clearTimeout(this.timer);
    this.clearTermTimetable();
    this.schedulePending = false;
    Object.assign(this.state, {
      running: false, connected: false, nextCheck: null, phase: 'login-required', error: message,
      scope: '', schedule: [], manualLesson: null, lessons: [], activities: [], lastChecked: null, lastSchedule: null, calendar: null,
      checkingLesson: null, lastSigninCheck: null, lastSigninLesson: null,
      scheduleSync: { status: 'login-required', lastSuccessAt: null, error: message }
    });
    this.publish();
  }
  suspend() { this.suspended = true; this.epoch++; this.timers.clearTimeout(this.timer); this.state.nextCheck = null; this.state.phase = 'sleeping'; this.publish(); }
  async resume() { this.suspended = false; if (this.inflight) await this.inflight; if (this.state.running) return this.check({ refresh: true }); }
  schedule() {
    this.timers.clearTimeout(this.timer);
    if (!this.state.running || this.suspended) return;
    const now = this.now();
    let delay = 1000 * (this.state.failures ? Math.min(300, this.config.interval * 2 ** (this.state.failures-1)) : this.state.lessons.length ? this.config.interval : 60);
    if (!this.state.failures && this.config.mode === 'auto') {
      for (const lesson of this.state.schedule) {
        for (const boundary of [lesson.start - BEFORE_CLASS, lesson.start, lesson.end + AFTER_CLASS + 1]) {
          if (boundary > now) delay = Math.min(delay, boundary - now);
        }
      }
    }
    delay = Math.max(delay, 1000);
    this.state.nextCheck = now + delay;
    this.timer = this.timers.setTimeout(() => this.check(), delay);
    this.timer?.unref?.();
  }
  check({ refresh = false } = {}) {
    const epoch = this.epoch;
    if (this.suspended) return Promise.resolve();
    if (this.inflight) {
      if (!refresh || this.refreshingSchedule) return this.inflight;
      // A regular sign-in check can reuse the cached timetable. An explicit refresh must fetch it.
      return this.inflight.then(() => {
        if (epoch === this.epoch) return this.check({ refresh: true });
      });
    }
    const valid = () => { if (epoch !== this.epoch || this.suspended) throw new MonitorError('cancelled', '检查已取消'); };
    this.refreshingSchedule = this.schedulePending = refresh || this.state.lastSchedule === null || this.now() - this.state.lastSchedule >= 5 * 60000;
    this.state.checking = true; this.state.checkingLesson = null; this.state.nextCheck = null;
    this.timers.clearTimeout(this.timer); this.publish();
    this.inflight = Promise.resolve().then(async () => {
      try {
        let fetchedFromSchool = false;
        // The schedule request also validates login and binds deduplication to account + term.
        if (this.refreshingSchedule) {
          const result = await this.api.schedule(this.config); valid();
          fetchedFromSchool = true;
          if (!result.scope || typeof result.scope !== 'string') throw invalid('无法确认当前登录账号，请重新登录');
          const schedule = normalizeSchedule(result.data);
          const manualLesson = result.manualData === undefined ? null
            : normalizeSchedule(result.manualData).find(lesson => lesson.id === this.config.lessonId) || null;
          if (this.state.scope !== result.scope) {
            this.clearTermTimetable();
            this.state.lastSigninCheck = null;
            this.state.lastSigninLesson = null;
            this.state.activities = [];
          }
          const syncedAt = this.now();
          Object.assign(this.state, { schedule, manualLesson, calendar: result.calendar || null, scope: result.scope, connected: true, lastSchedule: syncedAt,
            scheduleSync: { status: 'ok', lastSuccessAt: syncedAt, error: '' } });
          this.schedulePending = false;
        }
        const { schedule, manualLesson } = this.state;
        this.state.lessons = selectLessons(manualLesson ? [...schedule, manualLesson] : schedule, this.config, this.now());
        const activities = [];
        for (const lesson of this.state.lessons) {
          this.state.checkingLesson = lesson;
          this.publish();
          const response = await this.api.list(lesson); valid();
          fetchedFromSchool = true;
          if (response.scope !== this.state.scope) { this.state.lastSchedule = null; throw new MonitorError('auth', '登录账号或学期已变化，请重新开始监控'); }
          for (const item of normalizeList(response.data)) {
            let status = { state: item.participation === '2' ? 'completed' : 'ended' };
            if (item.participation === '1') {
              const detail = await this.api.detail(item); valid();
              if (detail.scope !== this.state.scope) throw new MonitorError('auth', '登录账号已变化，请重新开始监控');
              status = classifyDetail(detail.data, this.now());
            }
            const event = { ...item, ...status, lessonId: lesson.id, courseTitle: lesson.title, url: `${lessonUrl(lesson)}/${item.id}/${item.type}` };
            activities.push(event);
            const key = [this.state.scope, lesson.courseNo, lesson.courseSeq, lesson.id, item.id].join(':');
            if (status.state !== 'active' || !this.state.running) continue;
            let record = this.records.find(x => x.key === key);
            if (record?.delivery === 'emitted') continue;
            if (!record) {
              record = { ...event, key, scope: this.state.scope, detectedAt: this.now(), delivery: 'pending' };
              this.records.push(record); this.persist();
            }
            await this.notify(record, this.config); valid();
            record.delivery = 'emitted'; record.notifiedAt = this.now(); this.persist();
          }
          this.state.lastSigninCheck = this.now();
          this.state.lastSigninLesson = lesson;
        }
        valid(); this.state.activities = activities; if (fetchedFromSchool) this.state.lastChecked = this.now(); this.state.error = ''; this.state.failures = 0;
        this.state.phase = this.state.running ? this.state.lessons.length ? 'watching' : 'waiting' : 'ready';
      } catch (error) {
        if (error.kind === 'cancelled' || epoch !== this.epoch && (error.kind !== 'auth' || this.state.phase !== 'login-required')) return;
        this.state.failures++;
        if (error.kind === 'rate-limit') this.state.failures = Math.max(2, this.state.failures);
        this.state.error = error instanceof MonitorError ? error.message : '检查失败，请重试；持续失败时请重新登录';
        this.state.phase = error.kind === 'auth' ? 'login-required' : 'error';
        if (error.kind === 'auth') {
          this.invalidateLogin(error.message);
          this.emit('login-required');
        } else if (this.schedulePending) {
          this.state.scheduleSync = { ...this.state.scheduleSync, status: 'error', error: this.state.error };
        }
        if (error.kind === 'storage' || error.kind === 'input') this.state.running = false;
      } finally {
        this.refreshingSchedule = this.schedulePending = false;
        this.state.checking = false; this.state.checkingLesson = null; this.inflight = null; this.schedule(); this.publish();
      }
    });
    return this.inflight;
  }
}
module.exports = { ORIGIN, DEFAULTS, MonitorError, parseCourseUrl, validateConfig, timeValue, normalizeSchedule, normalizeList, classifyDetail, selectLessons, lessonUrl, timetableLessonUrl, schoolSigninUrl, signinActivityUrl, Monitor };
