(function (root) {
  'use strict';

  var Astro = {};
  var PI = Math.PI;
  var rad = PI / 180;
  var dayMs = 86400000;
  var J1970 = 2440587.5;
  var J2000 = 2451545.0;
  var e = 23.4397 * rad;

  function toRad(deg) { return deg * rad; }
  function toDeg(x) { return x / rad; }
  function sinDeg(deg) { return Math.sin(toRad(deg)); }
  function cosDeg(deg) { return Math.cos(toRad(deg)); }
  function norm360(deg) {
    deg = deg % 360;
    return deg < 0 ? deg + 360 : deg;
  }
  function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }
  function julian(date) { return date.getTime() / dayMs + J1970; }
  function days(date) { return julian(date) - J2000; }
  function sidereal(d, lon) { return toRad(norm360(280.16 + 360.9856235 * d + lon)); }
  function azimuth(H, phi, dec) {
    var a = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    return norm360(toDeg(a) + 180);
  }
  function altitude(H, phi, dec) {
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  }
  function astroRefraction(h) {
    if (h < -1 * rad) return 0;
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
  }
  function raDec(l, b) {
    return {
      ra: Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)),
      dec: Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l))
    };
  }
  function galacticToEquatorial(l, b) {
    var aNGP = toRad(192.85948);
    var dNGP = toRad(27.12825);
    var lNCP = toRad(122.93192);
    var sinb = Math.sin(b);
    var cosb = Math.cos(b);
    var dec = Math.asin(clamp(Math.sin(dNGP) * sinb + Math.cos(dNGP) * cosb * Math.cos(lNCP - l), -1, 1));
    var y = cosb * Math.sin(lNCP - l);
    var x = Math.cos(dNGP) * sinb - Math.sin(dNGP) * cosb * Math.cos(lNCP - l);
    return { ra: aNGP + Math.atan2(y, x), dec: dec };
  }
  function galacticCenterCoords() {
    return galacticToEquatorial(0, 0);
  }
  function sunCoords(date) {
    var d = days(date);
    var M = norm360(357.5291 + 0.98560028 * d);
    var C = 1.9148 * sinDeg(M) + 0.0200 * sinDeg(2 * M) + 0.0003 * sinDeg(3 * M);
    var L = norm360(M + C + 102.9372 + 180);
    var c = raDec(toRad(L), 0);
    c.lon = L;
    return c;
  }
  function moonCoords(date) {
    var d = days(date);
    var L = norm360(218.316 + 13.176396 * d);
    var M = norm360(134.963 + 13.064993 * d);
    var F = norm360(93.272 + 13.229350 * d);
    var D = norm360(297.8501921 + 12.19074912 * d);
    var Ms = norm360(357.5291092 + 0.98560028 * d);
    var lonCorr = 6.289 * sinDeg(M) +
      1.274 * sinDeg(2 * D - M) +
      0.658 * sinDeg(2 * D) +
      0.214 * sinDeg(2 * M) -
      0.186 * sinDeg(Ms) -
      0.059 * sinDeg(2 * D - 2 * M) -
      0.057 * sinDeg(2 * D - Ms - M) +
      0.053 * sinDeg(2 * D + M) +
      0.046 * sinDeg(2 * D - Ms) -
      0.041 * sinDeg(Ms - M) -
      0.035 * sinDeg(D) -
      0.031 * sinDeg(Ms + M) -
      0.015 * sinDeg(2 * F - 2 * D) +
      0.011 * sinDeg(2 * D - Ms + M);
    var latCorr = 5.128 * sinDeg(F) +
      0.280 * sinDeg(M + F) +
      0.277 * sinDeg(M - F) +
      0.173 * sinDeg(2 * D - F) +
      0.055 * sinDeg(2 * D + F - M) +
      0.046 * sinDeg(2 * D - F - M) +
      0.033 * sinDeg(2 * D + F) +
      0.017 * sinDeg(2 * M + F);
    var l = toRad(norm360(L + lonCorr));
    var b = toRad(latCorr);
    var dt = 385001 - 20905 * cosDeg(M) - 3699 * cosDeg(2 * D - M) - 2956 * cosDeg(2 * D);
    var c = raDec(l, b);
    c.dist = dt;
    c.lon = norm360(toDeg(l));
    return c;
  }
  function position(date, lat, lon, coords, applyParallax, applyRefraction) {
    var d = days(date);
    var phi = toRad(lat);
    var lw = lon;
    var c = coords(date);
    var H = sidereal(d, lw) - c.ra;
    var alt = altitude(H, phi, c.dec);
    if (applyParallax) {
      alt -= Math.asin(6371 / c.dist) * Math.cos(alt);
    }
    var outAlt = alt + (applyRefraction ? astroRefraction(alt) : 0);
    return { az: azimuth(H, phi, c.dec), alt: toDeg(outAlt), dist: c.dist };
  }
  function localDayStart(y, m, d, tzOffsetMin) {
    return Date.UTC(y, m - 1, d) - tzOffsetMin * 60000;
  }
  function addMin(t, min) { return new Date(t + min * 60000); }
  function isoDateParts(dateText) {
    var p = dateText.split('-');
    return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2]) };
  }
  function crossing(startMs, endMs, stepMin, valueFn, threshold, rising) {
    var prevT = startMs;
    var prev = valueFn(new Date(prevT)) - threshold;
    var found = null;
    for (var t = startMs + stepMin * 60000; t <= endMs; t += stepMin * 60000) {
      var cur = valueFn(new Date(t)) - threshold;
      if ((rising && prev < 0 && cur >= 0) || (!rising && prev >= 0 && cur < 0)) {
        var a = prevT;
        var b = t;
        for (var i = 0; i < 28; i++) {
          var mid = (a + b) / 2;
          var mv = valueFn(new Date(mid)) - threshold;
          if ((rising && mv >= 0) || (!rising && mv < 0)) b = mid;
          else a = mid;
        }
        found = new Date((a + b) / 2);
        break;
      }
      prevT = t;
      prev = cur;
    }
    return found;
  }
  function allCrossings(startMs, endMs, stepMin, valueFn, threshold, rising) {
    var list = [];
    var prevT = startMs;
    var prev = valueFn(new Date(prevT)) - threshold;
    for (var t = startMs + stepMin * 60000; t <= endMs; t += stepMin * 60000) {
      var cur = valueFn(new Date(t)) - threshold;
      if ((rising && prev < 0 && cur >= 0) || (!rising && prev >= 0 && cur < 0)) {
        var a = prevT;
        var b = t;
        for (var i = 0; i < 28; i++) {
          var mid = (a + b) / 2;
          var mv = valueFn(new Date(mid)) - threshold;
          if ((rising && mv >= 0) || (!rising && mv < 0)) b = mid;
          else a = mid;
        }
        list.push(new Date((a + b) / 2));
      }
      prevT = t;
      prev = cur;
    }
    return list;
  }
  function maxTime(startMs, endMs, stepMin, valueFn) {
    var bestT = startMs;
    var bestV = -Infinity;
    for (var t = startMs; t <= endMs; t += stepMin * 60000) {
      var v = valueFn(new Date(t));
      if (v > bestV) {
        bestV = v;
        bestT = t;
      }
    }
    var a = Math.max(startMs, bestT - stepMin * 60000);
    var b = Math.min(endMs, bestT + stepMin * 60000);
    for (var i = 0; i < 40; i++) {
      var m1 = a + (b - a) / 3;
      var m2 = b - (b - a) / 3;
      if (valueFn(new Date(m1)) < valueFn(new Date(m2))) a = m1;
      else b = m2;
    }
    return new Date((a + b) / 2);
  }
  function golden(startMs, endMs, valueFn, am) {
    if (am) {
      return {
        start: crossing(startMs, endMs, 2, valueFn, -4, true),
        end: crossing(startMs, endMs, 2, valueFn, 6, true)
      };
    }
    return {
      start: crossing(startMs, endMs, 2, valueFn, 6, false),
      end: crossing(startMs, endMs, 2, valueFn, -4, false)
    };
  }
  function blue(startMs, endMs, valueFn, am) {
    if (am) {
      return {
        start: crossing(startMs, endMs, 2, valueFn, -6, true),
        end: crossing(startMs, endMs, 2, valueFn, -4, true)
      };
    }
    return {
      start: crossing(startMs, endMs, 2, valueFn, -4, false),
      end: crossing(startMs, endMs, 2, valueFn, -6, false)
    };
  }

  Astro.sunPosition = function (date, lat, lon) {
    return position(date, lat, lon, sunCoords, false, true);
  };
  Astro.moonPosition = function (date, lat, lon) {
    return position(date, lat, lon, moonCoords, true, true);
  };
  Astro.galacticCenterPosition = function (date, lat, lon) {
    return position(date, lat, lon, galacticCenterCoords, false, true);
  };
  Astro.sunTimes = function (y, m, d, lat, lon, tzOffsetMin) {
    var start = localDayStart(y, m, d, tzOffsetMin);
    var end = start + dayMs;
    var rawAlt = function (date) { return position(date, lat, lon, sunCoords, false, false).alt; };
    return {
      astroDawn: crossing(start, end, 2, rawAlt, -18, true),
      nauticalDawn: crossing(start, end, 2, rawAlt, -12, true),
      civilDawn: crossing(start, end, 2, rawAlt, -6, true),
      rise: crossing(start, end, 2, rawAlt, -0.833, true),
      transit: maxTime(start, end, 5, rawAlt),
      set: crossing(start, end, 2, rawAlt, -0.833, false),
      civilDusk: crossing(start, end, 2, rawAlt, -6, false),
      nauticalDusk: crossing(start, end, 2, rawAlt, -12, false),
      astroDusk: crossing(start, end, 2, rawAlt, -18, false),
      goldenAM: golden(start, end, rawAlt, true),
      goldenPM: golden(start, end, rawAlt, false),
      blueAM: blue(start, end, rawAlt, true),
      bluePM: blue(start, end, rawAlt, false)
    };
  };
  Astro.moonTimes = function (y, m, d, lat, lon, tzOffsetMin) {
    var start = localDayStart(y, m, d, tzOffsetMin);
    var end = start + dayMs;
    var rawAlt = function (date) { return position(date, lat, lon, moonCoords, true, false).alt; };
    var rises = allCrossings(start, end, 10, rawAlt, -0.833, true);
    var sets = allCrossings(start, end, 10, rawAlt, -0.833, false);
    return {
      rise: rises.length ? rises[0] : null,
      set: sets.length ? sets[0] : null,
      transit: maxTime(start, end, 10, rawAlt)
    };
  };
  Astro.galacticCenterTimes = function (y, m, d, lat, lon, tzOffsetMin) {
    var start = localDayStart(y, m, d, tzOffsetMin);
    var end = start + dayMs;
    var rawAlt = function (date) { return position(date, lat, lon, galacticCenterCoords, false, false).alt; };
    return {
      rise: crossing(start, end, 2, rawAlt, 0, true),
      transit: maxTime(start, end, 5, rawAlt),
      set: crossing(start, end, 2, rawAlt, 0, false)
    };
  };
  Astro.galacticCenterWindow = function (y, m, d, lat, lon, tzOffsetMin) {
    var horizon = 0;
    var sunAlt = function (date) { return position(date, lat, lon, sunCoords, false, false).alt; };
    var gcAlt = function (date) { return position(date, lat, lon, galacticCenterCoords, false, false).alt; };
    var startD = localDayStart(y, m, d, tzOffsetMin);
    var dusk = crossing(startD, startD + dayMs, 2, sunAlt, -18, false);
    var nextStart = startD + dayMs;
    var dawn = crossing(nextStart, nextStart + dayMs, 2, sunAlt, -18, true);
    var windows = [];
    if (!dusk || !dawn) return { dusk: dusk, dawn: dawn, windows: windows };

    var rises = allCrossings(dusk.getTime(), dawn.getTime(), 5, gcAlt, horizon, true);
    var sets = allCrossings(dusk.getTime(), dawn.getTime(), 5, gcAlt, horizon, false);
    var points = [{ t: dusk, cause: 'dusk' }];
    for (var i = 0; i < rises.length; i++) points.push({ t: rises[i], cause: 'gcRise' });
    for (var j = 0; j < sets.length; j++) points.push({ t: sets[j], cause: 'gcSet' });
    points.sort(function (a, b) { return a.t.getTime() - b.t.getTime(); });
    points.push({ t: dawn, cause: 'dawn' });

    for (var k = 0; k < points.length - 1; k++) {
      var t0 = points[k].t.getTime();
      var t1 = points[k + 1].t.getTime();
      if (t1 - t0 < 60000) continue;
      var mid = new Date((t0 + t1) / 2);
      if (gcAlt(mid) > horizon) {
        windows.push({
          start: new Date(t0),
          end: new Date(t1),
          startCause: points[k].cause,
          endCause: points[k + 1].cause
        });
      }
    }
    return { dusk: dusk, dawn: dawn, windows: windows };
  };
  Astro.galacticPlanePoints = function (date, lat, lon, stepDeg) {
    var step = stepDeg || 5;
    var d = days(date);
    var phi = toRad(lat);
    var lst = sidereal(d, lon);
    var pts = [];
    for (var l = 0; l <= 360; l += step) {
      var eq = galacticToEquatorial(toRad(l), 0);
      var H = lst - eq.ra;
      pts.push({ l: l, az: azimuth(H, phi, eq.dec), alt: toDeg(altitude(H, phi, eq.dec)) });
    }
    return pts;
  };
  Astro.starWindow = function (y, m, d, lat, lon, tzOffsetMin) {
    var horizon = -0.833;
    var sunAlt = function (date) { return position(date, lat, lon, sunCoords, false, false).alt; };
    var moonAlt = function (date) { return position(date, lat, lon, moonCoords, true, false).alt; };
    var startD = localDayStart(y, m, d, tzOffsetMin);
    var dusk = crossing(startD, startD + dayMs, 2, sunAlt, -18, false);
    var nextStart = startD + dayMs;
    var dawn = crossing(nextStart, nextStart + dayMs, 2, sunAlt, -18, true);
    var windows = [];
    if (!dusk || !dawn) return { dusk: dusk, dawn: dawn, windows: windows };

    var rises = allCrossings(dusk.getTime(), dawn.getTime(), 5, moonAlt, horizon, true);
    var sets = allCrossings(dusk.getTime(), dawn.getTime(), 5, moonAlt, horizon, false);
    var points = [{ t: dusk, cause: 'dusk' }];
    for (var i = 0; i < sets.length; i++) points.push({ t: sets[i], cause: 'moonset' });
    for (var j = 0; j < rises.length; j++) points.push({ t: rises[j], cause: 'moonrise' });
    points.sort(function (a, b) { return a.t.getTime() - b.t.getTime(); });
    points.push({ t: dawn, cause: 'dawn' });

    for (var k = 0; k < points.length - 1; k++) {
      var t0 = points[k].t.getTime();
      var t1 = points[k + 1].t.getTime();
      if (t1 - t0 < 60000) continue;
      var mid = new Date((t0 + t1) / 2);
      if (moonAlt(mid) < horizon) {
        windows.push({
          start: new Date(t0),
          end: new Date(t1),
          startCause: points[k].cause,
          endCause: points[k + 1].cause
        });
      }
    }
    return { dusk: dusk, dawn: dawn, windows: windows };
  };
  Astro.moonIllumination = function (date) {
    var s = sunCoords(date);
    var m = moonCoords(date);
    var sdist = 149598000;
    var phi = Math.acos(clamp(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra), -1, 1));
    var inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    var angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    var phaseLon = norm360(m.lon - s.lon);
    return {
      fraction: clamp((1 + Math.cos(inc)) / 2, 0, 1),
      age: phaseLon / 360 * 29.53,
      phaseAngle: norm360(toDeg(angle))
    };
  };
  Astro._test = { days: days, sunCoords: sunCoords, moonCoords: moonCoords, galacticToEquatorial: galacticToEquatorial, galacticCenterCoords: galacticCenterCoords, norm360: norm360, parseDate: isoDateParts };

  root.Astro = Astro;
  if (typeof module !== 'undefined') module.exports = Astro;
})(typeof globalThis !== 'undefined' ? globalThis : this);
