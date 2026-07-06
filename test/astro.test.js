ObjC.import('Foundation');
ObjC.import('stdlib');

function readText(path) {
  return $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js;
}

eval(readText('astro.js'));

var expected = JSON.parse(readText('test/expected.json'));
var failures = [];

function pad(n) { return n < 10 ? '0' + n : String(n); }
function parseDateParts(s) {
  var p = s.split('-');
  return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2]) };
}
function minutesOf(s) {
  if (s === null || s === undefined) return null;
  var p = s.split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}
function localMinutes(date, tz) {
  if (!date) return null;
  var ms = date.getTime() + tz * 60000;
  var dt = new Date(ms);
  return dt.getUTCHours() * 60 + dt.getUTCMinutes() + dt.getUTCSeconds() / 60;
}
function fmtUtcTime(date) {
  if (!date) return 'null';
  return pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes());
}
function diffMinutes(actual, expected) {
  if (actual === null || expected === null) return actual === expected ? 0 : 9999;
  var d = Math.abs(actual - expected);
  return Math.min(d, 1440 - d);
}
function hhmmFromMinutes(min) {
  if (min === null) return 'null';
  min = Math.round(min);
  return pad(Math.floor(min / 60) % 24) + ':' + pad(min % 60);
}
function addFailure(name, item, expectedValue, actualValue, diff) {
  failures.push(name + ' ' + item + ' 期待=' + expectedValue + ' 実測=' + actualValue + ' 差=' + diff);
}
function checkTime(name, item, actualDate, expectedText, tz, tol) {
  var actual = localMinutes(actualDate, tz);
  var expectedMin = minutesOf(expectedText);
  var diff = diffMinutes(actual, expectedMin);
  if (diff > tol) addFailure(name, item, expectedText, hhmmFromMinutes(actual), diff.toFixed(2) + '分');
}
function checkRange(name, item, actual, range) {
  if (actual < range[0] || actual > range[1]) {
    addFailure(name, item, '[' + range[0] + ',' + range[1] + ']', actual.toFixed(3), '範囲外');
  }
}
function checkNear(name, item, actual, expectedValue, tol, unit) {
  var diff = Math.abs(actual - expectedValue);
  if (diff > tol) addFailure(name, item, expectedValue, actual.toFixed(4), diff.toFixed(4) + unit);
}
function toDeg(rad) { return rad * 180 / Math.PI; }
function angleDiff(a, b) {
  return (a - b + 540) % 360 - 180;
}
function parseUtcMinute(s) {
  var p = s.split(/[-T:]/);
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Number(p[3]), Number(p[4]));
}

var gcEq = Astro._test.galacticToEquatorial(0, 0);
checkNear('銀河座標変換', '銀河中心 RA', Astro._test.norm360(toDeg(gcEq.ra)), 266.40, 0.2, '度');
checkNear('銀河座標変換', '銀河中心 Dec', toDeg(gcEq.dec), -28.94, 0.2, '度');
var ngpEq = Astro._test.galacticToEquatorial(0, Math.PI / 2);
checkNear('銀河座標変換', '北銀極 RA', Astro._test.norm360(toDeg(ngpEq.ra)), 192.859, 0.2, '度');
checkNear('銀河座標変換', '北銀極 Dec', toDeg(ngpEq.dec), 27.128, 0.2, '度');
var gcCoords = Astro._test.galacticCenterCoords(new Date());
checkNear('銀河中心座標', 'RA', Astro._test.norm360(toDeg(gcCoords.ra)), 266.40, 0.2, '度');
checkNear('銀河中心座標', 'Dec', toDeg(gcCoords.dec), -28.94, 0.2, '度');

