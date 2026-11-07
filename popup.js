const rulesEl = document.getElementById("rules");
const emptyEl = document.getElementById("empty");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const addBtn = document.getElementById("addRule");
const undoBtn = document.getElementById("undo");
const undoMenu = document.getElementById("undoMenu");
const findBtn = document.getElementById("find");
const replaceBtn = document.getElementById("replace");
const replaceAllBtn = document.getElementById("replaceAll");
const clearBtn = document.getElementById("clear");

const STORAGE_KEY = "kfRules";
const MAX_VALUE_SHOWN = 8;

let rules = [];
// Плоский список найденных пунктов { els, resultIndex, field, cb } для текущих результатов.
let selectionPlan = [];
// Группированные блоки списков (строки ol/ul) для текущих результатов.
let groups = [];
// Чекбокс «Выбрать все» в шапке результатов.
let selectAllCb = null;

async function loadRules() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  rules = data[STORAGE_KEY] || [];
  render();
}

async function saveRules() {
  await chrome.storage.local.set({ [STORAGE_KEY]: rules });
}

function activeRules() {
  return rules.filter(
    (r) => r.enabled !== false && String(r.find).trim().length > 0
  );
}

function render() {
  rulesEl.innerHTML = "";
  emptyEl.style.display = rules.length ? "none" : "block";

  rules.forEach((rule, idx) => {
    const row = document.createElement("div");
    row.className = "rule" + (rule.enabled === false ? " off" : "");

    const top = document.createElement("div");
    top.className = "rule-row";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = rule.enabled !== false;
    enabled.title = "Активно";
    enabled.addEventListener("change", () => {
      rule.enabled = enabled.checked;
      saveRules();
      render();
    });

    const findInput = document.createElement("input");
    findInput.type = "text";
    findInput.placeholder = "Найти...";
    findInput.value = rule.find || "";
    findInput.addEventListener("input", () => {
      rule.find = findInput.value;
      saveRules();
    });

    const replaceInput = document.createElement("input");
    replaceInput.type = "text";
    replaceInput.placeholder = "Заменить на...";
    replaceInput.value = rule.replace || "";
    replaceInput.addEventListener("input", () => {
      rule.replace = replaceInput.value;
      saveRules();
    });

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.title = "Удалить правило";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      rules.splice(idx, 1);
      saveRules();
      render();
    });

    top.append(enabled, findInput, replaceInput, remove);

    const bottom = document.createElement("div");
    bottom.className = "rule-bottom";

    const modeSelect = document.createElement("select");
    const optExact = document.createElement("option");
    optExact.value = "exact";
    optExact.textContent = "Точное совпадение";
    const optPart = document.createElement("option");
    optPart.value = "part";
    optPart.textContent = "Часть значения";
    modeSelect.append(optExact, optPart);
    modeSelect.value = rule.mode === "exact" ? "exact" : "part";
    modeSelect.addEventListener("change", () => {
      rule.mode = modeSelect.value;
      saveRules();
    });

    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Режим:";
    modeLabel.append(modeSelect);
    bottom.append(modeLabel);

    const caseLabel = document.createElement("label");
    const caseCheck = document.createElement("input");
    caseCheck.type = "checkbox";
    // По умолчанию регистр НЕ учитывается.
    caseCheck.checked = rule.caseSensitive === true;
    caseCheck.addEventListener("change", () => {
      rule.caseSensitive = caseCheck.checked;
      saveRules();
    });
    const caseText = document.createElement("span");
    caseText.textContent = "Учитывать регистр";
    caseLabel.append(caseCheck, caseText);
    bottom.append(caseLabel);

    row.append(top, bottom);
    rulesEl.appendChild(row);
  });
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function modeLabel(mode) {
  return mode === "exact" ? "полное совпадение" : "часть значения";
}

// Подгоняет регистр подстановки под регистр найденного фрагмента (как в content.js).
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

