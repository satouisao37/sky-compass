(function () {
  'use strict';

  var Tokyo = { lat: 35.6812, lon: 139.7671, acc: null };
  var state = {
    loc: loadLoc(),
    selectedDate: new Date(),
    manual: false,
    mode: '2d',
    heading: 0,
    compassOn: false,
    orientation: {
      alpha: null,
      beta: null,
      gamma: null,
      heading: null,
      ready: false
    },
    raf3d: null,
    declination: Number(localStorage.getItem('declination') || '-7.7')
  };
  var els = {};
  var dailyCache = {};
  var sky3dCache = {};
  var renderedPathKey = '';
  var orientationListening = false;
  var fovY = 60 * Math.PI / 180;
  var dirs = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    ['dateLabel','placeLabel','locateBtn','mode2dBtn','mode3dBtn','skySvg','sky3d','sun3d','moon3d','sunGuide','moonGuide','sky3dStatus','rotatingSky','ticks','sunPath','moonPath','sunMarker','moonMarker','belowLabel','compassBtn','compassStatus','sunNow','sunTimes','moonNow','moonTimes','lightTimes','prevDay','nextDay','nowBtn','dateInput','timeSlider','timeLabel','declinationInput','latInput','lonInput','applyLocBtn'].forEach(function (id) { els[id] = document.getElementById(id); });
    drawTicks();
    els.declinationInput.value = state.declination;
    els.latInput.value = state.loc.lat.toFixed(4);
    els.lonInput.value = state.loc.lon.toFixed(4);
    bindEvents();
    setDateInput(state.selectedDate);
    setSliderFromDate(state.selectedDate);
    render();
    locate(false);
    setInterval(function () {
      if (!state.manual) {
        state.selectedDate = new Date();
        setDateInput(state.selectedDate);
        setSliderFromDate(state.selectedDate);
        render();
      }
    }, 1000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  function bindEvents() {
    els.locateBtn.addEventListener('click', function () { locate(true); });
    els.prevDay.addEventListener('click', function () { shiftDay(-1); });
    els.nextDay.addEventListener('click', function () { shiftDay(1); });
    els.nowBtn.addEventListener('click', function () { state.manual = false; state.selectedDate = new Date(); setDateInput(state.selectedDate); setSliderFromDate(state.selectedDate); render(); });
    els.dateInput.addEventListener('change', function () { state.manual = true; applyDateAndSlider(); });
    els.timeSlider.addEventListener('input', function () { state.manual = true; applyDateAndSlider(); });
    els.declinationInput.addEventListener('change', function () { state.declination = Number(els.declinationInput.value || 0); localStorage.setItem('declination', String(state.declination)); render(); });
    els.applyLocBtn.addEventListener('click', function () {
      state.loc = { lat: Number(els.latInput.value), lon: Number(els.lonInput.value), acc: null };
      saveLoc(state.loc);
      render();
    });
    els.compassBtn.addEventListener('click', enableCompass);
    els.mode2dBtn.addEventListener('click', function () { setMode('2d'); });
    els.mode3dBtn.addEventListener('click', function () { setMode('3d'); });
  }
  function loadLoc() {
    try {
      var saved = JSON.parse(localStorage.getItem('lastLocation') || 'null');
      if (saved && isFinite(saved.lat) && isFinite(saved.lon)) return saved;
    } catch (e) {}
    return Tokyo;
  }
  function saveLoc(loc) {
    try {
      localStorage.setItem('lastLocation', JSON.stringify(loc));
    } catch (e) {}
  }
  function locate(fromTap) {
    if (!navigator.geolocation) {
      els.placeLabel.textContent = '位置情報が使えません。座標を手入力してください';
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      state.loc = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      saveLoc(state.loc);
      els.latInput.value = state.loc.lat.toFixed(4);
      els.lonInput.value = state.loc.lon.toFixed(4);
      render();
    }, function () {
      if (fromTap) els.placeLabel.textContent = '位置情報を取得できません。座標を手入力してください';
      render();
    }, { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 });
  }
  function enableCompass() {
    function onGranted() {
      if (!orientationListening) {
        window.addEventListener('deviceorientation', onOrientation, true);
        orientationListening = true;
      }
      state.compassOn = true;
      els.compassStatus.textContent = '端末方位に追従';
      render();
    }
    if (!window.DeviceOrientationEvent) {
      els.compassStatus.textContent = '非対応のため北上固定';
      return;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function (res) {
        if (res === 'granted') onGranted();
        else els.compassStatus.textContent = '許可されませんでした';
      }).catch(function () { els.compassStatus.textContent = '許可されませんでした'; });
    } else {
      onGranted();
    }
  }
  function onOrientation(ev) {
    var heading = null;
    if (typeof ev.webkitCompassHeading === 'number') {
      heading = ev.webkitCompassHeading + state.declination;
      // 直立(beta=90)を超えて空へ向けると webkitCompassHeading は端末上端の水平射影が反対を向き180°反転するため補正
      // (境界では生値の反転と加算が同時に起きるので補正後は連続)
      if (typeof ev.beta === 'number' && ev.beta > 90) heading += 180;
    } else if (typeof ev.alpha === 'number') {
      heading = 360 - ev.alpha + state.declination;
    }
    if (heading !== null) {
      var wasReady = state.orientation.ready;
      state.heading = wasReady ? smoothAngle(state.heading, heading, .22) : norm360(heading);
      state.orientation.heading = wasReady ? smoothAngle(state.orientation.heading, heading, .22) : norm360(heading);
      state.orientation.ready = true;
      renderCompassRotation();
    } else {
      els.compassStatus.textContent = '方位が取得できません';
    }
    if (typeof ev.alpha === 'number') state.orientation.alpha = ev.alpha;
    if (typeof ev.beta === 'number') state.orientation.beta = smoothValue(state.orientation.beta, ev.beta, .22);
    if (typeof ev.gamma === 'number') state.orientation.gamma = smoothValue(state.orientation.gamma, ev.gamma, .22);
    if (state.mode === '3d') request3dRender();
  }
  function setMode(mode) {
    state.mode = mode;
    els.mode2dBtn.classList.toggle('active', mode === '2d');
    els.mode3dBtn.classList.toggle('active', mode === '3d');
    els.mode2dBtn.setAttribute('aria-pressed', mode === '2d' ? 'true' : 'false');
    els.mode3dBtn.setAttribute('aria-pressed', mode === '3d' ? 'true' : 'false');
    els.skySvg.classList.toggle('hidden', mode === '3d');
    els.sky3d.hidden = mode !== '3d';
    els.belowLabel.hidden = mode === '3d';
    if (mode === '3d') start3dLoop();
    else stop3dLoop();
  }
  function ymd(date) {
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
  }
  function setDateInput(date) {
    els.dateInput.value = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function setSliderFromDate(date) {
    els.timeSlider.value = String(date.getHours() * 60 + date.getMinutes());
  }
  function applyDateAndSlider() {
    var current = state.selectedDate;
    var parts = (els.dateInput.value || '').split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    var mins = Number(els.timeSlider.value);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d) || parts.length !== 3) {
      y = current.getFullYear();
      m = current.getMonth() + 1;
      d = current.getDate();
      setDateInput(current);
    }
    if (!isFinite(mins)) mins = current.getHours() * 60 + current.getMinutes();
    mins = Math.max(0, Math.min(1435, mins));
    state.selectedDate = new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60, 0);
    render();
  }
  function shiftDay(delta) {
    state.manual = true;
    state.selectedDate = new Date(state.selectedDate.getTime() + delta * 86400000);
    setDateInput(state.selectedDate);
    setSliderFromDate(state.selectedDate);
    render();
  }
  function render() {
    var loc = state.loc;
    var date = state.selectedDate;
    var tz = -date.getTimezoneOffset();
    var p = ymd(date);
    var sun = Astro.sunPosition(date, loc.lat, loc.lon);
    var moon = Astro.moonPosition(date, loc.lat, loc.lon);
    var illum = Astro.moonIllumination(date);
    var daily = getDaily(p, loc, tz);
    var st = daily.sunTimes;
    var mt = daily.moonTimes;
    els.dateLabel.textContent = fmtFull(date);
    els.placeLabel.textContent = loc.lat.toFixed(4) + ', ' + loc.lon.toFixed(4) + (loc.acc ? '  精度約' + Math.round(loc.acc) + 'm' : '');
    els.timeLabel.textContent = pad(date.getHours()) + ':' + pad(date.getMinutes());
    els.sunNow.textContent = '方位 ' + degDir(sun.az) + ' / 高度 ' + sun.alt.toFixed(1) + '度';
    els.moonNow.textContent = '方位 ' + degDir(moon.az) + ' / 高度 ' + moon.alt.toFixed(1) + '度 / 月齢 ' + illum.age.toFixed(1) + ' / 輝面比 ' + Math.round(illum.fraction * 100) + '%';
    els.sunTimes.textContent = '出 ' + fmtTime(st.rise) + ' / 南中 ' + fmtTime(st.transit) + ' / 入 ' + fmtTime(st.set);
    els.moonTimes.textContent = '出 ' + fmtTime(mt.rise) + ' / 南中 ' + fmtTime(mt.transit) + ' / 入 ' + fmtTime(mt.set);
    els.lightTimes.textContent = '朝GH ' + fmtRange(st.goldenAM) + ' / 夕GH ' + fmtRange(st.goldenPM) + ' / 朝BH ' + fmtRange(st.blueAM) + ' / 夕BH ' + fmtRange(st.bluePM);
    if (renderedPathKey !== daily.key) {
      els.sunPath.innerHTML = daily.sunPath;
      els.moonPath.innerHTML = daily.moonPath;
      renderedPathKey = daily.key;
    }
    drawBody(els.sunMarker, sun, 'sun', illum);
    drawBody(els.moonMarker, moon, 'moon', illum);
    els.belowLabel.textContent = [sun.alt < 0 ? '太陽は地平線下' : '', moon.alt < 0 ? '月は地平線下' : ''].filter(Boolean).join(' / ');
    renderCompassRotation();
    if (state.mode === '3d') request3dRender();
  }
  function renderCompassRotation() {
    var rot = state.compassOn ? -state.heading : 0;
    els.rotatingSky.setAttribute('transform', 'rotate(' + rot.toFixed(1) + ')');
  }
  function drawTicks() {
    var html = '';
    for (var a = 0; a < 360; a += 10) {
      var p1 = polar(a, a % 30 === 0 ? 92 : 96);
      var p2 = polar(a, 100);
      html += '<line class="tick ' + (a % 30 === 0 ? 'major' : '') + '" x1="' + p1.x + '" y1="' + p1.y + '" x2="' + p2.x + '" y2="' + p2.y + '"/>';
    }
    els.ticks.innerHTML = html;
  }
  function dailyKey(p, loc, tz) {
    return [p.y, p.m, p.d, loc.lat.toFixed(5), loc.lon.toFixed(5), tz].join('|');
  }
  function getDaily(p, loc, tz) {
    var key = dailyKey(p, loc, tz);
    if (!dailyCache[key]) {
      // 日付送りの連打で無制限に溜まらないよう上限で全消し(再計算は安価)
      if (Object.keys(dailyCache).length >= 32) dailyCache = {};
      var paths = buildPaths(p, loc, tz);
      dailyCache[key] = {
        key: key,
        sunTimes: Astro.sunTimes(p.y, p.m, p.d, loc.lat, loc.lon, tz),
        moonTimes: Astro.moonTimes(p.y, p.m, p.d, loc.lat, loc.lon, tz),
        sunPath: paths.sunPath,
        moonPath: paths.moonPath
      };
    }
    return dailyCache[key];
  }
  function buildPaths(p, loc, tz) {
    var base = Date.UTC(p.y, p.m - 1, p.d) - tz * 60000;
    var sunPts = [], moonPts = [], sunDots = '', moonDots = '';
    for (var h = 0; h <= 24; h++) {
      var dt = new Date(base + h * 3600000);
      var sp = project(Astro.sunPosition(dt, loc.lat, loc.lon));
      var mp = project(Astro.moonPosition(dt, loc.lat, loc.lon));
      sunPts.push((h ? 'L' : 'M') + sp.x.toFixed(1) + ' ' + sp.y.toFixed(1));
      moonPts.push((h ? 'L' : 'M') + mp.x.toFixed(1) + ' ' + mp.y.toFixed(1));
      sunDots += '<circle class="path-dot-sun" cx="' + sp.x.toFixed(1) + '" cy="' + sp.y.toFixed(1) + '" r="1.6"/>';
      moonDots += '<circle class="path-dot-moon" cx="' + mp.x.toFixed(1) + '" cy="' + mp.y.toFixed(1) + '" r="1.4"/>';
    }
    return {
      sunPath: '<path class="path-sun" d="' + sunPts.join(' ') + '"/>' + sunDots,
      moonPath: '<path class="path-moon" d="' + moonPts.join(' ') + '"/>' + moonDots
    };
  }
  function drawBody(el, pos, kind, illum) {
    var p = project(pos);
    var cls = pos.alt < 0 ? ' below' : '';
    if (kind === 'sun') {
      el.innerHTML = '<circle class="sun-disc' + cls + '" cx="' + p.x + '" cy="' + p.y + '" r="5.4"/>';
      return;
    }
    var f = illum.fraction;
    var shadow = (1 - f) * 10;
    var side = illum.age < 14.77 ? -1 : 1;
    var shadowX = p.x + side * Math.abs(f - .5) * 4;
    el.innerHTML = '<g class="' + (pos.alt < 0 ? 'below' : '') + '"><circle class="moon-disc" cx="' + p.x + '" cy="' + p.y + '" r="5.2"/><ellipse class="moon-shadow" cx="' + shadowX.toFixed(1) + '" cy="' + p.y + '" rx="' + shadow.toFixed(1) + '" ry="5.1"/></g>';
  }
  function project(pos) {
    var alt = Math.max(pos.alt, 0);
    var r = (90 - alt) / 90 * 100;
    if (pos.alt < 0) r = 104;
    return polar(pos.az, r);
  }
  function start3dLoop() {
    if (state.raf3d) return;
    request3dRender();
    state.raf3d = requestAnimationFrame(function tick() {
      render3d();
      state.raf3d = requestAnimationFrame(tick);
    });
  }
  function stop3dLoop() {
    if (!state.raf3d) return;
    cancelAnimationFrame(state.raf3d);
    state.raf3d = null;
  }
  function request3dRender() {
    if (state.mode === '3d') render3d();
  }
  function render3d() {
    if (state.mode !== '3d') return;
    if (!state.compassOn || !state.orientation.ready || state.orientation.beta === null || state.orientation.gamma === null) {
      els.sky3dStatus.style.display = 'block';
      els.sky3dStatus.textContent = window.DeviceOrientationEvent ? 'コンパス連動を許可してください' : 'この端末では3D姿勢を取得できません';
      hide3d(els.sun3d, els.sunGuide);
      hide3d(els.moon3d, els.moonGuide);
      return;
    }
    var rect = els.sky3d.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    els.sky3dStatus.style.display = 'none';
    var bodies = get3dBodies(state.selectedDate, state.loc);
    var basis = cameraBasis(state.orientation);
    draw3dBody(els.sun3d, els.sunGuide, bodies.sun, basis, rect);
    draw3dBody(els.moon3d, els.moonGuide, bodies.moon, basis, rect);
  }
  function draw3dBody(bodyEl, guideEl, pos, basis, rect) {
    var out = project3d(pos, basis, rect.width, rect.height);
    bodyEl.classList.toggle('below', pos.alt < 0);
    if (out.visible) {
      bodyEl.style.transform = 'translate3d(' + out.x.toFixed(1) + 'px,' + out.y.toFixed(1) + 'px,0)';
      guideEl.style.transform = 'translate3d(-999px,-999px,0)';
      guideEl.querySelector('.guide-arrow').style.transform = 'rotate(0deg)';
      return;
    }
    bodyEl.style.transform = 'translate3d(-999px,-999px,0)';
    guideEl.style.transform = 'translate3d(' + out.guideX.toFixed(1) + 'px,' + out.guideY.toFixed(1) + 'px,0)';
    guideEl.querySelector('.guide-arrow').style.transform = 'rotate(' + out.guideAngle.toFixed(1) + 'deg)';
  }
  function project3d(pos, basis, w, h) {
    var target = pos.vector;
    var x = dot(target, basis.right);
    var y = dot(target, basis.up);
    var z = dot(target, basis.forward);
    var cx = w / 2;
    var cy = h / 2;
    var f = (h / 2) / Math.tan(fovY / 2);
    var px = cx + x / Math.max(z, .05) * f;
    var py = cy - y / Math.max(z, .05) * f;
    var pad = 28;
    var visibleRadius = Math.min(w, h) / 2 - pad;
    var screenDx = px - cx;
    var screenDy = py - cy;
    var visible = z > .05 && Math.sqrt(screenDx * screenDx + screenDy * screenDy) <= visibleRadius;
    var dx = z > .05 ? screenDx : x;
    var dy = z > .05 ? screenDy : -y;
    if (z <= .05) {
      dx = -dx;
      dy = -dy;
    }
    if (Math.abs(dx) + Math.abs(dy) < .001) {
      dx = Math.sin((pos.az - state.orientation.heading) * Math.PI / 180);
      dy = 0;
    }
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var r = Math.min(w, h) / 2 - 38;
    return {
      visible: visible,
      x: px - 35,
      y: py - 21,
      guideX: cx + dx / len * r - 24,
      guideY: cy + dy / len * r - 13,
      guideAngle: Math.atan2(dy, dx) * 180 / Math.PI
    };
  }
  function get3dBodies(date, loc) {
    var key = [date.getTime(), loc.lat.toFixed(5), loc.lon.toFixed(5)].join('|');
    if (!sky3dCache[key]) {
      if (Object.keys(sky3dCache).length >= 8) sky3dCache = {};
      var sun = Astro.sunPosition(date, loc.lat, loc.lon);
      var moon = Astro.moonPosition(date, loc.lat, loc.lon);
      sun.vector = azAltVector(sun.az, sun.alt);
      moon.vector = azAltVector(moon.az, moon.alt);
      sky3dCache[key] = { sun: sun, moon: moon };
    }
    return sky3dCache[key];
  }
  function cameraBasis(o) {
    var heading = norm360(o.heading || state.heading);
    var beta = clamp(o.beta === null ? 90 : o.beta, -90, 180);
    var gamma = clamp(o.gamma === null ? 0 : o.gamma, -90, 90);
    // beta は直立=90 / 画面下向き(背面が天頂)=180 なので、見上げ角は beta-90(逆にすると上下反転する)
    var lookAlt = clamp(beta - 90, -85, 85) * Math.PI / 180;
    var top = azAltVector(heading, 0);
    var right = azAltVector(heading + 90, 0);
    var zenith = { x: 0, y: 0, z: 1 };
    var forward = normalize(add(scale(top, Math.cos(lookAlt)), scale(zenith, Math.sin(lookAlt))));
    var up = normalize(add(scale(top, -Math.sin(lookAlt)), scale(zenith, Math.cos(lookAlt))));
    var roll = -gamma * Math.PI / 180;
    var rolledRight = normalize(add(scale(right, Math.cos(roll)), scale(up, Math.sin(roll))));
    var rolledUp = normalize(add(scale(up, Math.cos(roll)), scale(right, -Math.sin(roll))));
    var screen = screenAngle() * Math.PI / 180;
    return {
      forward: forward,
      right: normalize(add(scale(rolledRight, Math.cos(screen)), scale(rolledUp, Math.sin(screen)))),
      up: normalize(add(scale(rolledUp, Math.cos(screen)), scale(rolledRight, -Math.sin(screen))))
    };
  }
  function hide3d(bodyEl, guideEl) {
    bodyEl.style.transform = 'translate3d(-999px,-999px,0)';
    guideEl.style.transform = 'translate3d(-999px,-999px,0)';
  }
  function azAltVector(az, alt) {
    var a = az * Math.PI / 180;
    var h = alt * Math.PI / 180;
    return { x: Math.cos(h) * Math.sin(a), y: Math.cos(h) * Math.cos(a), z: Math.sin(h) };
  }
  function smoothAngle(prev, next, rate) {
    if (!isFinite(prev)) return norm360(next);
    var a = prev * Math.PI / 180;
    var b = next * Math.PI / 180;
    var x = Math.cos(a) * (1 - rate) + Math.cos(b) * rate;
    var y = Math.sin(a) * (1 - rate) + Math.sin(b) * rate;
    return norm360(Math.atan2(y, x) * 180 / Math.PI);
  }
  function smoothValue(prev, next, rate) {
    return prev === null || !isFinite(prev) ? next : prev * (1 - rate) + next * rate;
  }
  function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    if (typeof window.orientation === 'number') return window.orientation;
    return 0;
  }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function normalize(a) {
    var len = Math.sqrt(dot(a, a)) || 1;
    return { x: a.x / len, y: a.y / len, z: a.z / len };
  }
  function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }
  function norm360(deg) {
    deg = deg % 360;
    return deg < 0 ? deg + 360 : deg;
  }
  function polar(az, r) {
    var a = az * Math.PI / 180;
    return { x: Number((Math.sin(a) * r).toFixed(2)), y: Number((-Math.cos(a) * r).toFixed(2)) };
  }
  function degDir(az) { return Math.round(az) + '度 ' + dirs[Math.round(az / 22.5) % 16]; }
  function fmtFull(date) { return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()); }
  function fmtTime(date) { return date ? pad(date.getHours()) + ':' + pad(date.getMinutes()) : '--:--'; }
  function fmtRange(r) { return fmtTime(r.start) + '-' + fmtTime(r.end); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
})();
