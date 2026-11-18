'use strict';

(() => {
  const scenes = {
    gate: { file: 'dufe-campus.jpg', label: '校门与之远楼 · 实景' },
    cherry: { file: 'dufe-cherry.webp', label: '樱花林 · 插画' },
    aerial: { file: 'dufe-aerial.webp', label: '校园俯瞰 · 插画' },
    ginkgo: { file: 'dufe-ginkgo.webp', label: '银杏路 · 插画' },
    garden: { file: 'dufe-garden.webp', label: '莘子园 · 插画' },
    snow: { file: 'dufe-snow.webp', label: '东财雪景 · 插画' }
  };
  const viewScenes = {
    today: ['.today-heading', 'gate'],
    timetable: ['.timetable-heading', 'cherry'],
    homework: ['.homework-heading', 'ginkgo'],
    signin: ['.page-heading', 'aerial'],
    campus: ['.cp-heading', 'garden']
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const sceneOrder = Object.keys(scenes);
  const stages = {};
  let activeView = 'today';
  let homeIndex = 0;

  for (const [view, [heading, scene]] of Object.entries(viewScenes)) {
    const hero = document.querySelector(`#${view}-panel ${heading}`);
    if (!hero) continue;
    hero.classList.add('campus-hero');
    let media = hero.querySelector('.campus-hero-media');
    let caption = hero.querySelector('.campus-hero-caption');
    if (!media) {
      media = document.createElement('div');
      media.className = 'campus-hero-media';
      media.setAttribute('aria-hidden', 'true');
      hero.prepend(media);
      caption = document.createElement('p');
      caption.className = 'campus-hero-caption';
      hero.append(caption);
    }
    stages[view] = { hero, media, caption, scene, request: 0, animation: null };
  }

  function finishAnimation(stage) {
    stage.animation?.cancel();
    stage.animation = null;
    while (stage.media.childElementCount > 1) stage.media.firstElementChild.remove();
  }

  async function showScene(view, key) {
    const stage = stages[view];
    if (!stage) return;
    const request = ++stage.request;
    const current = stage.media.lastElementChild;
    let next = current;
    if (current?.dataset.scene !== key) {
      next = new Image();
      next.alt = '';
      next.className = 'campus-hero-image';
      next.dataset.scene = key;
      next.src = `../assets/${scenes[key].file}`;
    }

    try {
      await next.decode();
    } catch {
      if (stage.request !== request || activeView !== view) return;
      if (!current && key !== 'gate') void showScene(view, 'gate');
      if (view === 'today') stage.caption.textContent = '照片暂时无法显示';
      return;
    }
    if (stage.request !== request || activeView !== view) return;
    finishAnimation(stage);
    if (next !== current) stage.media.append(next);
    stage.hero.dataset.scene = key;
    stage.caption.textContent = scenes[key].label;

    const fade = reduced.matches;
    const frames = fade ? [{ opacity: 0 }, { opacity: 1 }] : [
      { clipPath: 'polygon(91% 0, 100% 0, 100% 100%, 98% 100%)', transform: 'scale(1.065) translateX(2%)', opacity: .28 },
      { clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', transform: 'scale(1) translateX(0)', opacity: 1 }
    ];
    const animation = next.animate(frames, { duration: fade ? 120 : 470, easing: 'cubic-bezier(.22, .75, .26, 1)' });
    stage.animation = animation;
    animation.addEventListener('finish', () => {
      if (stage.animation === animation) finishAnimation(stage);
    }, { once: true });
  }

  const nextButton = document.getElementById('campus-scene-next');
  if (nextButton && sceneOrder.length > 1) {
    nextButton.hidden = false;
    nextButton.addEventListener('click', () => {
      homeIndex = (homeIndex + 1) % sceneOrder.length;
      void showScene('today', sceneOrder[homeIndex]);
    });
  }

  window.addEventListener('course-view-change', event => {
    const view = event.detail;
    if (!Object.hasOwn(stages, view) || view === activeView) return;
    if (stages[activeView]) finishAnimation(stages[activeView]);
    activeView = view;
    void showScene(view, view === 'today' ? sceneOrder[homeIndex] : stages[view].scene);
  });
  reduced.addEventListener('change', () => {
    if (stages[activeView]) finishAnimation(stages[activeView]);
  });
  void showScene(activeView, sceneOrder[homeIndex]);
})();