function renderFindResults(results) {
  resultsEl.innerHTML = "";
  resultsEl.hidden = false;
  selectionPlan = [];
  groups = [];

  const selectRow = document.createElement("label");
  selectRow.className = "select-all";
  selectAllCb = document.createElement("input");
  selectAllCb.type = "checkbox";
  selectAllCb.className = "select-all-check";
  selectAllCb.title = "Отметить все найденные записи";
  selectAllCb.addEventListener("change", () => {
    const checked = selectAllCb.checked;
    selectionPlan.forEach((p) => {
      p.cb.checked = checked;
    });
    updateReplaceLabel();
  });
  const selectAllText = document.createElement("span");
  selectAllText.textContent = "Выбрать все";
  selectRow.append(selectAllCb, selectAllText);
  resultsEl.appendChild(selectRow);

  let total = 0;
  results.forEach((r, resultIndex) => {
    const card = document.createElement("div");
    card.className = "result";

    const head = document.createElement("div");
    head.className = "head";
    head.textContent = `«${r.find}» → «${r.replace}» (${modeLabel(r.mode)})`;
    card.appendChild(head);

    const counts = document.createElement("div");
    counts.className = "counts";
    const cs = document.createElement("span");
    cs.textContent = `С учётом регистра: ${r.countCaseSensitive}`;
    const ci = document.createElement("span");
    ci.textContent = `Без учёта регистра: ${r.countCaseInsensitive}`;
    counts.append(cs, ci);
    card.appendChild(counts);

    if (r.items.length) {
      const ul = document.createElement("ul");
      r.items.forEach((v) => {
        // Значение найдено в нескольких строках списка — единый групповой блок.
        if (v.group) {
          renderGroup(card, v, resultIndex, r.find, r.replace);
          return;
        }

        const li = document.createElement("li");
        li.className = "item-row";

        const entry = {
          resultIndex,
          field: v.field,
          replace: r.replace,
          matched: v.matched,
          replaced: false,
          cb: null,
          matchEl: null,
          btn: null,
          textEl: null,
          text: v.text,
        };

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "item-check";
        cb.title = "Отметить для замены";
        cb.addEventListener("change", () => {
          updateReplaceLabel();
          syncSelectAll();
        });
        entry.cb = cb;
        selectionPlan.push(entry);

        const text = document.createElement("span");
        text.className = "item-text";
        text.title = "Показать на странице";
        const frag = highlightValue(v.text, v.matched);
        entry.matchEl = frag.querySelector("b.match") || null;
        text.appendChild(frag);
        entry.textEl = text;
        text.addEventListener("click", () => onShowField(v.field));

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "item-replace";
        btn.textContent = "Заменить";
        btn.title = "Заменить именно это значение";
        btn.addEventListener("click", () => performReplace([entry]));
        entry.btn = btn;

        li.append(cb, text, btn);
        ul.appendChild(li);
      });
      card.appendChild(ul);
      if (r.countCaseInsensitive > r.items.length) {
        const more = document.createElement("div");
        more.className = "more";
        more.textContent = `...и ещё ${r.countCaseInsensitive - r.items.length}`;
        card.appendChild(more);
      }
    }

    resultsEl.appendChild(card);
    total += r.countCaseInsensitive;
  });

  updateReplaceLabel();
  setStatus(`Найдено всего: ${total}`, "ok");
}

// Поддерживает состояние чекбокса «Выбрать все» в актуальном виде.
function syncSelectAll() {
  if (!selectAllCb || !selectionPlan.length) {
    if (selectAllCb) selectAllCb.checked = false;
    return;
  }
  selectAllCb.checked = selectionPlan.every((p) => p.cb.checked);
}

// Выделяет найденный фрагмент жирным внутри текста значения.
function highlightValue(text, matched) {
  const frag = document.createDocumentFragment();
  if (!matched) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  const idx = text.toUpperCase().indexOf(matched.toUpperCase());
  if (idx < 0) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  frag.appendChild(document.createTextNode(text.slice(0, idx)));
  const b = document.createElement("b");
  b.className = "match";
  b.textContent = text.slice(idx, idx + matched.length);
  frag.appendChild(b);
  frag.appendChild(document.createTextNode(text.slice(idx + matched.length)));
  return frag;
}

