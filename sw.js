'use strict';

var CACHE_VERSION = 'sky-compass-v8';
var ASSETS = [
  '.',
  'index.html',
  'style.css',
  'astro.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_VERSION).then(function (cache) {
    return cache.addAll(ASSETS);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (key) {
      return key === CACHE_VERSION ? null : caches.delete(key);
    }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  // stale-while-revalidate: キャッシュを即返しつつ裏で再取得して次回起動時に最新化する(圏外ではキャッシュのみで動作)
  event.respondWith(caches.match(event.request).then(function (cached) {
    var refresh = fetch(event.request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(event.request, copy); });
      }
      return response;
    });
    if (cached) {
      refresh.catch(function () {});
      return cached;
    }
    return refresh;
  }));
});
