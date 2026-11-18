'use strict';

const ALLOWED_REQUESTS = Object.freeze({
  '/student/currentDate': 'GET',
  '/student/queryCourseList': 'GET',
  '/student/signIn/getStuSignInList': 'POST',
  '/student/signIn/getSignInInfo': 'POST',
  '/student/signIn/getOnlineSignInInfo': 'POST',
  '/student/HomeworkList': 'GET',
  '/student/getWeekTimePaper': 'POST'
});

// This function runs inside the official school page on every platform.
async function readSchool(request) {
  const token = localStorage.getItem('token');
  const account = localStorage.getItem('STUDENTNO') || localStorage.getItem('user');
  if (!token || !account) return { error: 'auth' };
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
    if ([401, 403].includes(response.status)) return { error: 'auth' };
    if (response.status === 429) return { error: 'rate-limit' };
    if (!response.ok) return { error: 'network' };
    if (response.redirected || !response.headers.get('content-type')?.includes('json')) return { error: 'auth' };
    const value = await response.json();
    if (String(value.code) !== '2000') {
      return { error: /登录|登陆|认证|失效|过期/.test(String(value.message || '')) ? 'auth' : 'protocol' };
    }
    if (!Object.hasOwn(value, 'data')) return { error: 'protocol' };
    if (token !== localStorage.getItem('token') || account !== (localStorage.getItem('STUDENTNO') || localStorage.getItem('user')) || batch !== (localStorage.getItem('batch') || '')) return { error: 'auth' };
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
