import PagePreview from '../src/page-preview.js';

const fixtures = document.querySelector('#fixtures');
const results = document.querySelector('#results');
const realFetch = window.fetch;
let passed = 0;
let failed = 0;
const pause = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message = 'Проверка не выполнена') => { if (!value) throw new Error(message); };
const part = (element, name) => element.shadowRoot.querySelector(`[part="${name}"]`);
const response = (html, status = 200) => new Response(html, { status });
const create = (src) => {
  const element = document.createElement('page-preview');
  if (src !== undefined) element.setAttribute('src', src);
  fixtures.append(element);
  return element;
};
async function settled(element) {
  for (let i = 0; i < 200; i++) {
    if (['ready', 'error'].includes(element.dataset.status)) return;
    await pause(10);
  }
  throw new Error('Элемент не завершил загрузку');
}
async function test(name, run) {
  const item = document.createElement('li');
  try {
    await run();
    passed++;
    item.className = 'pass';
    item.textContent = `OK — ${name}`;
  } catch (error) {
    failed++;
    item.className = 'fail';
    item.textContent = `ОШИБКА — ${name}: ${error.message}`;
  } finally {
    fixtures.replaceChildren();
    window.fetch = realFetch;
  }
  results.append(item);
}

await test('Корневой модуль регистрирует правильный класс', async () => {
  assert(customElements.get('page-preview') === PagePreview);
  const element = document.createElement('page-preview');
  assert(element instanceof HTMLElement && element instanceof PagePreview);
  assert(element.shadowRoot?.mode === 'open');
});

await test('Реальный HTTP, относительный URL, название, первый h1 и видимая ссылка', async () => {
  const element = create('../demo/example.html');
  assert(element.dataset.status === 'loading');
  await settled(element);
  assert(element.dataset.status === 'ready');
  assert(part(element, 'title').textContent === 'Пробная страница');
  assert(part(element, 'heading').textContent === 'Первый заголовок');
  const link = part(element, 'link');
  assert(link.tagName === 'A');
  assert(link.href === new URL('../demo/example.html', document.baseURI).href);
  assert(link.textContent === 'Пробная страница' && link.getBoundingClientRect().width > 0);
});

await test('Отсутствующие title и h1; ссылка содержит URL', async () => {
  window.fetch = async () => response('<!doctype html><body>Пусто</body>');
  const element = create('/empty');
  await settled(element);
  assert(element.dataset.status === 'ready');
  assert(part(element, 'title').textContent === 'Название отсутствует');
  assert(part(element, 'heading').textContent === 'Заголовок отсутствует');
  assert(part(element, 'link').textContent === new URL('/empty', location.href).href);
});

await test('Пустые значения и первый пустой h1 не заменяются вторым', async () => {
  window.fetch = async () => response('<title> \n </title><h1> \n </h1><h1>Не первый</h1>');
  const element = create('/blank');
  await settled(element);
  assert(part(element, 'title').textContent === 'Название отсутствует');
  assert(part(element, 'heading').textContent === 'Заголовок отсутствует');
});

await test('Внутренние пробелы и HTML-сущности сохраняются правильно', async () => {
  window.fetch = async () => response('<title>  A  &amp; B  </title><h1>  X  <b>Y</b>\n Z  </h1>');
  const element = create('/spaces');
  await settled(element);
  // document.title itself normalizes whitespace according to the HTML standard.
  assert(part(element, 'title').textContent === 'A & B', 'title=' + JSON.stringify(part(element, 'title').textContent));
  assert(part(element, 'heading').textContent === 'X  Y\n Z', 'heading=' + JSON.stringify(part(element, 'heading').textContent));
});

await test('Полученный HTML выводится безопасно как текст', async () => {
  const element = create('../demo/safe.html');
  await settled(element);
  assert(part(element, 'heading').textContent === '<img src=x onerror=alert(1)>');
  assert(element.shadowRoot.querySelector('img') === null);
  assert(part(element, 'title').textContent === 'A & B');
});

await test('HTTP 404 переводит компонент в error', async () => {
  const element = create('../demo/missing.html');
  await settled(element);
  assert(element.dataset.status === 'error');
});

await test('Сетевая ошибка обрабатывается', async () => {
  window.fetch = async () => { throw new TypeError('Network failure'); };
  const element = create('/network-error');
  await settled(element);
  assert(element.dataset.status === 'error');
});

