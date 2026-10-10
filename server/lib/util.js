/*
 * Small helpers shared by the server's modules.
 * Strict ES5 for Node 0.12.2 on webOS 4.
 */
var fs = require('fs');
var path = require('path');
var os = require('os');

// An integer from config or a request, or dflt when there is none.
function toInt(v, dflt) {
  var n = parseInt(v, 10);
  return isNaN(n) ? dflt : n;
}

// node 0.12 has no { recursive: true }.
function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  mkdirp(path.dirname(dir));
  try { fs.mkdirSync(dir); } catch (e) {}
}

// A file's text, trimmed, or null when it cannot be read.
function readTrimmed(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').trim(); }
  catch (e) { return null; }
}

// The TV's own address on the home network, whatever the server is bound to.
function lanAddress() {
  var ifaces = {};
  try { ifaces = os.networkInterfaces() || {}; } catch (e) { return null; }
  var best = null;
  for (var name in ifaces) {
    if (!ifaces.hasOwnProperty(name)) continue;
    var list = ifaces[name] || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var fam = String(a.family);
      if (fam !== 'IPv4' && fam !== '4') continue;
      if (a.internal) continue;
      // Wired first where a TV has both, otherwise the first that answers.
      if (!best || /^eth/.test(name)) best = a.address;
    }
  }
  return best;
}

module.exports = { toInt: toInt, mkdirp: mkdirp, readTrimmed: readTrimmed, lanAddress: lanAddress };
