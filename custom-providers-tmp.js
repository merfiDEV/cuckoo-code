/**
 * ChatGPT Provider для Cuckoo Code
 * Совместим с src/providers/custom/loader.js (validateProvider)
 * 
 * Установка:
 *  1. Открой Cuckoo Code -> меню профилей -> "Импорт провайдера" -> выбери этот файл
 *  2. Или скопируй вручную в %APPDATA%\cuckoo-ai-pro-session\custom-providers\chatgpt.js
 *  3. Создай новый профиль и выбери ChatGPT как платформу
 * 
 * Поддерживает:
 *  - chatgpt.com
 *  - chat.openai.com (legacy)
 *  - chat.com
 * 
 * Основано на структуре deepseek.js / claude.js из https://github.com/wangyongpeng90/cuckoo-code
 */

// Селекторы для детекта состояния генерации ChatGPT
const STOP_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label="Остановить генерацию"]',
  'button[data-testid="stop-generating-button"]',
];

const ACTION_SELECTORS = [
  'button[data-testid="copy-turn-action-button"]',
  'button[aria-label="Copy"]',
  'button[aria-label="Копировать"]',
  'button[data-testid="good-response-turn-action-button"]',
  'button[data-testid="bad-response-turn-action-button"]',
];

module.exports = {
  id: 'chatgpt',
  name: 'ChatGPT',
  homeUrl: 'https://chatgpt.com/',
  sessionUrlBase: 'https://chatgpt.com/c/',

  // ========== Поиск поля ввода ==========
  findInput() {
    const selectors = [
      '#prompt-textarea',
      'div#prompt-textarea[contenteditable="true"]',
      'div[data-testid="composer"] div[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"]',
      'textarea[data-testid="composer-text-input"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Сообщение"]',
      'textarea[placeholder*="Ask"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
      '[role="textbox"]',
    ];
    for (const sel of selectors) {
      try {
        // берём последний видимый, т.к. ChatGPT может иметь скрытые дубликаты
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
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label*="Отправить"]',
      'button[type="submit"]',
      '#composer-submit-button',
      'button:has(svg)',
    ];
    for (const sel of selectors) {
      try {
        // ChatGPT иногда рендерит несколько кнопок, ищем видимую и enabled
        const nodes = document.querySelectorAll(sel);
        for (const btn of nodes) {
          if (this.isElementVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
            // дополнительная проверка: внутри должна быть иконка стрелки/отправки
            const hasIcon = btn.querySelector('svg');
            // Но если селектор уже точный (data-testid), то иконка не обязательна
            if (sel.includes('data-testid') || hasIcon) return btn;
          }
        }
      } catch (_) {}
    }
    return null;
  },

  // ========== Инфо о пользователе (для заголовка окна) ==========
  extractUserInfo() {
    const selectors = [
      'button[data-testid="profile-button"] span',
      '[data-testid="accounts-profile-button"]',
      'button[aria-label*="Profile"]',
      'img[alt*="User"]',
      '[data-testid="user-menu"]',
      'nav [class*="user"]',
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = (el.textContent || el.getAttribute('alt') || '').trim();
          if (text) return text;
        }
      } catch (_) {}
    }
    // fallback: email в localStorage (если доступен)
    try {
      const raw = localStorage.getItem('oai/lastActiveSession') || '';
      if (raw) return raw.slice(0, 40);
    } catch (_) {}
    return '';
  },

  // ========== URL матчинг ==========
  homeUrlPattern: /^https:\/\/(www\.)?(chatgpt\.com|chat\.openai\.com|chat\.com)\/?(\?.*)?$/,

  extractSessionId(url) {
    if (!url) return null;
    // chatgpt.com/c/uuid  или chatgpt.com/g/g-xxx/c/uuid  или chat.openai.com/c/uuid
    const patterns = [
      /\/c\/([a-zA-Z0-9_-]{8,})/,
      /\/chat\/([a-zA-Z0-9_-]{8,})/,
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
        host === 'chatgpt.com' ||
        host === 'www.chatgpt.com' ||
        host === 'chat.openai.com' ||
        host === 'chat.com' ||
        host === 'www.chat.com' ||
        host.endsWith('.chatgpt.com') ||
        host.endsWith('.chat.openai.com')
      );
    } catch (_) {
      // fallback для нестандартных URL
      return (
        url.includes('chatgpt.com') ||
        url.includes('chat.openai.com')
      );
    }
  },

  isElementVisible(el) {
    if (!el) return false;
    // ChatGPT использует display:none и hidden, проверяем комплексно
    if (el.hidden) return false;
    if (el.style && el.style.display === 'none') return false;
    const rect = el.getBoundingClientRect?.();
    if (rect && (rect.width === 0 || rect.height === 0)) {
      // но contenteditable может иметь 0 высоту до фокуса - проверяем offset
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    }
    return el.offsetWidth > 0 || el.offsetHeight > 0 || (rect && rect.width > 0);
  },

  // ========== Детект завершения ответа AI ==========
  // В ChatGPT: пока генерируется - видна кнопка Stop, после - появляются кнопки Copy/Like/Dislike
  isResponseComplete() {
    try {
      // 1. Если видна кнопка Stop -> точно НЕ завершено
      for (const sel of STOP_SELECTORS) {
        const btn = document.querySelector(sel);
        if (btn && this.isElementVisible(btn)) return false;
      }

      // 2. Ищем маркер завершённого сообщения: action buttons внутри последнего assistant сообщения
      const messages = this.getMessageCandidates();
      if (messages.length === 0) return false;

      const last = messages[messages.length - 1];
      // Проверяем что последнее сообщение имеет контент
      const md = this.getMessageMarkdown(last);
      if (!md || !(md.textContent || '').trim()) return false;

      // Считаем action кнопки рядом с последним сообщением
      // В ChatGPT они находятся в sibling div после сообщения или внутри article
      const scope = last.closest('article') || last.parentElement || last;
      let actionCount = 0;
      for (const sel of ACTION_SELECTORS) {
        try {
          if (scope.querySelector(sel)) actionCount++;
          else if (document.querySelector(sel) && last.contains(document.querySelector(sel))) actionCount++;
        } catch (_) {}
      }
      // Глобальный fallback: ищем любые copy кнопки на странице, если они есть - скорее всего генерация завершена
      const globalActions = document.querySelectorAll(ACTION_SELECTORS.join(','));
      if (globalActions.length > 0) actionCount = Math.max(actionCount, globalActions.length);

      // Если есть хотя бы 1 action кнопка и нет stop -> считаем завершённым
      // (ChatGPT 2024-2026: после генерации появляются Copy, Good/Bad response)
      return actionCount >= 1;
    } catch (err) {
      console.error('[Cuckoo ChatGPT] isResponseComplete error:', err);
      return false;
    }
  },

  // ========== Поиск сообщений ассистента ==========
  getMessageCandidates() {
    // ChatGPT использует несколько вариантов разметки в разные периоды
    const selectors = [
      'div[data-message-author-role="assistant"]',
      'div[data-message-author-role="assistant"] article',
      'article[data-testid*="conversation-turn"]',
      '[data-testid="conversation-turn-"]',
      'div.agent-turn',
      '.markdown.prose',
    ];

    let candidates = [];
    for (const sel of selectors) {
      try {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) {
          // Фильтруем только assistant
          const filtered = found.filter((el) => !this.isUserMessage(el));
          if (filtered.length > 0) {
            // Выбираем селектор который дал больше всего результатов
            if (filtered.length > candidates.length) candidates = filtered;
          }
        }
      } catch (_) {}
    }

    // Fallback: если ничего не нашли, пробуем найти все turn'ы и фильтровать
    if (candidates.length === 0) {
      const allTurns = Array.from(document.querySelectorAll('[data-message-author-role]'));
      candidates = allTurns.filter((el) => {
        const role = el.getAttribute('data-message-author-role');
        return role === 'assistant';
      });
    }

    // Ещё fallback: article элементы (ChatGPT оборачивает каждый ход в article)
    if (candidates.length === 0) {
      const articles = Array.from(document.querySelectorAll('article'));
      candidates = articles.filter((el) => {
        // Проверяем что внутри нет user-message
        const isUser = el.querySelector('[data-message-author-role="user"]');
        if (isUser) return false;
        // И есть markdown
        return el.querySelector('.markdown, .prose, [class*="markdown"]');
      });
    }

    return candidates;
  },

  getMessageMarkdown(messageEl) {
    if (!messageEl) return null;
    // Приоритетные селекторы для ChatGPT markdown
    const selectors = [
      'div.markdown',
      'div[data-message-author-role="assistant"] div.markdown',
      '.prose',
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
    // Если messageEl сам является markdown контейнером
    if (messageEl.classList && (messageEl.classList.contains('markdown') || messageEl.classList.contains('prose'))) {
      return messageEl;
    }
    // Fallback: возвращаем сам элемент
    return messageEl;
  },

  isUserMessage(node) {
    if (!node) return false;
    // Проверка по атрибуту data-message-author-role
    let current = node;
    while (current && current !== document.body) {
      const role = current.getAttribute?.('data-message-author-role');
      if (role === 'user' || role === 'human') return true;
      if (role === 'assistant' || role === 'system') return false;

      // Проверка по data-testid
      const testId = current.getAttribute?.('data-testid') || '';
      if (testId.includes('user-message')) return true;

      // Проверка по классу
      const cls = current.className || '';
      if (typeof cls === 'string' && (cls.includes('user-message') || cls.includes('human'))) return true;

      current = current.parentElement;
    }
    // Текстовая эвристика для cuckoo-code системных сообщений
    const text = (node.textContent || node.innerText || '').substring(0, 300);
    return (
      text.includes('我已选择目录：') ||
      text.includes('系统提示词：') ||
      text.includes('工具使用规则：') ||
      text.includes('Я выбрал директорию:') ||
      text.includes('PROJECT_DIR')
    );
  },

  getCodeBlockLanguage(pre) {
    if (!pre) return '';
    // 1. data-language атрибут (если injection сделал обёртку)
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
        // ChatGPT иногда использует hljs классы
        const hljsMatch = (el.className || '').match(/language-([\w-]+)/);
        if (hljsMatch) {
          lang = hljsMatch[1];
          break;
        }
      }
    }
    // 3. Banner/header над кодом (ChatGPT показывает язык в заголовке блока)
    if (!lang) {
      const block = pre.closest('div')?.parentElement;
      if (block) {
        const banner = block.querySelector('[class*="code-block-header"], [class*="code-header"]');
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
    return (lang || '').toLowerCase();
  },
};
