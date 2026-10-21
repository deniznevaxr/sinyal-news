// Phone behaviour: platform detection, the header that tucks away while reading,
// swipe-down-to-close sheets and pull-to-refresh in the installed app.

// Phone layout: narrow screens, or a phone held sideways.
export const phone = matchMedia('(max-width: 720px), (max-height: 500px) and (pointer: coarse)');

const ua = navigator.userAgent;
export const platform = {
  ios: /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  android: /Android/.test(ua),
  // In-app browsers (Instagram, Facebook…) cannot add to the home screen.
  inApp: /FBAN|FBAV|Instagram|Line\/|LinkedInApp|Snapchat|musical_ly|BytedanceWebview|Twitter/i.test(ua),
};
platform.iosSafari = platform.ios && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) && !platform.inApp;
platform.standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// The header slides away while scrolling down and returns on the slightest scroll up.
export function autoHideHeader(header) {
  let last = scrollY;
  let tucked = false;
  let queued = false;
  const set = on => { if (on !== tucked) { tucked = on; header.classList.toggle('tucked', on); } };
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const y = scrollY;
      if (!phone.matches || y < 90) set(false);
      else if (y - last > 6) set(true);
      else if (last - y > 6) set(false);
      last = y;
    });
  }, { passive: true });
}

// Drag a sheet down to close it. Starts on the sheet's header, or anywhere once its
// content is scrolled to the top; a short flick or a long drag closes, anything else snaps back.
export function dragToClose(container, { sheet, handle, body, onClose }) {
  let start = null;
  let dy = 0;
  let dragging = false;
  let el = null;
  container.addEventListener('touchstart', e => {
    if (!phone.matches || e.touches.length !== 1) return;
    el = sheet();
    if (!el || !el.contains(e.target)) return;
    const scroller = body ? el.querySelector(body) : el;
    const onHandle = handle && e.target.closest(handle);
    if (!onHandle && scroller && scroller.scrollTop > 0) return;
    if (e.target.closest('input, textarea, select, .seg, .src-list')) return;
    start = { y: e.touches[0].clientY, t: performance.now() };
    dy = 0;
    dragging = false;
  }, { passive: true });
  container.addEventListener('touchmove', e => {
    if (!start) return;
    dy = e.touches[0].clientY - start.y;
    if (!dragging) {
      if (dy < -4) { start = null; return; } // scrolling the content up: not ours
      if (dy < 8) return;
      dragging = true;
      el.style.transition = 'none';
    }
    e.preventDefault();
    el.style.transform = `translateY(${Math.max(0, dy - 8)}px)`;
  }, { passive: false });
  const end = () => {
    if (!start) return;
    const fast = dy / (performance.now() - start.t) > 0.55;
    start = null;
    if (!dragging) return;
    dragging = false;
    const sheetEl = el;
    sheetEl.style.transition = '';
    if (dy > 110 || (fast && dy > 30)) {
      // Finish the slide out, then close for real without a second animation.
      sheetEl.style.transform = `translateY(${sheetEl.offsetHeight + 40}px)`;
      setTimeout(() => {
        sheetEl.style.transition = 'none';
        sheetEl.style.transform = '';
        onClose();
        requestAnimationFrame(() => { sheetEl.style.transition = ''; });
      }, 220);
    } else {
      sheetEl.style.transform = '';
    }
  };
  container.addEventListener('touchend', end);
  container.addEventListener('touchcancel', end);
}

// Pull down at the top of the page to refresh — only in the installed app, where the
// browser has no pull-to-refresh of its own.
export function pullToRefresh(run, { blocked, labels }) {
  const ind = document.createElement('div');
  ind.className = 'ptr';
  ind.setAttribute('aria-hidden', 'true');
  ind.innerHTML = '<span class="ptr-bars"><i></i><i></i><i></i><i></i><i></i></span><span class="ptr-text"></span>';
  document.body.append(ind);
  const text = ind.querySelector('.ptr-text');
  let start = null;
  let pull = 0;
  let busy = false;
  const reset = () => { ind.classList.remove('show', 'ready'); ind.style.removeProperty('--pull'); };
  addEventListener('touchstart', e => {
    if (busy || !platform.standalone() || !phone.matches || scrollY > 0 || e.touches.length !== 1 || blocked()) return;
    start = e.touches[0].clientY;
    pull = 0;
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (start == null) return;
    pull = Math.min(120, Math.max(0, (e.touches[0].clientY - start) * 0.5));
    if (pull < 6 || scrollY > 0) { reset(); return; }
    ind.classList.add('show');
    ind.classList.toggle('ready', pull > 64);
    ind.style.setProperty('--pull', `${pull}px`);
    text.textContent = pull > 64 ? labels.release() : labels.pull();
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (start == null) return;
    start = null;
    if (pull <= 64) { reset(); return; }
    busy = true;
    ind.classList.add('busy');
    text.textContent = labels.loading();
    try { await run(); } finally {
      busy = false;
      ind.classList.remove('busy');
      reset();
    }
  });
}

// The iOS share icon, for the "add to home screen" steps.
export const shareGlyph = () => '<svg class="i sm share-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8v8.2M5.2 4.4 8 1.6l2.8 2.8"/><path d="M5.6 6.6H4.2v7.6h7.6V6.6h-1.4"/></svg>';
