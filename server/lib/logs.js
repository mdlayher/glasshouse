'use strict';
// Strict ES5 - node v0.12.2 on webOS 4 (LG OLED B8) has no ES6 support.
var fs = require('fs');
var path = require('path');
var os = require('os');
var execFile = require('child_process').execFile;

var MESSAGES_LOG = '/var/log/messages';
var DEFAULT_LIMIT = 100;
var MAX_LIMIT = 1000;
var MAX_FILE_READ = 512 * 1024; // 512 KB tail read

function getTvwebLogPath() {
  return process.env.TVWEB_LOG || '/var/lib/tvweb/tvweb.log';
}

/*
 * Reads a file's complete lines from `from` to the end, or the last maxBytes
 * of it when `from` is null, no longer in the file (rotated or truncated), on
 * another file (ino), or further back than maxBytes. `end` is the offset just
 * past the last newline, so a line still being written is read whole by the
 * next call; `whole` says the start was not `from`, so what came before has to
 * be dropped rather than added to.
 */
function readLines(filePath, from, ino, maxBytes) {
  try {
    if (!fs.existsSync(filePath)) return null;
    var stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    var size = stat.size;
    var sameFile = from !== null && (!ino || ino === String(stat.ino));
    var whole = !sameFile || from > size || size - from > maxBytes;
    var start = whole ? Math.max(0, size - maxBytes) : from;
    var toRead = size - start;
    if (toRead <= 0) return { text: '', end: start, ino: String(stat.ino), whole: whole };
    var fd = fs.openSync(filePath, 'r');
    var buf = typeof Buffer.alloc === 'function' ? Buffer.alloc(toRead) : new Buffer(toRead);
    var bytesRead = fs.readSync(fd, buf, 0, toRead, start);
    fs.closeSync(fd);
    var last = -1;
    for (var i = bytesRead - 1; i >= 0; i--) { if (buf[i] === 10) { last = i; break; } }
    var text = last === -1 ? '' : buf.toString('utf8', 0, last + 1);
    // A read that began part way into the file starts mid-line.
    if (whole && start > 0) {
      var firstNewline = text.indexOf('\n');
      text = firstNewline === -1 ? '' : text.substring(firstNewline + 1);
    }
    return { text: text, end: start + last + 1, ino: String(stat.ino), whole: whole };
  } catch (e) {
    return null;
  }
}

/**
 * Determine log level from line text or explicit indicator.
 * @param {string} text
 * @param {string} [hint]
 * @returns {string} 'error' | 'warning' | 'info' | 'debug'
 */
function detectLevel(text, hint) {
  if (hint) {
    var h = hint.toLowerCase();
    if (h === 'err' || h === 'error' || h === 'crit' || h === 'alert' || h === 'emerg') return 'error';
    if (h === 'warn' || h === 'warning') return 'warning';
    if (h === 'debug') return 'debug';
    if (h === 'info' || h === 'notice') return 'info';
  }
  var lower = text.toLowerCase();
  if (/\b(error|fail|failed|failure|fatal|panic|corrupt|segfault)\b/.test(lower)) return 'error';
  if (/\b(warn|warning)\b/.test(lower)) return 'warning';
  if (/\bdebug\b/.test(lower)) return 'debug';
  return 'info';
}

var SYS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+\[([0-9.]+)\]\s+(\S+)\s+(\S+)\s+(?:\[[^\]]*\])?\s*(.*)$/;

/**
 * Parse system log lines from /var/log/messages.
 * @param {string} raw
 * @param {number} bootTimeMs
 * @returns {Array.<Object>}
 */
function parseSystemLogs(raw, bootTimeMs) {
  if (!raw) return [];
  var lines = raw.split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var m = SYS_RE.exec(line);
    if (m) {
      var facLev = m[3];
      var levHint = facLev.indexOf('.') !== -1 ? facLev.split('.')[1] : facLev;
      out.push({
        ts: m[1],
        mono: parseFloat(m[2]),
        source: 'system',
        level: detectLevel(m[5], levHint),
        proc: m[4],
        msg: m[5],
        raw: line
      });
    } else {
      // Fallback for unstructured lines in /var/log/messages
      var isoMatch = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(.*)$/.exec(line);
      var ts = isoMatch ? isoMatch[1] : new Date().toISOString();
      var msg = isoMatch ? isoMatch[2] : line;
      var mono = (Date.parse(ts) - bootTimeMs) / 1000;
      if (isNaN(mono)) mono = 0;
      out.push({
        ts: ts,
        mono: mono,
        source: 'system',
        level: detectLevel(msg),
        proc: 'system',
        msg: msg,
        raw: line
      });
    }
  }
  return out;
}

