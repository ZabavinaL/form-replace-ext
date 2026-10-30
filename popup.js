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

  let total = 0;
  results.forEach((r) => {
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

    if (r.samples.length) {
      const ul = document.createElement("ul");
      r.samples.forEach((v) => {
        const li = document.createElement("li");
        li.textContent = v;
        ul.appendChild(li);
      });
      card.appendChild(ul);
      if (r.countCaseInsensitive > r.samples.length) {
        const more = document.createElement("div");
        more.className = "more";
        more.textContent = `...и ещё ${r.countCaseInsensitive - r.samples.length}`;
        card.appendChild(more);
      }
    }

    resultsEl.appendChild(card);
    total += r.countCaseInsensitive;
  });

  replaceBtn.disabled = false;
  setStatus(`Найдено всего: ${total}`, "ok");
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
      setStatus(res && res.error ? res.error : "Не удалось найти", "err");
    }
  } catch (_err2) {
    replaceBtn.disabled = true;
    setStatus("Перезагрузи страницу и попробуй снова (нет доступа)", "err");
  }
}

async function onReplace() {
  const active = activeRules();
  if (!active.length) {
    setStatus("Нет активных правил", "err");
    return;
  }

  setStatus("Применяю...");
  try {
    const res = await sendToTab({ type: "KF_REPLACE", rules: active });
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
  setStatus("Все правила удалены");
});

loadRules();