// Индикация количества отмеченных пунктов и доступности кнопок замены.
function updateReplaceLabel() {
  const hasNorm = selectionPlan.some((p) => !p.replaced);
  const hasGroup = groups.some(
    (g) => !g.replaced && g.rowData.some((rd) => !rd.replaced)
  );
  replaceAllBtn.disabled = !(hasNorm || hasGroup);
  let n = selectionPlan.filter((p) => !p.replaced && p.cb.checked).length;
  // Плюс отмеченные строки списков (в развёрнутых группах).
  groups.forEach((g) => {
    if (g.expanded) {
      n += g.rowData.filter((rd) => !rd.replaced && rd.cb.checked).length;
    }
  });
  replaceBtn.textContent = n
    ? `Заменить выбранные (${n})`
    : "Заменить выбранные";
  // «Заменить выбранные» активна только если есть отмеченные пункты.
  replaceBtn.disabled = n === 0;
}

// Показ найденного поля на странице (прокрутка + подсветка).
async function onShowField(field) {
  try {
    await sendToTab({ type: "KF_SHOW", field });
  } catch (_err) {
    setStatus("Поле недоступно", "err");
  }
}

// Применить замену к заданным пунктам и пометить их зелёным.
async function performReplace(entries) {
  const active = activeRules();
  if (!active.length) {
    setStatus("Нет активных правил", "err");
    return;
  }
  const targets = entries.map((p) => ({ rule: p.resultIndex, field: p.field }));
  setStatus("Применяю...");
  try {
    const res = await sendToTab({ type: "KF_REPLACE", rules: active, targets });
    if (res && res.ok) {
      entries.forEach(markReplaced);
      updateReplaceLabel();
      setStatus(`Готово: изменено полей — ${res.changed}`, "ok");
    } else {
      setStatus(res && res.error ? res.error : "Не удалось применить", "err");
    }
  } catch (_err) {
    setStatus("Перезагрузи страницу и попробуй снова (нет доступа)", "err");
  }
}

// Показать заменённый пункт зелёным и заблокировать его замену.
function markReplaced(p) {
  if (p.replaced) return;
  p.replaced = true;
  if (p.cb) p.cb.disabled = true;
  if (p.matchEl && p.matchEl.parentNode) {
    const b = document.createElement("b");
    b.className = "replaced";
    b.textContent = matchCase(p.matched, p.replace);
    p.matchEl.replaceWith(b);
  }
  if (p.btn) p.btn.disabled = true;
}

// Вернуть пункт к состоянию «найдено» (после отмены замены).
function unmarkReplaced(p) {
  if (!p.replaced) return;
  p.replaced = false;
  p.matchEl = null;
  if (p.textEl) {
    p.textEl.innerHTML = "";
    p.textEl.appendChild(highlightValue(p.text, p.matched));
    p.matchEl = p.textEl.querySelector("b.match") || null;
  }
  if (p.cb) {
    p.cb.disabled = false;
    p.cb.checked = false;
  }
  if (p.btn) p.btn.disabled = false;
}

