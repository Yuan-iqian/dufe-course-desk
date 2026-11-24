'use strict';

// Executed only on demand inside the school window. No page values leave the window.
function schoolLoginForm(credentials) {
  if (window !== window.top || location.origin !== 'https://sso.dufe.edu.cn' ||
      location.pathname !== '/auth/oauth/authorize') return false;
  const form = document.querySelector('form#normal_login_form');
  if (!form || new URL(form.action).origin !== location.origin ||
      new URL(form.action).pathname !== location.pathname || form.method !== 'post') return false;
  const username = form.querySelector('input#username[name="username"][type="text"]');
  const password = form.querySelector('input#password_[type="password"]');
  const editable = input => input && !input.disabled && !input.readOnly && input.getClientRects().length > 0;
  if (!credentials) return Boolean(username && password);
  if (!editable(username) || !editable(password)) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(username, credentials.account);
  set.call(password, credentials.password);
  for (const input of [username, password]) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

function loginFormScript(credentials = null) {
  return `(${schoolLoginForm.toString()})(${JSON.stringify(credentials)})`;
}

module.exports = { schoolLoginForm, loginFormScript };