for (var i = 0; i < expected.cases.length; i++) {
  var c = expected.cases[i];
  var p = parseDateParts(c.date);
  var st = Astro.sunTimes(p.y, p.m, p.d, c.lat, c.lon, c.tzOffsetMin);
  var mt = Astro.moonTimes(p.y, p.m, p.d, c.lat, c.lon, c.tzOffsetMin);
  checkTime(c.name, '太陽 天文薄明始', st.astroDawn, c.sun.astroDawn, c.tzOffsetMin, 3);
  checkTime(c.name, '太陽 航海薄明始', st.nauticalDawn, c.sun.nauticalDawn, c.tzOffsetMin, 3);
  checkTime(c.name, '太陽 市民薄明始', st.civilDawn, c.sun.civilDawn, c.tzOffsetMin, 2);
  checkTime(c.name, '太陽 出', st.rise, c.sun.rise, c.tzOffsetMin, 2);
  checkTime(c.name, '太陽 南中', st.transit, c.sun.transit, c.tzOffsetMin, 2);
  checkTime(c.name, '太陽 入', st.set, c.sun.set, c.tzOffsetMin, 2);
  checkTime(c.name, '太陽 市民薄明終', st.civilDusk, c.sun.civilDusk, c.tzOffsetMin, 2);
  checkTime(c.name, '太陽 航海薄明終', st.nauticalDusk, c.sun.nauticalDusk, c.tzOffsetMin, 3);
  checkTime(c.name, '太陽 天文薄明終', st.astroDusk, c.sun.astroDusk, c.tzOffsetMin, 3);
  checkTime(c.name, '月 出', mt.rise, c.moon.rise, c.tzOffsetMin, 5);
  checkTime(c.name, '月 入', mt.set, c.moon.set, c.tzOffsetMin, 5);
  checkTime(c.name, '月 南中', mt.transit, c.moon.transit, c.tzOffsetMin, 5);

  var sw = Astro.starWindow(p.y, p.m, p.d, c.lat, c.lon, c.tzOffsetMin);
  for (var w = 0; w < sw.windows.length; w++) {
    var win = sw.windows[w];
    var startMs = win.start.getTime();
    var endMs = win.end.getTime();
    if (startMs >= endMs) addFailure(c.name, '星空ウィンドウ順序', 'start < end', fmtUtcTime(win.start) + '-' + fmtUtcTime(win.end), '不正');
    if (sw.dusk && startMs < sw.dusk.getTime()) addFailure(c.name, '星空ウィンドウ開始', 'dusk以後', fmtUtcTime(win.start), '範囲外');
    if (sw.dawn && endMs > sw.dawn.getTime()) addFailure(c.name, '星空ウィンドウ終了', 'dawn以前', fmtUtcTime(win.end), '範囲外');
    var mid = new Date((startMs + endMs) / 2);
    var midSun = Astro.sunPosition(mid, c.lat, c.lon);
    var midMoon = Astro.moonPosition(mid, c.lat, c.lon);
    if (midSun.alt >= -17.9) addFailure(c.name, '星空ウィンドウ太陽高度', '< -17.9', midSun.alt.toFixed(2), '範囲外');
    if (midMoon.alt >= -0.8) addFailure(c.name, '星空ウィンドウ月高度', '< -0.8', midMoon.alt.toFixed(2), '範囲外');
  }
  if (c.name === '東京 2026-07-03') {
    if (sw.windows.length !== 1) addFailure(c.name, '星空ウィンドウ数', '1', String(sw.windows.length), '不一致');
    if (sw.windows.length && sw.windows[0].endCause !== 'moonrise') addFailure(c.name, '星空ウィンドウ終端理由', 'moonrise', sw.windows[0].endCause, '不一致');
    if (sw.windows.length) checkTime(c.name, '星空ウィンドウ終端', sw.windows[0].end, c.moon.rise, c.tzOffsetMin, 5);
  }

  var illumDate = new Date(Date.UTC(p.y, p.m - 1, p.d, 3, 0, 0)); // 12:00 JST
  var illum = Astro.moonIllumination(illumDate);
  checkNear(c.name, '輝面比', illum.fraction, c.moon.fracillum, 0.05, '');

  var sunAtTransit = Astro.sunPosition(st.transit, c.lat, c.lon);
  checkRange(c.name, '南中時 太陽高度', sunAtTransit.alt, c.sun.transitAltRange);
  checkNear(c.name, '南中時 太陽方位', sunAtTransit.az, 180, 1, '度');

  var gt = Astro.galacticCenterTimes(p.y, p.m, p.d, c.lat, c.lon, c.tzOffsetMin);
  var gcAtTransit = Astro.galacticCenterPosition(gt.transit, c.lat, c.lon);
  checkRange(c.name, '南中時 銀河中心高度', gcAtTransit.alt, c.galacticCenter.transitAltRange);
  checkNear(c.name, '南中時 銀河中心方位', gcAtTransit.az, 180, 1, '度');

  var gw = Astro.galacticCenterWindow(p.y, p.m, p.d, c.lat, c.lon, c.tzOffsetMin);
  for (var g = 0; g < gw.windows.length; g++) {
    var gcWin = gw.windows[g];
    var gcStartMs = gcWin.start.getTime();
    var gcEndMs = gcWin.end.getTime();
    if (gcStartMs >= gcEndMs) addFailure(c.name, '銀河中心ウィンドウ順序', 'start < end', fmtUtcTime(gcWin.start) + '-' + fmtUtcTime(gcWin.end), '不正');
    if (gw.dusk && gcStartMs < gw.dusk.getTime()) addFailure(c.name, '銀河中心ウィンドウ開始', 'dusk以後', fmtUtcTime(gcWin.start), '範囲外');
    if (gw.dawn && gcEndMs > gw.dawn.getTime()) addFailure(c.name, '銀河中心ウィンドウ終了', 'dawn以前', fmtUtcTime(gcWin.end), '範囲外');
    var gcMid = new Date((gcStartMs + gcEndMs) / 2);
    var gcMidSun = Astro.sunPosition(gcMid, c.lat, c.lon);
    var gcMidPos = Astro.galacticCenterPosition(gcMid, c.lat, c.lon);
    if (gcMidPos.alt <= -0.2) addFailure(c.name, '銀河中心ウィンドウ高度', '> -0.2', gcMidPos.alt.toFixed(2), '範囲外');
    if (gcMidSun.alt >= -17.9) addFailure(c.name, '銀河中心ウィンドウ太陽高度', '< -17.9', gcMidSun.alt.toFixed(2), '範囲外');
  }
}

