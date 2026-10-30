/**
 * Content script для массовой подмены значений в полях форм.
 * Слушает сообщения из попапа:
 *  - KF_FIND     — поиск совпадений (счёт с/без учёта регистра + найденные значения);
 *  - KF_REPLACE  — применение правил замены.
 */

// Поля-кандидаты: редактируемые input (без нередактируемых/служебных типов),
// textarea, select и любые contenteditable-блоки (true, plaintext-only и т.п.).
const SELECTOR =
  'input:not([type=hidden]):not([type=submit]):not([type=button])' +
  ':not([type=reset]):not([type=file]):not([type=checkbox])' +
  ':not([type=radio]):not([type=image]):not([type=color]):not([type=range]), ' +
  'textarea, select, [contenteditable]';

const MAX_SAMPLES = 8;

// Все поля основного документа и iframe того же домена.
function collectFields() {
  const all = [];
  const collect = (root) => {
    root.querySelectorAll(SELECTOR).forEach((el) => all.push(el));
  };
  collect(document);

  document.querySelectorAll("iframe").forEach((iframe) => {
    try {
      const doc = iframe.contentDocument;
      if (doc && doc !== document) collect(doc);
    } catch (_err) {
      // Кросс-доменный iframe — доступ закрыт, пропускаем.
    }
  });

  return all;
}

function fieldValue(el) {
  return el.isContentEditable ? el.innerText : el.value;
}

// Учитывать регистр по умолчанию НЕ надо: флаг вкл. только при caseSensitive === true.
function isCaseSensitive(rule) {
  return rule.caseSensitive === true;
}

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

  const caseSensitive = isCaseSensitive(rule);
  const current = fieldValue(el);
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

function activeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (r) => r.enabled !== false && String(r.find).trim().length > 0
  );
}

function applyRules(rules) {
  const enabled = activeRules(rules);
  let changed = 0;

  collectFields().forEach((el) => {
    for (const rule of enabled) {
      if (applyRule(el, rule)) {
        changed++;
        // Поле уже изменено первым подходящим правилом — к следующему полю.
        break;
      }
    }
  });

  return changed;
}

// Статистика по одному правилу: счёт с учётом и без учёта регистра, найденные значения.
function matchRule(rule) {
  const find = String(rule.find);
  const exact = rule.mode === "exact";
  const findUpper = find.toUpperCase();
  let countCaseSensitive = 0;
  let countCaseInsensitive = 0;
  const samples = [];
  const seen = new Set();

  collectFields().forEach((el) => {
    const cur = fieldValue(el);
    if (cur == null) return;
    const str = String(cur);

    const mCS = exact ? str === find : str.includes(find);
    const mCI = exact
      ? str.toUpperCase() === findUpper
      : str.toUpperCase().includes(findUpper);

    if (mCS) countCaseSensitive++;
    if (mCI) countCaseInsensitive++;

    if ((mCS || mCI) && samples.length < MAX_SAMPLES && !seen.has(str)) {
      seen.add(str);
      samples.push(str);
    }
  });

  return {
    find,
    replace: String(rule.replace),
    mode: exact ? "exact" : "part",
    caseSensitive: isCaseSensitive(rule),
    countCaseSensitive,
    countCaseInsensitive,
    samples,
  };
}

function findRules(rules) {
  return activeRules(rules).map(matchRule);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "KF_FIND") {
    try {
      sendResponse({ ok: true, results: findRules(msg.rules) });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  } else if (msg.type === "KF_REPLACE") {
    try {
      const changed = applyRules(msg.rules);
      sendResponse({ ok: true, changed });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  }

  return false;
});