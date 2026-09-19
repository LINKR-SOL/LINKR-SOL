/**
 * Generates app/theme-dark.generated.css, the dark theme's colours: `node scripts/dark-theme.mjs`.
 *
 * The site's stylesheets hard-code their light palette, so rather than hand-copying ~1,500 colours this reads every
 * stylesheet in load order and re-declares each colour-bearing declaration under html[data-theme="dark"], with the
 * colour mapped to its dark equivalent by role: surfaces go dark, text goes light, brand accents keep their hue and
 * shadows stay shadows. Every colour declaration is re-declared, even ones that only use a var(), so the prefix adds
 * the same specificity to all of them and the light theme's cascade carries over to the dark one unchanged.
 *
 * Re-run it after changing a colour in any stylesheet below. Hand-tuned dark rules live in app/theme-dark.css, which
 * loads after the generated file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The order the site loads them in (layout first, then the pages' own).
const SOURCES = [
  "app/theme.css",
  "app/globals.css",
  "app/multi.css",
  "app/cinematic.css",
  "app/linkr.css",
  "app/hero-stage.css",
  "app/connection-engine.css",
  "app/launch/studio.css",
];
const OUT = "app/theme-dark.generated.css";
const DARK = 'html[data-theme="dark"]';

// ─── Colour maths (sRGB ⇄ OKLCH) ──────────────────────────────────────────────────────────────────────────────────
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function rgbToOklch([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), H: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}
function oklchToRgbRaw({ L, C, H }) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toGam);
}
function oklchToRgb(c) {
  // Keep lightness and hue, shed chroma until the colour fits in sRGB.
  let lo = 0, hi = c.C, rgb = oklchToRgbRaw(c);
  const fits = (v) => v.every((x) => x >= -0.0005 && x <= 1.0005);
  if (!fits(rgb)) {
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(oklchToRgbRaw({ ...c, C: mid }))) lo = mid; else hi = mid; }
    rgb = oklchToRgbRaw({ ...c, C: lo });
  }
  return rgb.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255));
}

const NAMED = { white: [255, 255, 255], black: [0, 0, 0] };
function parseColor(s) {
  s = s.trim().toLowerCase();
  if (NAMED[s]) return { rgb: NAMED[s], a: 1 };
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^rgba?\((.*)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.some((p) => p.startsWith("var("))) return null;
    const num = (p, max) => (p.endsWith("%") ? (parseFloat(p) / 100) * max : parseFloat(p));
    return { rgb: parts.slice(0, 3).map((p) => num(p, 255)), a: parts[3] !== undefined ? num(parts[3], 1) : 1 };
  }
  return null;
}
function formatColor(rgb, a) {
  const hex = (n) => Math.round(n).toString(16).padStart(2, "0");
  a = Math.min(1, Math.max(0, a));
  return `#${rgb.map(hex).join("")}${a >= 0.998 ? "" : hex(a * 255)}`;
}

// ─── The dark palette, by role ───────────────────────────────────────────────────────────────────────────────────
// A saturated, mid-light colour is a brand/state accent (cobalt, signal orange, green, red): it keeps its hue.
const isAccent = ({ L, C }) => C >= 0.075 && L >= 0.33 && L <= 0.82;
// Neutrals take LINKR's navy hue so dark greys read as ink, not charcoal.
const tint = (c, maxC = 0.045) => (c.C < 0.012 ? { H: 258, C: 0.02 } : { H: c.H, C: Math.min(c.C, maxC) });
const WHITE = [255, 255, 255];
const SHADOW = oklchToRgb({ L: 0.09, C: 0.025, H: 262 });

const lightText = (L) => Math.min(0.955, Math.max(0.5, 1.1 - 0.78 * L));
function surfaceL(L) {
  if (L >= 0.995) return 0.245; // pure white cards and glass sit just above the page
  return Math.min(0.5, 0.19 + (0.995 - L) * 0.7); // the off-white page lands on deep navy, tints a touch lighter
}

function map(color, role, ruleOnDark) {
  const { rgb, a } = color;
  if (a === 0) return formatColor(rgb, 0);
  const c = rgbToOklch(rgb);
  const out = (L, extra = {}) => formatColor(oklchToRgb({ ...c, ...tint(c), L, ...extra }), extra.a ?? a);
  switch (role) {
    case "text":
      if (ruleOnDark || c.L >= 0.8) return formatColor(rgb, a); // already light: it sits on a dark or coloured ground
      if (isAccent(c)) return formatColor(oklchToRgb({ ...c, L: Math.max(c.L, 0.7) }), a);
      return out(lightText(c.L), { ...tint(c, 0.022) });
    case "surface":
      if (isAccent(c)) return formatColor(rgb, a); // cobalt buttons stay cobalt
      if (c.L < 0.45) return out(Math.max(c.L, 0.17), { C: Math.min(c.C, 0.06) }); // deliberately dark grounds stay dark
      if (c.L > 0.9 && a < 0.25) return formatColor(WHITE, a * 0.3); // faint white sheens become faint light sheens
      return out(surfaceL(c.L));
    case "border":
      if (isAccent(c)) return formatColor(rgb, a);
      if (c.L >= 0.97) return formatColor(WHITE, Math.max(0.06, a * 0.12)); // white glass edges become a faint rim
      if (c.L < 0.5) return ruleOnDark ? formatColor(rgb, a) : out(lightText(c.L), { ...tint(c, 0.022) });
      return out(Math.min(0.62, 0.285 + (0.97 - c.L) * 1.0), { ...tint(c, 0.07) }); // tinted lines keep some blue
    case "graphic": // svg fills, strokes and stops set from CSS
      if (isAccent(c)) return formatColor(rgb, a);
      if (c.L < 0.6) return out(lightText(c.L), { ...tint(c, 0.022) });
      return map(color, "border", ruleOnDark);
    case "shadow":
      if (isAccent(c) && c.L >= 0.5 && c.C >= 0.1) return formatColor(rgb, a); // bright coloured glows stay glows
      if (c.L > 0.9) return map(color, "surface", ruleOnDark); // white rings that cut a shape out of the page
      return formatColor(SHADOW, Math.min(0.7, a * 2.4 + 0.06));
    case "inset":
      if (isAccent(c)) return formatColor(rgb, a);
      if (c.L > 0.85) return formatColor(WHITE, Math.min(0.14, a * 0.12)); // inner highlight → faint rim light
      return formatColor(SHADOW, Math.min(0.6, a * 1.6));
    default:
      throw new Error(role);
  }
}

// ─── Which declarations carry colour, and in which role ──────────────────────────────────────────────────────────
function roleOf(prop) {
  if (prop === "color" || prop === "caret-color" || prop === "-webkit-text-fill-color" || prop.startsWith("text-decoration") || prop === "accent-color") return "text";
  if (prop.startsWith("background")) return "surface";
  if (/^(border|outline|column-rule)/.test(prop) && !/radius|spacing|collapse|width|style|image/.test(prop)) return "border";
  if (prop === "box-shadow" || prop === "text-shadow") return "shadow";
  if (prop === "filter") return "shadow";
  if (prop === "fill" || prop === "stroke" || prop === "stop-color" || prop === "flood-color" || prop === "lighting-color") return "graphic";
  if (prop === "-webkit-text-stroke" || prop === "-webkit-text-stroke-color") return "text";
  return null;
}
// Longhands a colour shorthand resets: re-declared with it so a dark `background:` never wipes a later light
// `background-size:` that used to win.
const RESET_PROPS = /^(background|border(?!-radius)|outline|text-decoration|column-rule)(-|$)/;

function varRole(name) {
  if (/soft-white|on-accent|fg-on/.test(name)) return "keep";
  if (/shadow|glow/.test(name)) return "shadow";
  if (/border|line|grid|rule|edge|stroke|ring/.test(name)) return "border";
  if (/wash/.test(name)) return "surface";
  if (/(^--(fg|text|ink|c-ink|slate|muted|faint)\b)|-(fg|text|ink|muted|faint)$|^--(pos|neg|positive|negative|accent-text|signal-ink|slate-)/.test(name)) return "text";
  if (/bg|surface|paper|canvas|wash|plum|sand|glass|panel|card|track|band|sunken|raised|tile|chip|fill/.test(name)) return "surface";
  if (/accent|signal|brand|cobalt|blue|orange/.test(name)) return "keep";
  return null; // decided per colour below
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|(?<![\w-])(?:white|black)(?![\w-])/g;
function splitTop(value, sep = ",") {
  const out = [];
  let depth = 0, cur = "", quote = null;
  for (const ch of value) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function replaceColors(value, fn) {
  // Leave url(...) alone: data-URI SVGs carry their own colours.
  const urls = [];
  const masked = value.replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)/g, (u) => ` ${urls.push(u) - 1} `);
  const replaced = masked.replace(COLOR_RE, (lit) => {
    const c = parseColor(lit);
    return c ? fn(c) : lit;
  });
  return replaced.replace(/ (\d+) /g, (_, i) => urls[+i]);
}
const hasColor = (v) => replaceColors(v, () => "") !== v;

// Surfaces that paint with a token the dark theme turns light (ink is text-coloured) keep a dark ink ground instead.
const INK_GROUND = { "--ink": "var(--ink-ground)", "--c-ink": "var(--ink-ground)" };

function darkValue(prop, value, ruleOnDark) {
  if (prop.startsWith("--")) {
    if (!hasColor(value)) return null;
    const vr = varRole(prop);
    if (vr === "keep") return value;
    if (vr === "shadow") return shadowList(value, false);
    return replaceColors(value, (c) => map(c, vr ?? (rgbToOklch(c.rgb).L > 0.6 ? "surface" : "text"), false));
  }
  const role = roleOf(prop);
  if (role === "surface") {
    let v = value;
    for (const [token, ground] of Object.entries(INK_GROUND)) v = v.replaceAll(`var(${token})`, ground);
    return replaceColors(v, (c) => map(c, "surface", ruleOnDark));
  }
  if (role === "shadow") return shadowList(value, ruleOnDark);
  if (role) return replaceColors(value, (c) => map(c, role, ruleOnDark));
  return value;
}
function shadowList(value, ruleOnDark) {
  return splitTop(value)
    .map((part) => replaceColors(part, (c) => map(c, /\binset\b/.test(part) ? "inset" : "shadow", ruleOnDark)))
    .join(",");
}

// A rule that paints its own dark or coloured ground keeps its light text as it is.
function ruleHasDarkGround(rule) {
  let dark = false;
  rule.each((d) => {
    if (d.type !== "decl" || !/^background(-color|-image)?$/.test(d.prop)) return;
    const first = d.value.replace(/url\([^)]*\)/g, "").match(COLOR_RE);
    const c = first && parseColor(first[0]);
    if (!c || c.a < 0.5) return;
    const o = rgbToOklch(c.rgb);
    if (o.L < 0.45 || isAccent(o)) dark = true;
  });
  if (/var\(--(ink|c-ink|accent|accent-cta|signal)\)/.test(rule.toString().match(/background[^;]*/)?.[0] ?? "")) dark = true;
  return dark;
}

