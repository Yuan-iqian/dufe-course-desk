'use strict';

const { registerPlugin, CapacitorHttp } = require('@capacitor/core');
const { App } = require('@capacitor/app');
const { Preferences } = require('@capacitor/preferences');
const { LocalNotifications } = require('@capacitor/local-notifications');
const { Monitor, MonitorError, ORIGIN, parseCourseUrl, schoolSigninUrl, signinActivityUrl, timetableLessonUrl } = require('../../src/core.cjs');
const { loadTimetable, loadTermTimetable, loadWeekTimetable } = require('../../src/shared/timetable.cjs');
const { HomeworkMonitor } = require('../../src/homework.cjs');
const { CampusClient } = require('../../src/shared/campus-client.cjs');
const hosted = require('../../src/hosted-service.json');
const NativeSchool = registerPlugin('SchoolSession');
const stateListeners = new Set();
const campusListeners = new Set();
const openCampusListeners = new Set();
const stores = new Map();
let schoolIdentity = null;
let sessionEpoch = 0, loggingOut = false, lastRecovery = 0, recovery = null;
async function recoverSchool(force = false) {
  if(loggingOut)return false;
  if(recovery)return recovery;
  if(!force && Date.now()-lastRecovery<60000)return false;
  lastRecovery=Date.now();
  const epoch=sessionEpoch;
  const pending=NativeSchool.reconnect().then(value=>epoch===sessionEpoch&&value.started===true).catch(()=>false).finally(()=>{if(recovery===pending)recovery=null;});
  recovery=pending;
  return recovery;
}
let monitor, homework, campus;
let active = true;
let notificationRevision = '';
let notificationQueue = Promise.resolve();

class MobileStore {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.pending = Promise.resolve();
    this.error = null;
  }
  read() { return this.value; }
  write(value) {
    this.value = value;
    const json = JSON.stringify(value);
    this.pending = this.pending.then(() => Preferences.set({ key: this.key, value: json })).catch(() => {
      this.error = new MonitorError('storage', '无法保存本机记录，请检查设备存储空间');
    });
  }
  async flush() { await this.pending; if (this.error) throw this.error; }
}

function emitSession(identity) {
  const previous = schoolIdentity;
  schoolIdentity = identity;
  if (previous && previous.id !== identity?.id) { void NativeSchool.closeCampusCard().catch(() => {}); monitor?.invalidateLogin(); homework?.invalidateLogin(); }
  campus?.setSession(identity);
  for (const listener of campusListeners) listener(campus.snapshot());
}

const api = {
  async request(path, method, params) {
    if(loggingOut)throw new MonitorError('auth','正在退出学校');
    const epoch=sessionEpoch;
    let result = await NativeSchool.request({ path, method, params });
    if(['auth', 'session-pending'].includes(result.error) && epoch===sessionEpoch && await recoverSchool() && epoch===sessionEpoch)result=await NativeSchool.request({path,method,params});
    if(epoch!==sessionEpoch)throw new MonitorError('auth','学校账号已退出，请重新登录');
    if (result.error === 'session-pending') result = { error: 'network' };
    if (result.error) {
      if (result.error === 'auth') emitSession(null);
      const messages = { auth: '请在学校窗口完成登录', network: '学校连接暂时中断，请稍后重试', 'rate-limit': '学校暂时限制查询频率，请稍后重试', protocol: '学校返回的数据无法识别' };
      throw new MonitorError(result.error, messages[result.error] || '学校数据读取失败');
    }
    if (!result.scope || !result.identity?.id) throw new MonitorError('protocol', '无法确认学校登录状态');
    emitSession(result.identity);
    return result;
  },
  schedule(config) { return loadTimetable(this.request.bind(this), config); },
  termSchedule(validateScope) { return loadTermTimetable(this.request.bind(this), validateScope); },
  weekSchedule(scope, week) { return loadWeekTimetable(this.request.bind(this), scope, week); },
  homeworkList() { return this.request('/student/HomeworkList', 'GET', { operation: '3' }); },
  homeworkDetail(item) {
    const { courseNo, courseSeq, weekTime, week, section, continunity, weekTimeId } = item;
    return this.request('/student/getWeekTimePaper', 'POST', { courseNo, courseSeq, weekTime, week, section, continunity, weekTimeId });
  },
  exercises(lesson) {
    return this.request('/student/exercise/getExerciseList', 'POST', {
      courseId: lesson.courseId, courseNo: lesson.courseNo, courseSeq: lesson.courseSeq, weekTimeId: lesson.id
    });
  },
  list(lesson) { return this.request('/student/signIn/getStuSignInList', 'POST', { weekTimeId: lesson.id }); },
  detail(item) { return this.request(item.type === 3 ? '/student/signIn/getOnlineSignInInfo' : '/student/signIn/getSignInInfo', 'POST', { signInId: item.id }); },
  open(url = ORIGIN) { return NativeSchool.open({ url }); }
};

