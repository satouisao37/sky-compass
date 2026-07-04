(function () {
  'use strict';

  var Tokyo = { lat: 35.6812, lon: 139.7671, acc: null };
  var mapMaxLat = 85.05112878;
  var mapMinZoom = 4;
  var mapMaxZoom = 17;
  var mapMinRadius = 40;
  var mapMaxRadius = 160;
  var mapMaxTilt = 55;
  var mapMaxTiles = 200;
  var mapPerspectiveRatio = 1.45;
  var state = {
    loc: loadLoc(),
    selectedDate: new Date(),
    manual: false,
    mode: '2d',
    heading: 0,
    sphere: {
      az: 180,
      el: 25,
      pointerId: null,
      lastX: 0,
      lastY: 0,
      raf: null
    },
    map: loadMapState(),
    compassOn: false,
    orientation: {
      alpha: null,
      beta: null,
      gamma: null,
      heading: null,
      ready: false,
      delta: null,
      deltaReady: false
    },
    raf3d: null,
    declination: Number(localStorage.getItem('declination') || '-7.7')
  };
  var els = {};
  var dailyCache = {};
  var sky3dCache = {};
  var renderedPathKey = '';
  var orientationListening = false;
  var headingOutliers = 0;
  var vis3d = { sun: false, moon: false };
  var basisPrev = null;
  var ref3d = null;
  var ref3dSize = '';
  var sphereStatic = buildSphereStatic();
  var sphereRendered = { view: '', daily: '', marker: '' };
  var mapRendered = { tiles: '', view: '', daily: '', marker: '' };
  var fov3dHalf = 50 * Math.PI / 180; // 3Dかざしの可視円半径に対応する視線からの角度(全視野100°)
  var dirs = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    ['dateLabel','placeLabel','locateBtn','mode2dBtn','mode3dBtn','modeSphereBtn','modeMapBtn','skySvg','sky3d','sky3dRef','sun3d','moon3d','sunGuide','moonGuide','sky3dStatus','sphereSvg','sphereGround','sphereGridBack','spherePathsBack','sphereGridFront','spherePathsFront','sphereMarkers','sphereLabels','mapView','mapSky','mapTiles','mapFog','mapMarker','mapSphereSvg','mapSphereGround','mapSphereGridBack','mapSpherePathsBack','mapSphereGridFront','mapSpherePathsFront','mapSphereMarkers','mapSphereLabels','mapZoomIn','mapZoomOut','mapRadiusInput','mapTiltInput','mapInfo','mapUseBtn','rotatingSky','ticks','sunPath','moonPath','sunMarker','moonMarker','belowLabel','compassBtn','compassStatus','sunNow','sunTimes','moonNow','moonTimes','lightTimes','prevDay','nextDay','nowBtn','dateInput','timeSlider','timeLabel','declinationInput','latInput','lonInput','applyLocBtn'].forEach(function (id) { els[id] = document.getElementById(id); });
    drawTicks();
    buildRef3d();
    initMapState();
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
    els.modeSphereBtn.addEventListener('click', function () { setMode('sphere'); });
    els.modeMapBtn.addEventListener('click', function () { setMode('map'); });
    bindSphereDrag();
    bindMapEvents();
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
  function loadMapState() {
    var fallback = { lat: Tokyo.lat, lon: Tokyo.lon };
    var out = {
      center: { lat: fallback.lat, lon: fallback.lon },
      selected: { lat: fallback.lat, lon: fallback.lon },
      zoom: 12,
      radius: Number(localStorage.getItem('mapSphereRadius') || '90'),
      tilt: 0,
      pointers: {},
      drag: null,
      pinch: null,
      raf: null
    };
    try {
      var saved = JSON.parse(localStorage.getItem('mapView') || 'null');
      if (saved) {
        if (saved.center && validLoc(saved.center)) out.center = { lat: saved.center.lat, lon: saved.center.lon };
        if (saved.selected && validLoc(saved.selected)) out.selected = { lat: saved.selected.lat, lon: saved.selected.lon };
        if (isFinite(saved.zoom)) out.zoom = clampMapZoom(saved.zoom);
        if (isFinite(saved.tilt)) out.tilt = clampMapTilt(saved.tilt);
      }
    } catch (e) {}
    out.radius = clampMapRadius(out.radius || 90);
    out.tilt = clampMapTilt(out.tilt || 0);
    return out;
  }
  function initMapState() {
    var saved = false;
    try { saved = !!localStorage.getItem('mapView'); } catch (e) {}
    if (!saved) resetMapToLoc();
    els.mapRadiusInput.value = String(state.map.radius);
    els.mapTiltInput.value = String(state.map.tilt);
  }
  function validLoc(loc) {
    return loc && isFinite(loc.lat) && isFinite(loc.lon) && loc.lat >= -mapMaxLat && loc.lat <= mapMaxLat && loc.lon >= -180 && loc.lon <= 180;
  }
  function saveMapState() {
    try {
      localStorage.setItem('mapSphereRadius', String(state.map.radius));
      localStorage.setItem('mapView', JSON.stringify({
        center: state.map.center,
        selected: state.map.selected,
        zoom: state.map.zoom,
        tilt: state.map.tilt
      }));
    } catch (e) {}
  }
  function hasSavedMapView() {
    try { return !!localStorage.getItem('mapView'); } catch (e) { return false; }
  }
  function resetMapToLoc() {
    state.map.center = { lat: state.loc.lat, lon: state.loc.lon };
    state.map.selected = { lat: state.loc.lat, lon: state.loc.lon };
    state.map.zoom = 12;
    state.map.tilt = 0;
    mapRendered.daily = '';
    mapRendered.marker = '';
    mapRendered.view = '';
    mapRendered.tiles = '';
  }
  function locate(fromTap) {
    if (!navigator.geolocation) {
      els.placeLabel.textContent = '位置情報が使えません。座標を手入力してください';
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      state.loc = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      saveLoc(state.loc);
      if (!hasSavedMapView()) resetMapToLoc();
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
      heading = withFlipCorrection(ev.webkitCompassHeading + state.declination, ev.beta);
    } else if (typeof ev.alpha === 'number') {
      heading = 360 - ev.alpha + state.declination;
    }
    if (heading !== null) {
      if (!state.orientation.ready) {
        state.heading = norm360(heading);
        state.orientation.heading = state.heading;
        state.orientation.ready = true;
      } else if (Math.abs(angleDiff(heading, state.orientation.heading)) > 120) {
        // 水平付近はコンパスと姿勢のパイプライン差で180°反転のタイミングがずれ得る。
        // 単発の外れ値は棄却し、連続したときだけ実際の反転とみなして即ジャンプ(EMAで混ぜると大回りに振れる)
        headingOutliers++;
        if (headingOutliers >= 3) {
          state.heading = norm360(heading);
          state.orientation.heading = state.heading;
          headingOutliers = 0;
        }
      } else {
        headingOutliers = 0;
        state.heading = smoothAngle(state.heading, heading, .22);
        state.orientation.heading = smoothAngle(state.orientation.heading, heading, .22);
      }
      renderCompassRotation();
      // 姿勢のみ(方位 null)のフレーム後に方位が戻っても文言が固着しないよう、成功時に復帰させる
      if (state.compassOn && els.compassStatus.textContent !== '端末方位に追従') els.compassStatus.textContent = '端末方位に追従';
    } else if (typeof ev.webkitCompassHeading !== 'number' && typeof ev.alpha !== 'number') {
      // コンパスは来ているが初期化待ち(斜め上で開始した場合)は黙って次サンプルを待つ
      els.compassStatus.textContent = '方位が取得できません';
    }
    // 3D姿勢は生値を保持し、平滑化は基底ベクトル側(cameraBasis)で行う
    if (typeof ev.alpha === 'number') state.orientation.alpha = ev.alpha;
    if (typeof ev.beta === 'number') state.orientation.beta = ev.beta;
    if (typeof ev.gamma === 'number') state.orientation.gamma = ev.gamma;
    updateDelta(ev);
    if (state.mode === '3d') request3dRender();
    else if (state.mode === 'sphere' && state.compassOn) requestSphereRender();
  }
  function setMode(mode) {
    if (state.mode === 'sphere' && mode !== 'sphere') endSphereDrag();
    if (state.mode === 'map' && mode !== 'map') endMapGesture();
    state.mode = mode;
    els.mode2dBtn.classList.toggle('active', mode === '2d');
    els.mode3dBtn.classList.toggle('active', mode === '3d');
    els.modeSphereBtn.classList.toggle('active', mode === 'sphere');
    els.modeMapBtn.classList.toggle('active', mode === 'map');
    els.mode2dBtn.setAttribute('aria-pressed', mode === '2d' ? 'true' : 'false');
    els.mode3dBtn.setAttribute('aria-pressed', mode === '3d' ? 'true' : 'false');
    els.modeSphereBtn.setAttribute('aria-pressed', mode === 'sphere' ? 'true' : 'false');
    els.modeMapBtn.setAttribute('aria-pressed', mode === 'map' ? 'true' : 'false');
    els.skySvg.classList.toggle('hidden', mode !== '2d');
    els.sky3d.hidden = mode !== '3d';
    els.sphereSvg.classList.toggle('hidden', mode !== 'sphere');
    els.mapView.classList.toggle('hidden', mode !== 'map');
    els.belowLabel.hidden = mode !== '2d';
    els.compassBtn.parentElement.classList.toggle('hidden', mode === 'map');
    if (mode === '3d') start3dLoop();
    else stop3dLoop();
    if (mode === 'sphere') renderSphere();
    if (mode === 'map') requestMapRender();
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
    if (state.mode === 'sphere') requestSphereRender();
    if (state.mode === 'map') requestMapRender();
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
        moonPath: paths.moonPath,
        sphereSun: paths.sphereSun,
        sphereMoon: paths.sphereMoon
      };
    }
    return dailyCache[key];
  }
  function buildPaths(p, loc, tz) {
    var base = Date.UTC(p.y, p.m - 1, p.d) - tz * 60000;
    var sunPts = [], moonPts = [], sunDots = '', moonDots = '';
    var sphereSun = [], sphereMoon = [];
    for (var h = 0; h <= 24; h++) {
      var dt = new Date(base + h * 3600000);
      var sun = Astro.sunPosition(dt, loc.lat, loc.lon);
      var moon = Astro.moonPosition(dt, loc.lat, loc.lon);
      var sp = project(sun);
      var mp = project(moon);
      sunPts.push((h ? 'L' : 'M') + sp.x.toFixed(1) + ' ' + sp.y.toFixed(1));
      moonPts.push((h ? 'L' : 'M') + mp.x.toFixed(1) + ' ' + mp.y.toFixed(1));
      sunDots += '<circle class="path-dot-sun" cx="' + sp.x.toFixed(1) + '" cy="' + sp.y.toFixed(1) + '" r="1.6"/>';
      moonDots += '<circle class="path-dot-moon" cx="' + mp.x.toFixed(1) + '" cy="' + mp.y.toFixed(1) + '" r="1.4"/>';
      sphereSun.push({ az: sun.az, alt: sun.alt, vector: azAltVector(sun.az, sun.alt) });
      sphereMoon.push({ az: moon.az, alt: moon.alt, vector: azAltVector(moon.az, moon.alt) });
    }
    return {
      sunPath: '<path class="path-sun" d="' + sunPts.join(' ') + '"/>' + sunDots,
      moonPath: '<path class="path-moon" d="' + moonPts.join(' ') + '"/>' + moonDots,
      sphereSun: sphereSun,
      sphereMoon: sphereMoon
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
  function bindMapEvents() {
    els.mapZoomIn.addEventListener('click', function () { zoomMapAtCenter(1); });
    els.mapZoomOut.addEventListener('click', function () { zoomMapAtCenter(-1); });
    els.mapRadiusInput.addEventListener('input', function () {
      state.map.radius = clampMapRadius(Number(els.mapRadiusInput.value) || 90);
      saveMapState();
      requestMapRender();
    });
    els.mapTiltInput.addEventListener('input', function () {
      state.map.tilt = clampMapTilt(Number(els.mapTiltInput.value) || 0);
      mapRendered.tiles = '';
      mapRendered.view = '';
      saveMapState();
      requestMapRender();
    });
    els.mapUseBtn.addEventListener('click', function () {
      state.loc = { lat: state.map.selected.lat, lon: state.map.selected.lon, acc: null };
      saveLoc(state.loc);
      els.latInput.value = state.loc.lat.toFixed(4);
      els.lonInput.value = state.loc.lon.toFixed(4);
      render();
    });
    els.mapView.addEventListener('pointerdown', mapPointerDown);
    els.mapView.addEventListener('pointermove', mapPointerMove);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (type) {
      els.mapView.addEventListener(type, mapPointerUp);
    });
    window.addEventListener('resize', function () { if (state.mode === 'map') { mapRendered.tiles = ''; requestMapRender(); } });
  }
  function mapPointerDown(ev) {
    // 情報パネルは pointer-events を生かしたまま除外する(none にするとタップが地図へ素通しして裏の地点を選択してしまう)
    if (ev.target.closest('.map-controls') || ev.target.closest('.map-radius-label') || ev.target.closest('.map-tilt-label') || ev.target.closest('.map-info') || ev.target === els.mapUseBtn) return;
    ev.preventDefault();
    els.mapView.setPointerCapture(ev.pointerId);
    state.map.pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY, startX: ev.clientX, startY: ev.clientY };
    var ids = mapPointerIds();
    if (ids.length === 1) {
      beginMapDrag(ev.pointerId, false);
      state.map.pinch = null;
    } else if (ids.length === 2) {
      beginMapPinch(ids);
    }
  }
  function mapPointerMove(ev) {
    var p = state.map.pointers[ev.pointerId];
    if (!p) return;
    p.x = ev.clientX;
    p.y = ev.clientY;
    var ids = mapPointerIds();
    if (ids.length >= 2 && state.map.pinch) {
      updateMapPinch(ids);
      return;
    }
    if (!state.map.drag || ev.pointerId !== state.map.drag.pointerId) return;
    var dx = ev.clientX - p.startX;
    var dy = ev.clientY - p.startY;
    if (Math.sqrt(dx * dx + dy * dy) > 8) state.map.drag.moved = true;
    var rect = els.mapView.getBoundingClientRect();
    var plane = screenToMapPlane(clientOffset(ev.clientX, ev.clientY, rect), rect);
    if (!plane) return;
    var next = { x: state.map.drag.grabWorld.x - plane.x, y: state.map.drag.grabWorld.y - plane.y };
    state.map.center = worldToLoc(next, state.map.zoom);
    requestMapRender();
  }
  function mapPointerUp(ev) {
    var p = state.map.pointers[ev.pointerId];
    var wasPinch = !!state.map.pinch;
    delete state.map.pointers[ev.pointerId];
    try {
      if (els.mapView.hasPointerCapture(ev.pointerId)) els.mapView.releasePointerCapture(ev.pointerId);
    } catch (e) {}
    if (p && state.map.drag && ev.pointerId === state.map.drag.pointerId && !state.map.drag.moved && !wasPinch) {
      var dx = ev.clientX - p.startX;
      var dy = ev.clientY - p.startY;
      if (Math.sqrt(dx * dx + dy * dy) < 8) {
        var loc = clientToMapLoc(ev.clientX, ev.clientY);
        if (loc) {
          state.map.selected = loc;
          mapRendered.daily = '';
          mapRendered.marker = '';
          requestMapRender();
        }
      }
    }
    var ids = mapPointerIds();
    state.map.drag = null;
    if (ids.length === 2) beginMapPinch(ids);
    else if (ids.length === 1) beginMapDrag(ids[0], true);
    else state.map.pinch = null;
    saveMapState();
  }
  function mapPointerIds() {
    return Object.keys(state.map.pointers);
  }
  function beginMapDrag(pointerId, moved) {
    var p = state.map.pointers[pointerId];
    if (!p) return;
    var rect = els.mapView.getBoundingClientRect();
    var center = locToWorld(state.map.center, state.map.zoom);
    var plane = screenToMapPlane(clientOffset(p.x, p.y, rect), rect);
    p.startX = p.x;
    p.startY = p.y;
    state.map.drag = {
      pointerId: Number(pointerId),
      grabWorld: plane ? { x: center.x + plane.x, y: center.y + plane.y } : center,
      moved: moved
    };
    state.map.pinch = null;
  }
  function beginMapPinch(ids) {
    var a = state.map.pointers[ids[0]];
    var b = state.map.pointers[ids[1]];
    state.map.pinch = {
      dist: mapDist(a, b),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2
    };
    state.map.drag = null;
  }
  function updateMapPinch(ids) {
    var a = state.map.pointers[ids[0]];
    var b = state.map.pointers[ids[1]];
    var dist = mapDist(a, b);
    if (!state.map.pinch || !dist) return;
    if (state.map.pinch.dist <= 0) {
      beginMapPinch(ids);
      return;
    }
    var ratio = dist / state.map.pinch.dist;
    if (ratio > 1.25) {
      zoomMapAt(state.map.pinch.midX, state.map.pinch.midY, state.map.zoom + 1);
      beginMapPinch(ids);
    } else if (ratio < .8) {
      zoomMapAt(state.map.pinch.midX, state.map.pinch.midY, state.map.zoom - 1);
      beginMapPinch(ids);
    }
  }
  function mapDist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function zoomMapAtCenter(delta) {
    var rect = els.mapView.getBoundingClientRect();
    zoomMapAt(rect.left + rect.width / 2, rect.top + rect.height / 2, state.map.zoom + delta);
  }
  function zoomMapAt(clientX, clientY, zoom) {
    zoom = clampMapZoom(zoom);
    if (zoom === state.map.zoom) return;
    var anchor = clientToMapLoc(clientX, clientY);
    if (!anchor) return;
    var rect = els.mapView.getBoundingClientRect();
    var plane = screenToMapPlane(clientOffset(clientX, clientY, rect), rect);
    if (!plane) return;
    var anchorPx = locToWorld(anchor, zoom);
    state.map.zoom = zoom;
    state.map.center = worldToLoc({ x: anchorPx.x - plane.x, y: anchorPx.y - plane.y }, zoom);
    mapRendered.tiles = '';
    saveMapState();
    requestMapRender();
  }
  function clientToMapLoc(clientX, clientY) {
    var rect = els.mapView.getBoundingClientRect();
    var center = locToWorld(state.map.center, state.map.zoom);
    var plane = screenToMapPlane(clientOffset(clientX, clientY, rect), rect);
    if (!plane) return null;
    return worldToLoc({ x: center.x + plane.x, y: center.y + plane.y }, state.map.zoom);
  }
  function requestMapRender() {
    if (state.mode !== 'map' || state.map.raf) return;
    state.map.raf = requestAnimationFrame(function () {
      state.map.raf = null;
      renderMap();
    });
  }
  function renderMap() {
    if (state.mode !== 'map') return;
    var rect = els.mapView.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var center = locToWorld(state.map.center, state.map.zoom);
    renderMapTiles(rect, center);
    renderMapOverlay(rect, center);
  }
  function renderMapTiles(rect, center) {
    var z = state.map.zoom;
    var metrics = mapTiltMetrics(rect);
    var left = center.x - rect.width / 2;
    var top = center.y - rect.height / 2;
    var max = Math.pow(2, z);
    var bounds = mapVisiblePlaneBounds(rect, metrics);
    var x1 = Math.floor((center.x + bounds.minX) / 256) - 1;
    var x2 = Math.floor((center.x + bounds.maxX) / 256) + 1;
    var y1 = Math.max(0, Math.floor((center.y + bounds.minY) / 256) - 1);
    var y2 = Math.min(max - 1, Math.floor((center.y + bounds.maxY) / 256) + 1);
    var limited = limitMapTileRange(x1, x2, y1, y2);
    x1 = limited.x1;
    x2 = limited.x2;
    y1 = limited.y1;
    y2 = limited.y2;
    els.mapView.classList.toggle('tilted', state.map.tilt > 0);
    els.mapView.style.setProperty('--map-fog-opacity', String(Math.min(.82, state.map.tilt / mapMaxTilt * .72)));
    if (state.map.tilt) {
      els.mapTiles.style.transform = 'perspective(' + metrics.perspective.toFixed(1) + 'px) rotateX(' + state.map.tilt.toFixed(1) + 'deg) translate(' + (-left).toFixed(1) + 'px,' + (-top).toFixed(1) + 'px)';
    } else {
      els.mapTiles.style.transform = 'translate(' + (-left).toFixed(1) + 'px,' + (-top).toFixed(1) + 'px)';
    }
    var key = [z, x1, x2, y1, y2, Math.round(rect.width), Math.round(rect.height), state.map.tilt, Math.round(metrics.perspective)].join('|');
    if (mapRendered.tiles === key) return;
    mapRendered.tiles = key;
    els.mapTiles.innerHTML = '';
    for (var x = x1; x <= x2; x++) {
      for (var y = y1; y <= y2; y++) {
        var img = document.createElement('img');
        var tx = ((x % max) + max) % max;
        img.alt = '';
        img.draggable = false;
        img.src = 'https://cyberjapandata.gsi.go.jp/xyz/pale/' + z + '/' + tx + '/' + y + '.png';
        img.style.left = (x * 256) + 'px';
        img.style.top = (y * 256) + 'px';
        img.onerror = function () { this.classList.add('missing'); };
        els.mapTiles.appendChild(img);
      }
    }
  }
  function renderMapOverlay(rect, center) {
    var pos = mapScreenPoint(state.map.selected, rect, center);
    if (!pos) {
      els.mapMarker.style.transform = 'translate(-999px,-999px)';
      els.mapSphereSvg.style.transform = 'translate(-999px,-999px)';
      return;
    }
    var r = state.map.radius;
    els.mapMarker.style.transform = 'translate(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px)';
    els.mapSphereSvg.style.width = (r * 2) + 'px';
    els.mapSphereSvg.style.height = (r * 2) + 'px';
    els.mapSphereSvg.style.transform = 'translate(' + (pos.x - r).toFixed(1) + 'px,' + (pos.y - r).toFixed(1) + 'px)';
    var date = state.selectedDate;
    var tz = -date.getTimezoneOffset();
    var p = ymd(date);
    var daily = getDaily(p, state.map.selected, tz);
    var basis = mapSphereBasis();
    var viewKey = state.map.tilt.toFixed(2);
    if (mapRendered.view !== viewKey) renderMapSphereGrid(basis);
    if (mapRendered.view !== viewKey || mapRendered.daily !== daily.key) renderMapSpherePaths(daily, basis);
    var markerKey = [date.getTime(), state.map.selected.lat.toFixed(5), state.map.selected.lon.toFixed(5), viewKey].join('|');
    var sun = Astro.sunPosition(date, state.map.selected.lat, state.map.selected.lon);
    var moon = Astro.moonPosition(date, state.map.selected.lat, state.map.selected.lon);
    var illum = Astro.moonIllumination(date);
    if (mapRendered.marker !== markerKey) renderMapSphereMarkers(sun, moon, illum, basis);
    els.mapInfo.textContent = state.map.selected.lat.toFixed(5) + ', ' + state.map.selected.lon.toFixed(5) +
      ' / 太陽 ' + degDir(sun.az) + ' 高度 ' + sun.alt.toFixed(1) + '度' +
      ' / 月 ' + degDir(moon.az) + ' 高度 ' + moon.alt.toFixed(1) + '度';
    mapRendered.view = viewKey;
    mapRendered.daily = daily.key;
    mapRendered.marker = markerKey;
  }
  function mapScreenPoint(loc, rect, center) {
    var p = locToWorld(loc, state.map.zoom);
    var projected = mapPlaneToScreen({ x: p.x - center.x, y: p.y - center.y }, rect);
    if (!projected) return null;
    return { x: projected.x + rect.width / 2, y: projected.y + rect.height / 2 };
  }
  function clientOffset(clientX, clientY, rect) {
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }
  function mapTiltMetrics(rect) {
    var tiltRad = clampMapTilt(state.map.tilt) * Math.PI / 180;
    return {
      perspective: Math.max(1, rect.height * mapPerspectiveRatio),
      tiltRad: tiltRad,
      sin: Math.sin(tiltRad),
      cos: Math.cos(tiltRad)
    };
  }
  function screenToMapPlane(screen, rect) {
    var m = mapTiltMetrics(rect);
    var denom = m.cos + screen.y * m.sin / m.perspective;
    if (denom <= 1e-3) return null;
    var y = screen.y / denom;
    var w = 1 - y * m.sin / m.perspective;
    if (w <= 1e-3) return null;
    return { x: screen.x * w, y: y };
  }
  function mapPlaneToScreen(plane, rect) {
    var m = mapTiltMetrics(rect);
    var w = 1 - plane.y * m.sin / m.perspective;
    if (w <= 1e-3) return null;
    return { x: plane.x / w, y: plane.y * m.cos / w };
  }
  function mapVisiblePlaneBounds(rect, metrics) {
    var corners = [
      { x: -rect.width / 2, y: -rect.height / 2 },
      { x: rect.width / 2, y: -rect.height / 2 },
      { x: rect.width / 2, y: rect.height / 2 },
      { x: -rect.width / 2, y: rect.height / 2 }
    ];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    var farY = metrics.sin > 1e-5 ? -metrics.perspective / Math.tan(metrics.tiltRad) * .98 : -rect.height / 2;
    corners.forEach(function (screen) {
      var plane = screenToMapPlane(screen, rect);
      if (!plane) {
        plane = { y: farY };
        plane.x = screen.x * (1 - plane.y * metrics.sin / metrics.perspective);
      }
      minX = Math.min(minX, plane.x);
      maxX = Math.max(maxX, plane.x);
      minY = Math.min(minY, plane.y);
      maxY = Math.max(maxY, plane.y);
    });
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }
  function limitMapTileRange(x1, x2, y1, y2) {
    while ((x2 - x1 + 1) * (y2 - y1 + 1) > mapMaxTiles) {
      if (y2 - y1 >= x2 - x1 && y1 < y2) y1++;
      else if (x1 < x2) {
        if (Math.abs(x1) > Math.abs(x2)) x1++;
        else x2--;
      } else break;
    }
    return { x1: x1, x2: x2, y1: y1, y2: y2 };
  }
  function mapSphereBasis() {
    var forward = azAltVector(180, 90 - state.map.tilt);
    var zenith = { x: 0, y: 0, z: 1 };
    var right = cross(zenith, forward);
    if (dot(right, right) < 1e-5) right = { x: 1, y: 0, z: 0 };
    right = normalize(right);
    var up = normalize(cross(forward, right));
    return { forward: forward, right: right, up: up };
  }
  function renderMapSphereGrid(basis) {
    var ground = spherePath(sphereStatic.horizon, basis);
    var horizon = sphereSplitPaths(sphereStatic.horizon, basis, 'sphere-horizon', false);
    var back = horizon.back;
    var front = horizon.front;
    sphereStatic.alts.forEach(function (samples) {
      var html = sphereSplitPaths(samples, basis, 'sphere-alt', false);
      back += html.back;
      front += html.front;
    });
    sphereStatic.meridians.forEach(function (samples) {
      var html = sphereSplitPaths(samples, basis, 'sphere-meridian', false);
      back += html.back;
      front += html.front;
    });
    els.mapSphereGround.innerHTML = '<circle class="sphere-rim" cx="0" cy="0" r="100"/>' +
      '<path class="sphere-ground" d="' + ground + 'Z"/>';
    els.mapSphereGridBack.innerHTML = back;
    els.mapSphereGridFront.innerHTML = front;
    renderMapSphereLabels(basis);
  }
  function renderMapSphereLabels(basis) {
    var html = '';
    sphereStatic.labels.forEach(function (item) {
      var p = sphereProject(item.v, basis);
      html += '<text class="sphere-label' + (p.front ? '' : ' sphere-back') + '" x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '">' + item.text + '</text>';
    });
    els.mapSphereLabels.innerHTML = html;
  }
  function renderMapSpherePaths(daily, basis) {
    var sun = sphereBodyPath(daily.sphereSun, basis, 'sun');
    var moon = sphereBodyPath(daily.sphereMoon, basis, 'moon');
    els.mapSpherePathsBack.innerHTML = sun.back + moon.back;
    els.mapSpherePathsFront.innerHTML = sun.front + moon.front;
  }
  function renderMapSphereMarkers(sunPos, moonPos, illum, basis) {
    var sun = { az: sunPos.az, alt: sunPos.alt, vector: azAltVector(sunPos.az, sunPos.alt) };
    var moon = { az: moonPos.az, alt: moonPos.alt, vector: azAltVector(moonPos.az, moonPos.alt) };
    var sp = sphereProject(sun.vector, basis);
    var mp = sphereProject(moon.vector, basis);
    var shadow = (1 - illum.fraction) * 10;
    var side = illum.age < 14.77 ? -1 : 1;
    var shadowX = mp.x + side * Math.abs(illum.fraction - .5) * 4;
    // 地図モードでは意図的に天球モードの正射影ドームへ切り替える。tilt=0 の平面コンパス曲線とは異なる。
    els.mapSphereMarkers.innerHTML =
      '<circle class="sphere-sun-now' + (sun.alt < 0 ? ' sphere-below' : '') + (sp.front ? '' : ' sphere-back') + '" cx="' + sp.x.toFixed(1) + '" cy="' + sp.y.toFixed(1) + '" r="5.2"/>' +
      '<g class="' + (moon.alt < 0 ? 'sphere-below ' : '') + (mp.front ? '' : 'sphere-back') + '"><circle class="sphere-moon-now" cx="' + mp.x.toFixed(1) + '" cy="' + mp.y.toFixed(1) + '" r="4.8"/><ellipse class="moon-shadow" cx="' + shadowX.toFixed(1) + '" cy="' + mp.y.toFixed(1) + '" rx="' + shadow.toFixed(1) + '" ry="4.7"/></g>';
  }
  function locToWorld(loc, z) {
    var lat = Math.max(-mapMaxLat, Math.min(mapMaxLat, loc.lat));
    var sin = Math.sin(lat * Math.PI / 180);
    var scale = 256 * Math.pow(2, z);
    return {
      x: (loc.lon + 180) / 360 * scale,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
    };
  }
  function worldToLoc(p, z) {
    var scale = 256 * Math.pow(2, z);
    var lon = p.x / scale * 360 - 180;
    var n = Math.PI - 2 * Math.PI * p.y / scale;
    var lat = Math.atan(Math.sinh(n)) * 180 / Math.PI;
    lon = ((lon + 540) % 360) - 180;
    return { lat: Math.max(-mapMaxLat, Math.min(mapMaxLat, lat)), lon: lon };
  }
  function endMapGesture() {
    if (state.map.drag || state.map.pinch || mapPointerIds().length) saveMapState();
    mapPointerIds().forEach(function (id) {
      try {
        if (els.mapView.hasPointerCapture(Number(id))) els.mapView.releasePointerCapture(Number(id));
      } catch (e) {}
    });
    state.map.pointers = {};
    state.map.drag = null;
    state.map.pinch = null;
    if (state.map.raf) {
      cancelAnimationFrame(state.map.raf);
      state.map.raf = null;
      mapRendered.tiles = '';
    }
  }
  function clampMapZoom(zoom) {
    return Math.max(mapMinZoom, Math.min(mapMaxZoom, Math.round(zoom)));
  }
  function clampMapRadius(radius) {
    return Math.max(mapMinRadius, Math.min(mapMaxRadius, Math.round(radius)));
  }
  function clampMapTilt(tilt) {
    return Math.max(0, Math.min(mapMaxTilt, Math.round(tilt)));
  }
  function bindSphereDrag() {
    els.sphereSvg.addEventListener('pointerdown', function (ev) {
      if (state.sphere.pointerId !== null) return;
      state.sphere.pointerId = ev.pointerId;
      state.sphere.lastX = ev.clientX;
      state.sphere.lastY = ev.clientY;
      els.sphereSvg.classList.add('dragging');
      els.sphereSvg.setPointerCapture(ev.pointerId);
    });
    els.sphereSvg.addEventListener('pointermove', function (ev) {
      if (ev.pointerId !== state.sphere.pointerId) return;
      var dx = ev.clientX - state.sphere.lastX;
      var dy = ev.clientY - state.sphere.lastY;
      state.sphere.lastX = ev.clientX;
      state.sphere.lastY = ev.clientY;
      // コンパス連動中は方位を端末向きが持つため横ドラッグは無効。仰角は常に調整可
      if (!state.compassOn) state.sphere.az = norm360(state.sphere.az + dx * .45);
      state.sphere.el = Math.max(5, Math.min(85, state.sphere.el + dy * .28));
      requestSphereRender();
    });
    ['pointerup', 'pointercancel'].forEach(function (type) {
      els.sphereSvg.addEventListener(type, function (ev) {
        if (ev.pointerId !== state.sphere.pointerId) return;
        endSphereDrag();
      });
    });
  }
  function endSphereDrag() {
    if (state.sphere.pointerId !== null) {
      try {
        if (els.sphereSvg.hasPointerCapture(state.sphere.pointerId)) els.sphereSvg.releasePointerCapture(state.sphere.pointerId);
      } catch (e) {}
    }
    state.sphere.pointerId = null;
    els.sphereSvg.classList.remove('dragging');
  }
  function requestSphereRender() {
    if (state.mode !== 'sphere' || state.sphere.raf) return;
    state.sphere.raf = requestAnimationFrame(function () {
      state.sphere.raf = null;
      renderSphere();
    });
  }
  function renderSphere() {
    if (state.mode !== 'sphere') return;
    var date = state.selectedDate;
    var loc = state.loc;
    var p = ymd(date);
    var tz = -date.getTimezoneOffset();
    var daily = getDaily(p, loc, tz);
    var basis = sphereBasis();
    var viewKey = sphereViewAz().toFixed(2) + '|' + state.sphere.el.toFixed(2);
    var markerKey = [date.getTime(), loc.lat.toFixed(5), loc.lon.toFixed(5)].join('|');
    if (sphereRendered.view !== viewKey) renderSphereGrid(basis);
    if (sphereRendered.view !== viewKey || sphereRendered.daily !== daily.key) renderSpherePaths(daily, basis);
    if (sphereRendered.view !== viewKey || sphereRendered.marker !== markerKey) renderSphereMarkers(date, loc, basis);
    sphereRendered.view = viewKey;
    sphereRendered.daily = daily.key;
    sphereRendered.marker = markerKey;
  }
  // 天球の視点方位: コンパス連動ONかつ方位取得済みなら端末方位に追従。外部視点では 180+heading にすると
  // 真上から見た回転が2Dコンパス(N方位=−heading=向いた方角が上)と一致する。それ以外はドラッグ値を使う。
  function sphereViewAz() {
    return (state.compassOn && state.orientation.ready) ? norm360(180 + state.heading) : state.sphere.az;
  }
  // 外部(俯瞰)視点の正射影。真上から見たとき N上・E右・S下・W左(時計回り)で2Dコンパスと一致する。
  // コンパス連動時の方位は sphereViewAz で 180−heading とし、真上視で2Dと同じ回転になるようにする。
  function sphereBasis() {
    var forward = azAltVector(sphereViewAz(), state.sphere.el);
    var zenith = { x: 0, y: 0, z: 1 };
    var right = cross(zenith, forward);
    if (dot(right, right) < 1e-5) right = { x: 1, y: 0, z: 0 };
    right = normalize(right);
    var up = normalize(cross(forward, right));
    return { forward: forward, right: right, up: up };
  }
  function sphereProject(v, basis) {
    return {
      x: dot(v, basis.right) * 100,
      y: -dot(v, basis.up) * 100,
      front: dot(v, basis.forward) >= 0
    };
  }
  function renderSphereGrid(basis) {
    var ground = spherePath(sphereStatic.horizon, basis);
    var horizon = sphereSplitPaths(sphereStatic.horizon, basis, 'sphere-horizon', false);
    els.sphereGround.innerHTML = '<circle class="sphere-rim" cx="0" cy="0" r="100"/>' +
      '<path class="sphere-ground" d="' + ground + 'Z"/>';
    var back = horizon.back;
    var front = horizon.front;
    sphereStatic.alts.forEach(function (samples) {
      var html = sphereSplitPaths(samples, basis, 'sphere-alt', false);
      back += html.back;
      front += html.front;
    });
    sphereStatic.meridians.forEach(function (samples) {
      var html = sphereSplitPaths(samples, basis, 'sphere-meridian', false);
      back += html.back;
      front += html.front;
    });
    els.sphereGridBack.innerHTML = back;
    els.sphereGridFront.innerHTML = front;
    renderSphereLabels(basis);
  }
  function renderSphereLabels(basis) {
    var html = '';
    sphereStatic.labels.forEach(function (item) {
      var p = sphereProject(item.v, basis);
      html += '<text class="sphere-label' + (p.front ? '' : ' sphere-back') + '" x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '">' + item.text + '</text>';
    });
    var zen = sphereProject(sphereStatic.zenith, basis);
    html += '<g class="sphere-zenith' + (zen.front ? '' : ' sphere-back') + '" transform="translate(' + zen.x.toFixed(1) + ' ' + zen.y.toFixed(1) + ')"><line x1="-5" y1="0" x2="5" y2="0"/><line x1="0" y1="-5" x2="0" y2="5"/></g>';
    html += '<text class="sphere-note' + (zen.front ? '' : ' sphere-back') + '" x="' + zen.x.toFixed(1) + '" y="' + (zen.y - 8).toFixed(1) + '">Z</text>';
    html += '<circle class="sphere-observer" cx="0" cy="0" r="3.2"/>';
    els.sphereLabels.innerHTML = html;
  }
  function renderSpherePaths(daily, basis) {
    var sun = sphereBodyPath(daily.sphereSun, basis, 'sun');
    var moon = sphereBodyPath(daily.sphereMoon, basis, 'moon');
    els.spherePathsBack.innerHTML = sun.back + moon.back;
    els.spherePathsFront.innerHTML = sun.front + moon.front;
  }
  function sphereBodyPath(samples, basis, kind) {
    var cls = kind === 'sun' ? 'sphere-path-sun' : 'sphere-path-moon';
    var dotCls = kind === 'sun' ? 'sphere-dot-sun' : 'sphere-dot-moon';
    var out = sphereSplitPaths(samples, basis, cls, true);
    samples.forEach(function (sample) {
      var p = sphereProject(sample.vector, basis);
      var html = '<circle class="' + dotCls + (sample.alt < 0 ? ' sphere-below' : '') + (p.front ? '' : ' sphere-back') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (kind === 'sun' ? '1.8' : '1.6') + '"/>';
      if (p.front) out.front += html;
      else out.back += html;
    });
    return out;
  }
  function renderSphereMarkers(date, loc, basis) {
    var bodies = get3dBodies(date, loc);
    var sun = bodies.sun;
    var moon = bodies.moon;
    var sp = sphereProject(sun.vector, basis);
    var mp = sphereProject(moon.vector, basis);
    els.sphereMarkers.innerHTML =
      '<circle class="sphere-sun-now' + (sun.alt < 0 ? ' sphere-below' : '') + (sp.front ? '' : ' sphere-back') + '" cx="' + sp.x.toFixed(1) + '" cy="' + sp.y.toFixed(1) + '" r="5.2"/>' +
      '<circle class="sphere-moon-now' + (moon.alt < 0 ? ' sphere-below' : '') + (mp.front ? '' : ' sphere-back') + '" cx="' + mp.x.toFixed(1) + '" cy="' + mp.y.toFixed(1) + '" r="4.8"/>';
  }
  function sphereSplitPaths(samples, basis, cls, dimBelow) {
    var front = '';
    var back = '';
    for (var i = 0; i < samples.length - 1; i++) {
      var a = samples[i];
      var b = samples[i + 1];
      var pa = sphereProject(a.vector, basis);
      var pb = sphereProject(b.vector, basis);
      var isFront = pa.front && pb.front;
      var below = dimBelow && (a.alt < 0 || b.alt < 0);
      var d = 'M' + pa.x.toFixed(1) + ' ' + pa.y.toFixed(1) + 'L' + pb.x.toFixed(1) + ' ' + pb.y.toFixed(1);
      var html = '<path class="' + cls + (below ? ' sphere-below' : '') + (isFront ? '' : ' sphere-back') + '" d="' + d + '"/>';
      if (isFront) front += html;
      else back += html;
    }
    return { front: front, back: back };
  }
  function spherePath(samples, basis) {
    var d = '';
    samples.forEach(function (sample, i) {
      var p = sphereProject(sample.vector, basis);
      d += (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
    });
    return d;
  }
  function sphereCircle(alt) {
    var pts = [];
    for (var az = 0; az <= 360; az += 5) pts.push({ az: az, alt: alt, vector: azAltVector(az, alt) });
    return pts;
  }
  function sphereMeridian(az) {
    var pts = [];
    var opp = norm360(az + 180);
    for (var a = 0; a <= 90; a += 5) pts.push({ az: az, alt: a, vector: azAltVector(az, a) });
    for (var b = 85; b >= 0; b -= 5) pts.push({ az: opp, alt: b, vector: azAltVector(opp, b) });
    return pts;
  }
  function buildSphereStatic() {
    return {
      horizon: sphereCircle(0),
      alts: [sphereCircle(30), sphereCircle(60)],
      meridians: [sphereMeridian(0), sphereMeridian(90)],
      labels: [
        { text: 'N', v: azAltVector(0, 0) },
        { text: 'E', v: azAltVector(90, 0) },
        { text: 'S', v: azAltVector(180, 0) },
        { text: 'W', v: azAltVector(270, 0) }
      ],
      zenith: { x: 0, y: 0, z: 1 }
    };
  }
  function start3dLoop() {
    if (state.raf3d) return;
    basisPrev = null; // 古い基底とのEMA混合を避ける
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
    if (!state.compassOn || !state.orientation.deltaReady || state.orientation.alpha === null || state.orientation.beta === null || state.orientation.gamma === null) {
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
    render3dRef(basis, rect);
    draw3dBody(els.sun3d, els.sunGuide, bodies.sun, basis, rect, 'sun');
    draw3dBody(els.moon3d, els.moonGuide, bodies.moon, basis, rect, 'moon');
  }
  function draw3dBody(bodyEl, guideEl, pos, basis, rect, kind) {
    var out = project3d(pos, basis, rect.width, rect.height, vis3d[kind]);
    vis3d[kind] = out.visible;
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
  // 等距離射影: 視線からの角度θに比例した半径へ置く(広角でも歪まず、傾きに対する移動量が一定。
  // 前方/背面の場合分けが不要で、全天が連続な同一式になる)
  function projectVec(v, basis, w, h) {
    var x = dot(v, basis.right);
    var y = dot(v, basis.up);
    var z = dot(v, basis.forward);
    var theta = Math.acos(Math.max(-1, Math.min(1, z)));
    var lat = Math.sqrt(x * x + y * y);
    var dx = lat > 1e-6 ? x / lat : 0;
    var dy = lat > 1e-6 ? -y / lat : 0;
    var rPx = theta / fov3dHalf * (Math.min(w, h) / 2 - 28);
    return { x: w / 2 + dx * rPx, y: h / 2 + dy * rPx, theta: theta, dx: dx, dy: dy };
  }
  function project3d(pos, basis, w, h, wasVisible) {
    var p = projectVec(pos.vector, basis, w, h);
    var cx = w / 2;
    var cy = h / 2;
    var edge = Math.min(w, h) / 2 - 28;
    var dx = p.dx;
    var dy = p.dy;
    if (!dx && !dy) {
      // 真正面/真後ろは横成分が縮退する。方位差の符号で左右に倒す(sinは180°で0になるため符号のみ使う)
      dx = Math.sin((pos.az - state.orientation.heading) * Math.PI / 180) >= 0 ? 1 : -1;
    }
    var rPx = p.theta / fov3dHalf * edge;
    // 可視中は判定角を縁8px相当広げるヒステリシス(縁でマーカー⇄誘導ピルが点滅しないように)
    var visible = p.theta <= fov3dHalf * (1 + (wasVisible ? 8 / edge : 0));
    var r = Math.min(w, h) / 2 - 38;
    return {
      visible: visible,
      x: cx + dx * rPx - 35,
      y: cy + dy * rPx - 21,
      guideX: cx + dx * r - 24,
      guideY: cy + dy * r - 13,
      guideAngle: Math.atan2(dy, dx) * 180 / Math.PI
    };
  }
  function buildRef3d() {
    els.sky3dRef.innerHTML = '<path class="horizon3d"/>' +
      '<g class="zenith3d"><line x1="-5" y1="0" x2="5" y2="0"/><line x1="0" y1="-5" x2="0" y2="5"/></g>' +
      '<g class="aim3d"><line x1="-7" y1="0" x2="7" y2="0"/><line x1="0" y1="-7" x2="0" y2="7"/></g>' +
      '<text class="card3d">N</text><text class="card3d">E</text><text class="card3d">S</text><text class="card3d">W</text>';
    var texts = els.sky3dRef.querySelectorAll('text');
    ref3d = {
      path: els.sky3dRef.querySelector('path'),
      zenith: els.sky3dRef.querySelector('.zenith3d'),
      aim: els.sky3dRef.querySelector('.aim3d'),
      cards: [texts[0], texts[1], texts[2], texts[3]]
    };
  }
  // 基準表示: 地平線・天頂・方位文字を同じ投影で描く(マーカー位置を方角として誤読しないための手がかり)
  function render3dRef(basis, rect) {
    var w = rect.width;
    var h = rect.height;
    var size = Math.round(w) + 'x' + Math.round(h);
    if (ref3dSize !== size) {
      els.sky3dRef.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      ref3d.aim.setAttribute('transform', 'translate(' + (w / 2).toFixed(1) + ' ' + (h / 2).toFixed(1) + ')');
      ref3dSize = size;
    }
    var d = '';
    for (var az = 0; az <= 360; az += 6) {
      var p = projectVec(azAltVector(az, 0), basis, w, h);
      d += (az ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
    }
    ref3d.path.setAttribute('d', d);
    var zen = projectVec({ x: 0, y: 0, z: 1 }, basis, w, h);
    ref3d.zenith.setAttribute('transform', 'translate(' + zen.x.toFixed(1) + ' ' + zen.y.toFixed(1) + ')');
    ref3d.zenith.style.display = zen.theta <= fov3dHalf ? '' : 'none';
    var rim = Math.min(w, h) / 2 - 16;
    for (var i = 0; i < 4; i++) {
      var c = projectVec(azAltVector(i * 90, 0), basis, w, h);
      var x = c.x;
      var y = c.y;
      if (c.theta > fov3dHalf) {
        // 視界外の方角は縁に沿わせて常時表示(どの姿勢でも方角が分かるように)
        x = w / 2 + c.dx * rim;
        y = h / 2 + c.dy * rim;
      }
      ref3d.cards[i].setAttribute('x', x.toFixed(1));
      ref3d.cards[i].setAttribute('y', y.toFixed(1));
    }
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
  // W3C の回転行列 R = Rz(alpha)Rx(beta)Ry(gamma) から端末軸ベクトル(alpha基準系)を直接計算する。
  // 合成行列はオイラー角の特異点(垂直付近)でも連続なため、振り上げや天頂狙いでも破綻しない。
  // 地上系は ENU(x=東, y=北, z=天頂)、端末系は right=画面右 / up=端末上端 / forward=背面視線。
  function deviceAxes(alpha, beta, gamma) {
    var D = Math.PI / 180;
    var a = alpha * D, b = beta * D, g = gamma * D;
    var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    return {
      right: { x: ca * cg - sa * sb * sg, y: sa * cg + ca * sb * sg, z: -cb * sg },
      up: { x: -sa * cb, y: ca * cb, z: sb },
      forward: { x: -(ca * sg + sa * sb * cg), y: -(sa * sg - ca * sb * cg), z: -cb * cg }
    };
  }
  // alpha 原点(iOSでは不定)と真北のずれ δ: コンパス値と行列側で同じ量(端末上端の水平射影方位)を
  // 計算して差分を取る。コンパスの180°反転は差分で自動的に相殺されるため反転補正が不要になる
  function updateDelta(ev) {
    var o = state.orientation;
    if (o.alpha === null || o.beta === null || o.gamma === null) return;
    if (typeof ev.webkitCompassHeading !== 'number') {
      // alpha が北基準の環境(非iOS)は偏角合わせのみ
      o.delta = state.declination;
      o.deltaReady = true;
      return;
    }
    var top = deviceAxes(o.alpha, o.beta, o.gamma).up;
    var horiz = Math.sqrt(top.x * top.x + top.y * top.y);
    if (horiz < .2) return; // 上端がほぼ鉛直(水平狙い付近)は射影もコンパスも縮退するため更新を凍結
    var t = norm360(ev.webkitCompassHeading + state.declination - azimuthOf(top));
    if (!o.deltaReady) {
      // 初期化は基準軸の取り違えが起きない姿勢(直立未満: 上端射影=背面射影)に限る
      if (o.beta >= 80) return;
      o.delta = t;
      o.deltaReady = true;
      return;
    }
    // iOSコンパスは姿勢の帯域によって基準軸(上端射影/背面射影)が切り替わり、値が180°入れ替わる
    // (斜め上帯域で背面基準になる実測挙動)。δは物理的にほぼ一定なので、
    // 候補 t / t+180 のうち現在のδに近い方を採用する(連続性選択)
    var t2 = t + 180;
    var target = Math.abs(angleDiff(t, o.delta)) <= Math.abs(angleDiff(t2, o.delta)) ? t : t2;
    o.delta = smoothAngle(o.delta, target, .22);
  }
  function azimuthOf(v) {
    return norm360(Math.atan2(v.x, v.y) * 180 / Math.PI);
  }
  function rotAz(v, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: v.x * c + v.y * s, y: v.y * c - v.x * s, z: v.z };
  }
  function cameraBasis(o) {
    var axes = deviceAxes(o.alpha, o.beta, o.gamma);
    var forward = rotAz(axes.forward, o.delta);
    var right = rotAz(axes.right, o.delta);
    var up = rotAz(axes.up, o.delta);
    var screen = screenAngle() * Math.PI / 180;
    if (screen) {
      var cs = Math.cos(screen), sn = Math.sin(screen);
      var r2 = add(scale(right, cs), scale(up, sn));
      up = add(scale(up, cs), scale(right, -sn));
      right = r2;
    }
    // 平滑化は角度でなく基底ベクトルのEMA+再直交化(角度の折り返し・特異点の問題が原理的に出ない)
    if (basisPrev) {
      forward = normalize(add(scale(basisPrev.forward, .75), scale(forward, .25)));
      up = add(scale(basisPrev.up, .75), scale(up, .25));
      up = normalize(add(up, scale(forward, -dot(up, forward))));
      right = cross(forward, up);
    }
    basisPrev = { forward: forward, right: right, up: up };
    return basisPrev;
  }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
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
  function angleDiff(a, b) {
    return (a - b + 540) % 360 - 180;
  }
  // iOSコンパスは姿勢の帯域によって基準軸(上端射影/背面射影)が切り替わり、値が180°入れ替わる。
  // 0/180°のどちらが正しいかは平滑方位への連続性で選ぶ。初期化だけは取り違えが起きない
  // 姿勢(直立未満: 両基準が一致)に限定する。beta を根拠にした強制矯正は斜め上帯域で
  // 誤発動する(反転しないのが正しい帯域)ため置かない。
  function withFlipCorrection(base, beta) {
    if (!state.orientation.ready) {
      return typeof beta === 'number' && beta >= 80 ? null : base;
    }
    var flipped = base + 180;
    return Math.abs(angleDiff(flipped, state.orientation.heading)) < Math.abs(angleDiff(base, state.orientation.heading)) ? flipped : base;
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
