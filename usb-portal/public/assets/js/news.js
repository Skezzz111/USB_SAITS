// Лента новостей: полная на странице «Новости», последние записи — на главной (data-limit, data-compact).
(function () {
  const { api, el, avatar, formatDate, me } = window.Portal;
  const list = document.querySelector('[data-news-list]');
  const status = document.querySelector('[data-news-status]');
  if (!list || !status) return;

  const limit = Number(list.dataset.limit) || 0;
  const compact = list.hasAttribute('data-compact');

  function card(item) {
    const author = item.author;
    return el('article', { class: `news-card${compact ? ' news-card--compact' : ''}` },
      el('time', { class: 'news-card__date', datetime: item.createdAt, text: formatDate(item.createdAt) }),
      el(compact ? 'h3' : 'h2', { class: 'news-card__title', text: item.title }),
      el('p', { class: 'news-card__body', text: item.body }),
      el('div', { class: 'news-card__author' },
        avatar(author, 'avatar--md'),
        el('div', {},
          el('strong', { text: author ? author.fullName : 'Профиль удалён' }),
          author ? el('small', { text: author.rank }) : null)));
  }

  me.then(async (user) => {
    if (!user) return;
    try {
      const { news } = await api('/news');
      const items = limit ? news.slice(0, limit) : news;
      list.replaceChildren(...items.map(card));
      status.textContent = 'Новостей пока нет.';
      status.hidden = items.length > 0;
    } catch (err) {
      status.textContent = err.message;
      status.hidden = false;
    }
  });
})();