function notificationId(text) {
  let value = 2166136261;
  for (const letter of text) value = Math.imul(value ^ letter.charCodeAt(0), 16777619);
  return (value >>> 1) || 1;
}

async function notify(record) {
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') return;
  const planned = stores.get('notification-state')?.read().planned || {};
  if (record.event?.startsWith('due:') && planned[record.key]?.at <= Date.now()) return;
  await LocalNotifications.schedule({ notifications: [{
    id: notificationId(record.key || record.title + Date.now()),
    title: record.kind === 'campus' ? '校园通知' : record.kind === 'exercise' ? `${record.courseTitle} · 课堂练习` : record.courseTitle || '东财课历',
    body: record.title,
    extra: { kind: record.kind || 'signin', recordKey: record.key }
  }] });
}

function updateDeadlineNotifications() {
  notificationQueue = notificationQueue.catch(() => {}).then(scheduleDeadlines);
  return notificationQueue;
}
async function scheduleDeadlines() {
  const state = homework.snapshot();
  const scope = homework.state.scope;
  const revision = JSON.stringify([scope, schoolIdentity?.id, state.items.map(item => [item.id, item.deadline, item.status]), state.running]);
  if (revision === notificationRevision || (await LocalNotifications.checkPermissions()).display !== 'granted') return;
  const pending = await LocalNotifications.getPending();
  const deadlines = pending.notifications.filter(item => item.extra?.kind === 'homework-deadline');
  if (deadlines.length) await LocalNotifications.cancel({ notifications: deadlines.map(item => ({ id: item.id })) });
  const notifications = [];
  const notificationStore = stores.get('notification-state');
  // Keep past registrations so returning to the foreground doesn't repeat a scheduled alert.
  const planned = Object.fromEntries(Object.entries(notificationStore.read().planned || {}).filter(([, value]) => value.at <= Date.now() && value.at > Date.now() - 7 * 86400000));
  if (state.running && schoolIdentity) {
    for (const item of state.items.filter(item => item.status === '1')) {
      for (const hours of [24, 1]) {
        const when = item.deadline - hours * 3600000;
        if (!Number.isFinite(when) || when <= Date.now() + 10000) continue;
        const key = [scope, item.id, `due:${item.deadline}:${hours}h`].join(':');
        notifications.push({ id: notificationId(key), title: item.courseTitle || '作业提醒', body: `${item.title} 将在 ${hours} 小时后截止`, schedule: { at: new Date(when) }, extra: { kind: 'homework-deadline', key } });
      }
    }
  }
  notifications.sort((a, b) => a.schedule.at - b.schedule.at);
  const selected = notifications.slice(0, 60);
  if (selected.length) await LocalNotifications.schedule({ notifications: selected });
  for (const item of selected) planned[item.extra.key] = { at: item.schedule.at.getTime(), id: item.id };
  notificationStore.write({ planned });
  await notificationStore.flush();
  notificationRevision = revision;
}

