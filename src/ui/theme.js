'use strict';

(() => {
  const themeKey = 'course-desk-theme';
  const backgroundKey = 'course-desk-background';
  const themes = new Set(['day', 'night', 'beige', 'mist', 'green']);
  const backgrounds = new Set(['gate', 'cherry', 'aerial', 'ginkgo', 'garden', 'snow']);
  const root = document.documentElement;
  const apply = theme => {
    root.dataset.theme = themes.has(theme) ? theme : 'day';
    root.dataset.bsTheme = root.dataset.theme === 'night' ? 'dark' : 'light';
  };
  const readPreference = key => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const remember = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* Keep the selection for this session. */ }
  };

  apply(readPreference(themeKey));
  root.dataset.background = 'gate';

  document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('theme-dialog');
    const choices = document.getElementById('theme-choices');
    const backgroundChoices = document.getElementById('background-choices');
    const backgroundOptions = backgroundChoices.querySelectorAll('input[name="background"]');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let changed = false;
    let backgroundChanged = false;
    let backgroundRequest = 0;
    let photo = document.getElementById('app-background-photo');
    const select = theme => {
      apply(theme);
      for (const option of choices.querySelectorAll('input[name="theme"]')) {
        option.checked = option.value === root.dataset.theme;
      }
    };
    select(root.dataset.theme);

    const checkBackground = background => {
      for (const option of backgroundOptions) option.checked = option.value === background;
    };

    async function selectBackground(background, animate = false) {
      const request = ++backgroundRequest;
      checkBackground(background);
      if (background === root.dataset.background) return true;
      const next = photo.cloneNode(false);
      next.src = background === 'gate' ? '../assets/dufe-campus.jpg' : `../assets/dufe-${background}.webp`;
      try {
        await next.decode();
      } catch {
        if (request === backgroundRequest) checkBackground(root.dataset.background);
        return false;
      }
      if (request !== backgroundRequest) return false;
      photo.replaceWith(next);
      photo = next;
      root.dataset.background = background;
      if (animate && !reducedMotion.matches) {
        photo.animate([{ opacity: .7 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      }
      return true;
    }

    const savedBackground = readPreference(backgroundKey);
    void selectBackground(backgrounds.has(savedBackground) ? savedBackground : 'gate');

    // The phone keeps preferences even when the school browser clears website data.
    if (window.reminder?.themePreference) {
      window.reminder.themePreference().then(theme => {
        if (changed || !themes.has(theme)) return;
        select(theme);
        remember(themeKey, theme);
      }).catch(() => {});
    }
    window.reminder?.backgroundPreference?.().then(async background => {
      if (backgroundChanged || !backgrounds.has(background)) return;
      if (await selectBackground(background)) remember(backgroundKey, background);
    }).catch(() => {});
    document.getElementById('theme-open').addEventListener('click', () => dialog.showModal());
    document.getElementById('theme-close').addEventListener('click', () => dialog.close());
    choices.addEventListener('change', event => {
      const theme = event.target.value;
      if (!themes.has(theme)) return;
      changed = true;
      select(theme);
      remember(themeKey, theme);
      window.reminder?.themePreference?.(theme).catch(() => {});
    });
    backgroundChoices.addEventListener('change', async event => {
      const background = event.target.value;
      if (!backgrounds.has(background)) return;
      backgroundChanged = true;
      if (!await selectBackground(background, true)) return;
      remember(backgroundKey, background);
      window.reminder?.backgroundPreference?.(background).catch(() => {});
    });
  });
})();
