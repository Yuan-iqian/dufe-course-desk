const update = state => {
  document.getElementById('card-placeholder').hidden = state === 'ready';
  document.getElementById('card-status').textContent = state === 'error' ? '学校页面暂时无法打开，请检查网络后重试' : state === 'paused' ? '恢复后重新连接学校' : '正在连接学校…';
  document.getElementById('card-retry').hidden = state !== 'error';
};
window.campusCard.onState(update);
window.campusCard.action('snapshot').then(update);
document.getElementById('card-reload').onclick = () => window.campusCard.action('refresh');
document.getElementById('card-retry').onclick = () => window.campusCard.action('refresh');
document.getElementById('card-close').onclick = () => window.campusCard.action('close');
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.campusCard.action('close'); });
