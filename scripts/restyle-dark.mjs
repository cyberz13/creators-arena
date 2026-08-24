/**
 * One-time restyle: light theme → CREATORS ARENA dark identity.
 * Ordered regex rules — earlier outputs must not be re-matched by later rules.
 */
import fs from "node:fs";
import path from "node:path";

const RULES = [
  // backgrounds (specific before generic; generic bg-white guarded against /opacity)
  [/bg-white\/85/g, "bg-[#0B0B0F]/85"],
  [/bg-white\/95/g, "bg-[#0B0B0F]/95"],
  [/bg-white(?!\/)/g, "bg-[#17171C]"],
  [/bg-slate-950/g, "bg-[#08080A]"],
  [/bg-slate-900/g, "bg-[#1D1D24]"],
  [/bg-slate-100/g, "bg-white/10"],
  [/bg-slate-50(?!\/)/g, "bg-white/5"],
  [/divide-slate-100/g, "divide-white/5"],
  [/divide-slate-50/g, "divide-white/5"],
  // borders
  [/border-slate-200\/80/g, "border-white/10"],
  [/border-slate-200\/70/g, "border-white/10"],
  [/border-slate-200/g, "border-white/10"],
  [/border-slate-100/g, "border-white/[0.06]"],
  [/border-slate-300/g, "border-white/15"],
  // text
  [/text-slate-900/g, "text-white"],
  [/text-slate-800/g, "text-zinc-200"],
  [/text-slate-700/g, "text-zinc-300"],
  [/text-slate-600/g, "text-zinc-400"],
  [/text-slate-500/g, "text-zinc-400"],
  [/text-slate-400/g, "text-zinc-500"],
  [/text-slate-300/g, "text-zinc-400"],
  [/text-slate-200/g, "text-zinc-300"],
  // brand (opacity variants first)
  [/bg-brand-50\/50/g, "bg-brand-500/10"],
  [/bg-brand-50\/60/g, "bg-brand-500/10"],
  [/bg-brand-50\/70/g, "bg-brand-500/10"],
  [/bg-brand-50(?!\/|\d)/g, "bg-brand-500/10"],
  [/bg-brand-100/g, "bg-brand-500/15"],
  [/border-brand-200/g, "border-brand-500/30"],
  [/border-brand-300/g, "border-brand-500/40"],
  [/text-brand-800/g, "text-brand-200"],
  [/text-brand-700/g, "text-brand-300"],
  [/text-brand-600/g, "text-brand-400"],
  // amber
  [/bg-amber-50\/60/g, "bg-amber-500/10"],
  [/bg-amber-50(?!\/|\d)/g, "bg-amber-500/10"],
  [/bg-amber-100/g, "bg-amber-500/15"],
  [/from-amber-50(?!\/|\d)/g, "from-amber-500/10"],
  [/to-white(?!\/)/g, "to-transparent"],
  [/text-amber-900/g, "text-amber-200"],
  [/text-amber-800/g, "text-amber-300"],
  [/text-amber-700/g, "text-amber-300"],
  [/text-amber-600/g, "text-amber-400"],
  [/border-amber-200/g, "border-amber-500/30"],
  [/border-amber-300/g, "border-amber-500/40"],
  // emerald
  [/bg-emerald-100/g, "bg-emerald-500/15"],
  [/bg-emerald-50(?!\/|\d)/g, "bg-emerald-500/10"],
  [/text-emerald-700/g, "text-emerald-300"],
  [/text-emerald-600/g, "text-emerald-400"],
  // red
  [/bg-red-100/g, "bg-red-500/15"],
  [/bg-red-50(?!\/|\d)/g, "bg-red-500/10"],
  [/text-red-700/g, "text-red-300"],
  [/text-red-600/g, "text-red-400"],
  // avatar palette extras
  [/bg-rose-100/g, "bg-rose-500/20"],
  [/text-rose-700/g, "text-rose-300"],
  [/bg-sky-100/g, "bg-sky-500/20"],
  [/text-sky-700/g, "text-sky-300"],
  [/bg-violet-100/g, "bg-violet-500/20"],
  [/text-violet-700/g, "text-violet-300"],
  // hero radial overlays: indigo rgba → identity purple
  [/99,102,241/g, "139,92,246"],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(p);
  }
  return out;
}

let changed = 0;
for (const file of walk("src")) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;
  for (const [re, to] of RULES) after = after.replace(re, to);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed++;
    console.log("✔", file);
  }
}
console.log(`\n${changed} ملفًا حُدّث`);
