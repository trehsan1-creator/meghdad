/* ==========================================================================
   قصهٔ ما — mobile story engine
   ========================================================================== */
(function () {
  "use strict";

  var cfg = window.WEDDING_CONFIG || {};
  var body = document.body;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------ helpers */
  var FA = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];
  function fa(v) { return String(v).replace(/[0-9]/g, function (d) { return FA[+d]; }); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(v, a, b) { return clamp((v - a) / (b - a), 0, 1); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function buzz(ms) {
    if (reduced) return;
    try { navigator.vibrate && navigator.vibrate(ms || 8); } catch (e) {}
  }

  var toastEl = $("#toast"), toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2600);
  }

  /* ------------------------------------------------------------ config binding */
  function text(v, fallback) {
    var s = (v === null || v === undefined) ? "" : String(v).trim();
    return s || fallback || "";
  }

  $$("[data-config]").forEach(function (el) {
    var key = el.getAttribute("data-config");
    var val = text(cfg[key]);
    if (val) { el.textContent = val; return; }
    // مقدار خالی → متن placeholder را به مهمان نشان نمی‌دهیم
    var row = el.closest(".row__text") ? el : null;
    if (row) { el.hidden = true; }
  });

  var chapters = Array.isArray(cfg.chapters) ? cfg.chapters : [];
  $$("[data-chapter]").forEach(function (act) {
    var c = chapters[+act.getAttribute("data-chapter")];
    if (!c) return;
    var k = $("[data-chapter-kicker]", act);
    var t = $("[data-chapter-title]", act);
    var b = $("[data-chapter-body]", act);
    if (k) k.textContent = text(c.kicker);
    if (t) t.textContent = text(c.title);
    if (b) b.textContent = text(c.body);
  });

  /* ------------------------------------------------------------ guest personalization */
  var guestName = "";
  try {
    var q = new URLSearchParams(location.search);
    guestName = text(q.get("to") || q.get("guest")).slice(0, 40);
  } catch (e) {}

  if (guestName) {
    var greet = $("#guestGreeting");
    if (greet) { greet.textContent = guestName + " عزیز، این دعوت برای شماست"; greet.hidden = false; }
  }

  /* ------------------------------------------------------------ viewport unit */
  function setVh() {
    var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty("--vh", h + "px");
  }
  setVh();

  /* ------------------------------------------------------------ preload + overture */
  var overture = $("#overture");
  var startBtn = $("#startButton");
  var loader = $("#loaderBar");
  var loaderFill = loader ? loader.querySelector("i") : null;

  var firstAct = $("#act-1");
  var critical = firstAct ? $$("img", firstAct) : [];
  var loaded = 0;

  function bumpLoader() {
    loaded++;
    var pct = Math.round((loaded / Math.max(1, critical.length)) * 100);
    if (loaderFill) loaderFill.style.width = pct + "%";
    if (loader) loader.setAttribute("aria-valuenow", String(pct));
    if (loaded >= critical.length) ready();
  }

  function ready() {
    if (loader) loader.classList.add("is-done");
    if (startBtn) startBtn.disabled = false;
  }

  if (!critical.length) { ready(); }
  else {
    critical.forEach(function (img) {
      var done = false;
      var finish = function () { if (!done) { done = true; bumpLoader(); } };
      if (img.complete && img.naturalWidth) { finish(); return; }
      img.addEventListener("load", finish, { once: true });
      img.addEventListener("error", finish, { once: true });
    });
    setTimeout(ready, 4000); // هرگز مهمان را پشت شبکهٔ ضعیف زندانی نمی‌کنیم
  }

  var started = false;
  function begin(jumpToInvite) {
    if (started) return;
    started = true;
    body.classList.remove("is-booting", "is-locked");
    body.classList.add("is-live");
    if (overture) overture.classList.add("is-gone");
    buzz(12);
    askGyro();
    measure();
    if (jumpToInvite) {
      requestAnimationFrame(function () { gotoAct(5, true); });
    }
    setTimeout(function () { if (overture) overture.style.display = "none"; }, 1000);
  }

  if (startBtn) startBtn.addEventListener("click", function () { begin(false); });
  var overtureSkip = $("#overtureSkip");
  if (overtureSkip) overtureSkip.addEventListener("click", function () { begin(true); });

  /* ------------------------------------------------------------ gyro parallax */
  var gyroX = 0, gyroTarget = 0;
  function onTilt(e) {
    var g = e.gamma; // -90..90
    if (typeof g !== "number") return;
    gyroTarget = clamp(g / 45, -1, 1) * 9;
    startLoop();
  }
  function askGyro() {
    if (reduced || !window.DeviceOrientationEvent) return;
    var DOE = window.DeviceOrientationEvent;
    if (typeof DOE.requestPermission === "function") {
      DOE.requestPermission().then(function (r) {
        if (r === "granted") window.addEventListener("deviceorientation", onTilt);
      }).catch(function () {});
    } else {
      window.addEventListener("deviceorientation", onTilt);
    }
  }

  /* ------------------------------------------------------------ story engine */
  var acts = $$(".act").map(function (el) {
    var cells = $$(".cell", el);
    return {
      el: el,
      stage: $(".stage", el),
      cells: cells,
      n: Math.max(1, cells.length),
      isStory: el.classList.contains("act--story"),
      no: el.getAttribute("data-no") || "۰۰",
      name: el.getAttribute("data-name") || "",
      top: 0, span: 1,
      target: 0, current: 0,
      liveIndex: -1,
      playing: false, t0: 0, shown: 0
    };
  });

  /* یک میلهٔ نامرئی با ارتفاع 100svh — دقیقاً همان ارتفاعی که صحنهٔ چسبان دارد.
     قبلاً vh را از visualViewport می‌گرفتیم که با نوار آدرس بالا و پایین می‌شد
     و با ارتفاع واقعی صحنه نمی‌خواند → درصد پیشرفت فصل مدام می‌لغزید. */
  var probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:100svh;pointer-events:none;visibility:hidden;";
  document.body.appendChild(probe);

  var vh = probe.offsetHeight || window.innerHeight;
  var docSpan = 1;

  function measure() {
    setVh();
    vh = probe.offsetHeight || window.innerHeight;
    acts.forEach(function (a) {
      var r = a.el.getBoundingClientRect();
      a.top = r.top + window.scrollY;
      a.span = Math.max(1, a.el.offsetHeight - (a.isStory ? vh : 0));
    });
    docSpan = Math.max(1, document.documentElement.scrollHeight - vh);
    update();
  }

  var activeIndex = -1;
  var chapterNo = $("#chapterNo"), chapterName = $("#chapterName");
  var railDots = $$(".rail__dot");
  var dockProgress = $("#dockProgress");

  function update() {
    var y = window.scrollY;

    // dock progress
    var pageP = clamp(y / docSpan, 0, 1);
    if (dockProgress) dockProgress.style.width = (pageP * 100).toFixed(2) + "%";

    // active chapter = nearest to viewport centre
    var centre = y + vh / 2, best = 0, bestD = Infinity;
    acts.forEach(function (a, i) {
      var d = Math.abs((a.top + a.el.offsetHeight / 2) - centre);
      if (d < bestD) { bestD = d; best = i; }
    });

    if (best !== activeIndex) {
      activeIndex = best;
      var a = acts[best];
      if (chapterNo) chapterNo.textContent = a.no;
      if (chapterName) chapterName.textContent = a.name;
      railDots.forEach(function (d, i) { d.classList.toggle("is-active", i === best); });
      acts.forEach(function (x, i) {
        if (x.stage) x.stage.classList.toggle("is-playing", i === best);
      });
      body.classList.toggle("at-end", best === acts.length - 1);
    }

    acts.forEach(function (a) {
      if (!a.isStory) return;
      // ۱:۱ با انگشت. قبلاً میانگین‌گیری می‌کردیم و تصویر عقب‌تر از دست حرکت
      // می‌کرد — همان حس «لیزی و ول» که آزاردهنده بود.
      a.target = a.current = clamp((y - a.top) / a.span, 0, 1);
    });

    schedule();
  }

  /* ------------------------------------------------------------ film player
     فریم‌ها دیگر به انگشت گره نخورده‌اند. هر فصلی که وارد کادر شود
     خودش فریم‌هایش را پخش می‌کند و تا وقتی در دید است لوپ می‌زند.
     اسکرول فقط جابه‌جایی بین فصل‌هاست — سبک و آزاد. */
  var HOLD = 2500;                 // ms ماندن هر فریم روی پرده
  var FADE = 1200;                 // ms دیزالوی بین دو فریم
  var CYCLE = HOLD + FADE;
  var HOLD_R = HOLD / CYCLE;

  function ss(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  function paint() {
    var now = performance.now();

    acts.forEach(function (a) {
      if (!a.isStory || !a.stage) return;
      if (!a.playing && a.shown <= 0) return;

      var since = now - a.t0;
      var t = a.n > 1 ? (since % (a.n * CYCLE)) : Math.min(since, CYCLE);
      var pos = t / CYCLE;
      var idx = Math.min(a.n - 1, Math.floor(pos));
      var frac = pos - idx;

      // دیزالو فقط در انتهای مکث هر فریم رخ می‌دهد
      var mix = (a.n > 1 && frac > HOLD_R) ? ss((frac - HOLD_R) / (1 - HOLD_R)) : 0;
      var nxt = (idx + 1) % a.n;
      var zoom = a.n > 1 ? 0.07 : 0.02;

      a.cells.forEach(function (c, i) {
        var o = 0, ph = 0;
        if (i === idx) { o = 1 - mix; ph = frac; }
        else if (i === nxt && mix > 0) { o = mix; ph = frac - 1; }

        var vis = o * a.shown;
        c.style.opacity = vis.toFixed(3);
        c.style.visibility = vis > 0.002 ? "visible" : "hidden";

        if (o > 0) {
          var k = clamp(ph, 0, 1);
          var dx = gyroX + (i % 2 ? -1 : 1) * k * 5;
          c.style.transform =
            "translate3d(" + dx.toFixed(2) + "px,0,0) scale(" + (1.015 + k * zoom).toFixed(4) + ")";
        }
      });

      if (idx !== a.liveIndex) {
        a.liveIndex = idx;
        a.cells.forEach(function (c, i) {
          if (i > 0) c.setAttribute("aria-hidden", i === idx ? "false" : "true");
        });
      }

      var st = a.stage.style;
      st.setProperty("--cut", (4 * mix * (1 - mix)).toFixed(3));
      st.setProperty("--copy", ss((since - 450) / 900).toFixed(3));
      st.setProperty("--bar", (1 - a.shown).toFixed(3));
      st.setProperty("--gx", gyroX.toFixed(2));
    });
  }

  var running = false, lastT = 0;
  function loop(now) {
    now = now || performance.now();
    var dt = clamp((now - lastT) / 1000, 0.001, 0.05);
    lastT = now;

    gyroX += (gyroTarget - gyroX) * 0.08;

    var alive = false;
    acts.forEach(function (a) {
      if (!a.isStory) return;
      if (a.playing) a.shown = Math.min(1, a.shown + dt / 0.45);
      else           a.shown = Math.max(0, a.shown - dt / 0.35);
      if (a.playing || a.shown > 0) alive = true;
    });

    paint();
    if (autoplay.on) autoTick(now);

    if (alive || autoplay.on || Math.abs(gyroTarget - gyroX) > 0.05) requestAnimationFrame(loop);
    else running = false;
  }
  function startLoop() {
    if (running) return;
    running = true;
    lastT = performance.now();
    requestAnimationFrame(loop);
  }
  function schedule() { startLoop(); }

  /* هر فصل وقتی نیمی از صفحه را گرفت، پخشش خودبه‌خود شروع می‌شود */
  if ("IntersectionObserver" in window) {
    acts.forEach(function (a) { a.el.__act = a; });
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        var a = en.target.__act;
        if (!a || !a.isStory) return;
        if (en.intersectionRatio >= 0.5 && !a.playing) {
          a.playing = true;
          a.t0 = performance.now();
          a.liveIndex = -1;
          if (a.stage) a.stage.classList.add("is-playing");
        } else if (en.intersectionRatio < 0.2 && a.playing) {
          a.playing = false;
          if (a.stage) a.stage.classList.remove("is-playing");
        }
      });
      startLoop();
    }, { threshold: [0, 0.2, 0.5, 0.8, 1] });
    acts.forEach(function (a) { if (a.isStory) io.observe(a.el); });
  } else {
    acts.forEach(function (a) {
      if (a.isStory) { a.playing = true; a.t0 = performance.now(); }
    });
    startLoop();
  }

  /* ------------------------------------------------------------ navigation */
  function gotoAct(i, instant, keepAuto) {
    var a = acts[i];
    if (!a) return;
    if (!keepAuto) autoplay.stop();
    window.scrollTo({
      top: a.top,
      behavior: (instant || reduced) ? "auto" : "smooth"
    });
    buzz(8);
  }

  railDots.forEach(function (dot) {
    dot.addEventListener("click", function () { gotoAct(+dot.getAttribute("data-goto")); });
  });

  var skipButton = $("#skipButton");
  if (skipButton) skipButton.addEventListener("click", function () { gotoAct(acts.length - 1); });

  /* ------------------------------------------------------------ autoplay cinema
     مهم‌ترین حل مشکل «اسکرول روی موبایل سخت است»:
     کاربر یک بار play می‌زند و قصه خودش جلو می‌رود. هر لمسی فوراً مکث می‌کند.
     ------------------------------------------------------------ */
  var autoplayBtn = $("#autoplayButton");

  var autoplay = {
    on: false,
    last: 0,
    speed: 96, // px در ثانیه → کل قصه حدود ۷۵ ثانیه
    start: function () {
      if (this.on) return;
      this.on = true;
      this.last = performance.now();
      if (autoplayBtn) autoplayBtn.setAttribute("aria-pressed", "true");
      if (autoplayBtn) autoplayBtn.setAttribute("aria-label", "توقف پخش خودکار");
      startLoop();
      toast("پخش خودکار — برای توقف صفحه را لمس کنید");
      buzz(10);
    },
    stop: function () {
      if (!this.on) return;
      this.on = false;
      if (autoplayBtn) autoplayBtn.setAttribute("aria-pressed", "false");
      if (autoplayBtn) autoplayBtn.setAttribute("aria-label", "پخش خودکار قصه");
    },
    toggle: function () { this.on ? this.stop() : this.start(); }
  };

  /* پخش خودکار = هر فصل یک دور کامل فریم‌هایش را پخش کند، بعد برود فصل بعد.
     دیگر صفحه را پیکسل‌به‌پیکسل نمی‌لغزانیم — خود آن منبع حس بد بود. */
  function autoTick(now) {
    var a = acts[activeIndex];
    if (!a) return;
    if (a.isStory) {
      if (!a.playing) return;
      if (now - a.t0 < a.n * CYCLE + 300) return;
    } else if (now - autoplay.last < 3400) {
      return;
    }
    if (activeIndex >= acts.length - 1) { autoplay.stop(); return; }
    autoplay.last = now;
    gotoAct(activeIndex + 1, false, true);
  }

  if (autoplayBtn) autoplayBtn.addEventListener("click", function () { autoplay.toggle(); });

  ["touchstart", "wheel", "keydown", "pointerdown"].forEach(function (evt) {
    window.addEventListener(evt, function (e) {
      if (!autoplay.on) return;
      if (autoplayBtn && autoplayBtn.contains(e.target)) return;
      autoplay.stop();
    }, { passive: true });
  });

  /* ------------------------------------------------------------ particles */
  function seed(sel, cls, count) {
    var host = $(sel);
    if (!host || reduced) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var s = document.createElement("span");
      s.className = cls;
      s.style.insetInlineStart = (Math.random() * 92 + 4).toFixed(1) + "%";
      s.style.top = (Math.random() * 80).toFixed(1) + "%";
      s.style.setProperty("--delay", (Math.random() * 6).toFixed(2) + "s");
      s.style.setProperty("--dur", (cls === "petal" ? 8 + Math.random() * 5 : 3 + Math.random() * 3).toFixed(2) + "s");
      frag.appendChild(s);
    }
    host.appendChild(frag);
  }
  seed(".petals", "petal", 8);
  seed(".sparkles", "spark", 10);

  /* ------------------------------------------------------------ countdown */
  var eventAt = cfg.eventDate ? new Date(cfg.eventDate) : null;
  var cdHint = $("#countdownHint");
  var cdEls = {
    days: $("[data-count='days']"),
    hours: $("[data-count='hours']"),
    minutes: $("[data-count='minutes']"),
    seconds: $("[data-count='seconds']")
  };

  function renderCountdown() {
    if (!eventAt || isNaN(eventAt.getTime())) {
      if (cdHint) cdHint.textContent = "به‌زودی زمان دقیق را اعلام می‌کنیم";
      return;
    }
    var diff = eventAt.getTime() - Date.now();
    if (diff <= 0) {
      Object.keys(cdEls).forEach(function (k) { if (cdEls[k]) cdEls[k].textContent = "۰۰"; });
      if (cdHint) cdHint.textContent = "امروز روز جشن ماست — منتظرتان هستیم";
      return;
    }
    var s = Math.floor(diff / 1000);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (cdEls.days)    cdEls.days.textContent    = fa(pad(d));
    if (cdEls.hours)   cdEls.hours.textContent   = fa(pad(h));
    if (cdEls.minutes) cdEls.minutes.textContent = fa(pad(m));
    if (cdEls.seconds) cdEls.seconds.textContent = fa(pad(sec));
  }
  renderCountdown();
  setInterval(renderCountdown, 1000);

  /* ------------------------------------------------------------ map / address / calendar */
  var mapBtn = $("#mapButton");
  if (mapBtn) {
    var mapUrl = text(cfg.mapUrl);
    if (mapUrl) { mapBtn.href = mapUrl; mapBtn.hidden = false; }
    else { mapBtn.remove(); }
  }

  function copy(str, okMsg) {
    var done = function () { toast(okMsg); buzz(10); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(done).catch(function () { fallbackCopy(str, done); });
    } else { fallbackCopy(str, done); }
  }
  function fallbackCopy(str, done) {
    var ta = document.createElement("textarea");
    ta.value = str;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); }
    catch (e) { toast("کپی نشد — لطفاً دستی انتخاب کنید"); }
    document.body.removeChild(ta);
  }

  var copyAddr = $("#copyAddress");
  if (copyAddr) {
    var addr = [text(cfg.venue), text(cfg.address)].filter(Boolean).join(" — ");
    if (!addr) copyAddr.remove();
    else copyAddr.addEventListener("click", function () { copy(addr, "نشانی کپی شد"); });
  }

  function icsStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
           pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "00Z";
  }

  var calBtn = $("#calButton");
  if (calBtn) {
    if (!eventAt || isNaN(eventAt.getTime())) calBtn.remove();
    else calBtn.addEventListener("click", function () {
      var end = cfg.eventEndDate ? new Date(cfg.eventEndDate) : new Date(eventAt.getTime() + 5 * 3600e3);
      var title = "جشن عروسی " + text(cfg.groomName) + " و " + text(cfg.brideName);
      var loc = [text(cfg.venue), text(cfg.address)].filter(Boolean).join(" — ");
      var ics = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//wedding//fa//",
        "BEGIN:VEVENT",
        "UID:" + Date.now() + "@wedding",
        "DTSTAMP:" + icsStamp(new Date()),
        "DTSTART:" + icsStamp(eventAt),
        "DTEND:" + icsStamp(end),
        "SUMMARY:" + title,
        "LOCATION:" + loc,
        "END:VEVENT", "END:VCALENDAR"
      ].join("\r\n");

      var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "wedding.ics";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast("فایل تقویم آماده شد");
      buzz(10);
    });
  }

  /* ------------------------------------------------------------ share */
  var shareBtn = $("#shareButton");
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      var title = "دعوت‌نامهٔ عروسی " + text(cfg.groomName) + " و " + text(cfg.brideName);
      if (navigator.share) {
        navigator.share({ title: title, text: title, url: location.href }).catch(function () {});
      } else {
        copy(location.href, "لینک دعوت‌نامه کپی شد");
      }
    });
  }

  /* ------------------------------------------------------------ music */
  var audio = $("#music");
  var musicBtn = $("#musicButton");
  if (musicBtn && audio) {
    if (cfg.musicEnabled && text(cfg.musicSrc)) {
      audio.src = cfg.musicSrc;
      audio.loop = true;
      audio.volume = 0.5;
      musicBtn.hidden = false;

      function markOn() {
        musicBtn.setAttribute("aria-pressed", "true");
        musicBtn.setAttribute("aria-label", "قطع موسیقی");
      }
      function markOff() {
        musicBtn.setAttribute("aria-pressed", "false");
        musicBtn.setAttribute("aria-label", "پخش موسیقی");
      }

      /* موسیقی به‌صورت پیش‌فرض پخش می‌شود، ولی دقیقاً روی همان لمسی که
         قصه را شروع می‌کند. مرورگرهای موبایل پخش بدون لمس کاربر را
         بلوک می‌کنند؛ این تنها راه قانونی و مطمئن است. صدا هم ناگهانی
         نمی‌آید — در ۱.۸ ثانیه نرم بالا می‌آید. */
      function playMusic() {
        audio.volume = 0;
        var pr = audio.play();
        if (!pr || !pr.then) return;
        pr.then(function () {
          markOn();
          var t0 = performance.now();
          requestAnimationFrame(function fade(now) {
            var k = Math.min(1, (now - t0) / 1800);
            audio.volume = 0.5 * k;
            if (k < 1) requestAnimationFrame(fade);
          });
        }).catch(function () { markOff(); });
      }

      if (startBtn) startBtn.addEventListener("click", playMusic);
      var skipEl = document.getElementById("overtureSkip");
      if (skipEl) skipEl.addEventListener("click", playMusic);

      musicBtn.addEventListener("click", function () {
        if (audio.paused) {
          audio.volume = 0.55;
          audio.play().then(function () {
            musicBtn.setAttribute("aria-pressed", "true");
            musicBtn.setAttribute("aria-label", "قطع موسیقی");
          }).catch(function () { toast("پخش موسیقی ممکن نشد"); });
        } else {
          audio.pause();
          musicBtn.setAttribute("aria-pressed", "false");
          musicBtn.setAttribute("aria-label", "پخش موسیقی");
        }
      });
    } else {
      musicBtn.remove();
      audio.remove();
    }
  }

  /* ------------------------------------------------------------ RSVP */
  var form = $("#rsvpForm");
  var nameInput = $("#guestName");
  var errName = $("#errName");
  var errAtt = $("#errAttendance");
  var countOut = $("#guestCount");
  var countField = $("#countField");
  var minus = $("#countMinus"), plus = $("#countPlus");
  var doneCard = $("#rsvpDone"), doneBody = $("#doneBody"), doneTitle = $("#doneTitle");
  var STORE = "wedding.rsvp.v1";

  var count = 1;
  function renderCount() {
    if (countOut) countOut.textContent = fa(count);
    if (minus) minus.disabled = count <= 1;
    if (plus) plus.disabled = count >= 10;
  }
  renderCount();

  if (minus) minus.addEventListener("click", function () { if (count > 1) { count--; renderCount(); buzz(6); } });
  if (plus) plus.addEventListener("click", function () { if (count < 10) { count++; renderCount(); buzz(6); } });

  if (guestName && nameInput && !nameInput.value) nameInput.value = guestName;

  function attendance() {
    var picked = form ? form.querySelector("input[name='attendance']:checked") : null;
    return picked ? picked.value : null;
  }

  $$("input[name='attendance']").forEach(function (r) {
    r.addEventListener("change", function () {
      if (errAtt) errAtt.hidden = true;
      if (countField) countField.hidden = r.value === "no";
      buzz(8);
    });
  });

  if (nameInput) {
    nameInput.addEventListener("input", function () {
      if (nameInput.value.trim()) {
        nameInput.removeAttribute("aria-invalid");
        if (errName) errName.hidden = true;
      }
    });
  }

  function validate() {
    var ok = true;
    var att = attendance();
    if (!att) {
      if (errAtt) errAtt.hidden = false;
      ok = false;
    }
    var nm = nameInput ? nameInput.value.trim() : "";
    if (!nm) {
      if (errName) errName.hidden = false;
      if (nameInput) nameInput.setAttribute("aria-invalid", "true");
      ok = false;
    }
    if (!ok) {
      buzz(24);
      var firstErr = form.querySelector(".err:not([hidden])");
      if (firstErr) firstErr.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }
    return ok;
  }

  /* پیام کوتاه — فارسی UCS-2 است و هر پیامک فقط ۶۷ کاراکتر است.
     بدون ایموجی و بدون تکرار تاریخ — تا یک سگمنت بماند. */
  function buildMessage(channel) {
    var nm = nameInput ? nameInput.value.trim() : "";
    var att = attendance();
    var base = att === "yes"
      ? nm + " — می‌آیم، " + fa(count) + " نفر."
      : nm + " — متأسفانه نمی‌توانم بیایم.";

    // در واتس‌اپ/تلگرام محدودیت کاراکتر نداریم، پس کامل‌تر می‌نویسیم
    if (channel !== "sms") {
      var when = text(cfg.dateLabel);
      return "پاسخ دعوت، " + base + (when ? " (" + when + ")" : "");
    }
    return "پاسخ دعوت: " + base;
  }

  function phoneDigits() {
    return text(cfg.rsvpPhone).replace(/[^\d+]/g, "");
  }

  function saveState(channel) {
    var att = attendance();
    try {
      localStorage.setItem(STORE, JSON.stringify({
        name: nameInput ? nameInput.value.trim() : "",
        attendance: att,
        count: att === "yes" ? count : 0,
        at: Date.now(),
        via: channel
      }));
    } catch (e) {}
    showDone(att);
  }

  function showDone(att) {
    if (!doneCard || !form) return;
    form.hidden = true;
    doneCard.hidden = false;
    if (doneTitle) doneTitle.textContent = att === "yes" ? "منتظرتان هستیم" : "ممنون که خبر دادید";
    if (doneBody) {
      doneBody.textContent = att === "yes"
        ? "پاسخ شما برای " + fa(count) + " نفر ثبت شد. اگر پیام ارسال نشد، دوباره تلاش کنید."
        : "جایتان خالی خواهد بود. امیدواریم بار دیگر دور هم باشیم.";
    }
    buzz(18);
  }

  function send(channel) {
    if (!validate()) return;

    var msg = buildMessage(channel);
    var phone = phoneDigits();
    var url = "";

    if (channel === "sms") {
      // iOS بعد از شماره از & استفاده می‌کند؛ بدون شماره همیشه ? درست است.
      var isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      var sep = phone ? (isiOS ? "&" : "?") : "?";
      url = "sms:" + phone + sep + "body=" + encodeURIComponent(msg);
    } else if (channel === "whatsapp") {
      url = phone
        ? "https://wa.me/" + phone.replace(/\D/g, "") + "?text=" + encodeURIComponent(msg)
        : "https://wa.me/?text=" + encodeURIComponent(msg);
    } else if (channel === "telegram") {
      url = "https://t.me/share/url?url=" + encodeURIComponent(location.href) +
            "&text=" + encodeURIComponent(msg);
    } else if (channel === "copy") {
      copy(msg, "متن پاسخ کپی شد");
      saveState(channel);
      return;
    }

    if (window.__RSVP_TEST__) { window.__LAST_RSVP_URL__ = url; saveState(channel); return; }

    try { window.location.href = url; }
    catch (e) { copy(msg, "متن پاسخ کپی شد"); }
    saveState(channel);
  }

  if (form) {
    form.addEventListener("submit", function (e) { e.preventDefault(); send("sms"); });
  }
  ["sendWa", "sendTg", "sendCopy"].forEach(function (id) {
    var b = $("#" + id);
    if (b) b.addEventListener("click", function () { send(b.getAttribute("data-channel")); });
  });

  // کانال‌های غیرفعال را حذف کن
  var ch = cfg.rsvpChannels || { sms: true, whatsapp: true, telegram: false, copy: true };
  var map = { sms: "#sendSms", whatsapp: "#sendWa", telegram: "#sendTg", copy: "#sendCopy" };
  Object.keys(map).forEach(function (k) {
    var el = $(map[k]);
    if (!el) return;
    if (ch[k]) el.hidden = false; else el.remove();
  });

  var resetBtn = $("#rsvpReset");
  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      try { localStorage.removeItem(STORE); } catch (e) {}
      if (doneCard) doneCard.hidden = true;
      if (form) form.hidden = false;
    });
  }

  // بازگرداندن پاسخ قبلی
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && saved.attendance) {
      if (nameInput) nameInput.value = saved.name || "";
      var radio = form && form.querySelector("input[value='" + saved.attendance + "']");
      if (radio) radio.checked = true;
      count = Math.max(1, +saved.count || 1);
      renderCount();
      showDone(saved.attendance);
    }
  } catch (e) {}

  /* ------------------------------------------------------------ wiring */
  window.addEventListener("scroll", update, { passive: true });

  /* فقط وقتی عرض عوض شد دوباره اندازه‌گیری می‌کنیم.
     روی موبایل، بالا/پایین رفتن نوار آدرس مدام resize می‌زند و اندازه‌گیری
     دوباره وسط اسکرول، تصویر را می‌پراند. */
  var lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth === lastW) { update(); return; }
    lastW = window.innerWidth;
    measure();
  });
  window.addEventListener("orientationchange", function () { setTimeout(measure, 250); });

  /* عمداً به visualViewport.resize وصل نیستیم: روی آی‌او‌اس هر بار که نوار
     آدرس جمع یا باز می‌شود شلیک می‌کرد و وسط اسکرول، قصه می‌پرید. */

  window.addEventListener("load", measure);
  measure();

  // اگر کاربر با لنگر مستقیم آمده
  if (location.hash === "#invite") { begin(true); }
})();