var TVWEB_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)(?:\s+\[([0-9.]+)\])?\s+(.*)$/;

/**
 * Parse Glasshouse server log lines.
 * @param {string} raw
 * @param {number} bootTimeMs
 * @param {number} defaultMono
 * @returns {Array.<Object>}
 */
function parseGlasshouseLogs(raw, bootTimeMs, defaultMono) {
  if (!raw) return [];
  var lines = raw.split('\n');
  var out = [];
  var lastMono = defaultMono;
  var lastTs = new Date(bootTimeMs + Math.round(defaultMono * 1000)).toISOString();

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var m = TVWEB_RE.exec(line);
    var ts, mono, msg;
    var marked = false;
    if (m) {
      ts = m[1];
      mono = m[2] ? parseFloat(m[2]) : (Date.parse(ts) - bootTimeMs) / 1000;
      msg = m[3];
      lastMono = mono;
      lastTs = ts;
      // console.error's mark (tvweb.js); lines from before it are guessed.
      if (msg.indexOf('ERROR ') === 0) { marked = true; msg = msg.substring(6); }
    } else {
      ts = lastTs;
      mono = lastMono;
      msg = line;
    }
    var proc = 'tvweb';
    var tagMatch = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(msg);
    if (tagMatch) {
      var cand = tagMatch[1];
      var candLower = cand.toLowerCase();
      if (candLower !== 'warning' && candLower !== 'warn' && candLower !== 'error' && candLower !== 'info' && candLower !== 'debug') {
        proc = cand;
      }
    }
    out.push({
      ts: ts,
      mono: mono,
      source: 'glasshouse',
      level: marked ? 'error' : detectLevel(msg),
      proc: proc,
      msg: msg,
      raw: line
    });
  }
  return out;
}

var DMESG_RE = /^\s*\[\s*([0-9.]+)\s*\]\s*(.*)$/;

/**
 * Parse kernel dmesg output.
 * @param {string} raw
 * @param {number} bootTimeMs
 * @returns {Array.<Object>}
 */
function parseKernelLogs(raw, bootTimeMs) {
  if (!raw) return [];
  var lines = raw.split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var m = DMESG_RE.exec(line);
    if (m) {
      var mono = parseFloat(m[1]);
      var msg = m[2];
      var ts = new Date(bootTimeMs + Math.round(mono * 1000)).toISOString();
      var proc = 'kernel';
      var tagMatch = /^(?:\[([a-zA-Z0-9_.-]+)\]:?\s*|([a-zA-Z0-9_.-]+)(?:\s+[\w.:-]+)?:\s*)(.*)$/.exec(msg);
      if (tagMatch) {
        var candidate = tagMatch[1] || tagMatch[2];
        var candLower = candidate.toLowerCase();
        if (candLower !== 'warning' && candLower !== 'warn' && candLower !== 'error' && candLower !== 'info' && candLower !== 'debug') {
          proc = candidate;
        }
      }
      out.push({
        ts: ts,
        mono: mono,
        source: 'kernel',
        level: detectLevel(msg),
        proc: proc,
        msg: msg,
        raw: line
      });
    }
  }
  return out;
}

/*
 * The cursor a poll sends back to be given only what is new:
 * "system:<end>:<ino>,glasshouse:<end>:<ino>,kernel:<last uptime>".
 */
function parseCursor(since) {
  var out = {};
  String(since || '').split(',').forEach(function (part) {
    var f = part.split(':');
    if (f[0] === 'kernel' && f[1] && !isNaN(parseFloat(f[1]))) out.kernel = parseFloat(f[1]);
    else if ((f[0] === 'system' || f[0] === 'glasshouse') && /^\d+$/.test(f[1] || '')) {
      out[f[0]] = { end: parseInt(f[1], 10), ino: f[2] || '' };
    }
  });
  return out;
}

/**
 * Fetch and combine logs across requested sources.
 * @param {Object} opts
 * @param {Array.<string>} [opts.sources] 'system', 'glasshouse', 'kernel'
 * @param {number|string} [opts.limit]
 * @param {string} [opts.filter]
 * @param {string} [opts.since] the cursor from the last call: only what
 *   came after it is returned, unless `incremental` comes back false
 * @param {function(Error|null, Object=): void} cb
 */
