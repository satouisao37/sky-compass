#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

osascript -l JavaScript <<'JXA'
ObjC.import('Foundation');
ObjC.import('stdlib');

function readText(path) {
  return $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js;
}

var files = ['astro.js', 'app.js', 'sw.js'];
var failed = false;
for (var i = 0; i < files.length; i++) {
  try {
    new Function(readText(files[i]));
    console.log('構文OK: ' + files[i]);
  } catch (e) {
    console.log('構文NG: ' + files[i] + ' ' + e);
    failed = true;
  }
}
if (failed) $.exit(1);
JXA

osascript -l JavaScript test/astro.test.js
