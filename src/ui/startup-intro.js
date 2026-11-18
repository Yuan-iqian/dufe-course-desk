'use strict';

(() => {
  const intro = document.getElementById('startup-intro');
  const skip = document.getElementById('startup-skip');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'course-desk-intro-played';
  try {
    if (sessionStorage.getItem(key)) return;
  } catch { /* The document still plays the intro only once. */ }

  const animations = [];
  let started = false;
  let deadline;

  function play(element, keyframes, timing) {
    const animation = element.animate(keyframes, { fill: 'both', ...timing });
    animations.push(animation);
    return animation;
  }

  function dismiss() {
    if (intro.open) intro.close();
  }

  function showScene(id, start, delay, latest) {
    const frame = document.getElementById(id);
    frame.decode().then(() => {
      const elapsed = performance.now() - start;
      if (!intro.open || elapsed > latest) return;
      play(frame, [
        { opacity: 0, clipPath: 'polygon(97% 0,100% 0,100% 100%,85% 100%)', transform: 'scale(1.055)' },
        { opacity: 1, clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)', transform: 'scale(1.025)' }
      ], { delay: Math.max(0, delay - elapsed), duration: 285, easing: 'cubic-bezier(.22,.72,.24,1)' });
    }).catch(() => {});
  }

  function show() {
    if (started || document.hidden) return;
    started = true;
    try { sessionStorage.setItem(key, '1'); } catch { /* Keep the current document guard. */ }
    intro.showModal();
    const reduced = reducedMotion.matches;
    const duration = reduced ? 240 : 1500;
    const start = performance.now();
    deadline = setTimeout(dismiss, duration + 50);

    if (!reduced) {
      play(document.getElementById('startup-campus-gate'), [
        { transform: 'scale(1)' }, { transform: 'scale(1.055)' }
      ], { duration: 850, easing: 'ease-out' });
      play(intro.querySelector('.startup-wordmark'), [
        { opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }
      ], { delay: 60, duration: 340, easing: 'ease-out' });
      showScene('startup-campus-cherry', start, 405, 660);
      showScene('startup-campus-aerial', start, 795, 1030);
    }

    play(intro, [{ opacity: 1, offset: 0 }, { opacity: 1, offset: reduced ? .25 : .81 }, { opacity: 0 }], { duration })
      .finished.then(dismiss, () => {});
  }

  function handleVisibility() {
    if (document.hidden && started) dismiss();
    else show();
  }

  skip.addEventListener('click', dismiss);
  intro.addEventListener('close', () => {
    clearTimeout(deadline);
    document.removeEventListener('visibilitychange', handleVisibility);
    for (const animation of animations) animation.cancel();
    if (!document.hidden && !document.querySelector('dialog[open]')) {
      document.querySelector('.view-tab[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
  }, { once: true });
  document.addEventListener('visibilitychange', handleVisibility);
  show();
})();
