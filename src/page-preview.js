const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: block; font-family: system-ui, sans-serif; color: #18332e; }
    article { padding: 22px; border: 1px solid #cdded7; border-radius: 16px; background: #fff; }
    .label { color: #5b7169; font-size: 12px; margin: 0 0 7px; }
    a { display: block; color: #185b46; font-size: 19px; font-weight: 650; overflow-wrap: anywhere; }
    dl { display: grid; gap: 6px; margin: 22px 0 0; }
    dt { color: #5b7169; font-size: 12px; }
    dd { margin: 0 0 9px; overflow-wrap: anywhere; }
    [part="message"] { margin: 10px 0 0; font-size: 13px; color: #5b7169; }
    :host([data-status="error"]) [part="message"] { color: #9b2929; }
    [hidden] { display: none; }
  </style>
  <article>
    <p class="label">ПРЕДПРОСМОТР СТРАНИЦЫ</p>
    <a part="link">Страница не выбрана</a>
    <dl>
      <dt>Название документа</dt>
      <dd><span part="title">Название отсутствует</span></dd>
      <dt>Первый заголовок</dt>
      <dd><span part="heading">Заголовок отсутствует</span></dd>
    </dl>
    <p part="message" role="status" aria-live="polite"></p>
  </article>
`;

export class PagePreview extends HTMLElement {
  static get observedAttributes() {
    return ['src'];
  }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.append(template.content.cloneNode(true));
    this._link = shadow.querySelector('[part="link"]');
    this._title = shadow.querySelector('[part="title"]');
    this._heading = shadow.querySelector('[part="heading"]');
    this._message = shadow.querySelector('[part="message"]');
    this._controller = null;
    this._generation = 0;
  }

  connectedCallback() {
    this._load();
  }

  disconnectedCallback() {
    ++this._generation;
    this._controller?.abort();
    this._controller = null;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'src' && oldValue !== newValue && this.isConnected) {
      this._load();
    }
  }

  _isCurrent(generation, source) {
    return this.isConnected && generation === this._generation &&
      this.getAttribute('src') === source;
  }

  _reset() {
    this._link.removeAttribute('href');
    this._link.textContent = 'Страница не выбрана';
    this._title.textContent = 'Название отсутствует';
    this._heading.textContent = 'Заголовок отсутствует';
    this._message.textContent = '';
  }

  async _load() {
    const generation = ++this._generation;
    this._controller?.abort();
    this._controller = null;
    this._reset();
    this.dataset.status = 'loading';
    const source = this.getAttribute('src');

    try {
      if (!source?.trim()) throw new Error('Укажите адрес страницы в атрибуте src.');
      const url = new URL(source, this.ownerDocument.baseURI);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Используйте адрес страницы HTTP или HTTPS.');
      }
      this._link.href = url.href;
      this._link.textContent = url.href;
      this._message.textContent = 'Загрузка…';
      const controller = new AbortController();
      this._controller = controller;
      const response = await fetch(url.href, { signal: controller.signal });
      if (!this._isCurrent(generation, source)) return;
      if (!response.ok) throw new Error(`Не удалось загрузить страницу: HTTP ${response.status}.`);
      const html = await response.text();
      if (!this._isCurrent(generation, source)) return;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const title = doc.title.trim();
      const heading = doc.querySelector('h1')?.textContent.trim() ?? '';
      this._title.textContent = title || 'Название отсутствует';
      this._heading.textContent = heading || 'Заголовок отсутствует';
      this._link.textContent = title || url.href;
      this._message.textContent = '';
      this.dataset.status = 'ready';
    } catch (error) {
      if (!this._isCurrent(generation, source)) return;
      this._message.textContent = error instanceof Error ? error.message : 'Ошибка загрузки страницы.';
      this.dataset.status = 'error';
    } finally {
      if (generation === this._generation) this._controller = null;
    }
  }
}

if (!customElements.get('page-preview')) {
  customElements.define('page-preview', PagePreview);
}

export default PagePreview;
