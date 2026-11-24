'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { Monitor, MonitorError, signinActivityUrl } = require('../src/core.cjs');
const { requestScript } = require('../src/shared/school-protocol.cjs');
const { loginFormScript } = require('../src/shared/school-login-form.cjs');

test('监控按课次建立练习基准，签到与练习编号相同时分别提醒且重启去重', async () => {
  const now = Date.parse('2026-11-24T13:00:00+08:00');
  const entry = (lesson, start, end) => ({ courseId: lesson + 10, weekTimeId: lesson, courseNo: 'A1', courseSeq: '01', beginTime: start, endTime: end });
  const scope = 'account-term';
  const rows = new Map([[1, [{ id: 50, exerciseStatus: 1, studentExerciseStatus: 0 }]], [2, []]]);
  const notices = [];
  let saved = {};
  let clock = now;
  const result = data => ({ scope, data });
  const api = {
    schedule: async () => result([{ dayList: [{ date: '20261124', courseList: [entry(1, '13:00', '13:45'), entry(2, '13:50', '14:30')] }] }]),
    list: async () => result([{ id: 51, type: 2, signStatus: 1 }]),
    detail: async () => result({ signStatus: 0, signInModel: { status: 1 } }),
    exercises: async lesson => {
      assert.equal(lesson.courseId, String(Number(lesson.id) + 10));
      return result(rows.get(Number(lesson.id)));
    }
  };
  const create = () => new Monitor({ api, now: () => clock, notify: async record => notices.push(record),
    store: { read: () => structuredClone(saved), write: data => { saved = structuredClone(data); } },
    timers: { setTimeout: () => null, clearTimeout() {} } });
  let monitor = create();
  await monitor.start();
  assert.equal(notices.length, 1);
  assert.equal(monitor.state.activities.find(item => item.kind === 'exercise').id, '50');
  rows.get(1).push({ id: 51, description: '课堂练习一', exerciseStatus: 1, studentExerciseStatus: 0 });
  await monitor.check();
  assert.deepEqual(notices.map(item => item.kind || 'signin'), ['signin', 'exercise']);
  assert.match(signinActivityUrl(monitor, { lessonId: '1', kind: 'exercise', id: '51' }), /\/1\/exercise$/);
  monitor = create();
  await monitor.start();
  assert.equal(notices.length, 2);
  clock += 47 * 60000;
  await monitor.check();
  rows.get(2).push({ id: 51, description: '下一节课的练习', exerciseStatus: 1, studentExerciseStatus: 0 });
  await monitor.check();
  assert.deepEqual(notices.filter(item => item.kind === 'exercise').map(item => item.lessonId), ['1', '2']);
  api.exercises = async () => { throw new MonitorError('network', '练习连接超时'); };
  await monitor.check();
  assert.equal(monitor.state.exerciseError, '练习连接超时');
  assert.equal(monitor.state.connected, true);
});

test('临时网页、访问限制和会话刷新不会误报掉线，学校确认过期才需要重登', async () => {
  let response = new Response('<html>暂不可用</html>');
  const values = { token: 'fixture', STUDENTNO: 'test', batch: 'A' };
  const context = { localStorage: { getItem: key => values[key] }, crypto: webcrypto, TextEncoder,
    URLSearchParams, AbortController, setTimeout, clearTimeout, fetch: async () => response };
  const script = requestScript('/student/exercise/getExerciseList', 'POST', {});
  const evaluate = () => vm.runInNewContext(script, context);
  assert.equal((await evaluate()).error, 'network');
  response = new Response('', { status: 403 });
  assert.equal((await evaluate()).error, 'protocol');
  response = new Response('', { status: 401 });
  assert.equal((await evaluate()).error, 'auth');
  delete values.token;
  assert.equal((await evaluate()).error, 'session-pending');
});

test('只填入学校官方顶层表单，保留密码原样且不会提交', () => {
  class Input {
    set value(value) { this.entered = value; }
    getClientRects() { return [1]; }
    dispatchEvent(event) { (this.events ??= []).push(event.type); }
  }
  const account = new Input(), password = new Input();
  const url = new URL('https://sso.dufe.edu.cn/auth/oauth/authorize');
  const form = { action: url.href, method: 'post', querySelector: selector => selector.includes('username') ? account : password };
  const window = {};
  window.top = window;
  const context = { window, location: url, document: { querySelector: () => form }, URL, HTMLInputElement: Input, Event };
  const credentials = { account: 'student-test', password: ' secret " &  ' };
  const code = loginFormScript(credentials);
  assert.equal(vm.runInNewContext(code, { ...context, location: new URL('https://example.test/auth/oauth/authorize') }), false);
  form.action = 'https://example.test/';
  assert.equal(vm.runInNewContext(code, context), false);
  form.action = url.href;
  assert.equal(vm.runInNewContext(code, context), true);
  assert.equal(account.entered, credentials.account);
  assert.equal(password.entered, credentials.password);
  assert.deepEqual(password.events, ['input', 'change']);
});
