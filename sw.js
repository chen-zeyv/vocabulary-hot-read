"use strict";

// 递增此版本号可让新外壳立即替换旧缓存；每次改动白名单文件后都要递增。
const CACHE_NAME = "vocabulary-hot-read-shell-v18";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./lesson-coverage.js",
  "./learning-options.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-master.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-apple-touch-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("vocabulary-hot-read-shell-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only same-origin static shell GETs may be read from Cache Storage.
  // All API calls, form submissions, and non-shell requests stay network-only.
  if (url.origin !== self.location.origin || request.method !== "GET") return;
  if (request.headers.has("authorization") || request.headers.has("x-api-key")) return;
  const shellUrl = new URL("./", self.location.href);
  const path = url.pathname;
  const allowed = SHELL_FILES.some((file) => new URL(file, shellUrl).pathname === path);
  if (!allowed && request.mode !== "navigate") return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(new URL("./index.html", shellUrl).href)) || Response.error();
    }));
    return;
  }

  // 静态外壳优先取网络，确保部署更新能到达已安装的应用；离线时回退到缓存。
  event.respondWith(fetch(request, { cache: "no-store" }).then(async (response) => {
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  }).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(request, { ignoreSearch: true })) || Response.error();
  }));
});