// Общий блок для случая, когда значение найдено в нескольких строках списка.
function renderGroup(container, v, resultIndex, find, replace) {
  const block = document.createElement("div");
  block.className = "group-block";
  block.title = "Найдено в разных строках одного списка";

  const head = document.createElement("div");
  head.className = "group-head";

  const summary = document.createElement("span");
  summary.className = "group-summary";
  summary.title = "Найдено в разных строках одного списка";
  summary.appendChild(document.createTextNode("«"));
  const findEl = document.createElement("b");
  findEl.className = "group-find";
  findEl.textContent = find;
  summary.appendChild(findEl);
  summary.appendChild(
    document.createTextNode(`» — ${v.rows.length} строк списка`)
  );
  head.appendChild(summary);

  const selectBtn = document.createElement("button");
  selectBtn.type = "button";
  selectBtn.className = "group-select";
  selectBtn.textContent = "Выбрать для замены";
  head.appendChild(selectBtn);

  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.className = "group-replace";
  replaceBtn.textContent = "Заменить";
  head.appendChild(replaceBtn);

  block.appendChild(head);

  const rowsEl = document.createElement("ul");
  rowsEl.className = "group-rows";
  rowsEl.hidden = true;
  block.appendChild(rowsEl);

  container.appendChild(block);

  const rowData = v.rows.map((row) => {
    const li = document.createElement("li");
    li.className = "group-row-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "group-row-check";
    const span = document.createElement("span");
    span.className = "group-row-text";
    const frag = highlightValue(row.text, row.matched);
    const matchEl = frag.querySelector("b.match") || null;
    span.appendChild(frag);
    span.title = "Показать поле на странице";
    span.addEventListener("click", (e) => {
      if (!e.target.closest(".group-row-check")) onShowField(v.field);
    });
    li.append(cb, span);
    rowsEl.appendChild(li);
    return {
      cb,
      span,
      matchEl,
      index: row.row,
      text: row.text,
      matched: row.matched,
      replaced: false,
    };
  });

  const entry = {
    v,
    resultIndex,
    find,
    replace,
    rowData,
    selectBtn,
    replaceBtn,
    rowsEl,
    summary,
    replaced: false,
    expanded: false,
  };
  groups.push(entry);

  // Раскрытие/скрытие всех значений списка (и по сводке, и по кнопке).
  const toggleExpand = () => {
    entry.expanded = !entry.expanded;
    rowsEl.hidden = !entry.expanded;
    updateGroupLabel(entry);
  };
  summary.addEventListener("click", toggleExpand);
  selectBtn.addEventListener("click", toggleExpand);

  rowData.forEach((rd) => {
    rd.cb.addEventListener("change", () => updateGroupLabel(entry));
  });

  replaceBtn.addEventListener("click", () => {
    let indexes = rowData
      .filter((rd) => !rd.replaced && rd.cb.checked)
      .map((rd) => rd.index);
    // «Выбрать для замены» не открывали (или ничего не отметили) —
    // заменяются все строки по одной кнопке.
    if (!indexes.length) {
      indexes = rowData
        .filter((rd) => !rd.replaced)
        .map((rd) => rd.index);
    }
    if (!indexes.length) {
      setStatus("Нет строк для замены", "err");
      return;
    }
    performReplaceGroup(entry, indexes);
  });
}

function updateGroupLabel(entry) {
  const avail = entry.rowData.filter((rd) => !rd.replaced);
  const sel = avail.filter((rd) => rd.cb.checked).length;
  if (entry.expanded) {
    entry.selectBtn.textContent = "Скрыть выбор";
    entry.replaceBtn.textContent = sel ? `Заменить (${sel})` : "Заменить";
  } else {
    entry.selectBtn.textContent = "Выбрать для замены";
    entry.replaceBtn.textContent = "Заменить";
  }
  entry.replaceBtn.disabled = avail.length === 0;
}

async function performReplaceGroup(group, indexes) {
  const active = activeRules();
  if (!active.length) {
    setStatus("Нет активных правил", "err");
    return;
  }
  setStatus("Применяю...");
  try {
    const res = await sendToTab({
      type: "KF_REPLACE",
      rules: active,
      targets: [
        { rule: group.resultIndex, field: group.v.field, rows: indexes },
      ],
    });
    if (res && res.ok) {
      indexes.forEach((i) => markGroupRow(group, i));
      refreshGroupDone(group);
      updateReplaceLabel();
      setStatus(`Готово: изменено полей — ${res.changed}`, "ok");
    } else {
      setStatus(res && res.error ? res.error : "Не удалось применить", "err");
    }
  } catch (_e) {
    setStatus("Перезагрузи страницу и попробуй снова (нет доступа)", "err");
  }
}