function snapshot() {
  const { scheduleSync, ...state } = monitor.snapshot();
  const work = homework.snapshot();
  return { ...state, homework: work, sync: { schedule: scheduleSync, homework: work.sync }, campusTasks: campus.pendingDeadlines(), schoolIdentity, demo: false, notificationSupported: true, mobile: true };
}
function publish() {
  for (const listener of stateListeners) listener(snapshot());
}
async function refresh() { await Promise.all([monitor.check({ refresh: true }), homework.check()]); }

let checkingCampus = false;
async function checkCampus() {
  if (!active || !schoolIdentity || checkingCampus) return;
  checkingCampus = true;
  try {
    const owner = schoolIdentity.id;
    const profile = campus.requireProfile();
    const response = await campus.request('alerts?since=' + (profile.lastAlert || profile.baseline));
    if (schoolIdentity?.id !== owner) return;
    const seen = new Set(profile.alerts || []);
    const fresh = response.items.filter(item => !seen.has(item.id + ':' + item.revision));
    for (const item of fresh) seen.add(item.id + ':' + item.revision);
    profile.alerts = [...seen].slice(-1000);
    profile.lastAlert = response.serverTime - 120000;
    campus.save();
    if (fresh.length) await notify({ kind: 'campus', title: fresh.slice(0, 3).map(item => item.title).join('\n') });
  } catch { /* The next foreground check retries; cached notices remain available. */ }
  finally { checkingCampus = false; }
}

const ready = (async () => {
  for (const key of ['reminder-state', 'homework-state', 'campus-state', 'notification-state']) {
    const { value } = await Preferences.get({ key });
    stores.set(key, new MobileStore(key, value ? JSON.parse(value) : {}));
  }
  monitor = new Monitor({ api, store: stores.get('reminder-state'), notify });
  homework = new HomeworkMonitor({ api, store: stores.get('homework-state'), notify, config: () => monitor.config });
  campus = new CampusClient({
    store: stores.get('campus-state'), url: hosted.url,
    fetchPublic: async route => {
      const response = await CapacitorHttp.get({ url: hosted.url + '/api/campus/' + route, connectTimeout: 15000, readTimeout: 20000 });
      if (response.status !== 200 || !response.data?.ok) throw new Error('校园公告暂时无法同步，请稍后重试');
      return response.data.data;
    }
  });
  monitor.on('change', publish);
  campus.on('tasks-changed', publish);
  homework.on('change', () => { publish(); void updateDeadlineNotifications().catch(() => {}); });
  monitor.on('login-required', () => { emitSession(null); homework.invalidateLogin(); });
  await NativeSchool.addListener('schoolPageReady', () => { void refresh(); });
  await NativeSchool.addListener('schoolSessionChanged', () => { if(!loggingOut)void recoverSchool(true).then(()=>refresh()); });
  await App.addListener('appStateChange', async state => {
    active = state.isActive;
    if (active) { await Promise.all([monitor.resume(), homework.resume()]); void refresh(); void checkCampus(); }
    else { monitor.suspend(); homework.suspend(); }
  });
  await App.addListener('backButton', async () => {
    const dialog = document.querySelector('dialog[open]');
    if (dialog) dialog.close();
    else if (!document.getElementById('today-panel').hidden) await App.minimizeApp();
    else document.getElementById('tab-today').click();
  });
  await LocalNotifications.addListener('localNotificationActionPerformed', async event => {
    if (event.notification.extra?.kind === 'campus') for (const listener of openCampusListeners) listener();
    else if (['signin', 'exercise'].includes(event.notification.extra?.kind)) {
      document.getElementById('tab-signin').click();
      const key = event.notification.extra.recordKey;
      if (key) { try { await api.open(schoolSigninUrl(monitor, key)); } catch { /* The activity may belong to an earlier account. */ } }
    } else document.getElementById('tab-homework').click();
  });
  setInterval(checkCampus, 60000);
  void refresh();
})();

