'use strict';
// Enter through the school's stable application URL. Never ship a user's OAuth callback.
const CAMPUS_CARD_URL = 'https://sso.dufe.edu.cn/app.php/open_apps/person_card/index/index';
function isCampusCardNavigation(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
      (u.hostname === 'dufe.edu.cn' || u.hostname.endsWith('.dufe.edu.cn'));
  } catch { return false; }
}
module.exports = { CAMPUS_CARD_URL, isCampusCardNavigation };