function getLogs(opts, cb) {
  opts = opts || {};
  var limit = parseInt(String(opts.limit), 10);
  if (isNaN(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  var requestedSources = opts.sources;
  if (!requestedSources || !requestedSources.length) {
    requestedSources = ['system', 'glasshouse'];
  }
  var wantSystem = requestedSources.indexOf('system') !== -1;
  var wantGlasshouse = requestedSources.indexOf('glasshouse') !== -1;
  var wantKernel = requestedSources.indexOf('kernel') !== -1;

  var now = Date.now();
  var uptime = typeof os.uptime === 'function' ? os.uptime() : 0;
  var bootTimeMs = now - Math.round(uptime * 1000);

  var tvwebPath = getTvwebLogPath();
  var sysAvailable = fs.existsSync(MESSAGES_LOG);
  var ghAvailable = fs.existsSync(tvwebPath);

  var meta = {
    system: { available: sysAvailable, path: MESSAGES_LOG },
    glasshouse: { available: ghAvailable, path: tvwebPath },
    kernel: { available: true }
  };

  var allEntries = [];
  var since = opts.since ? parseCursor(opts.since) : null;
  // False once any source had to be read whole, so the caller replaces its
  // list rather than adding to it.
  var incremental = !!since;
  var cursor = [];

  function readSource(name, file, parse) {
    var at = since && since[name];
    var r = readLines(file, at ? at.end : null, at ? at.ino : '', MAX_FILE_READ);
    if (!r) { if (since) incremental = false; return; }
    if (r.whole) incremental = false;
    cursor.push(name + ':' + r.end + ':' + r.ino);
    var entries = parse(r.text);
    for (var e = 0; e < entries.length; e++) allEntries.push(entries[e]);
  }

  if (wantSystem && sysAvailable) {
    readSource('system', MESSAGES_LOG, function (text) { return parseSystemLogs(text, bootTimeMs); });
  }

  if (wantGlasshouse && ghAvailable) {
    readSource('glasshouse', tvwebPath, function (text) { return parseGlasshouseLogs(text, bootTimeMs, uptime); });
  }

  function finish() {
    // Sort combined entries chronologically
    allEntries.sort(function (a, b) {
      if (a.mono !== b.mono) return a.mono - b.mono;
      return a.ts < b.ts ? -1 : (a.ts > b.ts ? 1 : 0);
    });

    // Optional server-side filter string
    var filter = typeof opts.filter === 'string' ? opts.filter.trim().toLowerCase() : '';
    if (filter) {
      var filtered = [];
      for (var f = 0; f < allEntries.length; f++) {
        var ent = allEntries[f];
        if (ent.raw.toLowerCase().indexOf(filter) !== -1 ||
            ent.proc.toLowerCase().indexOf(filter) !== -1) {
          filtered.push(ent);
        }
      }
      allEntries = filtered;
    }

    // Apply cap
    if (allEntries.length > limit) {
      allEntries = allEntries.slice(allEntries.length - limit);
    }

    cb(null, {
      ok: true,
      cursor: cursor.join(','),
      incremental: incremental,
      sources: meta,
      uptime: uptime,
      bootTime: bootTimeMs,
      limit: limit,
      total: allEntries.length,
      entries: allEntries
    });
  }

  if (wantKernel) {
    execFile('dmesg', [], { maxBuffer: 2 * 1024 * 1024 }, function (err, stdout) {
      if (!err && stdout) {
        // dmesg is a ring buffer, read whole each time: what is new is what
        // is later than the last entry the caller has.
        var kEntries = parseKernelLogs(stdout, bootTimeMs);
        // All of it when a file was read whole, as the caller starts over.
        var after = incremental && typeof since.kernel === 'number' ? since.kernel : -1;
        var lastMono = after;
        for (var k = 0; k < kEntries.length; k++) {
          if (kEntries[k].mono > after) allEntries.push(kEntries[k]);
          if (kEntries[k].mono > lastMono) lastMono = kEntries[k].mono;
        }
        if (lastMono >= 0) cursor.push('kernel:' + lastMono);
      } else if (err) {
        meta.kernel.available = false;
        meta.kernel.error = err.message;
      }
      finish();
    });
  } else {
    finish();
  }
}

module.exports = {
  getLogs: getLogs,
  parseCursor: parseCursor,
  parseSystemLogs: parseSystemLogs,
  parseGlasshouseLogs: parseGlasshouseLogs,
  parseKernelLogs: parseKernelLogs,
  detectLevel: detectLevel
};