await test('Отсутствующий, пустой, некорректный и опасный src дают error', async () => {
  for (const src of [undefined, '', '   ', 'http://[', 'javascript:alert(1)']) {
    const element = create(src);
    await settled(element);
    assert(element.dataset.status === 'error');
    assert(!part(element, 'link').hasAttribute('href'));
  }
});

await test('Начальное подключение отправляет ровно один запрос', async () => {
  let calls = 0;
  window.fetch = async () => { calls++; return response('<title>Один</title>'); };
  const element = create('/once');
  await settled(element);
  assert(calls === 1, `Запросов: ${calls}`);
  element.setAttribute('src', '/once');
  await pause();
  assert(calls === 1);
});

await test('Атрибут до подключения не начинает запрос', async () => {
  let calls = 0;
  window.fetch = async () => { calls++; return response('<title>Подключён</title>'); };
  const element = document.createElement('page-preview');
  element.setAttribute('src', '/detached');
  assert(calls === 0);
  fixtures.append(element);
  await settled(element);
  assert(calls === 1);
});

await test('Смена src обновляет данные и удаление src даёт error', async () => {
  window.fetch = async url => response(`<title>${new URL(url).pathname}</title>`);
  const element = create('/first');
  await settled(element);
  element.setAttribute('src', '/second');
  assert(element.dataset.status === 'loading');
  await settled(element);
  assert(part(element, 'title').textContent === '/second');
  element.removeAttribute('src');
  assert(element.dataset.status === 'error');
});

await test('Старый запрос не перезаписывает новый, даже если игнорирует abort', async () => {
  let release;
  let firstSignal;
  window.fetch = (url, options) => {
    if (url.endsWith('/slow')) {
      firstSignal = options.signal;
      return new Promise(resolve => { release = resolve; });
    }
    return Promise.resolve(response('<title>Новый</title><h1>Актуальный</h1>'));
  };
  const element = create('/slow');
  element.setAttribute('src', '/fast');
  await settled(element);
  release(response('<title>Старый</title>'));
  await pause();
  assert(firstSignal.aborted);
  assert(part(element, 'title').textContent === 'Новый');
});

await test('Старая ошибка не сбрасывает новое успешное состояние', async () => {
  let rejectOld;
  window.fetch = url => url.endsWith('/old')
    ? new Promise((_, reject) => { rejectOld = reject; })
    : Promise.resolve(response('<title>Новый</title>'));
  const element = create('/old');
  element.setAttribute('src', '/new');
  await settled(element);
  rejectOld(new Error('Old error'));
  await pause();
  assert(element.dataset.status === 'ready');
  assert(part(element, 'title').textContent === 'Новый');
});

await test('Удаление отменяет запрос и запрещает обновление; подключение загружает снова', async () => {
  let release;
  let signal;
  let calls = 0;
  window.fetch = (_url, options) => {
    calls++;
    if (calls === 1) {
      signal = options.signal;
      return new Promise(resolve => { release = resolve; });
    }
    return Promise.resolve(response('<title>Снова подключён</title>'));
  };
  const element = create('/reconnect');
  element.remove();
  release(response('<title>Не показывать</title>'));
  await pause();
  assert(signal.aborted);
  assert(part(element, 'title').textContent === 'Название отсутствует');
  fixtures.append(element);
  await settled(element);
  assert(calls === 2);
  assert(part(element, 'title').textContent === 'Снова подключён');
});

await test('Экземпляры получают разные копии шаблона и независимые данные', async () => {
  window.fetch = async url => response(`<title>${new URL(url).pathname}</title>`);
  const first = create('/one');
  const second = create('/two');
  await Promise.all([settled(first), settled(second)]);
  assert(part(first, 'title') !== part(second, 'title'));
  assert(first.shadowRoot.firstElementChild !== second.shadowRoot.firstElementChild);
  assert(part(first, 'title').textContent === '/one');
  assert(part(second, 'title').textContent === '/two');
});

await test('Повторный импорт не вызывает повторную регистрацию', async () => {
  await import('../src/page-preview.js?second-import');
  assert(customElements.get('page-preview') === PagePreview);
});

document.querySelector('#summary').textContent = `${passed} пройдено; ${failed} ошибок`;
document.body.dataset.result = failed ? 'failed' : 'passed';
