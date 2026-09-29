"use strict";
// JudgeCast demo: replays one recorded window (demo/scene.py) as a live run.
// Every text and number comes from the record; only the pacing (thinking pauses, token streaming, line reveals) is staged.

const $ = (s, r = document) => r.querySelector(s);
const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent = null, text = null) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v; else e.setAttribute(k, v);
  }
  if (text !== null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function sv(tag, attrs = {}, parent = null, text = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// ---------------------------------------------------------------- playback clock (pause, speed, restart)
let S = null;                 // the scene
let speed = 1, paused = true, gen = 0, started = false;
class Abort extends Error {}

function frameLoop(ms, onFrame) {
  const g = gen;
  return new Promise((res, rej) => {
    let acc = 0, last = performance.now();
    function tick(now) {
      if (g !== gen) return rej(new Abort());
      const dt = Math.min(now - last, 100); last = now;
      if (!paused) acc += dt * speed;
      const t = ms <= 0 ? 1 : Math.min(1, acc / ms);
      if (onFrame) onFrame(t);
      if (t >= 1) res(); else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}
const sleep = ms => frameLoop(ms, null);
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const tween = (ms, fn) => frameLoop(ms, t => fn(ease(t)));

// seeded jitter so every take of the video streams identically
let seed = 7;
function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

// ---------------------------------------------------------------- formatting
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parseT = s => new Date(s.replace(" ", "T"));
const pad = n => String(n).padStart(2, "0");
const fmtClock = d => `${DAYS[d.getDay()]} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDay = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmtDate = s => { const d = parseT(s); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const sgn = (v, k = 1) => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(k);
const num = (v, k = 2) => v.toFixed(k);

function ranges(pos) {
  const p = [...pos].sort((a, b) => a - b), out = [];
  for (let i = 0; i < p.length; i++) {
    let j = i; while (j + 1 < p.length && p[j + 1] === p[j] + 1) j++;
    out.push(i === j ? `${p[i]}` : `${p[i]}–${p[j]}`); i = j;
  }
  return out.join(", ");
}
const covShort = name => name.replace(/_load_fcst$/, "").replace(/_power_fcst$/, "").replace(/_fcst$/, "");
const covIndex = name => S.covariates.findIndex(c => c.name === name);

function judgmentChip(j, cls = "", parent = null) {
  const c = el("span", { class: "chip " + cls }, parent);
  c.innerHTML = `${j.covariate} <span>${j.start}–${j.end}</span> <b>${j.judgment}</b>`;
  return c;
}
function patternLabel(p) {
  return p.split("|").map(s => { const [c, v] = s.split(":"); return `${covShort(c)} ${v}`; }).join(" · ");
}

// ---------------------------------------------------------------- trace panel
const trace = () => $("#trace");
function follow() { const t = trace(); t.scrollTop = t.scrollHeight; }

function step(role, title, who, desc) {
  const s = el("div", { class: `step ${role} running` }, trace());
  const h = el("div", { class: "sh" }, s);
  el("span", { class: "st" }, h, title);
  if (who) el("span", { class: "who" }, h, who);
  const tm = el("span", { class: "tm" }, h, "");
  if (desc) el("div", { class: "sd" }, s, desc);
  const body = el("div", { class: "sb" }, s);
  follow();
  return { s, body, tm, done(txt) { s.classList.remove("running"); s.classList.add("done"); if (txt !== undefined) tm.textContent = txt; } };
}

function tokens(text) {
  const out = [];
  for (const w of text.match(/\s*\S+|\s+/g) || []) {
    if (w.length <= 6) { out.push(w); continue; }
    for (let i = 0; i < w.length;) { const n = 3 + Math.floor(rnd() * 3); out.push(w.slice(i, i + n)); i += n; }
  }
  return out;
}
async function stream(target, text, cps = 120) {
  const node = document.createTextNode("");
  const caret = el("span", { class: "caret" });
  target.appendChild(node); target.appendChild(caret);
  for (const tk of tokens(text)) {
    node.data += tk; follow();
    await sleep((tk.length * 1000 / cps) * (0.55 + rnd() * 0.9));
  }
  caret.remove();
}
const streamMs = (text, cps = 120) => (text.length * 1000) / cps;

// a model call: shimmering "Reasoning" with a clock that runs up to the call's recorded latency
async function reasoning(parent, label, ms) {
  const t = el("div", { class: "think" }, parent, `${label}…`);
  follow();
  await sleep(ms);
  t.classList.add("fin");
  return t;
}
function callClock(stepObj, seconds, estMs) {
  let alive = true, acc = 0, last = performance.now();
  const g = gen;
  (function tick(now) {
    if (!alive || g !== gen) return;
    const dt = Math.min(now - last, 100); last = now;
    if (!paused) acc += dt * speed;
    stepObj.tm.textContent = `${Math.min(seconds * 0.97, (acc / estMs) * seconds).toFixed(1)} s`;
    requestAnimationFrame(tick);
  })(last);
  return () => { alive = false; stepObj.tm.textContent = `${seconds.toFixed(1)} s`; };
}

// ---------------------------------------------------------------- charts
let CW = 1100, CH = 350;
const M = { l: 56, r: 22, t: 20, b: 36 };
let COVH = 92;
const CM = { t: 8, b: 8 };
let X, Y, NCTX, HOR, chart = {};

const narrow = () => window.matchMedia("(max-width: 999px)").matches;
function scales(chOverride) {
  // draw at the container's pixel size so type stays at its set size on any screen
  CW = Math.max(300, Math.round($(".left").clientWidth - 18));
  if (narrow()) {
    CH = Math.round(Math.min(330, Math.max(190, window.innerHeight * 0.27)));
    COVH = Math.round(CH * 0.5);
    document.documentElement.style.setProperty("--bankh", `${CH + 24}px`);
  } else {
    CH = Math.round(Math.min(380, Math.max(200, window.innerHeight * 0.34 - (window.innerHeight < 1000 ? 50 : 0))));
    COVH = window.innerHeight < 850 ? 58 : window.innerHeight < 1000 ? 66 : 92;
  }
  if (chOverride) CH = chOverride;
  NCTX = S.context.values.length; HOR = S.y_base.length;
  const n = NCTX + HOR;
  X = i => M.l + (i * (CW - M.l - M.r)) / (n - 1);
  const vals = [...S.context.values, ...S.y_base, ...S.y_hat, ...S.gt];
  if (S.construction) for (const c of S.construction.candidates) vals.push(...candidateForecast(c));
  for (const b of S.baselines || []) vals.push(...b.pred);
  let lo = Math.min(...vals), hi = Math.max(...vals); const padv = (hi - lo) * 0.08; lo -= padv; hi += padv;
  Y = v => M.t + ((hi - v) * (CH - M.t - M.b)) / (hi - lo);
  Y.lo = lo; Y.hi = hi;
}
const fx = s => NCTX - 1 + s;            // horizon step s (1-based) -> x index
function pathD(pts) { return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(""); }
function forecastPts(arr) {                 // anchored at the last observed point so the forecast leaves the history
  const pts = [[X(NCTX - 1), Y(S.context.values[NCTX - 1])]];
  arr.forEach((v, k) => pts.push([X(fx(k + 1)), Y(v)]));
  return pts;
}
function niceTicks(lo, hi, n = 5) {
  const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(6));
  return out;
}

function revealClip(svg, id) {
  let defs = svg.querySelector("defs") || sv("defs", {}, svg);
  const cp = sv("clipPath", { id }, defs);
  return sv("rect", { x: 0, y: 0, width: 0, height: 2000 }, cp);
}
async function reveal(rect, x0, x1, ms) {
  rect.setAttribute("x", x0);
  await tween(ms, t => rect.setAttribute("width", Math.max(0, (x1 - x0) * t)));
}

function drawChart() {
  const svg = $("#chart"); svg.innerHTML = ""; svg.setAttribute("viewBox", `0 0 ${CW} ${CH}`);
  const g = sv("g", {}, svg);
  const x0 = X(NCTX - 1), x1 = CW - M.r;
  // forecast horizon band + origin
  sv("rect", { x: x0, y: M.t, width: x1 - x0, height: CH - M.t - M.b, fill: "#f5f6f9" }, g);
  // grid + y ticks
  for (const v of niceTicks(Y.lo, Y.hi)) {
    sv("line", { x1: M.l, x2: x1, y1: Y(v), y2: Y(v), stroke: "#eceef2" }, g);
    sv("text", { x: M.l - 10, y: Y(v) + 4, "text-anchor": "end", "font-size": 12, fill: "#8a909b" }, g, String(v));
  }
  sv("text", { x: 14, y: M.t + (CH - M.t - M.b) / 2, "font-size": 12, fill: "#8a909b", transform: `rotate(-90 14 ${M.t + (CH - M.t - M.b) / 2})`, "text-anchor": "middle" }, g, S.dataset.unit);
  // day boundaries
  const times = [...S.context.times, ...S.future_times];
  times.forEach((t, i) => {
    const d = parseT(t);
    if (d.getHours() === 0 && d.getMinutes() === 0) {
      sv("line", { x1: X(i), x2: X(i), y1: M.t, y2: CH - M.b, stroke: "#eceef2" }, g);
      sv("text", { x: X(i) + 6, y: CH - M.b + 20, "font-size": 12, fill: "#6d737e" }, g, fmtDay(d));
    }
  });
  sv("line", { x1: x0, x2: x0, y1: M.t - 6, y2: CH - M.b, stroke: "#16181d", "stroke-width": 1.2, "stroke-dasharray": "3 3" }, g);
  sv("text", { x: x0 - 8, y: M.t + 8, "text-anchor": "end", "font-size": 12, "font-weight": 600, fill: "#16181d" }, g, "Forecast origin");
  const roomy = x1 - x0 > 230;          // the horizon band is too narrow for its labels on phones
  if (roomy) sv("text", { x: x1 - 8, y: M.t + 8, "text-anchor": "end", "font-size": 12, "font-weight": 600, fill: "#8a909b" }, g, `Forecast horizon · ${HOR} steps`);
  chart.unknown = sv("text", { x: (x0 + x1) / 2, y: (CH - M.b + M.t) / 2 + 30, "text-anchor": "middle", "font-size": 13, fill: "#b8bec8", "font-style": "italic", opacity: roomy ? 1 : 0 }, g, "future not yet observed");

  // history
  const hist = S.context.values.map((v, i) => [X(i), Y(v)]);
  sv("path", { d: pathD(hist), fill: "none", stroke: "#16181d", "stroke-width": 1.8, "stroke-linejoin": "round" }, g);

  chart.gRes = sv("g", {}, g);
  chart.gCand = sv("g", {}, g);
  chart.gArrow = sv("g", {}, g);
  chart.clipBase = revealClip(svg, "clip-base");
  chart.base = sv("path", { d: pathD(forecastPts(S.y_base)), fill: "none", stroke: "#7f7f7f", "stroke-width": 2, "stroke-dasharray": "6 4", "clip-path": "url(#clip-base)" }, g);
  chart.clipBl = revealClip(svg, "clip-bl");
  chart.bl = (S.baselines || []).map(b => sv("path", { d: pathD(forecastPts(b.pred)), fill: "none", stroke: "#d62728", "stroke-width": 2, "stroke-linejoin": "round", opacity: 0.85, "clip-path": "url(#clip-bl)" }, g));
  chart.jc = sv("path", { d: "", fill: "none", stroke: "#1f77b4", "stroke-width": 3, "stroke-linejoin": "round", opacity: 0 }, g);
  chart.clipObs = revealClip(svg, "clip-obs");
  chart.obs = sv("path", { d: pathD(forecastPts(S.gt)), fill: "none", stroke: "#16181d", "stroke-width": 2.2, "stroke-linejoin": "round", "clip-path": "url(#clip-obs)" }, g);
  chart.gLabels = sv("g", {}, g);

  // hover layer
  chart.cross = sv("line", { y1: M.t, y2: CH - M.b, stroke: "#16181d", "stroke-width": 1, opacity: 0 }, g);
  const hit = sv("rect", { x: M.l, y: M.t, width: CW - M.l - M.r, height: CH - M.t - M.b, fill: "transparent" }, g);
  hit.style.touchAction = "none";
  hit.addEventListener("pointermove", onHover);
  hit.addEventListener("pointerdown", onHover);
  hit.addEventListener("pointerleave", () => { $("#tip").hidden = true; chart.cross.setAttribute("opacity", 0); });
}

const shown = { base: false, jc: false, obs: false, bl: false };
let jcNow = null;          // the adjusted forecast as it is being built
function onHover(ev) {
  const svg = $("#chart"), r = svg.getBoundingClientRect();
  const vx = ((ev.clientX - r.left) / r.width) * CW;
  let i = Math.round(((vx - M.l) * (NCTX + HOR - 1)) / (CW - M.l - M.r));
  i = Math.max(0, Math.min(NCTX + HOR - 1, i));
  const times = [...S.context.times, ...S.future_times];
  const rows = [`<div class="t">${fmtClock(parseT(times[i]))}</div>`];
  const u = S.dataset.unit;
  if (i < NCTX) rows.push(`<i style="background:#16181d"></i>Observed ${num(S.context.values[i], 1)} ${u}`);
  else {
    const k = i - NCTX;
    if (shown.obs) rows.push(`<i style="background:#16181d"></i>Observed ${num(S.gt[k], 1)}`);
    if (shown.base) rows.push(`<i style="background:#7f7f7f"></i>Base ${num(S.y_base[k], 1)}`);
    if (shown.bl) for (const b of S.baselines) rows.push(`<i style="background:#d62728"></i>${b.label} ${num(b.pred[k], 1)}`);
    if (shown.jc && jcNow) rows.push(`<i style="background:#1f77b4"></i>JudgeCast ${num(jcNow[k], 1)}`);
    if (shown.obs && shown.base) rows.push(`<i style="background:#ff7f0e"></i>Residual ${sgn(S.gt[k] - S.y_base[k], 1)}`);
    rows.push(`<div class="t">horizon step ${k + 1}</div>`);
  }
  const tip = $("#tip"); tip.innerHTML = rows.join("<br>"); tip.hidden = false;
  const px = (X(i) / CW) * r.width;
  tip.style.left = `${px + (px > r.width * 0.7 ? -tip.offsetWidth - 16 : 16)}px`;
  tip.style.top = `${Math.max(8, ((ev.clientY - r.top) - 30))}px`;
  chart.cross.setAttribute("x1", X(i)); chart.cross.setAttribute("x2", X(i)); chart.cross.setAttribute("opacity", 0.25);
}

function drawCovariates() {
  const box = $("#covs"); box.innerHTML = ""; chart.covBands = [];
  S.covariates.forEach((c, ci) => {
    const row = el("div", { class: "cov" }, box);
    const svg = sv("svg", { viewBox: `0 0 ${CW} ${COVH}` }, row);
    const vals = [...c.context, ...c.horizon];
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const cy = v => CM.t + ((hi - v) * (COVH - CM.t - CM.b)) / (hi - lo || 1);
    const x0 = X(NCTX - 1), x1 = CW - M.r;
    sv("rect", { x: x0, y: 0, width: x1 - x0, height: COVH, fill: "#f5f6f9" }, svg);
    const bands = sv("g", {}, svg);
    sv("line", { x1: x0, x2: x0, y1: 0, y2: COVH, stroke: "#16181d", "stroke-width": 1.2, "stroke-dasharray": "3 3" }, svg);
    const color = ci === 0 ? "#76b7b2" : ci === 1 ? "#ff9da7" : "#9aa0aa";
    const pts = vals.map((v, i) => [X(i), cy(v)]);
    sv("path", { d: pathD(pts.slice(0, NCTX)), fill: "none", stroke: color, "stroke-width": 1.8 }, svg);
    sv("path", { d: pathD(pts.slice(NCTX - 1)), fill: "none", stroke: color, "stroke-width": 2.6 }, svg);
    const lab = sv("g", { stroke: "#fff", "stroke-width": 4, "stroke-linejoin": "round", "paint-order": "stroke" }, svg);
    const t1 = sv("text", { x: 8, y: 20, "font-size": 12.5, "font-weight": 600, fill: "#16181d" }, lab, c.label);
    sv("text", { x: 8, y: 36, "font-size": 11, fill: "#8a909b", "font-family": "var(--mono)" }, lab, c.name);
    if (COVH >= 90) sv("text", { x: 8, y: 52, "font-size": 11, fill: "#8a909b" }, lab, "known future");
    chart.covBands.push({ g: bands, cy });
  });
}

function addBand(j) {
  const ci = covIndex(j.covariate); if (ci < 0) return;
  const { g } = chart.covBands[ci];
  const xa = X(fx(j.start)) - (X(1) - X(0)) / 2, xb = X(fx(j.end)) + (X(1) - X(0)) / 2;
  // one hue for every judgment (blue); direction by glyph and edge (up: ▲ and a top edge, down: ▼ and a bottom edge),
  // strength by shade and by doubling the glyph
  const strong = j.judgment.length > 1, up = j.judgment[0] === "+";
  const b = sv("g", { opacity: 0 }, g);
  sv("rect", { x: xa + 1, y: 2, width: xb - xa - 2, height: COVH - 4, rx: 5, fill: strong ? "#c0d9ea" : "#e4eff6" }, b);
  sv("rect", { x: xa + 1, y: up ? 2 : COVH - 5, width: xb - xa - 2, height: 3, rx: 1.5, fill: "#1f77b4" }, b);
  const glyph = (up ? "▲" : "▼").repeat(strong ? 2 : 1);
  sv("text", { x: (xa + xb) / 2, y: up ? 20 : COVH - 11, "text-anchor": "middle", "font-size": 12, "letter-spacing": 1, fill: "#165682" }, b, glyph);
  tween(450, t => b.setAttribute("opacity", t)).catch(() => {});
}

function candidateForecast(c) {
  const f = [...S.y_base];
  for (const a of c.adjusted || []) for (const s of a.timestamps) f[s - 1] += a.delta;
  return f;
}

// ---------------------------------------------------------------- memory bank
function drawBank() {
  const b = $("#bank"); b.innerHTML = "";
  chart.cells = {};
  for (const e of S.bank) chart.cells[e.id] = el("div", { class: "cell", title: `${fmtDate(e.origin_time)} · ${e.source}` }, b);
  $("#bank-n").textContent = S.bank.length;
}
// size the cells so the whole memory fits the box it is given (one extra slot for the experience this window stores)
function fitBank() {
  const b = $("#bank"); if (!b || !b.clientHeight) return;
  const cs = getComputedStyle(b);
  const W = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = b.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const n = S.bank.length + 1;
  let cell = 3, gap = 2;
  for (let c = 16; c >= 3; c -= 0.5) {
    const g = Math.max(2, Math.round(c * 0.27));
    const cols = Math.floor((W + g) / (c + g));
    if (cols > 0 && Math.ceil(n / cols) * (c + g) - g <= H) { cell = c; gap = g; break; }
  }
  b.style.setProperty("--cell", `${cell}px`); b.style.setProperty("--gap", `${gap}px`);
}
function markCells(ids, cls, on) { for (const id of ids) { const c = chart.cells[id]; if (c) c.classList.toggle(cls, on); } }

// ---------------------------------------------------------------- stage rail + status
// phones: the visualization shown follows whatever is outlined
const VIEW_BY_SEL = { ".chart-card": "forecast", ".cov-card": "covariates", ".bank-card": "memory", ".right": "forecast" };
function setView(v) {
  $(".left").dataset.view = v;
  document.querySelectorAll("#views button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  if (v === "memory") fitBank();
}
// Outline what the current step is acting on, in that thing's role colour. Judgment and adjustment each read memory
// first (purple, the memory is always purple) and then act (judgment on the covariates, adjustment on the chart);
// construction happens in the trace, so the trace is outlined.
const FOCUS_OF = { base: [".chart-card", "base"], judge: [".bank-card", "memory"], adjust: [".chart-card", "adjustment"],
  observe: [".chart-card", "feedback"], construct: [".right", "feedback"], store: [".bank-card", "memory"] };
function focusAdd(sel, role) {
  const c = $(sel);
  c.style.setProperty("--fc", `var(--${role})`); c.style.setProperty("--fct", `var(--${role}-tint2)`);
  c.classList.add("focus");
}
function focusOn(sel, role) {
  document.querySelectorAll(".focus").forEach(c => c.classList.remove("focus"));
  if (sel) focusAdd(sel, role);
  if (sel && narrow() && VIEW_BY_SEL[sel]) setView(VIEW_BY_SEL[sel]);
}
function focusCard(name) { const f = FOCUS_OF[name]; focusOn(f && f[0], f && f[1]); }
function stage(name) {
  focusCard(name);
  let seen = false;
  for (const li of $("#rail").children) {
    if (li.dataset.stage === name) { li.className = "on"; seen = true; }
    else if (!seen) { if (!li.classList.contains("skip")) li.className = "done"; }
    else if (!li.classList.contains("skip")) li.className = "";
  }
}
function status(kind, text) { const s = $("#status"); s.className = "status " + kind; $("#status-text").textContent = text; }
function clock(label, t, fb = false) { $("#clock-label").textContent = label; $("#clock-time").textContent = fmtClock(t); $(".clock").classList.toggle("fb", fb); }

// ---------------------------------------------------------------- the run
async function run() {
  const sec = S.seconds || {};
  const cov = S.covariates.length;
  status("run", "Running");

  // 1. base forecast
  stage("base");
  let st = step("base", "Base forecast", S.models.tsfm, `Target-only forecast from the last ${S.dataset.lookback} steps of the ${S.dataset.label}; covariates are not used here.`);
  await sleep(700);
  shown.base = true; $('.lg[data-k="base"]').classList.remove("off");
  tween(500, t => chart.unknown.setAttribute("opacity", 1 - t)).catch(() => {});
  await reveal(chart.clipBase, X(NCTX - 1) - 2, CW, 1100);
  st.done("");
  await sleep(450);

  // 2. covariate-wise judgment: read relevant experience from memory, then judge
  stage("judge");
  const jText = S.rationales.map(r => r.rationale).join(" ");
  st = step("judgment", "Covariate-wise judgment", `${S.models.llm} · judge`,
    `Input: the current window (target context, base forecast, ${cov} known-future covariate${cov > 1 ? "s" : ""}) and relevant experience from memory.`);
  el("div", { class: "subh mem" }, st.body, `Relevant experience · k = ${S.models.k} nearest by departure distance, among ${S.bank.length} in memory`);
  follow();
  await sleep(600);
  for (const r of S.retrieved) {
    const row = el("div", { class: "exp" }, st.body);
    const d = parseT(r.origin_time);
    el("div", { class: "d", html: `${fmtDate(r.origin_time)}<span>${DAYS[d.getDay()]} · ${r.source === "forward" ? "J⁰ kept" : "J* reconstructed"}</span>` }, row);
    const chips = el("div", { class: "chips" }, row);
    for (const j of r.judgments) judgmentChip(j, "mem", chips);
    el("div", { class: "dist", html: `d ${num(r.distance, 3)}` }, row);
    markCells([r.id], "hit", true);
    follow();
    await sleep(380);
  }
  await sleep(500);
  focusOn(".cov-card", "judgment");
  el("div", { class: "subh jud" }, st.body, "Judgment");
  const thinkMs = 1600, jCps = 120;
  let stop = callClock(st, sec.judgment || 20, thinkMs + streamMs(jText, jCps) + 900);
  await reasoning(st.body, "Reasoning over covariate evidence", thinkMs);
  st.body.lastChild.textContent = "Judging each covariate on the spans it affects";
  for (const r of S.rationales) {
    const blk = el("div", { class: "block" }, st.body);
    el("div", { class: "bh", html: `<code>${r.covariate}</code>` }, blk);
    const rz = el("div", { class: "rz" }, blk);
    await stream(rz, r.rationale, jCps);
    const chips = el("div", { class: "chips", style: "margin-top:7px" }, blk);
    for (const j of S.judgments.filter(j => j.covariate === r.covariate).sort((a, b) => a.start - b.start)) {
      judgmentChip(j, "", chips); addBand(j); follow();
      await sleep(260);
    }
    await sleep(250);
  }
  stop(); st.done();
  markCells(S.retrieved.map(r => r.id), "hit", false);
  await sleep(500);

  // 4. numerical adjustment
  stage("adjust");
  const groups = S.adjusted.filter(a => a.pattern);
  const aText = groups.map(a => a.rationale).join(" ");
  st = step("adjustment", "Numerical adjustment", `${S.models.llm} · adjuster`,
    `Steps sharing a judgment pattern form one group; each group reads matched cases from memory and sets a per-step correction in ${S.dataset.unit}.`);
  stop = callClock(st, sec.adjustment || 20, 1200 + streamMs(aText, 125) + groups.length * 2400);
  await reasoning(st.body, "Grouping horizon steps by judgment pattern", 1100);
  jcNow = [...S.y_base];
  shown.jc = true; $('.lg[data-k="jc"]').classList.remove("off");
  chart.jc.setAttribute("d", pathD(forecastPts(jcNow))); chart.jc.setAttribute("opacity", 1);
  for (const a of groups) {
    const blk = el("div", { class: "block" }, st.body);
    el("div", { class: "bh", html: `<span class="chip adj">${patternLabel(a.pattern)}</span><span class="muted">steps ${ranges(a.timestamps)}</span>` }, blk);
    if (a.cases && a.cases.length) {
      focusOn(".bank-card", "memory");            // memory is always purple, whichever step reads it
      el("div", { class: "muted", style: "margin:2px 0 4px" }, blk, `${a.cases.length} matched cases from memory`);
      const cs = el("div", { class: "cases" }, blk);
      for (const c of a.cases) {
        el("div", { class: "case", html: `<span class="k">${fmtDate(c.origin_time)}</span><span>steps ${ranges(c.positions)}</span><span>Δ ${sgn(c.delta, 1)}</span><span>resid ${sgn(c.residual, 2)}</span>` }, cs);
        markCells([c.experience_id], "case", true); follow();
        await sleep(220);
      }
    }
    const rz = el("div", { class: "rz", style: "margin-top:6px" }, blk);
    await stream(rz, a.rationale, 125);
    const res = el("div", { class: "result", style: "margin-top:6px" }, blk);
    el("span", {}, res, "Correction");
    el("span", { class: "delta-v" }, res, `${sgn(a.delta, 1)} ${S.dataset.unit} per step`);
    follow();
    // grow the correction on the chart
    focusOn(".chart-card", "adjustment");
    const arrows = a.timestamps.map(s => sv("line", { x1: X(fx(s)), x2: X(fx(s)), y1: Y(jcNow[s - 1]), y2: Y(jcNow[s - 1]), stroke: "#2ca02c", "stroke-width": 2.4, "stroke-linecap": "round", opacity: 0.85 }, chart.gArrow));
    const from = a.timestamps.map(s => jcNow[s - 1]);
    await tween(900, t => {
      a.timestamps.forEach((s, k) => { jcNow[s - 1] = from[k] + a.delta * t; arrows[k].setAttribute("y2", Y(jcNow[s - 1])); });
      chart.jc.setAttribute("d", pathD(forecastPts(jcNow)));
    });
    markCells(a.cases ? a.cases.map(c => c.experience_id) : [], "case", false);
    await sleep(350);
  }
  jcNow = [...S.y_hat]; chart.jc.setAttribute("d", pathD(forecastPts(jcNow)));
  stop(); st.done();
  focusOn(null);                                  // adjustment ends when the forecast is issued; nothing outlined until the observation
  const issued = el("div", { class: "block", style: "border-color:var(--judgment-tint2);background:var(--judgment-tint)" }, st.body);
  issued.innerHTML = `<div class="bh" style="color:var(--judgment-text)"><span>Forecast issued · ŷ = ŷ<sub>base</sub> + a</span></div><div class="muted">${HOR} steps from ${fmtClock(parseT(S.future_times[0]))}</div>`;
  follow();
  await tween(600, t => chart.gArrow.setAttribute("opacity", 1 - 0.7 * t));
  await sleep(900);

  // 5. observation
  const div = el("div", { class: "endline", style: "margin:4px 0 14px" }, trace(), `⏵⏵  ${HOR} hours later`);
  follow();
  await sleep(700);
  stage("observe");
  st = step("feedback", "Observation arrives", "feedback", "The realized target closes the window; the base forecast's residual r = y − ŷ_base becomes available.");
  chart.unknown.setAttribute("opacity", 0);
  shown.obs = true; $('.lg[data-k="obs"]').classList.remove("off");
  const t0 = parseT(S.future_times[0]).getTime(), t1 = parseT(S.closed_time).getTime();
  const obsP = reveal(chart.clipObs, X(NCTX - 1) - 2, CW, 1800);
  if (S.baselines && S.baselines.length) {
    shown.bl = true; $("#lg-bl").classList.remove("off");
    reveal(chart.clipBl, X(NCTX - 1) - 2, CW, 1800).catch(() => {});
  }
  await tween(1800, t => clock("Observation", new Date(t0 + (t1 - t0) * t), true));
  await obsP;
  // residual bars
  const resid = S.gt.map((y, k) => y - S.y_base[k]);
  const bars = resid.map((r, k) => sv("line", { x1: X(fx(k + 1)), x2: X(fx(k + 1)), y1: Y(S.y_base[k]), y2: Y(S.y_base[k]), stroke: "#ff7f0e", "stroke-width": 5, "stroke-linecap": "round", opacity: 0.55 }, chart.gRes));
  $('.lg[data-k="res"]').classList.remove("off");
  await tween(700, t => bars.forEach((b, k) => b.setAttribute("y2", Y(S.y_base[k] + resid[k] * t))));
  const mean = resid.reduce((a, b) => a + b, 0) / resid.length;
  let kmax = 0; resid.forEach((r, k) => { if (Math.abs(r) > Math.abs(resid[kmax])) kmax = k; });
  const kv = el("div", { class: "kv" }, st.body);
  kv.innerHTML = `<span class="k">mean residual</span><span class="v">${sgn(mean, 2)} ${S.dataset.unit}</span>
    <span class="k">largest</span><span class="v">${sgn(resid[kmax], 2)} at step ${kmax + 1}</span>
    <span class="k">MSE</span><span class="v">base ${num(S.mse.base)}${(S.baselines || []).map(b => ` · ${b.label} ${num(b.mse)}`).join("")} → JudgeCast ${num(S.mse.judgecast)}</span>`;
  $("#sc-base").textContent = num(S.mse.base); $("#sc-jc").textContent = num(S.mse.judgecast);
  if (S.baselines && S.baselines.length) { $("#sc-bl").textContent = num(S.baselines[0].mse); $("#sc-bl-box").hidden = false; }
  $("#sc-delta").textContent = `${sgn(((S.mse.judgecast - S.mse.base) / S.mse.base) * 100, 1)}%`;
  $("#scoreboard").style.visibility = "visible";
  focusAdd("#scoreboard", "feedback");
  st.done("");
  follow();
  await sleep(1400);

  // 6. residual-guided experience construction
  const con = S.construction;
  if (!con) {
    for (const k of ["construct", "store"]) $(`#rail [data-stage=${k}]`).className = "skip";
    el("div", { class: "endline" }, trace(), "Test window: memory is fixed, no experience is constructed.");
    status("done", "Complete"); return;
  }
  stage("construct");
  tween(700, t => { chart.gRes.setAttribute("opacity", 1 - 0.7 * t); chart.jc.setAttribute("opacity", 1 - 0.65 * t); chart.bl.forEach(l => l.setAttribute("opacity", 0.85 - 0.65 * t)); }).catch(() => {});
  const alts = con.candidates.map((c, i) => ({ ...c, i })).filter(c => c.origin !== "forward");
  const fwd = con.candidates.find(c => c.origin === "forward");
  const pText = alts.map(c => c.rationales.map(r => r.rationale).join(" ")).join(" ");
  st = step("feedback", "Residual-guided experience construction", `${S.models.llm} · proposal`,
    `Using r, reconstruct ${alts.length} alternative judgments, replay the same adjustment on each, and keep the decision whose adjusted forecast fits best.`);
  stop = callClock(st, sec.construction || 60, 1500 + streamMs(pText, 190) + alts.length * 900 + 5000);
  await reasoning(st.body, "Reading the residual against the original judgment", 1500);
  const candEls = {};
  const f = el("div", { class: "cand" }, st.body);
  candEls[fwd ? con.candidates.indexOf(fwd) : 0] = f;
  el("div", { class: "id" }, f, "J⁰");
  const fc = el("div", {}, f); const fch = el("div", { class: "chips" }, fc);
  for (const j of (fwd || con.candidates[0]).judgments) judgmentChip(j, "gray", fch);
  el("div", { class: "rz muted" }, fc, "original forward judgment");
  follow();
  await sleep(500);
  for (const [n, c] of alts.entries()) {
    const box = el("div", { class: "cand" }, st.body); candEls[c.i] = box;
    el("div", { class: "id" }, box, `A${n + 1}`);
    const body = el("div", {}, box); const ch = el("div", { class: "chips" }, body);
    for (const j of c.judgments) { judgmentChip(j, "", ch); await sleep(140); }
    if (!c.judgments.length) el("span", { class: "chip gray" }, ch, "no covariate effect");
    const rz = el("div", { class: "rz" }, body);
    await stream(rz, c.rationales.map(r => r.rationale).join(" "), 190);
    await sleep(250);
  }
  // replay losses
  el("div", { class: "muted", style: "margin-top:4px" }, st.body, `Replay: same adjuster on each judgment · MSE against the observation`);
  const losses = el("div", { class: "losses" }, st.body);
  const maxL = Math.max(con.base_loss, ...con.candidates.map(c => c.loss));
  const rowOf = {};
  const order = con.candidates.map((c, i) => ({ c, i }));
  const altNo = {}; alts.forEach((c, n) => (altNo[c.i] = `A${n + 1}`));
  const baseRow = el("div", { class: "loss basel" }, losses);
  baseRow.innerHTML = `<span class="lab">base</span><span class="bar"><i></i></span><span class="val">${num(con.base_loss)}</span>`;
  requestAnimationFrame(() => (baseRow.querySelector("i").style.width = `${(con.base_loss / maxL) * 100}%`));
  const candLines = {};
  for (const { c, i } of order) {
    const r = el("div", { class: "loss" + (c.origin === "forward" ? " fwd" : "") }, losses);
    r.innerHTML = `<span class="lab">${c.origin === "forward" ? "J⁰" : altNo[i]}</span><span class="bar"><i></i></span><span class="val">${num(c.loss)}</span>`;
    rowOf[i] = r; follow();
    const line = sv("path", { d: pathD(forecastPts(candidateForecast(c))), fill: "none", stroke: c.origin === "forward" ? "#8fb8d8" : "#b9a3d3", "stroke-width": 1.6, opacity: 0 }, chart.gCand);
    candLines[i] = line;
    $('.lg[data-k="cand"]').classList.remove("off");
    requestAnimationFrame(() => (r.querySelector("i").style.width = `${(c.loss / maxL) * 100}%`));
    await tween(500, t => line.setAttribute("opacity", 0.9 * t));
    await sleep(450);
  }
  await sleep(500);
  // selection
  const sel = con.selected;
  rowOf[sel].classList.add("win");
  candEls[sel] && candEls[sel].classList.add("sel");
  for (const [i, l] of Object.entries(candLines)) {
    if (+i === sel) { l.setAttribute("stroke", "#9467bd"); l.setAttribute("stroke-width", 2.6); l.setAttribute("opacity", 1); }
    else tween(500, t => l.setAttribute("opacity", 0.9 - 0.75 * t)).catch(() => {});
  }
  stop(); st.done();
  const win = con.candidates[sel];
  const verdict = el("div", { class: "result", style: "margin-top:4px" }, st.body);
  verdict.innerHTML = `<span>Selected ${win.origin === "forward" ? "J⁰ (original)" : altNo[sel]}</span><span class="chip mem">MSE ${num(win.loss)} vs base ${num(con.base_loss)}</span>`;
  follow();
  await sleep(1300);

  // 7. memory update
  stage("store");
  st = step("memory", "Memory update", "validated experience",
    con.stored ? "The selected decision improves on the base forecast, so it is retained for subsequent forecasts." : "No decision improves on the base forecast; nothing is retained.");
  if (con.stored && S.stored) {
    const card = el("div", { class: "stored" }, st.body);
    el("div", { class: "bh", html: `<i class="sq mem"></i>${fmtDate(S.origin_time)} · ${win.origin === "forward" ? "J⁰ kept" : "J* reconstructed"} · gain ${num(con.gain)}` }, card);
    const ch = el("div", { class: "chips" }, card);
    for (const j of S.stored.judgments) judgmentChip(j, "mem", ch);
    const bank = $("#bank");
    const cell = el("div", { class: "cell new", title: `${fmtDate(S.origin_time)} · stored` });
    bank.append(cell);
    chart.cells[S.window] = cell;
    const nEl = $("#bank-n");
    await tween(600, t => (nEl.textContent = Math.round(S.bank.length + t)));
    $("#bank-note").textContent = "including this window";
  }
  st.done("");
  follow();
  await sleep(700);
  tween(700, t => { chart.jc.setAttribute("opacity", 0.35 + 0.65 * t); chart.bl.forEach(l => l.setAttribute("opacity", 0.2 + 0.65 * t)); }).catch(() => {});
  el("div", { class: "endline" }, trace(), "Stored experience is retrievable for the next forecast.");
  follow();
  status("done", "Complete");
  stage("__end__");
}

// ---------------------------------------------------------------- setup + controls
function reset() {
  gen++; seed = 7; started = false; paused = true;
  shown.base = shown.jc = shown.obs = shown.bl = false; jcNow = null;
  $("#trace").innerHTML = "";
  $("#scoreboard").hidden = false; $("#scoreboard").style.visibility = "hidden";   // space held from the start: no jump when it appears
  for (const id of ["#sc-base", "#sc-bl", "#sc-jc", "#sc-delta"]) $(id).textContent = "–";
  for (const k of ["obs", "base", "bl", "jc", "res", "cand"]) $(`.lg[data-k="${k}"]`).classList.add("off");
  for (const li of $("#rail").children) li.className = "";
  focusCard(null);
  status("", "Ready");
  clock("Forecast origin", parseT(S.future_times[0]));
  drawChart(); drawCovariates(); drawBank();
  // two columns: if the left column would overflow, give the excess back from the chart so memory stays in view
  if (!narrow()) requestAnimationFrame(() => {
    const L = $(".left"), over = L.scrollHeight - L.clientHeight;
    if (over > 2 && CH > 180 && !started) { scales(Math.max(180, CH - over)); drawChart(); drawCovariates(); }
  });
  setView("forecast");
  requestAnimationFrame(fitBank);
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const hint = el("div", { class: "endline", style: "margin-top:30%;cursor:pointer" }, trace(), touch ? "Tap ▶ to run this window" : "Press Space to run this window");
  hint.onclick = () => play();
  hint.id = "hint";
  $("#btn-play").textContent = "▶";
}
function play() {
  if (!started) {
    started = true; const h = $("#hint"); if (h) h.remove();
    paused = false;
    run().catch(e => { if (!(e instanceof Abort)) console.error(e); });
  } else paused = !paused;
  $("#btn-play").textContent = paused ? "▶" : "❚❚";
  if (started && $("#status").classList.contains("run")) $("#status-text").textContent = paused ? "Paused" : "Running";
}
function setSpeed(s) {
  speed = s;
  document.querySelectorAll(".spd").forEach(b => b.classList.toggle("on", +b.dataset.s === s));
}

const HOR_LABEL = () => `${S.y_base.length}-step horizon`;

// ---------------------------------------------------------------- samples: the header switch loads another recorded window
async function load(w) {
  const tpl = document.body.dataset.scene;               // static export: "scene_{w}.json"; local server: /api/scene?w=
  const url = tpl ? tpl.replace("{w}", w || document.body.dataset.default || "") : `/api/scene${w ? "?w=" + encodeURIComponent(w) : ""}`;
  const res = await fetch(url);
  const next = await res.json();
  if (next.error) { if (!S) document.body.textContent = next.error; return; }
  gen++;                                                 // stop a run in progress before swapping the scene
  S = next;
  document.title = `JudgeCast · ${S.dataset.dataset}`;
  $("#m-tsfm").textContent = S.models.tsfm;
  const bl = S.baselines && S.baselines.length;
  $("#lg-bl").hidden = !bl; $("#sc-bl-box").hidden = !bl;
  if (bl) { $("#lg-bl-t").textContent = S.baselines[0].label; $("#sc-bl-k").textContent = `${S.baselines[0].label.replace(" + covariates", " +cov")} MSE`; }
  $("#m-llm").textContent = `${S.models.llm}${S.models.effort ? " · " + S.models.effort : ""}`;
  $("#target-title").textContent = `${S.dataset.dataset} · ${S.dataset.label}`;
  $("#target-sub").textContent = `${S.dataset.unit} · hourly · ${HOR_LABEL()} · ${S.split === "train" ? "memory is being built" : "memory fixed"}`;
  const d0 = parseT(S.origin_time);
  $("#trace-sub").textContent = `${DAYS[d0.getDay()]} ${fmtDate(S.origin_time)}`;
  const box = $("#samples"); box.innerHTML = "";
  for (const s of S.samples || []) {
    const b = el("button", { class: s.id === S.window ? "on" : "" }, box);
    el("span", { class: "smp-t" }, b, s.title);
    if (s.desc) el("span", { class: "smp-d" }, b, s.desc);
    b.onclick = () => { if (s.id !== S.window) load(s.id); };
  }
  box.hidden = !(S.samples && S.samples.length > 1);
  const q = new URLSearchParams(location.search);
  if (w && q.get("w") !== w) { q.set("w", w); history.replaceState(null, "", `${location.pathname}?${q}`); }
  scales(); reset();
}

async function init() {
  const q0 = new URLSearchParams(location.search);
  await load(q0.get("w") || "");
  if (!S) return;

  $("#btn-play").onclick = play;
  $("#btn-restart").onclick = reset;
  document.querySelectorAll(".spd").forEach(b => (b.onclick = () => setSpeed(+b.dataset.s)));
  document.addEventListener("keydown", e => {
    if (e.code === "Space") { e.preventDefault(); play(); }
    else if (e.key === "r" || e.key === "R") reset();
    else if (e.key === "h" || e.key === "H") $("#controls").classList.toggle("hide");
    else if (["1", "2", "4"].includes(e.key)) setSpeed(+e.key);
  });
  document.querySelectorAll("#views button").forEach(b => (b.onclick = () => setView(b.dataset.v)));
  if (window.ResizeObserver) new ResizeObserver(() => fitBank()).observe($("#bank"));
  window.addEventListener("resize", () => { if (!started) { scales(); reset(); } else fitBank(); });
  const q = new URLSearchParams(location.search);
  if (q.get("speed")) setSpeed(+q.get("speed"));
  if (q.has("clean")) $("#controls").classList.add("hide");
  if (q.has("autoplay")) setTimeout(play, 1200);
}
init();
