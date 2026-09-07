/**
 * Z.AI Provider для Cuckoo Code (кастомный)
 * Совместим с src/providers/custom/loader.js (validateProvider)
 *
 * Платформа: https://chat.z.ai  (GLM-4.5 / GLM-4.6 / GLM-5 / GLM-5.3-Flash и т.д.)
 * Форк Open WebUI, поэтому DOM максимально схож с Open WebUI.
 *
 * Установка (вариант А — импорт как кастомный провайдер):
 *  1. Открой Cuckoo Code -> выбор платформы -> "Импорт провайдера" -> выбери этот файл zai.js
 *  2. Или скопируй вручную в %APPDATA%\cuckoo-ai-pro-session\custom-providers\zai.js
 *  3. Перезапусти Cuckoo Code, создай новый профиль и выбери Z.AI
 *
 * Установка (вариант B — как встроенный):
 *  1. Скопируй этот файл в src/providers/zai.js
 *  2. Добавь в src/providers/index.js:
 *     const zai = require('./zai');
 *     const builtinProviders = [deepseek, claude, zai];
 *
 * Проверено на фронтенде prod-fe-1.1.93 (Open WebUI fork, SvelteKit),
 * где:
 *  - input = <textarea id="chat-input">
 *  - send  = <button id="send-message-button" type="submit">
 *  - stop  = <div class="relative size-7"><button><span class="block bg-white size-3"></span></button></div>
 *  - messages container #chat-container, каждое сообщение div[id^="message-"] + .markdown-prose
 *  - copy  = <button id="copy-and-share-chat-button">
 *
 * Основано на структуре deepseek.js / claude.js / custom-providers-tmp.js
 */

// eslint-disable-next-line no-unused-vars
let stopBtnVisible = false;

// Селекторы Stop (пока генерируется — видна кнопка Stop)
const STOP_SELECTORS = [
  'div.relative.size-7 button',                         // точный шаблон Z.ai/OpenWebUI (квадрат Stop)
  'button:has(span.block.bg-white.size-3)',             // альтернатива если :has поддерживается
  'button[aria-label*="Stop"]',
  'button[aria-label*="stop"]',
  'button[aria-label*="Остановить"]',
  'button[aria-label*="停止"]',
];

// Селекторы признаков завершённого ответа
const ACTION_SELECTORS = [
  '#copy-and-share-chat-button',
  'button[id*="copy"]',
  'button[aria-label*="Copy"]',
  'button[aria-label*="copy"]',
  'button[aria-label*="Копировать"]',
  'button[title*="Copy"]',
];

