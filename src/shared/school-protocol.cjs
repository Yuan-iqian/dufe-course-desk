'use strict';

const ALLOWED_REQUESTS = Object.freeze({
  '/student/currentDate': 'GET',
  '/student/queryCourseList': 'GET',
  '/student/signIn/getStuSignInList': 'POST',
  '/student/signIn/getSignInInfo': 'POST',
  '/student/signIn/getOnlineSignInInfo': 'POST',
  '/student/HomeworkList': 'GET',
  '/student/getWeekTimePaper': 'POST',
  '/student/exercise/getExerciseList': 'POST'
});

// This function runs inside the official school page on every platform.
async function readSchool(request) {
  const token = localStorage.getItem('token');
  const account = localStorage.getItem('STUDENTNO') || localStorage.getItem('user');
  if (!token || !account) return { error: 'session-pending' };
  const batch = localStorage.getItem('batch') || '';
  async function digest(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const body = new URLSearchParams(request.params);
    const response = await fetch(request.path + (request.method === 'GET' ? '?' + body : ''), {
      method: request.method,
      headers: { token, batchNo: batch, fingerprint: localStorage.getItem('fingerprint') || '', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: request.method === 'POST' ? body : undefined,
      credentials: 'same-origin', signal: controller.signal, cache: 'no-store'
    });
    if (response.status === 401) return { error: 'auth' };
    if (response.status === 429) return { error: 'rate-limit' };
    if (response.redirected && response.url) {
      const target = new URL(response.url);
      if (target.origin === 'https://sso.dufe.edu.cn' && target.pathname === '/auth/oauth/authorize') return { error: 'auth' };
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
      return { error: response.status === 403 ? 'protocol' : 'network' };
    }
    const value = await response.json();
    if (String(value.code) !== '2000') {
      return { error: /(?:请|重新|未|没有)[^。！]{0,12}(?:登录|登陆)|(?:登录|登陆|认证|会话|token)[^。！]{0,12}(?:失效|过期)/i.test(String(value.message || '')) ? 'auth' : 'protocol' };
    }
    if (!Object.hasOwn(value, 'data')) return { error: 'protocol' };
    if (token !== localStorage.getItem('token') || account !== (localStorage.getItem('STUDENTNO') || localStorage.getItem('user')) || batch !== (localStorage.getItem('batch') || '')) return { error: 'network' };
    // Local profile identity remains stable when the term changes. Credentials stay in the school browser.
    return {
      scope: await digest(account + '\u0000' + batch),
      identity: { id: await digest('dufe-local-profile\u0000' + account), nickname: '学校账号 · ' + account.slice(-4) },
      data: value.data
    };
  } catch {
    return { error: 'network' };
  } finally {
    clearTimeout(timeout);
  }
}

function requestScript(path, method, params) {
  if (ALLOWED_REQUESTS[path] !== method) throw new Error('不支持的学校读取操作');
  return `(${readSchool.toString()})(${JSON.stringify({ path, method, params })})`;
}

module.exports = { ALLOWED_REQUESTS, readSchool, requestScript };