function markGroupRow(group, idx) {
  const rd = group.rowData.find((r) => r.index === idx && !r.replaced);
  if (!rd) return;
  rd.replaced = true;
  rd.cb.disabled = true;
  if (rd.matchEl && rd.matchEl.parentNode) {
    const b = document.createElement("b");
    b.className = "replaced";
    b.textContent = matchCase(rd.matched, group.replace);
    rd.matchEl.replaceWith(b);
  }
}

function refreshGroupDone(group) {
  if (group.rowData.every((rd) => rd.replaced)) {
    group.replaced = true;
    group.selectBtn.disabled = true;
    group.replaceBtn.disabled = true;
    if (group.summary) group.summary.classList.add("replaced");
  } else {
    group.replaced = false;
    if (group.summary) group.summary.classList.remove("replaced");
    updateGroupLabel(group);
  }
}

// Вернуть группу к состоянию «найдено» (после отмены замены).
function unmarkGroup(group) {
  group.replaced = false;
  group.rowData.forEach((rd) => {
    rd.replaced = false;
    if (rd.cb) {
      rd.cb.disabled = false;
      rd.cb.checked = false;
    }
    if (rd.span) {
      rd.span.innerHTML = "";
      rd.span.appendChild(highlightValue(rd.text, rd.matched));
      rd.matchEl = rd.span.querySelector("b.match") || null;
    }
  });
  group.selectBtn.disabled = false;
  if (group.summary) group.summary.classList.remove("replaced");
  updateGroupLabel(group);
}

// Отправка сообщения в активную вкладку с повторным внедрением скрипта на лету.
async function sendToTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("Вкладка недоступна");

  const trySend = () => chrome.tabs.sendMessage(tab.id, payload);

  try {
    return await trySend();
  } catch (_err) {
    // Страница открыта до установки/обновления расширения, content script в ней
    // отсутствует — внедряем на лету и повторяем.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    return await trySend();
  }
}

async function onFind() {
  const active = activeRules();
  if (!active.length) {
    resultsEl.hidden = true;
    replaceBtn.disabled = true;
    selectionPlan = [];
    updateReplaceLabel();
    setStatus("Нет активных правил", "err");
    return;
  }

  setStatus("Ищу...");
  try {
    const res = await sendToTab({ type: "KF_FIND", rules: active });
    if (res && res.ok) {
      renderFindResults(res.results);
    } else {
      replaceBtn.disabled = true;
      selectionPlan = [];
      updateReplaceLabel();
      setStatus(res && res.error ? res.error : "Не удалось найти", "err");
    }
  } catch (_err2) {
    replaceBtn.disabled = true;
    selectionPlan = [];
    updateReplaceLabel();
    setStatus("Перезагрузи страницу и попробуй снова (нет доступа)", "err");
  }
}

async function onReplace() {
  const normal = selectionPlan.filter((p) => !p.replaced && p.cb.checked);
  const groupSel = [];
  groups.forEach((g) => {
    if (!g.expanded) return;
    const rows = g.rowData
      .filter((rd) => !rd.replaced && rd.cb.checked)
      .map((rd) => rd.index);
    if (rows.length) groupSel.push([g, rows]);
  });
  if (!normal.length && !groupSel.length) {
    setStatus("Нет выбранных значений", "err");
    return;
  }
  const active = activeRules();
  if (!active.length) {
    setStatus("Нет активных правил", "err");
    return;
  }
  const targets = normal.map((p) => ({ rule: p.resultIndex, field: p.field }));
  groupSel.forEach(([g, rows]) => {
    targets.push({ rule: g.resultIndex, field: g.v.field, rows });
  });
  setStatus("Применяю...");
  try {
    const res = await sendToTab({ type: "KF_REPLACE", rules: active, targets });
    if (res && res.ok) {
      normal.forEach(markReplaced);
      groupSel.forEach(([g, rows]) => {
        rows.forEach((i) => markGroupRow(g, i));
        refreshGroupDone(g);
      });
      updateReplaceLabel();
      setStatus(`Готово: изменено полей — ${res.changed}`, "ok");
    } else {
      setStatus(res && res.error ? res.error : "Не удалось применить", "err");
    }
  } catch (_e) {
    setStatus("Перезагрузи страницу и попробуй снова (нет доступа)", "err");
  }
}

