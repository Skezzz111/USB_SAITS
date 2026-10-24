// Главная: одноразовая вступительная анимация героя и чата.
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!document.querySelector('.hero')) return;

  const ease = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
  const run = (selector, keyframes, delay, duration = 700, stagger = 120) => {
    document.querySelectorAll(selector).forEach((el, i) => {
      el.animate(keyframes, { duration, delay: delay + i * stagger, easing: ease, fill: 'backwards' });
    });
  };

  run('.site-header', [{ transform: 'translateY(-100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], 0, 600);
  run('.hero-badge', [
    { transform: 'scale(0.6)', opacity: 0 },
    { transform: 'scale(1.06)', opacity: 1, offset: 0.7 },
    { transform: 'none', opacity: 1 },
  ], 200, 600);
  run('.hero-title__line', [
    { transform: 'translateY(40%)', filter: 'blur(14px)', opacity: 0 },
    { transform: 'none', filter: 'blur(0)', opacity: 1 },
  ], 320, 850, 140);
  run('.hero-sub', [{ transform: 'translateY(16px)', filter: 'blur(8px)', opacity: 0 }, { transform: 'none', filter: 'blur(0)', opacity: 1 }], 640);
  run('.hero-actions', [{ transform: 'scale(0.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], 820, 600);
  run('.chat', [{ transform: 'translateY(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], 900, 900);

  document.querySelectorAll('.hero-arrow path, .hero-slash path').forEach((path, i) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
      duration: 700, delay: 1250 + i * 120, easing: 'ease-in-out', fill: 'backwards',
    });
  });

  run('.hero-note', [{ opacity: 0 }, { opacity: 1 }], 1400, 700, 200);
})();
