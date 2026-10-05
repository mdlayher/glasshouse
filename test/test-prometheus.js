// Strict ES5 - node v0.12.2 on webOS 4 (LG OLED B8) has no ES6 support.
var assert = require('assert');
var events = require('events');
var path = require('path');
var prometheus = require('../server/lib/prometheus');
var routes = require('../server/lib/routes');

console.log('Running test-prometheus.js ...');

// A GET from elsewhere on the network, which the token applies to.
function createMockReq(url, headers) {
  var req = new events.EventEmitter();
  req.url = url;
  req.method = 'GET';
  req.headers = headers || {};
  req.connection = { remoteAddress: '192.168.1.50' };
  return req;
}

// The family names the # TYPE lines declare, in order.
function declaredNames(text) {
  return text.split('\n').filter(function (line) { return /^# TYPE /.test(line); })
    .map(function (line) { return line.split(' ')[2]; });
}

// Every sample line, without the comments.
function sampleLines(text) {
  return text.split('\n').filter(function (line) { return line && line.charAt(0) !== '#'; });
}

// 1. Every rendering declares exactly the stable names, and nothing else
(function testStableNames() {
  // Renaming or dropping one of these breaks dashboards built on it.
  assert.deepEqual(prometheus.STABLE, [
    'glasshouse_info',
    'glasshouse_boot_time_seconds',
    'glasshouse_system_on',
    'glasshouse_screen_on',
    'glasshouse_soc_temperature_celsius',
    'glasshouse_cpu_utilization_ratio',
    'glasshouse_cpu_core_utilization_max_ratio',
    'glasshouse_cpu_frequency_hertz',
    'glasshouse_gpu_frequency_hertz',
    'glasshouse_memory_total_bytes',
    'glasshouse_memory_available_bytes',
    'glasshouse_swap_total_bytes',
    'glasshouse_swap_free_bytes',
    'glasshouse_network_receive_bytes_total',
    'glasshouse_network_transmit_bytes_total',
    'glasshouse_wifi_signal_dbm',
    'glasshouse_wifi_link_quality',
    'glasshouse_emmc_pre_eol_state',
    'glasshouse_app_storage_size_bytes',
    'glasshouse_app_storage_available_bytes',
    'glasshouse_remote_battery_ratio',
    'glasshouse_adblock_enabled',
    'glasshouse_oled_panel_usage_seconds_total',
    'glasshouse_oled_last_compensation_usage_seconds',
    'glasshouse_oled_compensation_interval_seconds',
    'glasshouse_oled_compensation_running',
    'glasshouse_oled_compensation_runs_total',
    'glasshouse_oled_last_refresher_usage_seconds',
    'glasshouse_oled_refresher_interval_seconds',
    'glasshouse_oled_refresher_runs_total',
    'glasshouse_oled_failure_alerts_total'
  ]);

  var renderings = {
    b8: prometheus.render(require('./fixtures/stats-b8-webos4.json'), '0.80.1'),
    g4: prometheus.render(require('./fixtures/stats-g4-webos9.json'), '0.80.1'),
    c4: prometheus.render(require('./fixtures/stats-c4-webos9.json'), '0.80.1'),
    empty: prometheus.render({}, '0.80.1'),
    failed: prometheus.render({ ok: false, error: 'timeout' }, '0.80.1')
  };
  Object.keys(renderings).forEach(function (k) {
    var text = renderings[k];
    assert.deepEqual(declaredNames(text), prometheus.STABLE, k);
    assert.ok(/\n$/.test(text), 'the exposition ends with a newline');
    sampleLines(text).forEach(function (line) {
      var m = /^([a-z_]+)(\{[^}]*\})? (-?[0-9.]+(e[+-]?[0-9]+)?)$/.exec(line);
      assert.ok(m, k + ': ' + line);
      assert.ok(prometheus.STABLE.indexOf(m[1]) !== -1, k + ': ' + line);
    });
    text.split('\n').forEach(function (line) {
      if (/^# HELP /.test(line)) assert.ok(line.split(' ').length > 3, k + ': a family without help: ' + line);
    });
  });

  // Without readings only the info metric has a sample, never a made-up 0.
  assert.deepEqual(sampleLines(renderings.empty), [
    'glasshouse_info{model="",firmware="",webos="",version="0.80.1"} 1'
  ]);
  assert.deepEqual(sampleLines(renderings.failed), sampleLines(renderings.empty));
  console.log('  ✓ every rendering declares exactly the stable metric names');
})();

// 2. Values are in base units: bytes, hertz, seconds and ratios
(function testValues() {
  // The C4 has no GPU clock reading and no Pixel Refresher run recorded yet,
  // so neither has a sample.
  var c4 = sampleLines(prometheus.render(require('./fixtures/stats-c4-webos9.json'), '0.80.1'));
  assert.deepEqual(c4, [
    'glasshouse_info{model="OLED55C4PUA.DUSQLJR",firmware="23.20.35",webos="9.2.0",version="0.80.1"} 1',
    'glasshouse_boot_time_seconds 1791204922.238',
    'glasshouse_system_on 1',
    'glasshouse_screen_on 1',
    'glasshouse_soc_temperature_celsius 59',
    'glasshouse_cpu_utilization_ratio 0.06',
    'glasshouse_cpu_core_utilization_max_ratio 0.09',
    'glasshouse_cpu_frequency_hertz 1400000000',
    'glasshouse_memory_total_bytes 2094612480',
    'glasshouse_memory_available_bytes 683720704',
    'glasshouse_swap_total_bytes 629141504',
    'glasshouse_swap_free_bytes 527855616',
    'glasshouse_network_receive_bytes_total{interface="wlan0"} 5972719',
    'glasshouse_network_transmit_bytes_total{interface="wlan0"} 6913087',
    'glasshouse_wifi_signal_dbm -63',
    'glasshouse_wifi_link_quality 0',
    'glasshouse_emmc_pre_eol_state{state="normal"} 1',
    'glasshouse_emmc_pre_eol_state{state="warning"} 0',
    'glasshouse_emmc_pre_eol_state{state="urgent"} 0',
    'glasshouse_app_storage_size_bytes 6368002048',
    'glasshouse_app_storage_available_bytes 4660920320',
    'glasshouse_remote_battery_ratio 0.52',
    'glasshouse_adblock_enabled 1',
    'glasshouse_oled_panel_usage_seconds_total 1395720',
    'glasshouse_oled_last_compensation_usage_seconds 1386000',
    'glasshouse_oled_compensation_interval_seconds 14400',
    'glasshouse_oled_compensation_running 0',
    'glasshouse_oled_compensation_runs_total 67',
    'glasshouse_oled_refresher_interval_seconds 7200000',
    'glasshouse_oled_refresher_runs_total 0',
    'glasshouse_oled_failure_alerts_total 0'
  ]);

  // The same C4 in Active Standby.
  var standby = sampleLines(prometheus.render({
    powerState: { raw: 'Active Standby', label: 'Standby', systemOn: false, screenOn: false }
  }, ''));
  assert.ok(standby.indexOf('glasshouse_system_on 0') !== -1);
  assert.ok(standby.indexOf('glasshouse_screen_on 0') !== -1);

  // Readings no fixture has.
  var more = sampleLines(prometheus.render({
    load: 57,
    gpuMhz: 390,
    emmc: { eol: 'Urgent' },
    oled: { comp_status: 'Running', last_refresher_hours: 2026 }
  }, ''));
  [
    'glasshouse_cpu_utilization_ratio 0.57',
    'glasshouse_gpu_frequency_hertz 390000000',
    'glasshouse_emmc_pre_eol_state{state="normal"} 0',
    'glasshouse_emmc_pre_eol_state{state="urgent"} 1',
    'glasshouse_oled_compensation_running 1',
    'glasshouse_oled_last_refresher_usage_seconds 7293600'
  ].forEach(function (line) { assert.ok(more.indexOf(line) !== -1, line + ' in\n' + more.join('\n')); });

  // An unread /proc/meminfo reads as zeros, which are not reported; a TV
  // without swap has a real 0, which is.
  var noMem = sampleLines(prometheus.render({ mem: { total: 0, avail: 0 }, swap: { total: 0, free: 0 } }, ''));
  assert.strictEqual(noMem.filter(function (l) { return /memory|swap/.test(l); }).length, 0);
  var noSwap = sampleLines(prometheus.render({ mem: { total: 1024, avail: 512 }, swap: { total: 0, free: 0 } }, ''));
  assert.ok(noSwap.indexOf('glasshouse_swap_total_bytes 0') !== -1);
  // eMMC state unknown: no samples rather than three zeros.
  assert.strictEqual(sampleLines(prometheus.render({ emmc: { eol: 'unknown' } }, '')).length, 1);
  console.log('  ✓ values are in base units, and unknown readings are left out');
})();

// 3. Label values are escaped, and a missing one is empty rather than omitted
(function testLabels() {
  assert.strictEqual(prometheus.escapeLabel('a\\b"c\nd'), 'a\\\\b\\"c\\nd');
  var text = prometheus.render({ device: { model: 'X"1\\\n' } }, '1.0');
  assert.ok(text.indexOf('glasshouse_info{model="X\\"1\\\\\\n",firmware="",webos="",version="1.0"} 1') !== -1, text);
  assert.ok(prometheus.render(null, '').indexOf('glasshouse_info{model="",firmware="",webos="",version=""} 1') !== -1);
  console.log('  ✓ label values are escaped, and missing ones are empty');
})();

// 4. The route: absent while off, gated by the token while on
(function testRoute() {
  function get(url, headers, cb) {
    var res = {
      writeHead: function (code, hdrs) { res.statusCode = code; res.headers = hdrs; },
      end: function (body) { res.body = String(body || ''); cb(res); }
    };
    routes.handleRequest(createMockReq(url, headers), res);
  }

  var config = { web: { enabled: false }, token: '', prometheus: { enabled: false } };
  var stats = require('./fixtures/stats-g4-webos9.json');
  var checks = 0;
  routes.init({
    config: config,
    version: '0.80.1',
    prometheus: prometheus,
    telemetry: { collectStats: function (cb) { cb(stats); } }
  });

  get('/api/prometheus/metrics', {}, function (r) {
    checks++;
    assert.strictEqual(r.statusCode, 404, 'off: the endpoint does not answer');
  });

  config.prometheus.enabled = true;
  get('/api/prometheus/metrics', {}, function (r) {
    checks++;
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.headers['Content-Type'], 'text/plain; version=0.0.4; charset=utf-8');
    assert.strictEqual(r.body, prometheus.render(stats, '0.80.1'));
  });

  config.token = 'secret';
  get('/api/prometheus/metrics', {}, function (r) {
    checks++;
    assert.strictEqual(r.statusCode, 401, 'no credential');
  });
  get('/api/prometheus/metrics', { authorization: 'Bearer wrong' }, function (r) {
    checks++;
    assert.strictEqual(r.statusCode, 401, 'wrong credential');
  });
  get('/api/prometheus/metrics', { authorization: 'Bearer secret' }, function (r) {
    checks++;
    assert.strictEqual(r.statusCode, 200, 'the Bearer header alone');
  });

  // A token set does not make the endpoint answer while it is off.
  config.prometheus.enabled = false;
  get('/api/prometheus/metrics', { authorization: 'Bearer secret' }, function (r) {
    checks++;
    assert.strictEqual(r.statusCode, 404);
  });

  assert.strictEqual(checks, 6, 'every callback ran');
  console.log('  ✓ the route is absent while off, and token-gated while on');
})();