function prefixSelector(sel) {
  return splitTop(sel)
    .map((s) => {
      s = s.trim();
      if (!s) return s;
      if (s.startsWith(":root")) return `:root[data-theme="dark"]${s.slice(5)}`;
      if (/^html(?![\w-])/.test(s)) return `html[data-theme="dark"]${s.slice(4)}`;
      return `${DARK} ${s}`;
    })
    .join(",");
}

// ─── Build ───────────────────────────────────────────────────────────────────────────────────────────────────────
const out = postcss.root();
const warnings = [];
let decls = 0;
for (const file of SOURCES) {
  const src = fs.readFileSync(path.join(web, file), "utf8");
  const root = postcss.parse(src, { from: file });
  const section = postcss.root();
  root.walkRules((rule) => {
    // Only plain rules, possibly inside @media / @supports / @container.
    let p = rule.parent;
    const wrappers = [];
    while (p && p.type !== "root") {
      if (p.type === "atrule" && /^(media|supports|container)$/.test(p.name)) wrappers.unshift(p);
      else { if (p.type === "atrule" && p.name === "keyframes" && hasColor(rule.toString())) warnings.push(`${file}: colour in @keyframes ${p.params} left as is`); return; }
      p = p.parent;
    }
    const onDark = ruleHasDarkGround(rule);
    const colourDecls = [];
    rule.each((d) => {
      if (d.type !== "decl") return;
      const isColourProp = d.prop.startsWith("--") ? hasColor(d.value) : roleOf(d.prop) || RESET_PROPS.test(d.prop);
      if (!isColourProp) return;
      const v = darkValue(d.prop, d.value, onDark);
      if (v === null) return;
      colourDecls.push(postcss.decl({ prop: d.prop, value: v, important: d.important }));
    });
    if (!colourDecls.length) return;
    decls += colourDecls.length;
    let node = postcss.rule({ selector: prefixSelector(rule.selector) });
    colourDecls.forEach((d) => node.append(d));
    for (const w of [...wrappers].reverse()) { const at = postcss.atRule({ name: w.name, params: w.params }); at.append(node); node = at; }
    section.append(node);
  });
  if (section.nodes.length) {
    out.append(postcss.comment({ text: ` ${file} ` }));
    section.each((n) => out.append(n.clone()));
  }
}

const header = `/* GENERATED by scripts/dark-theme.mjs from the light stylesheets. Do not edit: change the source colour and
   re-run \`node scripts/dark-theme.mjs\`. Hand-tuned dark rules go in theme-dark.css. */\n`;
out.walkDecls((d) => { d.raws.before = ""; d.raws.between = ":"; });
out.walk((n) => { if (n.type === "rule" || n.type === "atrule") { n.raws.before = "\n"; n.raws.between = ""; n.raws.after = ""; n.raws.semicolon = false; } });
const css = header + out.toResult({ map: false }).css.trim() + "\n";
fs.writeFileSync(path.join(web, OUT), css);
console.log(`${OUT}: ${decls} declarations, ${(css.length / 1024).toFixed(1)} KB`);
for (const w of new Set(warnings)) console.log("note:", w);
