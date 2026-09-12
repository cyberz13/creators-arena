/* CREATORS ARENA tracking challenge — static, no request data is ever inlined here. */
(function () {
  var cfgEl = document.getElementById("ca-config");
  if (!cfgEl) return;
  var cfg;
  try {
    cfg = JSON.parse(cfgEl.textContent || "{}");
  } catch {
    return;
  }
  if (typeof cfg.code !== "string" || typeof cfg.t !== "string") return;

  var t0 = performance.now();
  var ix = 0;
  ["pointermove", "touchstart", "scroll", "keydown"].forEach(function (ev) {
    addEventListener(ev, function () { ix++; }, { passive: true });
  });
  var tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* unsupported */ }
  var fp = [
    screen.width, screen.height, screen.colorDepth, tz,
    navigator.hardwareConcurrency || 0, window.devicePixelRatio || 1,
  ].join("x");

  // A ~300ms window lets the loader breathe and captures touch/pointer liveness.
  setTimeout(function () {
    var url = new URL("/go/" + encodeURIComponent(cfg.code), location.origin);
    url.searchParams.set("t", cfg.t);
    url.searchParams.set("fp", fp);
    if (navigator.webdriver) url.searchParams.set("wd", "1");
    url.searchParams.set("el", String(Math.round(performance.now() - t0)));
    url.searchParams.set("ix", String(ix));
    if (document.referrer) url.searchParams.set("r", document.referrer);
    if (cfg.utm) url.searchParams.set("utm_source", cfg.utm);
    location.replace(url.href);
  }, 300);
})();