var planeDate = new Date(Date.UTC(2026, 6, 3, 12, 0, 0));
var plane = Astro.galacticPlanePoints(planeDate, 35.6812, 139.7671, 5);
var gcPlane = Astro.galacticCenterPosition(planeDate, 35.6812, 139.7671);
checkNear('銀河面大円', 'l=0 高度', plane[0].alt, gcPlane.alt, 0.6, '度');
if (Math.abs(angleDiff(plane[0].az, gcPlane.az)) > 0.6) {
  addFailure('銀河面大円', 'l=0 方位', gcPlane.az.toFixed(3), plane[0].az.toFixed(3), Math.abs(angleDiff(plane[0].az, gcPlane.az)).toFixed(3) + '度');
}

var phaseWindow = expected.moonPhases.windowUtc;
var phases = Astro.moonPhases(parseUtcMinute(phaseWindow[0]), parseUtcMinute(phaseWindow[1]), 6);
for (var mp = 0; mp < expected.moonPhases.events.length; mp++) {
  var ref = expected.moonPhases.events[mp];
  var refMs = parseUtcMinute(ref.utc);
  var matched = false;
  var bestDiff = 999999;
  for (var pe = 0; pe < phases.length; pe++) {
    if (phases[pe].type !== ref.type) continue;
    var diff = Math.abs(phases[pe].date.getTime() - refMs) / 60000;
    if (diff < bestDiff) bestDiff = diff;
    if (diff <= 360) matched = true;
  }
  if (!matched) addFailure('月相', ref.type + ' ' + ref.utc, '±360分以内', bestDiff.toFixed(1) + '分', '範囲外');
}

var anchorDates = [
  new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
  new Date(Date.UTC(2026, 6, 3, 3, 0, 0)),
  new Date(Date.UTC(2026, 11, 21, 12, 34, 0))
];
for (var a = 0; a < anchorDates.length; a++) {
  var posS = Astro.sunPosition(anchorDates[a], 35.6812, 139.7671);
  var posM = Astro.moonPosition(anchorDates[a], 35.6812, 139.7671);
  var im = Astro.moonIllumination(anchorDates[a]);
  if (posS.az < 0 || posS.az >= 360) addFailure('物理アンカー', '太陽az', '[0,360)', posS.az, '範囲外');
  if (posM.az < 0 || posM.az >= 360) addFailure('物理アンカー', '月az', '[0,360)', posM.az, '範囲外');
  if (im.fraction < 0 || im.fraction > 1) addFailure('物理アンカー', '輝面比', '[0,1]', im.fraction, '範囲外');
  if (im.age < 0 || im.age >= 29.6) addFailure('物理アンカー', '月齢', '[0,29.6)', im.age, '範囲外');
}

if (failures.length) {
  for (var f = 0; f < failures.length; f++) console.log(failures[f]);
  $.exit(1);
}
console.log('astro.test.js PASS');
