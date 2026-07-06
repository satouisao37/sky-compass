(function () {
  'use strict';

  var Tokyo = { lat: 35.6812, lon: 139.7671, acc: null };
  var mapStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';
  var mapMinZoom = 4;
  var mapMaxZoom = 18;
  var mapMinRadius = 20;
  var mapMaxRadius = 160;
  var mapMaxTilt = 60;
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
    favorites: loadFavorites(),
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
  var renderedTimelineKey = '';
  var renderedMoonCalKey = '';
  var orientationListening = false;
  var headingOutliers = 0;
  var headingAnchorOff = 0;
  var deltaAnchorOff = 0;
  var vis3d = { sun: false, moon: false };
  var basisPrev = null;
  var ref3d = null;
  var ref3dSize = '';
  var paths3d = null;
  var sphereStatic = buildSphereStatic();
  var sphereRendered = { view: '', daily: '', marker: '' };
  var mapRendered = { view: '', daily: '', marker: '', rays: '' };
  var map = null;
  var mapSelectedMarker = null;
  var mapSphereMarker = null;
  var mapSaveTimer = null;
  var mapInitFailed = false;
  var RAY_KM = 200, RAY_SEG = 40; // 地上レイの長さ(km)と大圏の折線分割数
  var mapRayInfo = { count: 0, kinds: [] }; // 直近に setData したレイの内容(検証用)
  var RAY_SUN = '#ffd166', RAY_MOON = '#dce9f2'; // レイの色(--sun / --moon と同系。暗色ケーシングで明地図でも視認)
  var fov3dHalf = 50 * Math.PI / 180; // 3Dかざしの可視円半径に対応する視線からの角度(全視野100°)
  var dirs = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    ['dateLabel','placeLabel','locateBtn','mode2dBtn','mode3dBtn','modeSphereBtn','modeMapBtn','skySvg','sky3d','sky3dRef','sky3dPaths','sun3d','moon3d','sunGuide','moonGuide','sky3dStatus','sphereSvg','sphereGround','sphereGridBack','spherePathsBack','sphereGridFront','spherePathsFront','sphereGalaxy','sphereMarkers','sphereLabels','mapView','mapCanvas','mapMarker','mapSphereMarker','mapSphereSvg','mapSphereGround','mapSphereGridBack','mapSpherePathsBack','mapSphereGridFront','mapSpherePathsFront','mapSphereGalaxy','mapSphereMarkers','mapSphereLabels','mapZoomIn','mapZoomOut','mapRaysBtn','mapRadiusInput','mapTiltInput','mapBearingInput','mapInfo','mapLegend','rotatingSky','ticks','sunPath','moonPath','galaxy2d','sunMarker','moonMarker','belowLabel','compassBtn','compassStatus','sunNow','sunTimes','moonNow','moonTimes','lightTimes','galaxyNow','galaxyTimes','moonPhaseNext','moonStrip','prevDay','nextDay','nowBtn','dateInput','timeSlider','timeLabel','timelineBar','twilightGrad','tlMoon','tlGB','tlHours','tlSun','tlNow','tlNowHandle','timelineAxis','timelineEvents','declinationInput','latInput','lonInput','applyLocBtn','favNameInput','favSaveBtn','favList'].forEach(function (id) { els[id] = document.getElementById(id); });
    drawTicks();
    buildRef3d();
    build3dPaths();
    initMapState();
    els.declinationInput.value = state.declination;
    els.latInput.value = state.loc.lat.toFixed(4);
    els.lonInput.value = state.loc.lon.toFixed(4);
    renderFavorites();
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
      var lat = Number(els.latInput.value);
      var lon = Number(els.lonInput.value);
      applyLocation({
        lat: isFinite(lat) ? lat : state.loc.lat,
        lon: isFinite(lon) ? lon : state.loc.lon
      }, false);
    });
    els.favSaveBtn.addEventListener('click', addFavorite);
    els.favNameInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); addFavorite(); }
    });
    els.compassBtn.addEventListener('click', toggleCompass);
    els.mode2dBtn.addEventListener('click', function () { setMode('2d'); });
    els.mode3dBtn.addEventListener('click', function () { setMode('3d'); });
    els.modeSphereBtn.addEventListener('click', function () { setMode('sphere'); });
    els.modeMapBtn.addEventListener('click', function () { setMode('map'); });
    bindSphereDrag();
    bindMapEvents();
    bindModeSwipe();
    bindTimeline();
    bindMoonCalendar();
  }
  // コンパス盤の横フリックで表示モードを前後に切り替える
  var MODE_ORDER = ['2d', '3d', 'sphere', 'map'];
  function bindModeSwipe() {
    var wrap = els.skySvg.parentElement; // .compass-wrap
    if (!wrap) return;
    // 距離50px以上・速度0.35px/ms以上・水平優位(|dx|≥|dy|×1.7)の「速いフリック」のみ発火。
    // 地図パン・天球回転のようなゆっくりドラッグは速度が足りず取られない
    var MIN_DIST = 50, MIN_VEL = 0.35, H_RATIO = 1.7;
    var startX = 0, startY = 0, startT = 0, tracking = false;
    wrap.addEventListener('touchstart', function (ev) {
      // スライダー・ボタン起点は除外(誤爆防止)、マルチタッチも無効
      if (ev.touches.length !== 1 || ev.target.closest('input, button, .map-controls, .map-sliders')) {
        tracking = false;
        return;
      }
      var t = ev.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startT = ev.timeStamp;
      tracking = true;
    }, { passive: true });
    wrap.addEventListener('touchmove', function (ev) {
      if (ev.touches.length > 1) tracking = false; // ピンチ等はキャンセル
    }, { passive: true });
    wrap.addEventListener('touchend', function (ev) {
      if (!tracking) return;
      tracking = false;
      var t = ev.changedTouches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      var dt = ev.timeStamp - startT;
      var vel = Math.abs(dx) / Math.max(dt, 1);
      if (Math.abs(dx) < MIN_DIST || vel < MIN_VEL || Math.abs(dx) < Math.abs(dy) * H_RATIO) return;
      switchModeBySwipe(dx < 0 ? 1 : -1); // 左フリック=次モード、右フリック=前モード
    }, { passive: true });
    wrap.addEventListener('touchcancel', function () { tracking = false; }, { passive: true });
  }
  function switchModeBySwipe(dir) {
    var idx = MODE_ORDER.indexOf(state.mode);
    if (idx < 0) return;
    var next = Math.max(0, Math.min(MODE_ORDER.length - 1, idx + dir)); // 両端はクランプ
    if (next === idx) return;
    if (map) { try { map.stop(); } catch (e) {} } // 地図の慣性パン暴走を抑止
    setMode(MODE_ORDER[next]);
  }
  function loadLoc() {
    try {
      var saved = JSON.parse(localStorage.getItem('lastLocation') || 'null');
      if (saved && isFinite(saved.lat) && isFinite(saved.lon)) return sanitizeLoc(saved, Tokyo, false);
    } catch (e) {}
    return Tokyo;
  }
  function saveLoc(loc) {
    try {
      localStorage.setItem('lastLocation', JSON.stringify(loc));
    } catch (e) {}
  }
  function loadFavorites() {
    try {
      var arr = JSON.parse(localStorage.getItem('favorites') || '[]');
      if (Array.isArray(arr)) {
        return arr.filter(function (f) { return f && isFinite(f.lat) && isFinite(f.lon); }).slice(0, 30).map(function (f) {
          return { id: f.id || genFavId(), name: String(f.name || '').slice(0, 20) || '無名', lat: clampLat(f.lat), lon: clampLon(f.lon) };
        });
      }
    } catch (e) {}
    return [];
  }
  function saveFavorites() {
    try { localStorage.setItem('favorites', JSON.stringify(state.favorites)); } catch (e) {}
  }
  function genFavId() { return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function addFavorite() {
    // 地図モードは選択地点、他モードは現在地(state.loc)を保存対象にする
    var src = (state.mode === 'map') ? state.map.selected : state.loc;
    var pt = { lat: clampLat(src.lat), lon: clampLon(src.lon) };
    var name = (els.favNameInput.value || '').trim().slice(0, 20) || (pt.lat.toFixed(3) + ', ' + pt.lon.toFixed(3));
    state.favorites.push({ id: genFavId(), name: name, lat: pt.lat, lon: pt.lon });
    if (state.favorites.length > 30) state.favorites = state.favorites.slice(-30); // 上限で古いものから捨てる
    saveFavorites();
    els.favNameInput.value = '';
    renderFavorites();
  }
  function removeFavorite(id) {
    state.favorites = state.favorites.filter(function (f) { return f.id !== id; });
    saveFavorites();
    renderFavorites();
  }
  function renderFavorites() {
    var ul = els.favList;
    if (!ul) return;
    ul.textContent = '';
    if (!state.favorites.length) {
      var empty = document.createElement('li');
      empty.className = 'fav-empty';
      empty.textContent = '保存した地点はまだありません';
      ul.appendChild(empty);
      return;
    }
    state.favorites.forEach(function (fav) {
      var li = document.createElement('li');
      li.className = 'fav-item';
      var apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'fav-apply';
      apply.textContent = fav.name;
      apply.title = fav.lat.toFixed(4) + ', ' + fav.lon.toFixed(4);
      apply.addEventListener('click', function () { applyLocation({ lat: fav.lat, lon: fav.lon }, true); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'fav-del';
      del.setAttribute('aria-label', fav.name + ' を削除');
      del.textContent = '×';
      del.addEventListener('click', function () { removeFavorite(fav.id); });
      li.appendChild(apply);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }
  // 地点の適用を一元化: state.loc 更新・入力反映・保存・(任意で)地図ジャンプ・再描画
  function applyLocation(loc, jumpMap) {
    state.loc = { lat: clampLat(loc.lat), lon: clampLon(loc.lon), acc: null };
    els.latInput.value = state.loc.lat.toFixed(4);
    els.lonInput.value = state.loc.lon.toFixed(4);
    saveLoc(state.loc);
    if (jumpMap) {
      state.map.center = { lat: state.loc.lat, lon: state.loc.lon };
      state.map.selected = { lat: state.loc.lat, lon: state.loc.lon };
      mapRendered.daily = '';
      mapRendered.marker = '';
      mapRendered.rays = '';
      if (map) {
        syncMapMarkers();
        map.jumpTo({ center: [state.map.center.lon, state.map.center.lat] });
      }
      scheduleSaveMapState();
    }
    render();
  }
  function loadMapState() {
    var fallback = { lat: Tokyo.lat, lon: Tokyo.lon };
    var out = {
      center: { lat: fallback.lat, lon: fallback.lon },
      selected: { lat: fallback.lat, lon: fallback.lon },
      zoom: 12,
      radius: Number(localStorage.getItem('mapSphereRadius') || '90'),
      tilt: 0,
      bearing: 0,
      raysOn: localStorage.getItem('mapRaysOn') !== '0',
      raf: null
    };
    try {
      var saved = JSON.parse(localStorage.getItem('mapView') || 'null');
      if (saved) {
        if (saved.center && validLoc(saved.center)) out.center = { lat: saved.center.lat, lon: saved.center.lon };
        if (saved.selected && validLoc(saved.selected)) out.selected = { lat: saved.selected.lat, lon: saved.selected.lon };
        if (isFinite(saved.zoom)) out.zoom = clampMapZoom(saved.zoom);
        if (isFinite(saved.tilt)) out.tilt = clampMapTilt(saved.tilt);
        if (isFinite(saved.bearing)) out.bearing = clampMapBearing(saved.bearing);
      }
    } catch (e) {}
    out.radius = clampMapRadius(out.radius || 90);
    out.tilt = clampMapTilt(out.tilt || 0);
    out.bearing = clampMapBearing(out.bearing || 0);
    return out;
  }
  function initMapState() {
    var saved = false;
    try { saved = !!localStorage.getItem('mapView'); } catch (e) {}
    if (!saved) resetMapToLoc();
    els.mapRadiusInput.value = String(state.map.radius);
    els.mapTiltInput.value = String(Math.round(state.map.tilt));
    els.mapBearingInput.value = String(Math.round(state.map.bearing));
    els.mapRaysBtn.setAttribute('aria-pressed', state.map.raysOn ? 'true' : 'false');
    els.mapLegend.classList.toggle('hidden', !state.map.raysOn);
  }
  function validLoc(loc) {
    return loc && isFinite(loc.lat) && isFinite(loc.lon) && loc.lat >= -90 && loc.lat <= 90 && loc.lon >= -180 && loc.lon <= 180;
  }
  function saveMapState() {
    try {
      localStorage.setItem('mapSphereRadius', String(state.map.radius));
      localStorage.setItem('mapView', JSON.stringify({
        center: sanitizeLoc(state.map.center, Tokyo, true),
        selected: sanitizeLoc(state.map.selected, state.map.center, true),
        zoom: state.map.zoom,
        tilt: state.map.tilt,
        bearing: state.map.bearing
      }));
    } catch (e) {}
  }
  function scheduleSaveMapState() {
    if (mapSaveTimer) clearTimeout(mapSaveTimer);
    mapSaveTimer = setTimeout(function () {
      mapSaveTimer = null;
      saveMapState();
    }, 300);
  }
  function hasSavedMapView() {
    try { return !!localStorage.getItem('mapView'); } catch (e) { return false; }
  }
  function resetMapToLoc() {
    state.map.center = sanitizeLoc(state.loc, Tokyo, false);
    state.map.selected = sanitizeLoc(state.loc, Tokyo, false);
    state.map.zoom = 12;
    state.map.tilt = 0;
    state.map.bearing = 0;
    mapRendered.daily = '';
    mapRendered.marker = '';
    mapRendered.view = '';
    syncMapCamera();
    syncMapMarkers();
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
  function toggleCompass() {
    if (state.compassOn) disableCompass();
    else enableCompass();
  }
  function disableCompass() {
    // deviceorientation リスナーは 3D かざしモードが姿勢に依存するため外さず、追従フラグのみ落とす
    state.compassOn = false;
    els.compassStatus.textContent = '北上固定';
    els.compassBtn.textContent = 'コンパス連動';
    els.compassBtn.classList.remove('active');
    render(); // 2Dは北上固定(rot=0)へ、天球は手動ドラッグ(state.sphere.az)へ戻す
  }
  function enableCompass() {
    function onGranted() {
      if (!orientationListening) {
        window.addEventListener('deviceorientation', onOrientation, true);
        orientationListening = true;
      }
      state.compassOn = true;
      els.compassStatus.textContent = '端末方位に追従';
      els.compassBtn.textContent = '連動を解除';
      els.compassBtn.classList.add('active');
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
      reanchorHeading(ev);
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
    if (mode === 'map') {
      ensureMap();
      if (map) map.resize();
      requestMapRender();
    }
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
  function jumpToMinutes(min) {
    min = Math.max(0, Math.min(1435, Math.round(min / 5) * 5));
    els.timeSlider.value = String(min);
    state.manual = true;
    applyDateAndSlider();
  }
  function jumpToDay(iso) {
    state.manual = true;
    els.dateInput.value = iso;
    applyDateAndSlider();
  }
  function bindTimeline() {
    if (!els.timelineBar) return;
    var pointerId = null;
    function moveToPointer(ev) {
      var rect = els.timelineBar.getBoundingClientRect();
      if (!rect.width) return;
      jumpToMinutes((ev.clientX - rect.left) / rect.width * 1440);
    }
    els.timelineBar.addEventListener('pointerdown', function (ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      pointerId = ev.pointerId;
      els.timelineBar.classList.add('dragging');
      els.timelineBar.setPointerCapture(pointerId);
      moveToPointer(ev);
    });
    els.timelineBar.addEventListener('pointermove', function (ev) {
      if (pointerId !== ev.pointerId || !(ev.buttons & 1)) return;
      moveToPointer(ev);
    });
    function endPointer(ev) {
      if (pointerId !== ev.pointerId) return;
      if (els.timelineBar.hasPointerCapture(pointerId)) els.timelineBar.releasePointerCapture(pointerId);
      pointerId = null;
      els.timelineBar.classList.remove('dragging');
    }
    els.timelineBar.addEventListener('pointerup', endPointer);
    els.timelineBar.addEventListener('pointercancel', endPointer);
    els.timelineEvents.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-min]');
      if (!btn || btn.disabled) return;
      jumpToMinutes(Number(btn.getAttribute('data-min')));
    });
  }
  function bindMoonCalendar() {
    if (!els.moonStrip) return;
    els.moonStrip.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-date]');
      if (!btn) return;
      jumpToDay(btn.getAttribute('data-date'));
    });
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
    var sw = daily.starWindow;
    els.dateLabel.textContent = fmtFull(date);
    els.placeLabel.textContent = loc.lat.toFixed(4) + ', ' + loc.lon.toFixed(4) + (loc.acc ? '  精度約' + Math.round(loc.acc) + 'm' : '');
    els.timeLabel.textContent = pad(date.getHours()) + ':' + pad(date.getMinutes());
    els.sunNow.textContent = '方位 ' + degDir(sun.az) + ' / 高度 ' + sun.alt.toFixed(1) + '度';
    els.moonNow.textContent = '方位 ' + degDir(moon.az) + ' / 高度 ' + moon.alt.toFixed(1) + '度 / 月齢 ' + illum.age.toFixed(1) + ' / 輝面比 ' + Math.round(illum.fraction * 100) + '%';
    els.sunTimes.textContent = '出 ' + fmtTime(st.rise) + ' / 南中 ' + fmtTime(st.transit) + ' / 入 ' + fmtTime(st.set);
    els.moonTimes.textContent = '出 ' + fmtTime(mt.rise) + ' / 南中 ' + fmtTime(mt.transit) + ' / 入 ' + fmtTime(mt.set);
    drawGalaxyCard(date, loc, daily);
    // 略語をやめ時系列順に明記(朝=ブルー→ゴールデン、夕=ゴールデン→ブルー)。時刻は数値のみのため innerHTML でも安全
    els.lightTimes.innerHTML = '朝　ブルーアワー ' + fmtRange(st.blueAM) + '／ゴールデンアワー ' + fmtRange(st.goldenAM) + '<br>' +
      '夕　ゴールデンアワー ' + fmtRange(st.goldenPM) + '／ブルーアワー ' + fmtRange(st.bluePM) + '<br>' +
      '夜　星空　' + fmtStarWindow(sw);
    if (renderedPathKey !== daily.key) {
      els.sunPath.innerHTML = daily.sunPath;
      els.moonPath.innerHTML = daily.moonPath;
      renderedPathKey = daily.key;
    }
    renderTimeline(daily, p, loc, date);
    drawMoonCalendar(loc);
    drawGalaxy2d(date, loc);
    drawBody(els.sunMarker, sun, 'sun', illum);
    drawBody(els.moonMarker, moon, 'moon', illum);
    els.belowLabel.textContent = [sun.alt < 0 ? '太陽は地平線下' : '', moon.alt < 0 ? '月は地平線下' : ''].filter(Boolean).join(' / ');
    renderCompassRotation();
    if (state.mode === '3d') request3dRender();
    if (state.mode === 'sphere') requestSphereRender();
    // 地図操作(パン/ズーム)中は時計駆動の DOM 書込を止める(ドーム内容は selected/日時/pitch にのみ依存し、
    // パン/ズームでは変わらない。操作が終われば次の秒 tick で追いつく)
    if (state.mode === 'map' && (!map || !map.isMoving())) requestMapRender();
  }
  function renderCompassRotation() {
    var rot = state.compassOn ? -displayHeading() : 0;
    els.rotatingSky.setAttribute('transform', 'rotate(' + rot.toFixed(1) + ')');
  }
  function renderTimeline(daily, p, loc, date) {
    if (renderedTimelineKey !== daily.key) {
      buildTimelineStatic(daily, p, loc);
      renderedTimelineKey = daily.key;
    }
    updateTimelineIndicator(date);
  }
  function buildTimelineStatic(daily, p, loc) {
    var st = daily.sunTimes;
    var mt = daily.moonTimes;
    buildTwilightGradient(st);
    els.tlMoon.innerHTML = buildMoonBands(mt, p, loc);
    els.tlGB.innerHTML = buildLightRails(st);
    els.tlHours.innerHTML = buildTimelineHours();
    els.tlSun.innerHTML = buildSunTicks(st);
    els.timelineAxis.innerHTML = [0, 6, 12, 18, 24].map(function (h) { return '<span>' + h + '</span>'; }).join('');
    els.timelineEvents.innerHTML = buildTimelineEvents(st, mt);
  }
  function buildTwilightGradient(st) {
    var colors = timelineColors();
    var stops = [
      { min: 0, color: colors.night },
      { min: minuteOf(st.astroDawn), color: colors.astro },
      { min: minuteOf(st.nauticalDawn), color: colors.nautical },
      { min: minuteOf(st.civilDawn), color: colors.civil },
      { min: minuteOf(st.rise), color: colors.day },
      { min: minuteOf(st.set), color: colors.day },
      { min: minuteOf(st.civilDusk), color: colors.civil },
      { min: minuteOf(st.nauticalDusk), color: colors.nautical },
      { min: minuteOf(st.astroDusk), color: colors.astro },
      { min: 1440, color: colors.night }
    ].filter(function (s) { return s.min !== null; }).sort(function (a, b) { return a.min - b.min; });
    els.twilightGrad.innerHTML = stops.map(function (s) {
      return '<stop offset="' + (s.min / 1440 * 100).toFixed(3) + '%" stop-color="' + s.color + '"/>';
    }).join('');
  }
  function timelineColors() {
    var css = getComputedStyle(document.documentElement);
    return {
      night: css.getPropertyValue('--tl-night').trim(),
      astro: css.getPropertyValue('--tl-astro').trim(),
      nautical: css.getPropertyValue('--tl-nautical').trim(),
      civil: css.getPropertyValue('--tl-civil').trim(),
      day: css.getPropertyValue('--tl-day').trim()
    };
  }
  function buildMoonBands(mt, p, loc) {
    var rise = minuteOf(mt.rise);
    var set = minuteOf(mt.set);
    var ranges = [];
    if (rise !== null && set !== null) {
      ranges = rise < set ? [[rise, set]] : [[0, set], [rise, 1440]];
    } else if (rise !== null) {
      ranges = [[rise, 1440]];
    } else if (set !== null) {
      ranges = [[0, set]];
    } else {
      var noon = new Date(p.y, p.m - 1, p.d, 12, 0, 0);
      if (Astro.moonPosition(noon, loc.lat, loc.lon).alt > -0.833) ranges = [[0, 1440]];
    }
    return ranges.map(function (r) {
      var w = r[1] - r[0];
      if (w <= 0) return '';
      return '<rect class="tl-moon-band" x="' + r[0] + '" y="0" width="' + w + '" height="10"/>' +
        '<line class="tl-moon-edge" x1="' + r[0] + '" x2="' + r[1] + '" y1="10" y2="10" vector-effect="non-scaling-stroke"/>';
    }).join('');
  }
  function buildLightRails(st) {
    return [
      { range: st.goldenAM, cls: 'tl-golden' },
      { range: st.goldenPM, cls: 'tl-golden' },
      { range: st.blueAM, cls: 'tl-blue' },
      { range: st.bluePM, cls: 'tl-blue' }
    ].map(function (item) {
      return rangeRects(item.range, item.cls, 50, 6);
    }).join('');
  }
  function rangeRects(range, cls, y, h) {
    if (!range || !range.start || !range.end) return '';
    var start = minuteOf(range.start);
    var end = minuteOf(range.end);
    if (start === null || end === null || start === end) return '';
    var parts = start < end ? [[start, end]] : [[0, end], [start, 1440]];
    return parts.map(function (p) {
      return '<rect class="' + cls + '" x="' + p[0] + '" y="' + y + '" width="' + (p[1] - p[0]) + '" height="' + h + '" rx="1"/>';
    }).join('');
  }
  function buildTimelineHours() {
    return [0, 360, 720, 1080, 1440].map(function (min) {
      return '<line class="tl-grid" x1="' + min + '" x2="' + min + '" y1="0" y2="56" vector-effect="non-scaling-stroke"/>';
    }).join('');
  }
  function buildSunTicks(st) {
    return [st.rise, st.set].map(function (date) {
      var min = minuteOf(date);
      if (min === null) return '';
      return '<line class="tl-sun-tick" x1="' + min + '" x2="' + min + '" y1="0" y2="56" vector-effect="non-scaling-stroke"/>';
    }).join('');
  }
  function buildTimelineEvents(st, mt) {
    return [
      eventButton('sun', '☀ 出', st.rise),
      eventButton('sun', '☀ 入', st.set),
      eventButton('moon', '☾ 出', mt.rise),
      eventButton('moon', '☾ 入', mt.set)
    ].join('');
  }
  function eventButton(kind, label, date) {
    var min = minuteOf(date);
    var disabled = min === null;
    return '<button class="timeline-event ' + kind + '" type="button"' +
      (disabled ? ' disabled' : ' data-min="' + min + '"') + '>' + label + ' ' + fmtTime(date) + '</button>';
  }
  function updateTimelineIndicator(date) {
    var mins = minuteOf(date);
    if (mins === null) mins = 0;
    els.tlNow.setAttribute('x1', String(mins));
    els.tlNow.setAttribute('x2', String(mins));
    els.tlNowHandle.style.left = (mins / 1440 * 100).toFixed(4) + '%';
  }
  function minuteOf(date) {
    return date ? date.getHours() * 60 + date.getMinutes() : null;
  }
  function drawMoonCalendar(loc) {
    var today = startOfDay(new Date());
    var selected = state.selectedDate;
    var selectedIso = isoDay(selected);
    var key = isoDay(today) + '|' + selectedIso + '|' + loc.lat.toFixed(4) + ',' + loc.lon.toFixed(4);
    if (renderedMoonCalKey === key) return;

    var stripStart = today.getTime();
    var nextEvents = Astro.moonPhases(stripStart, stripStart + 40 * 86400000, 6);
    var nextNew = firstMoonPhase(nextEvents, 'new');
    var nextFull = firstMoonPhase(nextEvents, 'full');
    els.moonPhaseNext.textContent = '次の新月 ' + fmtPhaseEvent(nextNew) + ' ・ 次の満月 ' + fmtPhaseEvent(nextFull);

    var dayEvents = Astro.moonPhases(stripStart, stripStart + 28 * 86400000, 6);
    var eventByDay = {};
    dayEvents.forEach(function (event) {
      eventByDay[isoDay(event.date)] = event;
    });
    els.moonStrip.innerHTML = buildMoonCalendarCells(today, selectedIso, loc, eventByDay);
    renderedMoonCalKey = key;

    var selectedCell = els.moonStrip.querySelector('.moon-cell.selected');
    if (selectedCell) {
      els.moonStrip.scrollLeft = Math.max(0, selectedCell.offsetLeft - (els.moonStrip.clientWidth - selectedCell.clientWidth) / 2);
    }
  }
  function buildMoonCalendarCells(today, selectedIso, loc, eventByDay) {
    var weekdays = ['日','月','火','水','木','金','土'];
    var html = '';
    for (var i = 0; i < 28; i++) {
      var day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      var p = ymd(day);
      var iso = isoDay(day);
      var tz = -day.getTimezoneOffset();
      var noon = new Date(p.y, p.m - 1, p.d, 12, 0, 0);
      var illum = Astro.moonIllumination(noon);
      var mt = Astro.moonTimes(p.y, p.m, p.d, loc.lat, loc.lon, tz);
      var event = eventByDay[iso];
      var phaseClass = event ? ' phase-' + event.type : '';
      var selectedClass = iso === selectedIso ? ' selected' : '';
      var wd = weekdays[day.getDay()];
      var wdClass = day.getDay() === 0 ? ' sun' : (day.getDay() === 6 ? ' sat' : '');
      html += '<button class="moon-cell' + selectedClass + phaseClass + '" type="button" data-date="' + iso + '">' +
        '<span class="mc-date' + wdClass + '">' + p.m + '/' + p.d + '<br>(' + wd + ')</span>' +
        '<svg class="mc-glyph" viewBox="-9 -9 18 18" aria-hidden="true">' + moonGlyphSvg(illum.fraction, illum.age) + '</svg>' +
        '<span class="mc-age">月齢' + illum.age.toFixed(1) + '</span>' +
        '<span class="mc-illum">' + Math.round(illum.fraction * 100) + '%</span>' +
        '<span class="mc-rs">↑' + fmtTime(mt.rise) + '<br>↓' + fmtTime(mt.set) + '</span>' +
        (event ? '<span class="mc-badge">' + (event.type === 'new' ? '新' : '満') + '</span>' : '') +
        '</button>';
    }
    return html;
  }
  function moonGlyphSvg(fraction, age) {
    var r = 7;
    var s = r / 5.2;
    var g = moonShadowGeom(fraction, age, 0);
    return '<circle class="mc-disc" cx="0" cy="0" r="' + r + '"/>' +
      '<ellipse class="mc-shadow" cx="' + (g.x * s).toFixed(1) + '" cy="0" rx="' + (g.rx * s).toFixed(1) + '" ry="' + r + '"/>';
  }
  function firstMoonPhase(events, type) {
    for (var i = 0; i < events.length; i++) {
      if (events[i].type === type) return events[i];
    }
    return null;
  }
  function fmtPhaseEvent(event) {
    return event ? fmtMD(event.date) + ' ' + fmtTime(event.date) : '--';
  }
  function fmtMD(date) {
    return (date.getMonth() + 1) + '/' + date.getDate();
  }
  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  function isoDay(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
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
        starWindow: Astro.starWindow(p.y, p.m, p.d, loc.lat, loc.lon, tz),
        galacticCenterTimes: Astro.galacticCenterTimes(p.y, p.m, p.d, loc.lat, loc.lon, tz),
        galacticCenterWindow: Astro.galacticCenterWindow(p.y, p.m, p.d, loc.lat, loc.lon, tz),
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
    var shadow = moonShadowGeom(illum.fraction, illum.age, p.x);
    el.innerHTML = '<g class="' + (pos.alt < 0 ? 'below' : '') + '"><circle class="moon-disc" cx="' + p.x + '" cy="' + p.y + '" r="5.2"/><ellipse class="moon-shadow" cx="' + shadow.x.toFixed(1) + '" cy="' + p.y + '" rx="' + shadow.rx.toFixed(1) + '" ry="5.1"/></g>';
  }
  function moonShadowGeom(fraction, age, cx) {
    var side = age < 14.77 ? -1 : 1;
    return {
      x: cx + side * Math.abs(fraction - .5) * 4,
      rx: (1 - fraction) * 10
    };
  }
  function drawGalaxy2d(date, loc) {
    var pts = Astro.galacticPlanePoints(date, loc.lat, loc.lon, 4);
    var d = '';
    var open = false;
    pts.forEach(function (pt) {
      if (pt.alt < 0) {
        open = false;
        return;
      }
      var p = project(pt);
      d += (open ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
      open = true;
    });
    var html = d ? '<path class="path-galaxy" d="' + d + '"/>' : '';
    var gc = Astro.galacticCenterPosition(date, loc.lat, loc.lon);
    if (gc.alt >= 0) {
      var gp = project(gc);
      html += '<circle class="gc-marker" cx="' + gp.x.toFixed(1) + '" cy="' + gp.y.toFixed(1) + '" r="3.4"/>' +
        '<text class="gc-label" x="' + gp.x.toFixed(1) + '" y="' + (gp.y - 6).toFixed(1) + '">GC</text>';
    }
    els.galaxy2d.innerHTML = html;
  }
  function drawGalaxyCard(date, loc, daily) {
    var gc = Astro.galacticCenterPosition(date, loc.lat, loc.lon);
    els.galaxyNow.textContent = gc.alt < 0 ?
      '地平線下（方位 ' + degDir(gc.az) + '）' :
      '方位 ' + degDir(gc.az) + ' / 高度 ' + gc.alt.toFixed(1) + '度';
    var gt = daily.galacticCenterTimes;
    var transitAlt = gt.transit ? Astro.galacticCenterPosition(gt.transit, loc.lat, loc.lon).alt : null;
    var win = daily.galacticCenterWindow;
    els.galaxyTimes.textContent = '南中 ' + fmtTime(gt.transit) +
      (transitAlt === null ? '' : '（高度' + transitAlt.toFixed(0) + '度）') +
      ' / 見頃 ' + fmtGalaxyWindow(win);
  }
  function project(pos) {
    var alt = Math.max(pos.alt, 0);
    var r = (90 - alt) / 90 * 100;
    if (pos.alt < 0) r = 104;
    return polar(pos.az, r);
  }
  function bindMapEvents() {
    els.mapZoomIn.addEventListener('click', function () { ensureMap(); if (map) map.zoomIn(); });
    els.mapZoomOut.addEventListener('click', function () { ensureMap(); if (map) map.zoomOut(); });
    els.mapRaysBtn.addEventListener('click', function () {
      state.map.raysOn = !state.map.raysOn;
      try { localStorage.setItem('mapRaysOn', state.map.raysOn ? '1' : '0'); } catch (e) {}
      els.mapRaysBtn.setAttribute('aria-pressed', state.map.raysOn ? 'true' : 'false');
      els.mapLegend.classList.toggle('hidden', !state.map.raysOn);
      applyRayVisibility();
      mapRendered.rays = ''; // ON 復帰時に最新データで再構築させる
      ensureMap();
      requestMapRender();
    });
    els.mapRadiusInput.addEventListener('input', function () {
      state.map.radius = clampMapRadius(Number(els.mapRadiusInput.value) || 90);
      scheduleSaveMapState();
      requestMapRender();
    });
    els.mapTiltInput.addEventListener('input', function () {
      state.map.tilt = clampMapTilt(Number(els.mapTiltInput.value) || 0);
      mapRendered.view = '';
      ensureMap();
      if (map) {
        map.setPitch(state.map.tilt);
        scheduleSaveMapState();
      } else {
        scheduleSaveMapState();
        requestMapRender();
      }
    });
    els.mapBearingInput.addEventListener('input', function () {
      state.map.bearing = clampMapBearing(Number(els.mapBearingInput.value) || 0);
      mapRendered.view = '';
      ensureMap();
      if (map) {
        map.setBearing(state.map.bearing);
        scheduleSaveMapState();
      } else {
        scheduleSaveMapState();
        requestMapRender();
      }
    });
    window.addEventListener('resize', function () { if (state.mode === 'map' && map) map.resize(); });
    // CDP実動検証用
    window.__mapDebug = function () {
      if (!map) return null;
      var out = { zoom: map.getZoom(), pitch: map.getPitch(), center: map.getCenter(), loaded: map.loaded() };
      try {
        var queried = map.getLayer('sky-rays-now') ? map.querySourceFeatures('sky-rays').length : 0;
        out.rays = {
          hasSource: !!map.getSource('sky-rays'),
          features: mapRayInfo.count,
          kinds: mapRayInfo.kinds,
          queried: queried,
          nowVisible: map.getLayer('sky-rays-now') ? (map.getLayoutProperty('sky-rays-now', 'visibility') || 'visible') : 'none'
        };
      } catch (e) { out.rays = { err: String(e) }; }
      return out;
    };
  }
  function ensureMap() {
    if (map || mapInitFailed || !window.maplibregl) return;
    state.map.center = sanitizeLoc(state.map.center, Tokyo, true);
    state.map.selected = sanitizeLoc(state.map.selected, state.map.center, true);
    try {
      createMap();
    } catch (e) {
      // WebGL が使えない環境では Map 生成が投げる。毎フレーム再試行して例外を吐き続けないよう一度で諦める
      mapInitFailed = true;
      if (map) { try { map.remove(); } catch (e2) {} }
      map = null;
      els.mapInfo.textContent = 'この端末では地図を表示できません(WebGL が無効です)';
    }
  }
  function createMap() {
    map = new maplibregl.Map({
      container: els.mapCanvas,
      style: mapStyleUrl,
      center: [state.map.center.lon, state.map.center.lat],
      zoom: state.map.zoom,
      pitch: state.map.tilt,
      bearing: state.map.bearing,
      minZoom: mapMinZoom,
      maxZoom: mapMaxZoom,
      maxPitch: mapMaxTilt,
      dragRotate: false,
      pitchWithRotate: false
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapSelectedMarker = makeViewportMarker(els.mapMarker).setLngLat([state.map.selected.lon, state.map.selected.lat]).addTo(map);
    mapSphereMarker = makeViewportMarker(els.mapSphereMarker).setLngLat([state.map.selected.lon, state.map.selected.lat]).addTo(map);
    map.on('click', function (ev) {
      state.map.selected = { lat: clampLat(ev.lngLat.lat), lon: wrapLon(ev.lngLat.lng) };
      mapRendered.daily = '';
      mapRendered.marker = '';
      mapRendered.rays = '';
      syncMapMarkers();
      scheduleSaveMapState();
      requestMapRender();
    });
    map.on('moveend', function () {
      syncMapStateFromCamera(false);
      scheduleSaveMapState();
    });
    map.on('pitch', function () {
      syncMapStateFromCamera(true);
      requestMapRender();
    });
    map.on('pitchend', function () {
      syncMapStateFromCamera(true);
      scheduleSaveMapState();
    });
    map.on('rotate', function () {
      syncMapStateFromCamera(true);
      requestMapRender();
    });
    map.on('rotateend', function () {
      syncMapStateFromCamera(true);
      scheduleSaveMapState();
    });
    // ズームに追従して天球ドームの表示倍率を更新(地上サイズを一定に見せる)
    map.on('zoom', updateMapSphereScale);
    map.on('load', function () {
      // 建物の立体表示(liberty 同梱の building-3d)を z13 から出す(既定 minzoom:14 では既定ズームで見えない)
      try {
        if (map.getLayer('building-3d')) map.setLayerZoomRange('building-3d', 13, 24);
      } catch (e) {}
      addRayLayers();
      mapRendered.rays = '';
      requestMapRender();
    });
  }
  function makeViewportMarker(element) {
    return new maplibregl.Marker({
      element: element,
      anchor: 'center',
      pitchAlignment: 'viewport',
      rotationAlignment: 'viewport'
    });
  }
  function syncMapStateFromCamera(syncInputs) {
    if (!map) return;
    var center = map.getCenter();
    state.map.center = { lat: clampLat(center.lat), lon: wrapLon(center.lng) };
    state.map.zoom = map.getZoom();
    state.map.tilt = clampMapTilt(map.getPitch());
    state.map.bearing = clampMapBearing(map.getBearing());
    if (syncInputs) {
      // pitch/rotate イベント毎の無条件代入はレイアウトを誘発するため、丸め値が変わったときだけ書く
      var tiltValue = String(Math.round(state.map.tilt));
      if (els.mapTiltInput.value !== tiltValue) els.mapTiltInput.value = tiltValue;
      var bearingValue = String(Math.round(state.map.bearing));
      if (els.mapBearingInput.value !== bearingValue) els.mapBearingInput.value = bearingValue;
    }
  }
  function syncMapCamera() {
    if (!map) return;
    map.jumpTo({
      center: [state.map.center.lon, state.map.center.lat],
      zoom: state.map.zoom,
      pitch: state.map.tilt,
      bearing: state.map.bearing
    });
  }
  function syncMapMarkers() {
    if (!mapSelectedMarker || !mapSphereMarker) return;
    var lngLat = [state.map.selected.lon, state.map.selected.lat];
    mapSelectedMarker.setLngLat(lngLat);
    mapSphereMarker.setLngLat(lngLat);
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
    ensureMap();
    renderMapOverlay();
  }
  function renderMapOverlay() {
    if (mapInitFailed) return; // 失敗メッセージを毎秒の再描画で上書きしない
    var r = state.map.radius;
    els.mapSphereSvg.style.width = (r * 2) + 'px';
    els.mapSphereSvg.style.height = (r * 2) + 'px';
    updateMapSphereScale();
    syncMapMarkers();
    var date = state.selectedDate;
    var tz = -date.getTimezoneOffset();
    var p = ymd(date);
    var daily = getDaily(p, state.map.selected, tz);
    // 地上レイ(太陽・月の方位線)を更新。selected/日時のみ依存(view 非依存)なのでパン/傾き/回転では再構築しない
    if (state.map.raysOn && map && map.getSource && map.getSource('sky-rays')) {
      var rayKey = [date.getTime(), state.map.selected.lat.toFixed(5), state.map.selected.lon.toFixed(5)].join('|');
      if (mapRendered.rays !== rayKey && updateMapRays(date, state.map.selected, daily)) mapRendered.rays = rayKey;
    }
    var basis = mapSphereBasis();
    var viewKey = Math.round(state.map.tilt) + '/' + Math.round(state.map.bearing);
    if (mapRendered.view !== viewKey) renderMapSphereGrid(basis);
    if (mapRendered.view !== viewKey || mapRendered.daily !== daily.key) renderMapSpherePaths(daily, basis);
    var markerKey = [date.getTime(), state.map.selected.lat.toFixed(5), state.map.selected.lon.toFixed(5), viewKey].join('|');
    if (mapRendered.marker === markerKey) {
      mapRendered.view = viewKey;
      mapRendered.daily = daily.key;
      return;
    }
    var sun = Astro.sunPosition(date, state.map.selected.lat, state.map.selected.lon);
    var moon = Astro.moonPosition(date, state.map.selected.lat, state.map.selected.lon);
    var illum = Astro.moonIllumination(date);
    renderMapSphereMarkers(sun, moon, illum, basis);
    renderGalaxyInto(els.mapSphereGalaxy, date, state.map.selected, basis);
    els.mapInfo.textContent = state.map.selected.lat.toFixed(5) + ', ' + state.map.selected.lon.toFixed(5) +
      ' / 太陽 ' + degDir(sun.az) + ' 高度 ' + sun.alt.toFixed(1) + '度' +
      ' / 月 ' + degDir(moon.az) + ' 高度 ' + moon.alt.toFixed(1) + '度';
    mapRendered.view = viewKey;
    mapRendered.daily = daily.key;
    mapRendered.marker = markerKey;
  }
  function addRayLayers() {
    if (!map || (map.getSource && map.getSource('sky-rays'))) return;
    try {
      map.addSource('sky-rays', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      var colorByBody = ['match', ['get', 'body'], 'sun', RAY_SUN, 'moon', RAY_MOON, '#ffffff'];
      // 暗色ケーシングを下敷きにして明るい地図でもレイを縁取りで浮かせる(道路ケーシングと同手法)
      map.addLayer({
        id: 'sky-rays-casing', type: 'line', source: 'sky-rays',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': 'rgba(12,18,24,0.55)', 'line-width': ['match', ['get', 'kind'], 'now', 5, 4] }
      });
      // 出没方位は破線、現在方位は実線で区別
      map.addLayer({
        id: 'sky-rays-event', type: 'line', source: 'sky-rays',
        filter: ['!=', ['get', 'kind'], 'now'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': colorByBody, 'line-width': 2.2, 'line-dasharray': [1.8, 1.6] }
      });
      map.addLayer({
        id: 'sky-rays-now', type: 'line', source: 'sky-rays',
        filter: ['==', ['get', 'kind'], 'now'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': colorByBody, 'line-width': 2.8 }
      });
      applyRayVisibility();
    } catch (e) {}
  }
  function applyRayVisibility() {
    if (!map) return;
    var vis = state.map.raysOn ? 'visible' : 'none';
    ['sky-rays-casing', 'sky-rays-event', 'sky-rays-now'].forEach(function (id) {
      if (map.getLayer(id)) { try { map.setLayoutProperty(id, 'visibility', vis); } catch (e) {} }
    });
  }
  function rayLineCoords(loc, az) {
    var coords = [];
    for (var i = 0; i <= RAY_SEG; i++) {
      var pt = Astro.destinationPoint(loc.lat, loc.lon, az, RAY_KM * i / RAY_SEG);
      coords.push([pt.lon, pt.lat]);
    }
    return coords;
  }
  function rayFeature(loc, az, body, kind) {
    return { type: 'Feature', properties: { body: body, kind: kind }, geometry: { type: 'LineString', coordinates: rayLineCoords(loc, az) } };
  }
  function buildRayFeatures(date, loc, daily) {
    var feats = [];
    var sun = Astro.sunPosition(date, loc.lat, loc.lon);
    var moon = Astro.moonPosition(date, loc.lat, loc.lon);
    if (sun.alt >= -0.833) feats.push(rayFeature(loc, sun.az, 'sun', 'now'));
    if (moon.alt >= -0.833) feats.push(rayFeature(loc, moon.az, 'moon', 'now'));
    var st = daily.sunTimes, mt = daily.moonTimes;
    if (st.rise) feats.push(rayFeature(loc, Astro.sunPosition(st.rise, loc.lat, loc.lon).az, 'sun', 'rise'));
    if (st.set) feats.push(rayFeature(loc, Astro.sunPosition(st.set, loc.lat, loc.lon).az, 'sun', 'set'));
    if (mt.rise) feats.push(rayFeature(loc, Astro.moonPosition(mt.rise, loc.lat, loc.lon).az, 'moon', 'rise'));
    if (mt.set) feats.push(rayFeature(loc, Astro.moonPosition(mt.set, loc.lat, loc.lon).az, 'moon', 'set'));
    return { type: 'FeatureCollection', features: feats };
  }
  function updateMapRays(date, loc, daily) {
    var src = map && map.getSource && map.getSource('sky-rays');
    if (!src) return false;
    var fc = buildRayFeatures(date, loc, daily);
    src.setData(fc);
    mapRayInfo = { count: fc.features.length, kinds: fc.features.map(function (f) { return f.properties.body + ':' + f.properties.kind; }) };
    return true;
  }
  function mapSphereBasis() {
    // 地図の回転(bearing)に合わせて天球ドームの方位を回す。
    // MapLibre は bearing の方位が画面上端に来るため、カメラ方位は bearing+180(手前=画面下)。
    var b = state.map.bearing || 0;
    var forward = azAltVector(180 + b, 90 - state.map.tilt); // 視点(カメラ)へ向かう方向
    var right = normalize(azAltVector(90 + b, 0));            // 画面右 = bearing+90 の水平方向
    var up = normalize(cross(forward, right));
    return { forward: forward, right: right, up: up };
  }
  function mapSphereZoomFactor() {
    // 地上サイズを一定に見せるため、基準ズーム(12)からの倍率でスケールする(2^Δzoom)。上下限でクランプ。
    var zoom = map ? map.getZoom() : state.map.zoom;
    var f = Math.pow(2, zoom - 12);
    return Math.max(0.12, Math.min(8, f));
  }
  function updateMapSphereScale() {
    if (!els.mapSphereSvg) return;
    els.mapSphereSvg.style.transform = 'scale(' + mapSphereZoomFactor().toFixed(3) + ')';
  }
  function renderMapSphereGrid(basis) {
    renderSphereGridInto(mapSphereTargets(), basis, { zenith: false, observer: false });
  }
  function renderMapSphereLabels(basis) {
    renderSphereLabelsInto(mapSphereTargets(), basis, { zenith: false, observer: false });
  }
  function renderMapSpherePaths(daily, basis) {
    renderSpherePathsInto(mapSphereTargets(), daily, basis);
  }
  function renderMapSphereMarkers(sunPos, moonPos, illum, basis) {
    // 地図モードでは意図的に天球モードの正射影ドームへ切り替える。tilt=0 の平面コンパス曲線とは異なる。
    var html = '';
    if (sunPos.alt >= 0) { // 地平線下は描かない
      var sp = sphereProject(azAltVector(sunPos.az, sunPos.alt), basis);
      html += '<circle class="sphere-sun-now' + (sp.front ? '' : ' sphere-back') + '" cx="' + sp.x.toFixed(1) + '" cy="' + sp.y.toFixed(1) + '" r="5.2"/>';
    }
    if (moonPos.alt >= 0) {
      var mp = sphereProject(azAltVector(moonPos.az, moonPos.alt), basis);
      var shadow = moonShadowGeom(illum.fraction, illum.age, mp.x);
      html += '<g class="' + (mp.front ? '' : 'sphere-back') + '"><circle class="sphere-moon-now" cx="' + mp.x.toFixed(1) + '" cy="' + mp.y.toFixed(1) + '" r="4.8"/><ellipse class="moon-shadow" cx="' + shadow.x.toFixed(1) + '" cy="' + mp.y.toFixed(1) + '" rx="' + shadow.rx.toFixed(1) + '" ry="4.7"/></g>';
    }
    els.mapSphereMarkers.innerHTML = html;
  }
  function clampMapZoom(zoom) {
    return Math.max(mapMinZoom, Math.min(mapMaxZoom, zoom));
  }
  function clampMapRadius(radius) {
    return Math.max(mapMinRadius, Math.min(mapMaxRadius, Math.round(radius)));
  }
  function clampMapTilt(tilt) {
    return Math.max(0, Math.min(mapMaxTilt, tilt));
  }
  function clampMapBearing(bearing) {
    if (!isFinite(bearing)) return 0;
    // -180〜180 に正規化(getBearing の範囲に合わせる)
    return ((bearing + 180) % 360 + 360) % 360 - 180;
  }
  function clampLat(lat) {
    return Math.max(-90, Math.min(90, lat));
  }
  function clampLon(lon) {
    return Math.max(-180, Math.min(180, lon));
  }
  function wrapLon(lon) {
    return ((lon + 540) % 360) - 180;
  }
  function sanitizeLoc(loc, fallback, wrap) {
    fallback = fallback || Tokyo;
    var lat = loc && isFinite(loc.lat) ? loc.lat : fallback.lat;
    var lon = loc && isFinite(loc.lon) ? loc.lon : fallback.lon;
    return { lat: clampLat(lat), lon: wrap ? wrapLon(lon) : clampLon(lon) };
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
    if (sphereRendered.view !== viewKey || sphereRendered.marker !== markerKey) {
      renderSphereMarkers(date, loc, basis);
      renderGalaxyInto(els.sphereGalaxy, date, loc, basis);
    }
    sphereRendered.view = viewKey;
    sphereRendered.daily = daily.key;
    sphereRendered.marker = markerKey;
  }
  // 天球の視点方位: コンパス連動ONかつ方位取得済みなら端末方位に追従。外部視点では 180+heading にすると
  // 真上から見た回転が2Dコンパス(N方位=−heading=向いた方角が上)と一致する。それ以外はドラッグ値を使う。
  function sphereViewAz() {
    return (state.compassOn && state.orientation.ready) ? norm360(180 + displayHeading()) : state.sphere.az;
  }
  // 外部(俯瞰)視点の正射影。真上から見たとき N上・E右・S下・W左(時計回り)で2Dコンパスと一致する。
  // コンパス連動時の方位は sphereViewAz で 180−heading とし、真上視で2Dと同じ回転になるようにする。
  function sphereBasis() {
    return basisFromForward(azAltVector(sphereViewAz(), state.sphere.el));
  }
  function basisFromForward(forward) {
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
    renderSphereGridInto(sphereTargets(), basis, { zenith: true, observer: true });
  }
  function renderSphereGridInto(target, basis, options) {
    var ground = spherePath(sphereStatic.horizon, basis);
    var horizon = sphereSplitPaths(sphereStatic.horizon, basis, 'sphere-horizon', false);
    target.ground.innerHTML = '<circle class="sphere-rim" cx="0" cy="0" r="100"/>' +
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
    target.gridBack.innerHTML = back;
    target.gridFront.innerHTML = front;
    renderSphereLabelsInto(target, basis, options);
  }
  function renderSphereLabels(basis) {
    renderSphereLabelsInto(sphereTargets(), basis, { zenith: true, observer: true });
  }
  function renderSphereLabelsInto(target, basis, options) {
    var html = '';
    sphereStatic.labels.forEach(function (item) {
      var p = sphereProject(item.v, basis);
      html += '<text class="sphere-label' + (p.front ? '' : ' sphere-back') + '" x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '">' + item.text + '</text>';
    });
    if (options.zenith) {
      var zen = sphereProject(sphereStatic.zenith, basis);
      html += '<g class="sphere-zenith' + (zen.front ? '' : ' sphere-back') + '" transform="translate(' + zen.x.toFixed(1) + ' ' + zen.y.toFixed(1) + ')"><line x1="-5" y1="0" x2="5" y2="0"/><line x1="0" y1="-5" x2="0" y2="5"/></g>';
      html += '<text class="sphere-note' + (zen.front ? '' : ' sphere-back') + '" x="' + zen.x.toFixed(1) + '" y="' + (zen.y - 8).toFixed(1) + '">Z</text>';
    }
    if (options.observer) html += '<circle class="sphere-observer" cx="0" cy="0" r="3.2"/>';
    target.labels.innerHTML = html;
  }
  function renderSpherePaths(daily, basis) {
    renderSpherePathsInto(sphereTargets(), daily, basis);
  }
  function renderSpherePathsInto(target, daily, basis) {
    var sun = sphereBodyPath(daily.sphereSun, basis, 'sun');
    var moon = sphereBodyPath(daily.sphereMoon, basis, 'moon');
    target.pathsBack.innerHTML = sun.back + moon.back;
    target.pathsFront.innerHTML = sun.front + moon.front;
  }
  function sphereTargets() {
    return {
      ground: els.sphereGround,
      gridBack: els.sphereGridBack,
      gridFront: els.sphereGridFront,
      pathsBack: els.spherePathsBack,
      pathsFront: els.spherePathsFront,
      labels: els.sphereLabels
    };
  }
  function mapSphereTargets() {
    return {
      ground: els.mapSphereGround,
      gridBack: els.mapSphereGridBack,
      gridFront: els.mapSphereGridFront,
      pathsBack: els.mapSpherePathsBack,
      pathsFront: els.mapSpherePathsFront,
      labels: els.mapSphereLabels
    };
  }
  function sphereBodyPath(samples, basis, kind) {
    var cls = kind === 'sun' ? 'sphere-path-sun' : 'sphere-path-moon';
    var dotCls = kind === 'sun' ? 'sphere-dot-sun' : 'sphere-dot-moon';
    var out = sphereSplitPaths(samples, basis, cls, true);
    samples.forEach(function (sample) {
      if (sample.alt < 0) return; // 地平線下の点は描かない
      var p = sphereProject(sample.vector, basis);
      var html = '<circle class="' + dotCls + (p.front ? '' : ' sphere-back') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (kind === 'sun' ? '1.8' : '1.6') + '"/>';
      if (p.front) out.front += html;
      else out.back += html;
    });
    return out;
  }
  function renderSphereMarkers(date, loc, basis) {
    var bodies = get3dBodies(date, loc);
    var sun = bodies.sun;
    var moon = bodies.moon;
    var html = '';
    if (sun.alt >= 0) { // 地平線下は描かない
      var sp = sphereProject(sun.vector, basis);
      html += '<circle class="sphere-sun-now' + (sp.front ? '' : ' sphere-back') + '" cx="' + sp.x.toFixed(1) + '" cy="' + sp.y.toFixed(1) + '" r="5.2"/>';
    }
    if (moon.alt >= 0) {
      var mp = sphereProject(moon.vector, basis);
      html += '<circle class="sphere-moon-now' + (mp.front ? '' : ' sphere-back') + '" cx="' + mp.x.toFixed(1) + '" cy="' + mp.y.toFixed(1) + '" r="4.8"/>';
    }
    els.sphereMarkers.innerHTML = html;
  }
  function renderGalaxyInto(targetG, date, loc, basis) {
    var samples = Astro.galacticPlanePoints(date, loc.lat, loc.lon, 4).map(function (pt) {
      return { az: pt.az, alt: pt.alt, vector: azAltVector(pt.az, pt.alt) };
    });
    var arch = sphereSplitPaths(samples, basis, 'sphere-path-galaxy', true);
    var html = arch.back + arch.front;
    var gc = Astro.galacticCenterPosition(date, loc.lat, loc.lon);
    if (gc.alt >= 0) {
      var p = sphereProject(azAltVector(gc.az, gc.alt), basis);
      html += '<circle class="sphere-gc-now' + (p.front ? '' : ' sphere-back') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4.2"/>';
    }
    targetG.innerHTML = html;
  }
  // clipBelow=true(太陽・月の軌道)では地平線(z=0)で切り、地平線下(ドームに埋まる部分)は描かない。
  // grid など clipBelow=false は従来どおり全区間を描く。
  function sphereSplitPaths(samples, basis, cls, clipBelow) {
    var front = '';
    var back = '';
    for (var i = 0; i < samples.length - 1; i++) {
      var va = samples[i].vector;
      var vb = samples[i + 1].vector;
      if (clipBelow) {
        var aUp = va.z >= 0;
        var bUp = vb.z >= 0;
        if (!aUp && !bUp) continue; // 両端とも地平線下
        if (aUp !== bUp) {
          // z=0(地平線)の交点を線形補間で求め、地平線上側だけ残す
          var t = va.z / (va.z - vb.z);
          var vc = normalize({ x: va.x + (vb.x - va.x) * t, y: va.y + (vb.y - va.y) * t, z: 0 });
          if (aUp) vb = vc; else va = vc;
        }
      }
      var pa = sphereProject(va, basis);
      var pb = sphereProject(vb, basis);
      var isFront = pa.front && pb.front;
      var d = 'M' + pa.x.toFixed(1) + ' ' + pa.y.toFixed(1) + 'L' + pb.x.toFixed(1) + ' ' + pb.y.toFixed(1);
      var html = '<path class="' + cls + (isFront ? '' : ' sphere-back') + '" d="' + d + '"/>';
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
    var date = state.selectedDate;
    var daily = getDaily(ymd(date), state.loc, -date.getTimezoneOffset());
    var bodies = get3dBodies(date, state.loc);
    var basis = cameraBasis(state.orientation);
    render3dRef(basis, rect);
    render3dPaths(daily, basis, rect);
    draw3dBody(els.sun3d, els.sunGuide, bodies.sun, basis, rect, 'sun');
    draw3dBody(els.moon3d, els.moonGuide, bodies.moon, basis, rect, 'moon');
  }
  function build3dPaths() {
    // 減光(地平線下)を先に描いて実線を上に重ねる。太陽を最後に置き最前面へ
    els.sky3dPaths.innerHTML =
      '<path class="path3d-moon path3d-dim"/><path class="path3d-moon"/>' +
      '<path class="path3d-sun path3d-dim"/><path class="path3d-sun"/>';
    var p = els.sky3dPaths.querySelectorAll('path');
    paths3d = { moonDim: p[0], moon: p[1], sunDim: p[2], sun: p[3] };
  }
  // 太陽・月の日周軌道(毎正時サンプル)を等距離射影でつなぐ。
  // 視線から遠い(真後ろ側)線分は投影半径が発散して画面を横切る誤線になるため θ≦120° の区間のみ描く。
  function render3dPaths(daily, basis, rect) {
    var sun = split3dPath(daily.sphereSun, basis, rect.width, rect.height);
    var moon = split3dPath(daily.sphereMoon, basis, rect.width, rect.height);
    paths3d.sun.setAttribute('d', sun.above);
    paths3d.sunDim.setAttribute('d', sun.below);
    paths3d.moon.setAttribute('d', moon.above);
    paths3d.moonDim.setAttribute('d', moon.below);
  }
  function split3dPath(samples, basis, w, h) {
    var thetaMax = 120 * Math.PI / 180;
    var above = '', below = '';
    for (var i = 0; i < samples.length - 1; i++) {
      var a = samples[i], b = samples[i + 1];
      var pa = projectVec(a.vector, basis, w, h);
      var pb = projectVec(b.vector, basis, w, h);
      if (pa.theta > thetaMax || pb.theta > thetaMax) continue;
      var seg = 'M' + pa.x.toFixed(1) + ' ' + pa.y.toFixed(1) + 'L' + pb.x.toFixed(1) + ' ' + pb.y.toFixed(1);
      if (a.alt < 0 || b.alt < 0) below += seg;
      else above += seg;
    }
    return { above: above, below: below };
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
  // alpha 原点(iOSでは不定)と真北のずれ δ: コンパス値と行列側で同じ量(照準=背面視線 forward の
  // 水平射影方位)の差分を取る。基準を照準そのものに置くと azimuthOf(rotAz(v,δ))=azimuthOf(v)+δ より
  // 画面中央の方位 = azimuthOf(forward)+δ = webkitCompassHeading+偏角 が beta/gamma によらず厳密一致する。
  // 上端 up を基準にすると beta=90° で方位が 180° 反転し、斜め上帯域でロール成分の残差が方位ずれになっていた(#29)。
  function updateDelta(ev) {
    var o = state.orientation;
    if (o.alpha === null || o.beta === null || o.gamma === null) return;
    if (typeof ev.webkitCompassHeading !== 'number') {
      // alpha が北基準の環境(非iOS)は偏角合わせのみ
      o.delta = state.declination;
      o.deltaReady = true;
      return;
    }
    // 照準(forward)の水平射影を基準にする。forward の方位は地平線→天頂で連続(反転しない)
    var aim = deviceAxes(o.alpha, o.beta, o.gamma).forward;
    var horiz = Math.sqrt(aim.x * aim.x + aim.y * aim.y);
    if (horiz < .2) return; // 照準がほぼ鉛直(天頂/真下狙い)は射影もコンパスも縮退するため更新を凍結
    var t = norm360(ev.webkitCompassHeading + state.declination - azimuthOf(aim));
    if (!o.deltaReady) {
      // 初期化は基準軸の取り違えが起きない姿勢(直立未満: 上端射影=背面射影)に限る
      if (o.beta >= 80) return;
      o.delta = t;
      o.deltaReady = true;
      return;
    }
    // δの連続性選択も heading と同じ分岐ロック問題を持つ(誤って t+180 側に入ると保持し続ける)。
    // 上端射影と照準 forward の方位が一致し軸の取り違えが起きない |β|<45 では t が真のδそのもの
    // (ロールがあっても両射影の方位差は90°程度に収まり、しきい値120°を超えない)。
    // 180°側に居座り続けたときだけ矯正する(#39)
    if (Math.abs(o.beta) < 45 && Math.abs(angleDiff(t, o.delta)) > 120) {
      if (++deltaAnchorOff >= 8) {
        o.delta = t;
        deltaAnchorOff = 0;
        return;
      }
    } else {
      deltaAnchorOff = 0;
    }
    // iOSコンパス自体が姿勢の帯域で基準軸を切り替え値が180°入れ替わる実測挙動への耐性。
    // δは物理的にほぼ一定なので、候補 t / t+180 のうち現在のδに近い方を採用する(連続性選択)
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
  // 2Dコンパス・天球モードの表示に使う方位。
  // 【重要・再追加禁止】#30 の「空へ向けた帯域(β>100)で 180°反転(skyFlip)」は撤去した(#39)。
  // 生の webkitCompassHeading は垂直越えで180°跳ぶが、withFlipCorrection の連続性選択が既に
  // それを打ち消して state.heading を視線方位のまま保つ。表示側でさらに反転すると同じ180°跳びへの
  // 二重補正になり、かざした帯域で常に180°逆を表示していた。180°反転の扱いは withFlipCorrection の
  // 一層だけに置くこと。
  function displayHeading() {
    return state.heading;
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
  // withFlipCorrection の連続性選択は初回サンプルで決まった 0/180 分岐を保持し続ける。しかも候補は
  // 常に平滑値から90°以内に丸められるため、後段の外れ値ジャンプ判定(>120°)は webkit 経路では
  // 二度と発火しない(=何かの拍子に逆分岐へ入るとセッション中ずっと反転したまま自力回復できない)。
  // 上端射影が信頼でき iOS の基準軸取り違えも起きない |β|<70 帯域では生コンパス値を絶対の真とみなし、
  // 平滑値が180°側に居座り続けたときだけ分岐を矯正する(#39)。連発ガードは瞬間ノイズの棄却。
  function reanchorHeading(ev) {
    if (!state.orientation.ready || typeof ev.webkitCompassHeading !== 'number' || typeof ev.beta !== 'number' || Math.abs(ev.beta) >= 70) {
      headingAnchorOff = 0;
      return;
    }
    var raw = norm360(ev.webkitCompassHeading + state.declination);
    if (Math.abs(angleDiff(raw, state.orientation.heading)) > 120) {
      if (++headingAnchorOff >= 8) {
        state.heading = raw;
        state.orientation.heading = raw;
        headingAnchorOff = 0;
      }
    } else {
      headingAnchorOff = 0;
    }
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
  function fmtStarWindow(sw) {
    if (!sw || !sw.windows || !sw.windows.length) {
      if (!sw || !sw.dusk || !sw.dawn) return 'なし（薄明が明けない）';
      return 'なし（月が一晩中出ている）';
    }
    return sw.windows.map(function (w) {
      var text = fmtTime(w.start) + '〜' + fmtTime(w.end);
      if (w.startCause === 'moonset') text = '月没後 ' + text;
      if (w.endCause === 'moonrise') text += '（月出まで）';
      return text;
    }).join('／');
  }
  function fmtGalaxyWindow(win) {
    if (!win || !win.windows || !win.windows.length) {
      if (!win || !win.dusk || !win.dawn) return 'なし（薄明が明けない）';
      return 'なし（夜間は地平線下）';
    }
    return win.windows.map(function (w) {
      return fmtTime(w.start) + '〜' + fmtTime(w.end);
    }).join('／');
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
})();
