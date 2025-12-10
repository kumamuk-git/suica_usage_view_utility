(function () {
  const ROOT_ID = "suica-enhancer-root";
  if (document.getElementById(ROOT_ID)) return;

  const historyTable = document.querySelector(".historyTable table");
  if (!historyTable) return;

  const state = {
    entries: [],
    filtered: [],
    originalKeys: new Set(),
    filters: {
      dateFrom: null,
      dateTo: null,
      types: new Set(),
      keyword: "",
      hideOriginal: false,
      holidays: new Set()
    }
  };

  const dayChars = ["日", "月", "火", "水", "木", "金", "土"];

  // 開発者ツールの「Console」に必ず出す
  const log = (...args) => console.log("[suica-enhancer]", ...args);

  function text(node) {
    return (node?.textContent || "").trim();
  }

  function parseYearMonthFromSelect(select) {
    const value =
      select?.value ||
      select?.querySelector("option[selected]")?.value ||
      "";
    const parts = value.split("/");
    const now = new Date();
    return {
      year: Number(parts[0]) || now.getFullYear(),
      month: Number(parts[1]) || now.getMonth() + 1
    };
  }

  const { year: selectedYear, month: selectedMonth } = parseYearMonthFromSelect(
    document.querySelector('select[name="specifyYearMonth"]')
  );

  function parseMoney(raw) {
    const normalized = raw.replace(/[\\¥,\s]/g, "");
    if (!normalized) return null;
    const num = Number(normalized);
    return Number.isNaN(num) ? null : num;
  }

  function formatDate(d) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  function parseRow(checkbox) {
    const tr = checkbox.closest("tr");
    if (!tr) return null;
    const cells = tr.querySelectorAll("td");
    const rawDate = text(cells[1]);
    const [m, d] = rawDate.split("/").map(Number);
    if (!m || !d) return null;
    let year = selectedYear;
    if (m > selectedMonth) year = selectedYear - 1;
    const dateObj = new Date(year, m - 1, d);
    return {
      id: checkbox.value,
      rawDate,
      dateObj,
      ymd: formatDate(dateObj),
      dow: dayChars[dateObj.getDay()],
      dowIndex: dateObj.getDay(),
      type1: text(cells[2]),
      place1: text(cells[3]),
      type2: text(cells[4]),
      place2: text(cells[5]),
      balance: parseMoney(text(cells[6])),
      amount: parseMoney(text(cells[7])),
      tr
    };
  }

  function parseRowWithContext(checkbox, ctx) {
    const tr = checkbox.closest("tr");
    if (!tr) return null;
    const cells = tr.querySelectorAll("td");
    const rawDate = text(cells[1]);
    const [m, d] = rawDate.split("/").map(Number);
    if (!m || !d) return null;
    let year = ctx.year;
    if (m > ctx.month) year = ctx.year - 1;
    const dateObj = new Date(year, m - 1, d);
    return {
      id: checkbox.value,
      rawDate,
      dateObj,
      ymd: formatDate(dateObj),
      dow: dayChars[dateObj.getDay()],
      dowIndex: dateObj.getDay(),
      type1: text(cells[2]),
      place1: text(cells[3]),
      type2: text(cells[4]),
      place2: text(cells[5]),
      balance: parseMoney(text(cells[6])),
      amount: parseMoney(text(cells[7])),
      tr: null
    };
  }

  function collectEntries() {
    const checkboxes = historyTable.querySelectorAll('input[name="printCheck"]');
    const entries = [];
    checkboxes.forEach((cb) => {
      const parsed = parseRow(cb);
      if (parsed) entries.push(parsed);
    });
    return entries;
  }

  function parseHolidays(raw) {
    const set = new Set();
    raw
      .split(/[,、\s\n]+/)
      .map((v) => v.trim())
      .filter(Boolean)
      .forEach((token) => {
        const d = new Date(token);
        if (!Number.isNaN(d.getTime())) {
          set.add(formatDate(d));
        }
      });
    return set;
  }

  function parseDoc(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, "text/html");
  }

  function parseEntriesFromDoc(doc) {
    const table = doc.querySelector(".historyTable table");
    if (!table) {
      log("parseEntriesFromDoc: table not found");
      return [];
    }
    const select = doc.querySelector('select[name="specifyYearMonth"]');
    const { year, month } = parseYearMonthFromSelect(select);
    const checkboxes = table.querySelectorAll('input[name="printCheck"]');
    const entries = [];
    checkboxes.forEach((cb) => {
      const parsed = parseRowWithContext(cb, { year, month });
      if (parsed) entries.push(parsed);
    });
    log(
      "parseEntriesFromDoc: parsed entries",
      entries.length,
      "year/month",
      year,
      month
    );
    return entries;
  }

  function ymToNumber(year, month) {
    return year * 100 + month;
  }

  function getYearMonthOptions(docRef = document) {
    const select = docRef.querySelector('select[name="specifyYearMonth"]');
    if (!select) return [];
    const opts = Array.from(select.querySelectorAll("option")).map((o) => {
      const { year, month } = parseYearMonthFromSelect({ value: o.value });
      return { value: o.value, year, month };
    });
    return opts.sort(
      (a, b) => ymToNumber(b.year, b.month) - ymToNumber(a.year, a.month)
    );
  }

  function findOptionForDate(date, options) {
    const ym = ymToNumber(date.getFullYear(), date.getMonth() + 1);
    // options を降順で想定。対象年月以下で最初にヒットしたものを使う
    for (const opt of options) {
      if (ymToNumber(opt.year, opt.month) <= ym) {
        return opt;
      }
    }
    return options[options.length - 1] || null;
  }

  const normalizeField = (s) => (s || "").replace(/\s+/g, "");

  function parseInputDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function mergeEntries(newEntries) {
    const key = (e) =>
      `${e.ymd}|${normalizeField(e.type1)}|${normalizeField(e.place1)}|${normalizeField(
        e.type2
      )}|${normalizeField(e.place2)}|${e.amount}|${e.balance}`;
    const existing = new Set(state.entries.map(key));
    let added = 0;
    const addedEntries = [];
    newEntries.forEach((e) => {
      const k = key(e);
      if (!existing.has(k)) {
        existing.add(k);
        state.entries.push(e);
        added += 1;
        addedEntries.push(e);
      }
    });
    log("mergeEntries: added", added, "total", state.entries.length);
    return addedEntries;
  }

  function getEarliestDate(entries) {
    return new Date(
      Math.min.apply(
        null,
        entries.map((e) => e.dateObj.getTime())
      )
    );
  }

  function applyFilters() {
    const { dateFrom, dateTo, types, keyword, holidays } = state.filters;
    const filtered = state.entries.filter((e) => {
      if (dateFrom && e.dateObj < dateFrom) return false;
      if (dateTo && e.dateObj > dateTo) return false;
      if (types.size > 0) {
        const hasType =
          (e.type1 && types.has(e.type1)) || (e.type2 && types.has(e.type2));
        if (!hasType) return false;
      }
      if (keyword) {
        const hit =
          e.place1.includes(keyword) ||
          e.place2.includes(keyword) ||
          e.type1.includes(keyword) ||
          e.type2.includes(keyword);
        if (!hit) return false;
      }
      e.isHoliday = holidays.has(e.ymd);
      return true;
    });
    state.filtered = filtered;
    render();
  }

  function createLegend() {
    const legend = document.createElement("div");
    legend.className = "se-legend";
    legend.innerHTML = `
      <span class="se-chip se-sun">日</span>
      <span class="se-chip se-sat">土</span>
      <span class="se-chip se-weekday">平日</span>
      <span class="se-chip se-holiday">祝日指定</span>
      <span class="se-chip se-plus">入金</span>
      <span class="se-chip se-minus">利用</span>
    `;
    return legend;
  }

  function buildControls(types) {
    const wrapper = document.createElement("div");
    wrapper.className = "se-controls";

    const dates = state.entries.map((e) => e.dateObj.getTime());
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    state.filters.dateFrom = minDate;
    state.filters.dateTo = maxDate;

    const typeList = Array.from(types).sort();

    wrapper.innerHTML = `
      <div class="se-row">
        <label>開始日 <input id="se-date-from" type="date" value="${formatDate(
          minDate
        )}"></label>
        <label>終了日 <input id="se-date-to" type="date" value="${formatDate(
          maxDate
        )}"></label>
        <label><input id="se-hide-original" type="checkbox"> 元テーブルを隠す</label>
      </div>
      <div class="se-row se-types" id="se-type-filters"></div>
      <div class="se-row">
        <label>駅・場所フィルター <input id="se-keyword" type="text" placeholder="例: 品川 / 物販"></label>
        <label>祝日（YYYY-MM-DDをカンマ区切り）<input id="se-holiday" type="text" placeholder="2025-01-01,2025-02-11"></label>
      </div>
      <div class="se-row se-actions">
        <button id="se-apply" type="button">フィルター適用</button>
        <button id="se-reset" type="button">リセット</button>
        <button id="se-export" type="button">CSVエクスポート</button>
        <div id="se-summary" class="se-summary"></div>
        <div id="se-fetch-status" class="se-status"></div>
      </div>
    `;

    const typeContainer = wrapper.querySelector("#se-type-filters");
    typeList.forEach((t) => {
      const id = `se-type-${t}`;
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" id="${id}" data-type="${t}" checked> ${t}`;
      typeContainer.appendChild(label);
      state.filters.types.add(t);
    });

    wrapper.appendChild(createLegend());
    return wrapper;
  }

  function formatAmount(val) {
    if (val === null || val === undefined) return "";
    return val.toLocaleString("ja-JP");
  }

  function formatAmountWithSign(val) {
    if (val === null || val === undefined) return "";
    const abs = Math.abs(val).toLocaleString("ja-JP");
    if (val > 0) return `+${abs}`;
    if (val < 0) return `-${abs}`;
    return abs;
  }

  function appendEntriesToOriginalTable(entries) {
    if (!historyTable) return;
    const tbody = historyTable.querySelector("tbody") || historyTable;
    entries.forEach((e, idx) => {
      const key = `${e.ymd}|${normalizeField(e.type1)}|${normalizeField(
        e.place1
      )}|${normalizeField(e.type2)}|${normalizeField(e.place2)}|${e.amount}|${e.balance}`;
      if (state.originalKeys.has(key)) return;
      state.originalKeys.add(key);
      const tr = document.createElement("tr");
      tr.setAttribute("data-se-appended", "1");
      tr.innerHTML = `
        <td class="whtbg check" align="center"></td>
        <td class="whtbg" align="center"><font class="sentence">${e.ymd.slice(5).replace("-", "/")}</font></td>
        <td class="whtbg" align="center"><font class="sentence">${e.type1 || ""}</font></td>
        <td class="whtbg" align="center"><font class="sentence">${e.place1 || ""}</font></td>
        <td class="whtbg" align="center"><font class="sentence">${e.type2 || ""}</font></td>
        <td class="whtbg" align="center"><font class="sentence">${e.place2 || ""}</font></td>
        <td class="whtbg MoneyText" align="right"><font class="list_title">\\${formatAmount(e.balance) || ""}</font></td>
        <td class="whtbg MoneyText" align="right"><font class="list_title">${formatAmountWithSign(e.amount) || ""}</font></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderTableBody(tbody) {
    tbody.innerHTML = "";
    let weekdayToggle = false;
    let lastWeekdayDate = null;
    state.filtered.forEach((e) => {
      const tr = document.createElement("tr");
      const dayClass = e.isHoliday
        ? "se-holiday"
        : e.dowIndex === 0
        ? "se-sun"
        : e.dowIndex === 6
        ? "se-sat"
        : "se-weekday";
      const isWeekday = dayClass === "se-weekday";
      if (isWeekday) {
        if (e.ymd !== lastWeekdayDate) {
          weekdayToggle = !weekdayToggle;
          lastWeekdayDate = e.ymd;
        }
      }
      const rowClass = isWeekday && weekdayToggle ? `${dayClass} se-alt` : dayClass;
      tr.className = rowClass;
      const amountClass =
        e.amount === null
          ? ""
          : e.amount >= 0
          ? "se-plus"
          : "se-minus";
      tr.innerHTML = `
        <td>${e.ymd} (${e.dow})</td>
        <td>${e.type1}</td>
        <td>${e.place1}</td>
        <td>${e.type2}</td>
        <td>${e.place2}</td>
        <td class="se-num">${formatAmount(e.balance)}</td>
        <td class="se-num ${amountClass}">${formatAmount(e.amount)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderSummary() {
    const summary = document.getElementById("se-summary");
    if (!summary) return;
    const count = state.filtered.length;
    const total = state.entries.length;
    const amounts = state.filtered.map((e) => e.amount || 0);
    const charge = amounts.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const spend = amounts.filter((v) => v < 0).reduce((a, b) => a + b, 0);
    summary.textContent = `表示 ${count} / ${total} 件　利用額: ${spend.toLocaleString(
      "ja-JP"
    )} 円　チャージ額: ${charge.toLocaleString("ja-JP")} 円`;
  }

  function render() {
    const tbody = document.querySelector("#se-table-body");
    if (!tbody) return;
    renderTableBody(tbody);
    renderSummary();
  }

  function exportCsv(filtered) {
    const header = ["日付", "種別1", "場所1", "種別2", "場所2", "残高", "入金・利用額"];
    const rows = filtered.map((e) => [
      e.ymd,
      e.type1,
      e.place1,
      e.type2,
      e.place2,
      e.balance ?? "",
      e.amount ?? ""
    ]);
    const esc = (v) => {
      const s = String(v ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    a.download = `suica_usage_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function fetchHolidaysAndSet() {
    const holidayInput = document.querySelector("#se-holiday");
    const status = document.querySelector("#se-fetch-status");
    const setError = (msg) => {
      if (status) status.textContent = msg;
      console.error("[suica-enhancer] holiday fetch error:", msg);
    };
    try {
      const url =
        "https://holidays-jp.github.io/api/v1/date.json"; // 祝日JSON（日本の祝日API）
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const holidays = new Set(Object.keys(data));
      state.filters.holidays = holidays;
      if (holidayInput) holidayInput.value = Array.from(holidays).sort().join(",");
      applyFilters();
      if (status) status.textContent = "祝日読み込み成功";
    } catch (e) {
      setError(`祝日取得失敗: ${e.message}`);
    }
  }

  function init() {
    state.entries = collectEntries();
    // 元テーブルのエントリキーを記録（重複追記防止）
    state.entries.forEach((e) => {
      const k = `${e.ymd}|${normalizeField(e.type1)}|${normalizeField(e.place1)}|${normalizeField(
        e.type2
      )}|${normalizeField(e.place2)}|${e.amount}|${e.balance}`;
      state.originalKeys.add(k);
    });
    if (state.entries.length === 0) return;
    state.filtered = [...state.entries];

    const typeSet = new Set();
    state.entries.forEach((e) => {
      if (e.type1) typeSet.add(e.type1);
      if (e.type2) typeSet.add(e.type2);
    });

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "se-root";
    root.innerHTML = `
      <div class="se-header">
        <h3>Suica利用履歴ビュー（拡張）</h3>
        <p class="se-note">日付範囲・種別・場所フィルター、休日色分け、元テーブル表示切替ができます。</p>
      </div>
    `;
    const controls = buildControls(typeSet);
    root.appendChild(controls);
    const tableWrap = document.createElement("div");
    tableWrap.className = "se-table-wrap";
    tableWrap.innerHTML = `
      <table class="se-table">
        <thead>
          <tr>
            <th>日付</th>
            <th>種別1</th>
            <th>場所1</th>
            <th>種別2</th>
            <th>場所2</th>
            <th>残高</th>
            <th>入金・利用額</th>
          </tr>
        </thead>
        <tbody id="se-table-body"></tbody>
      </table>
    `;
    root.appendChild(tableWrap);

    const target = document.querySelector(".historyBox");
    (target?.parentElement || document.body).insertBefore(root, target);

    const dateFromInput = root.querySelector("#se-date-from");
    const dateToInput = root.querySelector("#se-date-to");
    const keywordInput = root.querySelector("#se-keyword");
    const hideOriginalInput = root.querySelector("#se-hide-original");
    const holidayInput = root.querySelector("#se-holiday");
    const applyBtn = root.querySelector("#se-apply");
    const resetBtn = root.querySelector("#se-reset");
    const exportBtn = root.querySelector("#se-export");
    const disablePrintBtn = document.querySelector('button[name="PRINT"]');
    if (disablePrintBtn) {
      disablePrintBtn.disabled = true;
      disablePrintBtn.title = "拡張で追加した行はサーバ印刷と互換がないため無効化しています";
    }

    dateFromInput.addEventListener("change", () => {
      state.filters.dateFrom = dateFromInput.value
        ? parseInputDate(dateFromInput.value)
        : null;
      fetchUntilCovered();
    });
    dateToInput.addEventListener("change", () => {
      state.filters.dateTo = dateToInput.value
        ? parseInputDate(dateToInput.value)
        : null;
    });
    keywordInput.addEventListener("input", () => {
      state.filters.keyword = keywordInput.value.trim();
    });
    hideOriginalInput.addEventListener("change", () => {
      const box = document.querySelector(".historyBox");
      if (box) box.style.display = hideOriginalInput.checked ? "none" : "";
    });
    holidayInput.addEventListener("change", () => {
      state.filters.holidays = parseHolidays(holidayInput.value);
    });

    root.querySelectorAll("#se-type-filters input[type='checkbox']").forEach((cb) => {
      cb.addEventListener("change", () => {
        const type = cb.dataset.type;
        if (!type) return;
        if (cb.checked) {
          state.filters.types.add(type);
        } else {
          state.filters.types.delete(type);
        }
      });
    });

    applyBtn.addEventListener("click", () => {
      applyFilters();
    });

    const fetchBtn = null;
    const fetchStatus = root.querySelector("#se-fetch-status");
    let isFetching = false;
    // 祝日自動取得ボタン追加
    // 初期表示時に祝日自動取得
    fetchHolidaysAndSet();

    async function fetchUntilCovered() {
      if (isFetching) return;
      isFetching = true;
      const targetStart = state.filters.dateFrom;
      const targetEnd = state.filters.dateTo || state.filters.dateFrom;
      if (!targetEnd) {
        if (fetchStatus) fetchStatus.textContent = "開始日または終了日を設定してください。";
        isFetching = false;
        return;
      }
      if (fetchStatus) fetchStatus.textContent = "追加取得中...";
      const formEl = document.forms[0];
      if (!formEl) {
        if (fetchStatus) fetchStatus.textContent = "フォームが見つかりません。";
        isFetching = false;
        return;
      }

      const runLoop = async (direction) => {
        let currentDoc = document;
        let options = getYearMonthOptions(currentDoc);
        let cursor = direction === "older" ? new Date(targetEnd) : new Date(targetStart || targetEnd);
        let fetched = 0;
        const visited = new Set();
        const maxLoop = options.length + 6;
        for (let i = 0; i < maxLoop; i++) {
          if (direction === "older" && targetStart && cursor < targetStart) break;
          if (direction === "newer" && cursor > targetEnd) break;
          if (direction === "newer" && targetStart && cursor < targetStart) break;
          const cursorKey = cursor.toISOString().slice(0, 10);
          if (visited.has(cursorKey)) {
            log(`fetch ${direction} stop: cursor repeated ${cursorKey}`);
            break;
          }
          visited.add(cursorKey);
          options = getYearMonthOptions(currentDoc);
          let opt = findOptionForDate(cursor, options);
          if (!opt && options.length) opt = options[options.length - 1];
          if (!opt) break;
          const dayValue = String(cursor.getDate()).padStart(2, "0");
          try {
            const sourceForm = currentDoc.forms[0] || formEl;
            const form = new FormData(sourceForm);
            Array.from(form.keys()).forEach((k) => {
              if (k.startsWith("se-")) form.delete(k);
            });
            form.set("specifyYearMonth", opt.value);
            form.set("specifyDay", dayValue);
            form.set("SEARCH", "検索");
            const statusMsg = `fetch ${direction} #${i + 1} ym=${opt.value} day=${dayValue}`;
            log(statusMsg);
            fetchStatus.textContent = statusMsg;
            const res = await fetch(location.href, {
              method: "POST",
              body: form,
              credentials: "same-origin"
            });
            let html = "";
            try {
              const buf = await res.arrayBuffer();
              html = new TextDecoder("shift-jis").decode(buf);
            } catch (e) {
              html = await res.text();
            }
            const doc = parseDoc(html);
            currentDoc = doc;
            const newEntries = parseEntriesFromDoc(doc);
            if (newEntries.length === 0) {
              log(`fetch loop ${direction}`, i, "no entries, shift day ±1");
              cursor.setDate(cursor.getDate() + (direction === "older" ? -1 : 1));
              continue;
            }
            const addedEntries = mergeEntries(newEntries);
            if (addedEntries.length > 0) {
              appendEntriesToOriginalTable(addedEntries);
            }
            if (newEntries.length) {
              log(
                `sample dates: first=${newEntries[0].ymd} last=${newEntries[newEntries.length - 1].ymd}`
              );
            }
            fetched += addedEntries.length;
            // 追加なしでもカーソルを進めるため、ベースは追加分があればそれ、なければ今回レスポンス全体
            const baseEntries = addedEntries.length > 0 ? addedEntries : newEntries;
            const dates = baseEntries.map((e) => e.dateObj.getTime()).filter((n) => Number.isFinite(n));
            if (dates.length === 0) {
              log("fetch loop", direction, "no valid dates, stop");
              break;
            }
            if (direction === "older") {
              const minD = new Date(Math.min(...dates));
              const nextCursor = new Date(minD);
              nextCursor.setDate(nextCursor.getDate() + 1); // 最古+1日
              if (nextCursor.getTime() === cursor.getTime()) {
                log("fetch older stop: cursor not advanced");
                break;
              }
              cursor = nextCursor;
            } else {
              const maxD = new Date(Math.max(...dates));
              const nextCursor = new Date(maxD);
              nextCursor.setDate(nextCursor.getDate() - 1); // 最新-1日
              if (nextCursor.getTime() === cursor.getTime()) {
                log("fetch newer stop: cursor not advanced");
                break;
              }
              cursor = nextCursor;
            }
          } catch (e) {
            console.error("fetch loop failed", e);
            break;
          }
        }
        return fetched;
      };

      const fetchedOlder = await runLoop("older");
      const fetchedNewer = await runLoop("newer");
      applyFilters();
      const totalFetched = fetchedOlder + fetchedNewer;
      if (fetchStatus)
        fetchStatus.textContent =
          totalFetched > 0 ? `追加取得 ${totalFetched} 件` : "追加データなし / 取得失敗";
      isFetching = false;
    }

    exportBtn.addEventListener("click", () => exportCsv(state.filtered));

    resetBtn.addEventListener("click", () => {
      state.filters.dateFrom = parseInputDate(dateFromInput.defaultValue);
      state.filters.dateTo = parseInputDate(dateToInput.defaultValue);
      dateFromInput.value = dateFromInput.defaultValue;
      dateToInput.value = dateToInput.defaultValue;
      keywordInput.value = "";
      state.filters.keyword = "";
      holidayInput.value = "";
      state.filters.holidays = new Set();
      state.filters.types = new Set();
      root
        .querySelectorAll("#se-type-filters input[type='checkbox']")
        .forEach((cb) => {
          cb.checked = true;
          const type = cb.dataset.type;
          if (type) state.filters.types.add(type);
        });
      applyFilters();
    });

    applyFilters();
    hideOriginalInput.checked = true;
    hideOriginalInput.dispatchEvent(new Event("change"));
  }

  init();
})();

