/**
 * Content script для массовой подмены значений в полях форм.
 * Слушает сообщения из попапа и применяет правила на странице.
 */

// Поля-кандидаты: редактируемые input (без нередактируемых/служебных типов),
// textarea, select и любые contenteditable-блоки (true, plaintext-only и т.п.).
const SELECTOR =
  'input:not([type=hidden]):not([type=submit]):not([type=button])' +
  ':not([type=reset]):not([type=file]):not([type=checkbox])' +
  ':not([type=radio]):not([type=image]):not([type=color]):not([type=range]), ' +
  'textarea, select, [contenteditable]';

// Экранирование спецсимволов regex для поиска как обычной строки.
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setValue(el, nextValue) {
  if (el.tagName === "SELECT") {
    el.value = nextValue;
  } else if (el.isContentEditable) {
    el.innerText = nextValue;
  } else {
    el.value = nextValue;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyRule(el, rule) {
  const find = String(rule.find);
  const replace = String(rule.replace);
  if (!find) return false;

  // Учёт регистра: true по умолчанию (флаг может отсутствовать у старых правил).
  const caseSensitive = rule.caseSensitive !== false;

  const isContentEditable = el.isContentEditable;
  const current = isContentEditable ? el.innerText : el.value;
  if (current == null) return false;

  let next = null;

  if (rule.mode === "exact") {
    const a = caseSensitive ? String(current) : String(current).toUpperCase();
    const b = caseSensitive ? find : find.toUpperCase();
    if (a === b) {
      next = replace;
    }
  } else {
    const flags = caseSensitive ? "g" : "gi";
    const re = new RegExp(escapeRegExp(find), flags);
    next = String(current).replace(re, replace);
  }

  if (next === null || next === current) return false;

  setValue(el, next);
  return true;
}

function applyInDocument(doc, enabledRules) {
  let changed = 0;

  doc.querySelectorAll(SELECTOR).forEach((el) => {
    for (const rule of enabledRules) {
      if (applyRule(el, rule)) {
        changed++;
        // Поле уже изменено первым подходящим правилом — к следующему полю.
        break;
      }
    }
  });

  return changed;
}

function applyRules(rules) {
  if (!Array.isArray(rules)) return 0;

  const enabled = rules.filter(
    (r) => r.enabled !== false && String(r.find).trim().length > 0
  );

  let changed = applyInDocument(document, enabled);

  // iframe того же домена: прозрачно для пользователя, кросс-доменные
  // пропускаются (политика безопасности браузера не позволяет к ним доступ).
  document.querySelectorAll("iframe").forEach((iframe) => {
    try {
      const doc = iframe.contentDocument;
      if (doc && doc !== document) {
        changed += applyInDocument(doc, enabled);
      }
    } catch (_err) {
      // Кросс-доменный iframe — доступ закрыт, пропускаем.
    }
  });

  return changed;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "KF_REPLACE") {
    try {
      const changed = applyRules(msg.rules);
      sendResponse({ ok: true, changed });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  }
  return false;
});