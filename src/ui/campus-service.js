(() => {
  'use strict';
  let session = { data: null, url: '' };
  function update(next) {
    session = next;
    window.dispatchEvent(new CustomEvent('course-session', {
      detail: { userId: next.data?.user?.id || '', url: next.url || '' }
    }));
  }
  async function invoke(action, payload) {
    const result = await window.reminder.invoke(action, payload);
    if (!result.ok) throw new Error(result.message);
    return result.data;
  }
  window.courseService = Object.freeze({
    snapshot: () => ({ user: session.data?.user || null, url: session.url, online: session.online }),
    request: (path, body) => invoke('campus', { path, body }),
    login: () => invoke('login'),
    logout: () => invoke('logout-school')
  });
  window.reminder.onCampusSession(update);
  invoke('campus-session').then(update).catch(() => {});
})();