// Заменить все найденные значения без выбора пунктов.
async function onReplaceAll() {
  const normal = selectionPlan.filter((p) => !p.replaced);
  const groupPairs = [];
  groups.forEach((g) => {
    if (g.replaced) return;
    const rows = g.rowData.filter((rd) => !rd.replaced).map((rd) => rd.index);
    if (rows.length) groupPairs.push([g, rows]);
  });
  if (!normal.length && !groupPairs.length) {
    setStatus("Нет найденных значений для замены", "err");
    return;
  }
  const active = activeRules();
  if (!active.length) {
    setStatus("Нет активных правил", "err");
    return;
  }
  const targets = normal.map((p) => ({ rule: p.resultIndex, field: p.field }));
  groupPairs.forEach(([g, rows]) => {
    targets.push({ rule: g.resultIndex, field: g.v.field, rows });
  });
  setStatus("Применяю...");
  try {
    const res = await sendToTab({ type: "KF_REPLACE", rules: active, targets });
    if (res && res.ok) {
      normal.forEach(markReplaced);
      groupPairs.forEach(([g, rows]) => {
        rows.forEach((i) => markGroupRow(g, i));
        refreshGroupDone(g);
      });
      updateReplaceLabel();
      setStatus(`Готово: изменено полей — ${res.changed}`, "ok");
    } else {
      setStatus(res && res.error ? res.error : "Не удалось применить", "err");
    }
  } catch (_e) {
    setStatus("Перезагрузи страницу и попробуй снова (нет доступа)", "err");
  }
}

// Отмена замены на странице: mode "last" — последняя, "all" — полностью.
async function onUndo(mode) {
  setStatus("Отменяю...");
  try {
    const res = await sendToTab({
      type: "KF_UNDO",
      undoAll: mode === "all",
    });
    if (res && res.ok) {
      if (res.changed > 0) {
        const fieldSet = new Set(res.fields || []);
        selectionPlan.forEach((p) => {
          if (fieldSet.has(p.field)) unmarkReplaced(p);
        });
        groups.forEach((g) => {
          if (fieldSet.has(g.v.field)) unmarkGroup(g);
        });
        updateReplaceLabel();
        setStatus(
          mode === "all"
            ? `Отменено всё: полей — ${res.changed}`
            : "Последняя замена отменена",
          "ok"
        );
      }
      else setStatus("Нечего отменять");
    } else {
      setStatus(res && res.error ? res.error : "Не удалось отменить", "err");
    }
  } catch (_err) {
    setStatus("Перезагрузи страницу и попробуй снова (нет доступа)", "err");
  }
}

// Полный сброс области результатов.
function resetResults() {
  selectionPlan = [];
  groups = [];
  selectAllCb = null;
  resultsEl.innerHTML = "";
  resultsEl.hidden = true;
  replaceBtn.disabled = true;
  updateReplaceLabel();
}

addBtn.addEventListener("click", () => {
  rules.push({
    find: "",
    replace: "",
    mode: "part",
    enabled: true,
    caseSensitive: false, // по умолчанию регистр не учитывается
  });
  saveRules();
  render();
});

findBtn.addEventListener("click", onFind);
replaceBtn.addEventListener("click", onReplace);
replaceAllBtn.addEventListener("click", onReplaceAll);

// Меню «Отменить»: открытие/скрытие и выбор действия.
undoBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  undoMenu.hidden = !undoMenu.hidden;
});

undoMenu.addEventListener("click", (e) => {
  const target = e.target.closest("[data-undo]");
  if (target) {
    undoMenu.hidden = true;
    onUndo(target.dataset.undo);
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".undo-wrap")) undoMenu.hidden = true;
});

clearBtn.addEventListener("click", async () => {
  rules = [];
  await saveRules();
  render();
  resetResults();
  setStatus("Все правила удалены");
});

loadRules();