/** @type {import('./custom/provider.d.ts').Provider} */
module.exports = {
  id: 'zai',
  name: 'Z.AI',
  homeUrl: 'https://chat.z.ai/',
  sessionUrlBase: 'https://chat.z.ai/c/',

  // Для совместимости с шаблоном — также декларируем массивы селекторов
  inputSelectors: [
    '#chat-input',
    'textarea#chat-input',
    'textarea[placeholder*="Send a message"]',
    'textarea[placeholder*="Send"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="输入"]',
    'textarea[placeholder*="发送"]',
    'textarea',
    'div[contenteditable="true"]',
    '[role="textbox"]',
  ],
  sendButtonSelectors: [
    '#send-message-button',
    'button#send-message-button',
    'button[type="submit"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
  ],
  userInfoSelector: 'button[data-testid="profile-button"], #user-menu, [data-testid="user-menu"]',
  homeUrlPattern: /^https:\/\/(www\.)?(chat\.z\.ai|z\.ai)\/?(\?.*)?$/,

  // ========== Поиск поля ввода ==========
  findInput() {
    const selectors = [
      '#chat-input',
      'textarea#chat-input',
      'div.messageInputContainer textarea',
      'textarea[placeholder*="Send a message"]',
      'textarea[placeholder*="Send"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="发送"]',
      'textarea[placeholder*="提问"]',
      'textarea',
      'div[contenteditable="true"]',
      '[role="textbox"]',
    ];
    for (const sel of selectors) {
      try {
        // Берём последний видимый — в Svelte может быть скрытый дубликат
        const nodes = document.querySelectorAll(sel);
        for (let i = nodes.length - 1; i >= 0; i--) {
          const el = nodes[i];
          if (this.isElementVisible(el)) return el;
        }
      } catch (_) {}
    }
    return null;
  },

  // ========== Поиск кнопки отправки ==========
  findSendButton() {
    const selectors = [
      '#send-message-button',
      'button#send-message-button',
      'button[type="submit"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="发送"]',
      'form button:has(svg)',
      'button:has(svg)',
    ];
    for (const sel of selectors) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (const btn of nodes) {
          if (this.isElementVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
            // Если селектор точный (#send-message-button / type=submit) — сразу возвращаем
            if (sel.includes('send-message-button') || sel.includes('type="submit"')) return btn;
            // Иначе требуем иконку внутри (стрелка отправки)
            if (btn.querySelector('svg')) return btn;
            // Fallback: кнопка внутри .messageInputContainer
            if (btn.closest('.messageInputContainer')) return btn;
            return btn;
          }
        }
      } catch (_) {
        // :has может не поддерживаться в старых Electron — игнорируем
      }
    }
    // Fallback: ищем любую кнопку внутри формы ввода рядом с textarea
    try {
      const input = document.querySelector('#chat-input');
      if (input) {
        const form = input.closest('form');
        if (form) {
          const btn = form.querySelector('button[type="submit"], button');
          if (btn && this.isElementVisible(btn) && !btn.disabled) return btn;
        }
      }
    } catch (_) {}
    return null;
  },

  // ========== Инфо о пользователе (для заголовка окна) ==========
  extractUserInfo() {
    const selectors = [
      '[data-testid="profile-button"] span',
      '[data-testid="user-menu"]',
      '#user-menu',
      'button[aria-label*="Profile"]',
      'img[alt*="User"]',
      'nav [class*="user"]',
      '.user-name',
      '[class*="userMenu"]',
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = (el.textContent || el.getAttribute('alt') || '').trim();
          if (text && text.length < 60) return text;
        }
      } catch (_) {}
    }
    // Fallback: email / name из localStorage (Open WebUI хранит token / user)
    try {
      const raw = localStorage.getItem('user') || localStorage.getItem('token') || '';
      if (raw) {
        try {
          const j = JSON.parse(raw);
          if (j && (j.name || j.email)) return (j.name || j.email).slice(0, 40);
        } catch (_) {
          return raw.slice(0, 40);
        }
      }
    } catch (_) {}
    return '';
  },

  // ========== URL матчинг ==========
  extractSessionId(url) {
    if (!url) return null;
    const patterns = [
      /\/c\/([a-f0-9-]{8,})/i,         // Open WebUI canonical: /c/uuid  (chat.z.ai/c/xxx)
      /\/chat\/([a-f0-9-]{8,})/i,      // fallback: /chat/uuid
      /\/s\/([a-f0-9-]{8,})/i,         // fallback
      /\/c\/([a-zA-Z0-9_-]{8,})/,      // generic как у ChatGPT
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m) return m[1];
    }
    return null;
  },

  matchesUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      return (
        host === 'chat.z.ai' ||
        host === 'www.chat.z.ai' ||
        host === 'z.ai' ||
        host === 'www.z.ai' ||
        host.endsWith('.chat.z.ai') ||
        host.endsWith('.z.ai')
      );
    } catch (_) {
      return url.includes('chat.z.ai') || url.includes('z.ai');
    }
  },

  isElementVisible(el) {
    if (!el) return false;
    if (el.hidden) return false;
    if (el.style && el.style.display === 'none') return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    const rect = el.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0) {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    }
    return el.offsetWidth > 0 || el.offsetHeight > 0 || (rect && rect.width > 0);
  },

  // ========== Детект завершения ответа AI ==========
  // В Z.ai (Open WebUI fork): пока генерируется — видна кнопка Stop (div.relative.size-7 button)
  // После — появляются кнопки Copy/Share, а Stop исчезает. Используем edge-trigger как у Claude
  // чтобы избежать ложных срабатываний на полпути.
  async isResponseComplete() {
    try {
      // 1. Если видна кнопка Stop -> точно НЕ завершено
      let stopVisible = false;
      for (const sel of STOP_SELECTORS) {
        try {
          const nodes = document.querySelectorAll(sel);
          for (const btn of nodes) {
            if (this.isElementVisible(btn)) {
              stopVisible = true;
              break;
            }
          }
          if (stopVisible) break;
        } catch (_) {
          // :has может кинуть SyntaxError в старых движках
          continue;
        }
      }
      // Fallback: отдельный поиск по характерному span внутри Stop
      if (!stopVisible) {
        try {
          const span = document.querySelector('div.relative.size-7 span.block.bg-white.size-3');
          if (span && this.isElementVisible(span.closest('button') || span)) stopVisible = true;
        } catch (_) {}
      }

      if (stopVisible) {
        stopBtnVisible = true;
        return false;
      }

      // Edge: только что исчез Stop -> ждём стабилизации Svelte (Open WebUI рендерит markdown чанками)
      if (stopBtnVisible) {
        stopBtnVisible = false;
        // Даём 800ms на финальный рендер markdown-prose и появление copy кнопок
        await new Promise((r) => setTimeout(r, 800));
        return true;
      }

      // Если Stop никогда не появлялся (например, короткий ответ без streaming),
      // проверяем наличие признаков завершённого сообщения:
      const messages = this.getMessageCandidates();
      if (messages.length === 0) return false;
      const last = messages[messages.length - 1];
      const md = this.getMessageMarkdown(last);
      if (!md || !(md.textContent || '').trim()) return false;

      // Ищем action кнопки рядом с последним сообщением или глобально
      let actionCount = 0;
      const scope = last.closest('[id^="message-"]') || last.closest('#chat-container') || last.parentElement || last;
      for (const sel of ACTION_SELECTORS) {
        try {
          if (scope && scope.querySelector(sel)) actionCount++;
        } catch (_) {}
      }
      // Глобальный fallback: если на странице есть хоть одна copy/share кнопка — считаем завершённым
      // но только если Stop уже не видна (проверено выше)
      if (actionCount === 0) {
        try {
          const globalActions = document.querySelectorAll(ACTION_SELECTORS.join(','));
          if (globalActions.length > 0) actionCount = globalActions.length;
        } catch (_) {}
      }

      // Если есть хотя бы 1 action и нет stop — завершено
      if (actionCount >= 1) return true;

      // Fallback Z.ai: в Open WebUI fork action-кнопки могут не иметь id #copy-and-share
      // (Share вверху). Если Stop не видна и markdown не пустой — считаем завершённым.
      // Стриминг защищён проверкой Stop выше, а двойной вызов защищён pendingJsChecks в observer.js:263.
      return true;
    } catch (err) {
      console.error('[Cuckoo Z.AI] isResponseComplete error:', err);
      return false;
    }
  },

  // ========== Поиск сообщений ассистента ==========
  getMessageCandidates() {
    // Z.ai = Open WebUI fork: сообщения в #chat-container, каждый div[id^="message-"]
    // Внутри каждого — .markdown-prose (или .markdown)
    const selectors = [
      '#chat-container div[id^="message-"]',
      'div[id^="message-"]',
      '[data-message-id]',
      'div[data-message-author-role="assistant"]',
      '.markdown-prose',
      '.markdown',
    ];

    let best = [];
    for (const sel of selectors) {
      try {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length === 0) continue;
        // Если селектор — .markdown-prose, нам нужен родительский контейнер сообщения,
        // иначе isUserMessage будет работать на внутреннем div и может ошибиться.
        // Поэтому для markdown-пробуем подняться к ближайшему message-контейнеру
        let candidates = found;
        if (sel.includes('markdown')) {
          candidates = found.map((el) => {
            const parent = el.closest('div[id^="message-"]') || el.closest('[id^="message-"]') || el;
            return parent;
          });
          // Дедуп по элементу
          candidates = Array.from(new Set(candidates));
        }
        const filtered = candidates.filter((el) => !this.isUserMessage(el));
        if (filtered.length > best.length) best = filtered;
      } catch (_) {}
    }

    // Fallback: если ничего не нашли, берём все id^=message- без фильтра
    if (best.length === 0) {
      const all = Array.from(document.querySelectorAll('div[id^="message-"]'));
      if (all.length > 0) best = all.filter((el) => !this.isUserMessage(el));
    }

    // Ещё fallback: article элементы (если форк изменился)
    if (best.length === 0) {
      const articles = Array.from(document.querySelectorAll('article'));
      const filtered = articles.filter((el) => {
        if (el.querySelector('[data-message-author-role="user"]')) return false;
        return el.querySelector('.markdown, .markdown-prose, [class*="markdown"]');
      });
      if (filtered.length > 0) best = filtered;
    }

    // Последняя страховка: все .markdown-prose как кандидаты (без фильтра)
    if (best.length === 0) {
      const mds = Array.from(document.querySelectorAll('.markdown-prose'));
      if (mds.length > 0) {
        best = mds.map((el) => el.closest('div[id^="message-"]') || el).filter((el) => !this.isUserMessage(el));
      }
    }

    return best;
  },

  getMessageMarkdown(messageEl) {
    if (!messageEl) return null;
    // Если сам элемент уже markdown
    if (
      messageEl.classList &&
      (messageEl.classList.contains('markdown-prose') || messageEl.classList.contains('markdown'))
    ) {
      return messageEl;
    }
    const selectors = [
      '.markdown-prose',
      'div.markdown-prose',
      '.markdown',
      'div.markdown',
      '[class*="markdown-prose"]',
      '[class*="markdown"]',
      'div[class*="prose"]',
      '[data-message-id] div.markdown',
    ];
    for (const sel of selectors) {
      try {
        const el = messageEl.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    // Fallback: сам элемент
    return messageEl;
  },

  isUserMessage(node) {
    if (!node) return false;
    let current = node;
    while (current && current !== document.body) {
      const role = current.getAttribute?.('data-message-author-role') || current.getAttribute?.('data-role') || current.getAttribute?.('data-author') || '';
      if (role === 'user' || role === 'human') return true;
      if (role === 'assistant' || role === 'system' || role === 'ai') return false;

      const testId = current.getAttribute?.('data-testid') || '';
      if (testId.includes('user-message')) return true;
      if (testId === 'user') return true;

      // Open WebUI иногда использует id="message-<uuid>" без role, но родитель имеет класс user vs assistant
      const cls = current.className || '';
      if (typeof cls === 'string') {
        if (cls.includes('user-message') || cls.includes('message-user') || cls.includes('human')) return true;
        // В Open WebUI user-сообщения часто имеют фон bg-gray-100 / bg-white в отличии от ассистента
        // Но это хрупко — оставляем только явные маркеры
      }

      // Проверка по id: если id начинается с message- и внутри есть аватар пользователя справа?
      // Пропускаем эвристику — полагаемся на текстовую

      current = current.parentElement;
    }
    // Текстовая эвристика для cuckoo-code системных сообщений (в т.ч. рус/кит)
    // В Z.ai системный промпт содержит блок ## 环境信息 / 当前工作目录 — его тоже считаем user
    const text = (node.textContent || node.innerText || '').substring(0, 600);
    return (
      text.includes('我已选择目录：') ||
      text.includes('系统提示词：') ||
      text.includes('工具使用规则：') ||
      text.includes('Я выбрал директорию:') ||
      text.includes('PROJECT_DIR') ||
      text.includes('【工具执行结果】') ||
      text.includes('【JS 执行结果汇总】') ||
      text.includes('当前工作目录') ||
      text.includes('环境信息') ||
      text.includes('projectDir') ||
      text.includes('你可以') && text.includes('shell 命令')
    );
  },

  getCodeBlockLanguage(pre) {
    if (!pre) return '';
    // 1. data-language на pre или родителе
    let lang = pre.getAttribute('data-language') || '';
    if (!lang) {
      const parentDiv = pre.closest('div[data-language]');
      if (parentDiv) lang = parentDiv.getAttribute('data-language') || '';
    }
    // 2. class language-xxx на code/pre
    if (!lang) {
      const codeEl = pre.querySelector('code');
      const els = [codeEl, pre].filter(Boolean);
      for (const el of els) {
        const cls = Array.from(el.classList || []).find((c) => c.startsWith('language-'));
        if (cls) {
          lang = cls.replace('language-', '');
          break;
        }
        const hljsMatch = (el.className || '').match(/language-([\w-]+)/);
        if (hljsMatch) {
          lang = hljsMatch[1];
          break;
        }
        // Open WebUI иногда кладёт язык в hljs class: class="hljs language-python"
        const inner = el.className || '';
        const m2 = inner.match(/hljs\s+language-(\w+)/);
        if (m2) {
          lang = m2[1];
          break;
        }
      }
    }
    // 3. Banner/header над кодом (Open WebUI показывает язык в заголовке блока)
    if (!lang) {
      const block = pre.closest('div')?.parentElement;
      if (block) {
        const banner = block.querySelector(
          '[class*="code-block-header"], [class*="code-header"], [class*="language"]'
        );
        if (banner) {
          const t = (banner.textContent || '').trim().split(/\s+/)[0];
          if (/^[a-zA-Z0-9_+#.-]{1,20}$/.test(t)) lang = t;
        }
      }
    }
    // 4. pre > code className напрямую
    if (!lang && pre.firstElementChild) {
      const codeCls = pre.firstElementChild.className || '';
      const m = codeCls.match(/hljs\s+language-(\w+)/);
      if (m) lang = m[1];
    }
    // 5. Попытка вытащить из заголовка копирования (Open WebUI header)
    if (!lang) {
      const holder = pre.closest('[class*="markdown"]') || pre.parentElement;
      if (holder) {
        const maybe = holder.previousElementSibling;
        if (maybe) {
          const t = (maybe.textContent || '').trim().split(/\s+/)[0];
          if (/^[a-zA-Z0-9_+#.-]{1,20}$/.test(t) && t.length <= 12) lang = t;
        }
      }
    }
    return (lang || '').toLowerCase();
  },
};
