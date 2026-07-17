"use strict";

const SECTION_ORDER = ["X", "Official Blogs", "Podcasts", "Papers", "RedNote", "Blogs", "Reddit"];
const SECTION_LABEL = {
  X: "X / Twitter",
  "Official Blogs": "Official Blogs",
  Podcasts: "Podcasts",
  Papers: "Papers",
  RedNote: "RedNote / 小红书",
  Blogs: "Blogs",
  Reddit: "Reddit",
};

const state = {
  index: [],
  date: null,
  digest: null,
  lang: localStorage.getItem("lang") || "both",
  query: "",
  hiddenSections: new Set(),
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- Data loading ----------------------------------------------------------

async function init() {
  applyTheme(localStorage.getItem("theme") || "light");
  wireControls();
  try {
    const res = await fetch("data/index.json", { cache: "no-cache" });
    state.index = (await res.json()).sort((a, b) => b.date.localeCompare(a.date));
  } catch (e) {
    state.index = [];
  }
  if (!state.index.length) {
    $("#content").innerHTML = '<p class="empty">No digests yet. Check back after the next run.</p>';
    return;
  }
  state.available = new Set(state.index.map((d) => d.date));
  const newest = state.index[0];
  if (newest && newest.generatedAt) {
    $("#lastUpdated").textContent = "Last updated " + formatDateTime(newest.generatedAt);
  }
  const param = new URLSearchParams(location.search).get("date");
  const start = state.index.find((d) => d.date === param) || state.index[0];
  await loadDate(start.date);
}

async function loadDate(date) {
  state.date = date;
  const res = await fetch(`data/${date}.json`, { cache: "no-cache" });
  state.digest = await res.json();
  $("#dateBtn").textContent = formatDate(date);
  const [y, m] = date.split("-").map(Number);
  state.calYM = { y, m: m - 1 }; // calendar opens on the shown day's month
  buildChips();
  render();
  updateDateButtons();
}

// ---- Calendar popover ----------------------------------------------------

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function toggleCal(show) {
  const pop = $("#calPop");
  const open = show ?? pop.hidden;
  pop.hidden = !open;
  $("#dateBtn").setAttribute("aria-expanded", String(open));
  if (open) renderCalendar();
}

function renderCalendar() {
  const pop = $("#calPop");
  const { y, m } = state.calYM;
  pop.innerHTML = "";

  const head = el("div", "cal-head");
  const prev = el("button", "cal-nav", "‹");
  const next = el("button", "cal-nav", "›");
  prev.onclick = (e) => { e.stopPropagation(); shiftMonth(-1); };
  next.onclick = (e) => { e.stopPropagation(); shiftMonth(1); };
  head.append(prev, el("span", "cal-title", `${MONTHS[m]} ${y}`), next);
  pop.appendChild(head);

  const grid = el("div", "cal-grid");
  for (const d of DOW) grid.appendChild(el("span", "cal-dow", d));

  const first = new Date(y, m, 1).getDay(); // 0=Sun .. 6=Sat
  const days = new Date(y, m + 1, 0).getDate();
  for (let day = 1; day <= days; day++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const has = state.available.has(iso);
    const cell = el("button", "cal-cell" + (has ? " has" : " none") + (iso === state.date ? " sel" : ""), String(day));
    // Offset the 1st into its weekday column instead of using blank cells
    if (day === 1 && first > 0) cell.style.gridColumnStart = String(first + 1);
    if (has) cell.onclick = (e) => { e.stopPropagation(); toggleCal(false); loadDate(iso); };
    else cell.disabled = true;
    grid.appendChild(cell);
  }
  pop.appendChild(grid);
}

function shiftMonth(delta) {
  let { y, m } = state.calYM;
  m += delta;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  state.calYM = { y, m };
  renderCalendar();
}

// ---- Rendering -------------------------------------------------------------

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return (state.digest.items || []).filter((it) => {
    if (state.hiddenSections.has(it.section)) return false;
    if (!q) return true;
    return [it.source, it.role, it.title, it.en, it.zh, (it.tags || []).join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

function render() {
  const lang = state.lang;
  $("#headline").textContent = lang === "zh" ? state.digest.headline_zh : state.digest.headline_en;
  document.body.className = `lang-${lang}`;

  const items = visibleItems();
  const root = $("#content");
  root.innerHTML = "";

  if (!items.length) {
    root.appendChild(el("p", "empty", "Nothing matches your filters."));
    return;
  }

  for (const section of SECTION_ORDER) {
    const secItems = items.filter((it) => it.section === section);
    if (!secItems.length) continue;

    const secNode = el("section", "section");
    secNode.appendChild(el("h2", null, esc(SECTION_LABEL[section])));

    // Group Feedly-style sections by category
    const grouped = section === "X" || section === "Podcasts" || section === "Official Blogs";
    if (grouped) {
      secItems.forEach((it) => secNode.appendChild(card(it)));
    } else {
      const cats = [...new Set(secItems.map((it) => it.category || ""))];
      for (const cat of cats) {
        if (cat && cats.length > 1) secNode.appendChild(el("div", "subcat", esc(cat)));
        secItems.filter((it) => (it.category || "") === cat).forEach((it) => secNode.appendChild(card(it)));
      }
    }
    root.appendChild(secNode);
  }
}

function card(it) {
  const c = el("div", "card");
  const head = it.role
    ? `<span class="src">${esc(it.source)}</span> <span class="role">· ${esc(it.role)}</span>`
    : `<span class="src">${esc(it.source)}</span>`;
  c.appendChild(el("div", "hd", head));
  if (it.title) c.appendChild(el("div", "ttl", esc(it.title)));
  if (it.en) c.appendChild(el("p", "en", esc(it.en)));
  if (it.zh) c.appendChild(el("p", "zh", esc(it.zh)));

  const meta = el("div", "meta");
  (it.tags || []).forEach((t) => meta.appendChild(el("span", "tag", esc(t))));
  const a = el("a", "link", "source ↗");
  a.href = it.url;
  a.target = "_blank";
  a.rel = "noopener";
  meta.appendChild(a);
  c.appendChild(meta);
  return c;
}

function buildChips() {
  const counts = {};
  for (const it of state.digest.items || []) counts[it.section] = (counts[it.section] || 0) + 1;
  const box = $("#chips");
  box.innerHTML = "";
  for (const section of SECTION_ORDER) {
    if (!counts[section]) continue;
    const chip = el("button", "chip" + (state.hiddenSections.has(section) ? "" : " on"));
    chip.innerHTML = `${esc(SECTION_LABEL[section])}<span class="ct">${counts[section]}</span>`;
    chip.onclick = () => {
      if (state.hiddenSections.has(section)) state.hiddenSections.delete(section);
      else state.hiddenSections.add(section);
      chip.classList.toggle("on");
      render();
    };
    box.appendChild(chip);
  }
}

// ---- Controls --------------------------------------------------------------

function wireControls() {
  $("#langSeg").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.lang === state.lang);
    b.onclick = () => {
      state.lang = b.dataset.lang;
      localStorage.setItem("lang", state.lang);
      $("#langSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      render();
    };
  });

  let t;
  $("#search").oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.query = e.target.value;
      render();
    }, 120);
  };

  $("#themeBtn").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("theme", next);
  };

  $("#dateBtn").onclick = (e) => { e.stopPropagation(); toggleCal(); };
  document.addEventListener("click", (e) => {
    if (!$("#calPop").hidden && !e.target.closest(".cal-wrap")) toggleCal(false);
  });
  $("#prevDay").onclick = () => step(1); // older
  $("#nextDay").onclick = () => step(-1); // newer
}

function step(dir) {
  const i = state.index.findIndex((d) => d.date === state.date);
  const j = i + dir;
  if (j >= 0 && j < state.index.length) loadDate(state.index[j].date);
}

function updateDateButtons() {
  const i = state.index.findIndex((d) => d.date === state.date);
  $("#nextDay").disabled = i <= 0;
  $("#prevDay").disabled = i >= state.index.length - 1;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

init();
