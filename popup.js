const rulesEl = document.getElementById("rules");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const addBtn = document.getElementById("addRule");
const applyBtn = document.getElementById("apply");
const clearBtn = document.getElementById("clear");

const STORAGE_KEY = "kfRules";

let rules = [];

async function loadRules() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  rules = data[STORAGE_KEY] || [];
  render();
}

async function saveRules() {
  await chrome.storage.local.set({ [STORAGE_KEY]: rules });
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
    caseCheck.checked = rule.caseSensitive !== false;
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

async function applyRulesToTab() {
  const activeRules = rules.filter(
    (r) => r.enabled !== false && String(r.find).trim().length > 0
  );

  if (!activeRules.length) {
    setStatus("Нет активных правил", "err");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus("Вкладка недоступна", "err");
    return;
  }

  setStatus("Применяю...");

  const payload = { type: "KF_REPLACE", rules: activeRules };
  const apply = async () => {
    const res = await chrome.tabs.sendMessage(tab.id, payload);
    if (res && res.ok) {
      setStatus(`Готово: изменено полей — ${res.changed}`, "ok");
    } else {
      setStatus(
        res && res.error ? res.error : "Не удалось применить",
        "err"
      );
    }
  };

  try {
    await apply();
  } catch (_err) {
    // Страница открыта до установки/обновления расширения, и content script
    // в ней ещё не загружен. Внедряем его на лету и повторяем применение.
    try {
      setStatus("Внедряю скрипт...");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await apply();
    } catch (_err2) {
      setStatus(
        "Перезагрузи страницу и попробуй снова (нет доступа)",
        "err"
      );
    }
  }
}

addBtn.addEventListener("click", () => {
  rules.push({
    find: "",
    replace: "",
    mode: "part",
    enabled: true,
    caseSensitive: true,
  });
  saveRules();
  render();
});

applyBtn.addEventListener("click", applyRulesToTab);

clearBtn.addEventListener("click", async () => {
  rules = [];
  await saveRules();
  render();
  setStatus("Все правила удалены");
});

loadRules();