async function invoke(action, payload) {
  try {
    if (action === 'open-campus-card') { await NativeSchool.openCampusCard(); return { ok: true }; }
    await ready;
    if (action === 'credentials-status') return { ok: true, ...await NativeSchool.credentialsStatus() };
    if (loggingOut && ['credentials-save', 'credentials-clear', 'login-fill'].includes(action)) throw new Error('正在退出学校，请稍后重试');
    if (action === 'credentials-save') { await NativeSchool.saveCredentials(payload); return { ok: true, saved: true }; }
    if (action === 'credentials-clear') { await NativeSchool.clearCredentials(); return { ok: true, saved: false }; }
    if (action === 'login-fill') {
      await NativeSchool.open({ url: ORIGIN + '/', fillSaved: true });
      return { ok: true, saved: true };
    }
    if (action === 'campus-session') return { ok: true, data: campus.snapshot() };
    if (action === 'term-timetable') return { ok: true, data: await monitor.termTimetable(payload === true) };
    if (action === 'week-timetable') return { ok: true, data: await monitor.weekTimetable(payload?.week, payload?.refresh === true) };
    if (action === 'campus') {
      const data = await campus.request(payload.path, payload.body);
      await stores.get('campus-state').flush();
      return { ok: true, data };
    }
    if (action === 'login') await api.open();
    else if (action === 'logout-school') {
      loggingOut=true;sessionEpoch++;lastRecovery=0;recovery=null;
      try {
      monitor.invalidateLogin(); homework.invalidateLogin(); emitSession(null);
      await NativeSchool.logout();
      await updateDeadlineNotifications();
      } finally { loggingOut=false; }
    } else if (action === 'start') {
      await LocalNotifications.requestPermissions();
      notificationRevision = '';
      await Promise.all([monitor.start(), homework.start()]);
      await updateDeadlineNotifications();
    } else if (action === 'pause') { monitor.stop(); homework.stop(); await updateDeadlineNotifications(); }
    else if (action === 'refresh') await refresh();
    else if (action === 'refresh-timetable') await monitor.check({ refresh: true });
    else if (action === 'homework-refresh') await homework.check();
    else if (action === 'save') { monitor.configure(payload); homework.stop(); }
    else if (action === 'import') { monitor.configure({ ...monitor.config, ...parseCourseUrl(payload), mode: 'manual' }); await monitor.check({ refresh: true }); }
    else if (action === 'open-homework') {
      const item = homework.state.items.find(row => row.id === payload);
      await api.open(item?.url || ORIGIN + '/homework/');
    } else if (action === 'open-lesson') {
      await api.open(timetableLessonUrl(monitor, payload));
    } else if (action === 'open-signin-activity') {
      await api.open(signinActivityUrl(monitor, payload));
    } else if (action === 'open-school') {
      await api.open(schoolSigninUrl(monitor, payload));
    } else if (action === 'open-campus-source') await NativeSchool.openExternal({ url: payload });
    else if (action === 'test-notification') { await LocalNotifications.requestPermissions(); await notify({ title: '收到这条通知，说明提醒权限已开启' }); }
    else if (action === 'notifications-settings') await NativeSchool.settings();
    else if (action === 'quit') await App.minimizeApp();
    else if (action !== 'snapshot') throw new Error('不支持的操作');
    await Promise.all([...stores.values()].map(store => store.flush()));
    return { ok: true, data: snapshot() };
  } catch (error) {
    return { ok: false, message: error.message || '操作暂时无法完成' };
  }
}

function displayPreference(key, choices) {
  let write = Promise.resolve();
  return async value => {
    if (value === undefined) {
      await write.catch(() => {});
      return (await Preferences.get({ key })).value;
    }
    if (!choices.includes(value)) return;
    write = write.catch(() => {}).then(() => Preferences.set({ key, value }));
    await write;
  };
}

window.reminder = Object.freeze({
  invoke,
  themePreference: displayPreference('course-desk-theme', ['day', 'night', 'beige', 'mist', 'green']),
  backgroundPreference: displayPreference('course-desk-background', ['gate', 'cherry', 'aerial', 'ginkgo', 'garden', 'snow']),
  onState: listener => stateListeners.add(listener),
  onCampusSession: listener => campusListeners.add(listener),
  onOpenCampus: listener => openCampusListeners.add(listener),
  onSound: () => {}
});
