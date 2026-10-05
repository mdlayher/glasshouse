/*
 * Telemetry in the Prometheus text exposition format, version 0.0.4.
 * Strict ES5 for Node 0.12.2 on webOS 4.
 *
 * The names in STABLE are what dashboards and alerts are built on, so one is
 * never renamed or dropped; test-prometheus.js pins them. Labels hold only what
 * rarely changes, since every new label value starts a new series.
 */

var STABLE = [
  'glasshouse_info'
];

// The exposition format escapes backslash, double quote and newline in a
// label value, and nothing else.
function escapeLabel(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function labelSet(labels) {
  var parts = [];
  for (var k in labels) parts.push(k + '="' + escapeLabel(labels[k]) + '"');
  return parts.length ? '{' + parts.join(',') + '}' : '';
}

function gauge(name, help, labels, value) {
  return '# HELP ' + name + ' ' + help + '\n' +
    '# TYPE ' + name + ' gauge\n' +
    name + labelSet(labels) + ' ' + value + '\n';
}

// stats is telemetry's collectStats result; version is Glasshouse's own.
function render(stats, version) {
  var device = (stats && stats.device) || {};
  var system = (stats && stats.system) || {};
  return gauge('glasshouse_info', 'The TV and the Glasshouse version serving it.', {
    model: device.model,
    firmware: system.firmware,
    webos: system.webos,
    version: version
  }, 1);
}

module.exports = { render: render, escapeLabel: escapeLabel, STABLE: STABLE };
