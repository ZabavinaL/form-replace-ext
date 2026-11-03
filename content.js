/**
 * Content script для массовой подмены значений в полях форм.
 * Слушает сообщения из попапа:
 *  - KF_FIND    — поиск совпадений со списком найденных полей (по элементам);
 *  - KF_REPLACE — применение правил замены (по всем полям или по переданным таргетам);
 *  - KF_SHOW    — прокрутка и подсветка поля на странице.
 */

// Поля-кандидаты: редактируемые input (без нередактируемых/служебных типов),
// textarea, select и любые contenteditable-блоки (true, plaintext-only и т.п.).
const SELECTOR =
  'input:not([type=hidden]):not([type=submit]):not([type=button])' +
  ':not([type=reset]):not([type=file]):not([type=checkbox])' +
  ':not([type=radio]):not([type=image]):not([type=color]):not([type=range]), ' +
  'textarea, select, [contenteditable]';

// Максимум найденных пунктов на правило, показываемых в попапе.
const MAX_RESULTS = 50;
const FLASH_MS = 2400;

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

// Подгоняет регистр подстановки под регистр найденного фрагмента:
//   "JOHN"  → "ПОЛН.",  "John" → "Иван",  "john" → "иван".
function matchCase(found, replacement) {
  if (!found || !replacement) return replacement;
  if (found === found.toUpperCase() && /[A-Za-zА-ЯЁ]/.test(found)) {
    return replacement.toUpperCase();
  }
  const first = found.charAt(0);
  if (/[A-ZА-ЯЁ]/.test(first)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function setFieldValue(el, value) {
  if (el.tagName === "SELECT") {
    el.value = value;
  } else if (el.isContentEditable) {
    el.innerText = value;
  } else {
    el.value = value;
  }
}

function commitChanges(el) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// Замена в текстовых узлах contenteditable: сохраняет HTML-разметку
// (списки, жирный текст, стили), трогая только текст внутри узлов.
function replaceInContentEditable(el, re, toNext) {
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let changed = false;
  for (const node of nodes) {
    const value = node.nodeValue;
    if (!value) continue;
    const next = value.replace(re, toNext);
    if (next !== value) {
      node.nodeValue = next;
      changed = true;
    }
  }
  return changed;
}

function applyRule(el, rule) {
  const find = String(rule.find);
  const replace = String(rule.replace);
  if (!find) return false;

  const caseSensitive = isCaseSensitive(rule);
  const cur = fieldValue(el);
  if (cur == null) return false;
  const current = String(cur);
  const toNext = (m) => matchCase(m, replace);

  if (rule.mode === "exact") {
    const a = caseSensitive ? current : current.toUpperCase();
    const b = caseSensitive ? find : find.toUpperCase();
    if (a !== b) return false;
    const next = matchCase(current, replace);
    if (next === current) return false;
    setFieldValue(el, next);
    commitChanges(el);
    return true;
  }

  const flags = caseSensitive ? "g" : "gi";
  const re = new RegExp(escapeRegExp(find), flags);
  const changed = el.isContentEditable
    ? replaceInContentEditable(el, re, toNext)
    : (() => {
        const next = current.replace(re, toNext);
        if (next === current) return false;
        setFieldValue(el, next);
        return true;
      })();

  if (changed) commitChanges(el);
  return changed;
}

function activeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (r) => r.enabled !== false && String(r.find).trim().length > 0
  );
}

