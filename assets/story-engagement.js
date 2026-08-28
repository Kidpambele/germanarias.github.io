(() => {
  const slug = location.pathname.split('/').pop().replace(/\.html$/, '');
  if (!slug || slug === 'index' || slug === 'index-es' || slug === 'admin') return;
  const spanish = document.documentElement.lang === 'es';
  const author = document.querySelector('.author');
  if (!author) return;

  const section = document.createElement('section');
  section.className = 'engagement';
  section.innerHTML = `
    <h2>${spanish ? 'Comentarios' : 'Comments'}</h2>
    <p class="engagement-note">${spanish ? 'Los comentarios se publican después de ser aprobados.' : 'Comments appear after they have been approved.'}</p>
    <div class="comment-list" aria-live="polite"></div>
    <form class="comment-form">
      <label>${spanish ? 'Nombre' : 'Name'}<input name="name" maxlength="60" required autocomplete="name"></label>
      <label>${spanish ? 'Comentario' : 'Comment'}<textarea name="message" maxlength="1000" required></textarea></label>
      <label class="comment-website" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <button type="submit">${spanish ? 'Enviar comentario' : 'Submit comment'}</button>
      <div class="comment-status" role="status"></div>
    </form>`;
  author.before(section);

  const list = section.querySelector('.comment-list');
  const form = section.querySelector('.comment-form');
  const status = section.querySelector('.comment-status');

  const render = (comments) => {
    list.replaceChildren();
    if (!comments.length) {
      const empty = document.createElement('p');
      empty.className = 'comment-empty';
      empty.textContent = spanish ? 'Aún no hay comentarios.' : 'There are no comments yet.';
      list.append(empty);
      return;
    }
    for (const item of comments) {
      const article = document.createElement('article');
      article.className = 'comment';
      const name = document.createElement('div');
      name.className = 'comment-name';
      name.textContent = item.name;
      const message = document.createElement('div');
      message.className = 'comment-message';
      message.textContent = item.message;
      article.append(name, message);
      list.append(article);
    }
  };

  fetch(`/api/comments?story=${encodeURIComponent(slug)}`)
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((data) => render(data.comments || []))
    .catch(() => render([]));

  const viewKey = `viewed:${slug}`;
  if (!sessionStorage.getItem(viewKey)) {
    fetch('/api/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ story: slug }) })
      .then((response) => { if (response.ok) sessionStorage.setItem(viewKey, '1'); })
      .catch(() => {});
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = '';
    const values = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch('/api/comments', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ story: slug, name: values.name, message: values.message, website: values.website })
      });
      if (!response.ok) throw new Error();
      form.reset();
      status.textContent = spanish ? 'Gracias. Su comentario está pendiente de aprobación.' : 'Thank you. Your comment is awaiting approval.';
    } catch {
      status.textContent = spanish ? 'No fue posible enviar el comentario. Inténtelo de nuevo.' : 'The comment could not be sent. Please try again.';
    } finally {
      button.disabled = false;
    }
  });
})();
