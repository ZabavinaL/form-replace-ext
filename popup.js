const rulesEl = document.getElementById("rules");
const emptyEl = document.getElementById("empty");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const addBtn = document.getElementById("addRule");
const findBtn = document.getElementById("find");
const replaceBtn = document.getElementById("replace");
const clearBtn = document.getElementById("clear");

const STORAGE_KEY = "kfRules";
const MAX_VALUE_SHOWN = 8;

let rules = [];
// Плоский список найденных пунктов { els, resultIndex, field, cb } для текущих результатов.
let selectionPlan = [];

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

function renderFindResults(results) {
  resultsEl.innerHTML = "";
  resultsEl.hidden = false;
  selectionPlan = [];

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
        const li = document.createElement("li");
        li.className = "item-row";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "item-check";
        cb.title = "Отметить для замены";
        cb.addEventListener("change", updateReplaceLabel);
        selectionPlan.push({ cb, resultIndex, field: v.field });

        const text = document.createElement("span");
        text.className = "item-text";
        text.title = "Показать на странице";
        text.appendChild(highlightValue(v.text, v.matched));
        text.addEventListener("click", () => onShowField(v.field));

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "item-replace";
        btn.textContent = "Заменить";
        btn.title = "Заменить именно это значение";
        btn.addEventListener("click", () => onReplaceOne(resultIndex, v.field));

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

  replaceBtn.disabled = false;
  updateReplaceLabel();
  setStatus(`Найдено всего: ${total}`, "ok");
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
  b.textContent = text.slice(idx, idx + matched.length);
  frag.appendChild(b);
  frag.appendChild(document.createTextNode(text.slice(idx + matched.length)));
  return frag;
}

// Индикация количества отмеченных пунктов на кнопке «Заменить».
function updateReplaceLabel() {
  if (!selectionPlan.length) {
    replaceBtn.textContent = "Заменить";
    return;
  }
  const n = selectionPlan.filter((p) => p.cb.checked).length;
  replaceBtn.textContent = n ? `Заменить (${n})` : "Заменить";
}

// Показ найденного поля на странице (прокрутка + подсветка).
async function onShowField(field) {
  try {
    await sendToTab({ type: "KF_SHOW", field });
  } catch (_err) {
    setStatus("Поле недоступно", "err");
  }
}

// Замена одного конкретного пункта.
async function onReplaceOne(resultIndex, field) {
  const active = activeRules();
  if (!active.length) return;
  setStatus("Применяю...");
  try {
    const res = await sendToTab({
      type: "KF_REPLACE",
      rules: active,
      targets: [{ rule: resultIndex, field }],
    });
    if (res && res.ok) {
      setStatus(`Готово: заменено полей — ${res.changed}`, "ok");
      await onFind();
    } else {
      setStatus(res && res.error ? res.error : "Не удалось применить", "err");
    }
  } catch (_err2) {
    setStatus("Перезагрузи страницу и попробуй снова (нет доступа)", "err");
  }
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
  const active = activeRules();
  if (!active.length) {
    setStatus("Нет активных правил", "err");
    return;
  }

  const checked = selectionPlan.filter((p) => p.cb.checked);
  const targets = checked.map((p) => ({ rule: p.resultIndex, field: p.field }));

  setStatus("Применяю...");
  try {
    const payload = { type: "KF_REPLACE", rules: active };
    if (targets.length) payload.targets = targets;
    const res = await sendToTab(payload);
    if (res && res.ok) {
      setStatus(`Готово: изменено полей — ${res.changed}`, "ok");
    } else {
      setStatus(
        res && res.error ? res.error : "Не удалось применить",
        "err"
      );
    }
  } catch (_err2) {
    setStatus("Перезагрузи страницу и попробуй снова (нет доступа)", "err");
  }
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

clearBtn.addEventListener("click", async () => {
  rules = [];
  await saveRules();
  render();
  resultsEl.hidden = true;
  replaceBtn.disabled = true;
  updateReplaceLabel();
  setStatus("Все правила удалены");
});

loadRules();