// targets: [{ rule, field }] — индексы правила и поля из последнего поиска.
function applyRules(rules, targets) {
  const enabled = activeRules(rules);
  const fields = collectFields();
  let changed = 0;

  if (Array.isArray(targets) && targets.length) {
    const seen = new Set();
    for (const t of targets) {
      const rule = enabled[t.rule];
      const el = fields[t.field];
      if (!rule || !el) continue;
      const key = t.rule + ":" + t.field;
      if (seen.has(key)) continue;
      seen.add(key);
      if (applyRule(el, rule)) changed++;
    }
    return changed;
  }

  fields.forEach((el) => {
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

// Статистика по одному правилу: счёт, найденные поля (со значениями и фрагментами).
function matchRule(rule) {
  const find = String(rule.find);
  const exact = rule.mode === "exact";
  const caseSensitive = isCaseSensitive(rule);
  const findUpper = find.toUpperCase();
  let countCaseSensitive = 0;
  let countCaseInsensitive = 0;
  const items = [];

  collectFields().forEach((el, fieldIndex) => {
    const cur = fieldValue(el);
    if (cur == null) return;
    const str = String(cur);

    const mCI = exact
      ? str.toUpperCase() === findUpper
      : str.toUpperCase().includes(findUpper);
    if (!mCI) return;
    countCaseInsensitive++;

    const mCS = exact ? str === find : str.includes(find);
    if (mCS) countCaseSensitive++;

    if (items.length < MAX_RESULTS) {
      let matched = str;
      if (!exact) {
        const idx = caseSensitive
          ? str.indexOf(find)
          : str.toUpperCase().indexOf(findUpper);
        matched = idx >= 0 ? str.substr(idx, find.length) : "";
      }
      items.push({ field: fieldIndex, text: str, matched });
    }
  });

  return {
    find,
    replace: String(rule.replace),
    mode: exact ? "exact" : "part",
    caseSensitive,
    countCaseSensitive,
    countCaseInsensitive,
    items,
  };
}

function findRules(rules) {
  return activeRules(rules).map(matchRule);
}

// Временная подсветка поля на странице.
function flashField(el) {
  const prev = { outline: el.style.outline, outlineOffset: el.style.outlineOffset };
  el.style.outline = "3px solid #ff9800";
  el.style.outlineOffset = "2px";
  setTimeout(() => {
    el.style.outline = prev.outline;
    el.style.outlineOffset = prev.outlineOffset;
  }, FLASH_MS);
}

// ---- Подсветка найденных слов на странице (жёлтый фон) ----

const MARK_ATTR = "data-kf-mark";
const MARK_BG = "#fff59d";
let markSpans = [];
let markControls = [];

// Снять все подсветки, вернув исходное состояние.
function clearMarks() {
  markSpans.forEach((span) => {
    const parent = span.parentNode;
    if (parent) parent.replaceChild(span.firstChild, span);
  });
  markSpans = [];

  markControls.forEach(({ el, prev }) => {
    el.style.backgroundColor = prev;
  });
  markControls = [];
}

// Оборачивает диапазон внутри текстового узла в спаны с жёлтым фоном.
function wrapRange(textNode, start, end) {
  const parent = textNode.parentNode;
  if (!parent || end <= start) return;

  const before = textNode.splitText(start);
  const mid = before.splitText(end - start);

  const span = textNode.ownerDocument.createElement("span");
  span.setAttribute(MARK_ATTR, "");
  span.style.backgroundColor = MARK_BG;
  parent.insertBefore(span, mid);
  span.appendChild(mid);
  markSpans.push(span);
}

// Отметить вхождения find внутри contenteditable (по текстовым узлам).
function markContentEditable(el, find, caseSensitive) {
  const re = new RegExp(escapeRegExp(find), caseSensitive ? "g" : "gi");
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const value = node.nodeValue;
    if (!value) continue;
    const ranges = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(value)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex++;
    }
    for (let i = ranges.length - 1; i >= 0; i--) {
      wrapRange(node, ranges[i][0], ranges[i][1]);
    }
  }
}

// Отметить поле целиком (для input/textarea/select и точного совпадения).
function markElement(el) {
  const prev = el.style.backgroundColor;
  el.style.backgroundColor = MARK_BG;
  markControls.push({ el, prev });
}

// Отметить на странице совпадения всех активных правил
// (первое подходящее правило на поле, как при замене).
function markMatches(rules) {
  const enabled = activeRules(rules);
  collectFields().forEach((el) => {
    for (const rule of enabled) {
      const find = String(rule.find);
      if (!find) continue;
      const caseSensitive = isCaseSensitive(rule);
      const cur = fieldValue(el);
      if (cur == null) continue;
      const str = String(cur);

      const exact = rule.mode === "exact";
      const mCI = exact
        ? str.toUpperCase() === find.toUpperCase()
        : str.toUpperCase().includes(find.toUpperCase());
      if (!mCI) continue;

      if (el.isContentEditable && !exact) {
        markContentEditable(el, find, caseSensitive);
      } else {
        markElement(el);
      }
      break;
    }
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "KF_FIND") {
    try {
      clearMarks();
      const results = findRules(msg.rules);
      markMatches(msg.rules);
      sendResponse({ ok: true, results });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  } else if (msg.type === "KF_REPLACE") {
    try {
      clearMarks();
      const changed = applyRules(msg.rules, msg.targets);
      sendResponse({ ok: true, changed });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  } else if (msg.type === "KF_SHOW") {
    try {
      const fields = collectFields();
      const el = fields[msg.field];
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        flashField(el);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  }

  return false;
});
