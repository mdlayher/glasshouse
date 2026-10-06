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
    'glasshouse_cpu_seconds_total',
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
    'glasshouse_emmc_life_used_ratio',
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
    'glasshouse_oled_failure_alerts_total',
    'glasshouse_oled_gsr_stress_events_total',
    'glasshouse_oled_protection_enabled',
    'glasshouse_signal_info',
    'glasshouse_signal_width_pixels',
    'glasshouse_signal_height_pixels',
    'glasshouse_signal_refresh_hertz'
  ]);

  var renderings = {
    b8: prometheus.render(require('./fixtures/stats-b8-webos4.json'), '0.80.1'),
    g4: prometheus.render(require('./fixtures/stats-g4-webos9.json'), '0.80.1'),
    c4: prometheus.render(require('./fixtures/stats-c4-webos9.json'), '0.80.1'),
    c4standby: prometheus.render(require('./fixtures/stats-c4-webos9-standby.json'), '0.80.1'),
    cx: prometheus.render(require('./fixtures/stats-cx-webos5.json'), '0.80.1'),
    cxhdr: prometheus.render(require('./fixtures/stats-cx-webos5-hdr.json'), '0.80.1'),
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
  // Captured before telemetry gave the precise readings, the CPU times and the
  // eMMC estimates, so this renders from the rounded ones. The C4 has no GPU clock reading and no Pixel Refresher run
  // recorded yet, so neither has a sample. Nor did it give the raw dynamic
  // range or the signal's timing yet, so those are empty or absent.
  var c4 = sampleLines(prometheus.render(require('./fixtures/stats-c4-webos9.json'), '0.80.1'));
  assert.deepEqual(c4, [
    'glasshouse_info{model="OLED55C4PUA.DUSQLJR",firmware="23.20.35",webos="9.2.0",version="0.80.1"} 1',
    'glasshouse_boot_time_seconds 1791204922.238',
    'glasshouse_system_on 1',
    'glasshouse_screen_on 1',
    'glasshouse_soc_temperature_celsius 59',
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
    'glasshouse_oled_failure_alerts_total 0',
    'glasshouse_signal_info{dynamic_range="",picture_mode="hdrGame"} 1'
  ]);

  // The same C4 in standby, from a server with the precise readings.
  var standby = sampleLines(prometheus.render(require('./fixtures/stats-c4-webos9-standby.json'), '0.80.1'));
  assert.deepEqual(standby, [
    'glasshouse_info{model="OLED55C4PUA.DUSQLJR",firmware="23.20.35",webos="9.2.0",version="0.80.1"} 1',
    'glasshouse_boot_time_seconds 1791204921',
    'glasshouse_system_on 0',
    'glasshouse_screen_on 0',
    'glasshouse_soc_temperature_celsius 50',
    'glasshouse_cpu_seconds_total{cpu="0",mode="user"} 1050.09',
    'glasshouse_cpu_seconds_total{cpu="0",mode="nice"} 0.12',
    'glasshouse_cpu_seconds_total{cpu="0",mode="system"} 405.81',
    'glasshouse_cpu_seconds_total{cpu="0",mode="idle"} 14489.86',
    'glasshouse_cpu_seconds_total{cpu="0",mode="iowait"} 2.1',
    'glasshouse_cpu_seconds_total{cpu="0",mode="irq"} 0',
    'glasshouse_cpu_seconds_total{cpu="0",mode="softirq"} 29.23',
    'glasshouse_cpu_seconds_total{cpu="0",mode="steal"} 0',
    'glasshouse_cpu_seconds_total{cpu="1",mode="user"} 919.8',
    'glasshouse_cpu_seconds_total{cpu="1",mode="nice"} 0.13',
    'glasshouse_cpu_seconds_total{cpu="1",mode="system"} 352.75',
    'glasshouse_cpu_seconds_total{cpu="1",mode="idle"} 14577.48',
    'glasshouse_cpu_seconds_total{cpu="1",mode="iowait"} 2.3',
    'glasshouse_cpu_seconds_total{cpu="1",mode="irq"} 0',
    'glasshouse_cpu_seconds_total{cpu="1",mode="softirq"} 0.86',
    'glasshouse_cpu_seconds_total{cpu="1",mode="steal"} 0',
    'glasshouse_cpu_frequency_hertz 1400000000',
    'glasshouse_memory_total_bytes 2094612480',
    'glasshouse_memory_available_bytes 856883200',
    'glasshouse_swap_total_bytes 629141504',
    'glasshouse_swap_free_bytes 452182016',
    'glasshouse_network_receive_bytes_total{interface="wlan0"} 16811466',
    'glasshouse_network_transmit_bytes_total{interface="wlan0"} 22843413',
    'glasshouse_wifi_signal_dbm -64',
    'glasshouse_wifi_link_quality 0',
    'glasshouse_emmc_pre_eol_state{state="normal"} 1',
    'glasshouse_emmc_pre_eol_state{state="warning"} 0',
    'glasshouse_emmc_pre_eol_state{state="urgent"} 0',
    'glasshouse_emmc_life_used_ratio{type="a"} 0',
    'glasshouse_emmc_life_used_ratio{type="b"} 0',
    'glasshouse_app_storage_size_bytes 6368251904',
    'glasshouse_app_storage_available_bytes 4660547584',
    'glasshouse_remote_battery_ratio 0.52',
    'glasshouse_adblock_enabled 1',
    'glasshouse_oled_panel_usage_seconds_total 1398600',
    'glasshouse_oled_last_compensation_usage_seconds 1386000',
    'glasshouse_oled_compensation_interval_seconds 14400',
    'glasshouse_oled_compensation_running 0',
    'glasshouse_oled_compensation_runs_total 67',
    'glasshouse_oled_refresher_interval_seconds 7200000',
    'glasshouse_oled_refresher_runs_total 0',
    'glasshouse_oled_failure_alerts_total 0',
    'glasshouse_oled_gsr_stress_events_total 133204',
    'glasshouse_oled_protection_enabled{protection="asbl"} 1',
    'glasshouse_oled_protection_enabled{protection="gsr"} 1',
    'glasshouse_signal_info{dynamic_range="sdr",picture_mode="eco"} 1'
  ]);

  // A CX on webOS 5 with the screen on: all four cores online, a Pixel
  // Refresher run on record, and no remote paired.
  var cx = sampleLines(prometheus.render(require('./fixtures/stats-cx-webos5.json'), '0.80.1'));
  assert.deepEqual(cx, [
    'glasshouse_info{model="OLED77CXAUA",firmware="04.60.65",webos="5.6.0",version="0.80.1"} 1',
    'glasshouse_boot_time_seconds 1791226915',
    'glasshouse_system_on 1',
    'glasshouse_screen_on 1',
    'glasshouse_soc_temperature_celsius 43',
    'glasshouse_cpu_seconds_total{cpu="0",mode="user"} 79.98',
    'glasshouse_cpu_seconds_total{cpu="0",mode="nice"} 0.15',
    'glasshouse_cpu_seconds_total{cpu="0",mode="system"} 38.76',
    'glasshouse_cpu_seconds_total{cpu="0",mode="idle"} 804.66',
    'glasshouse_cpu_seconds_total{cpu="0",mode="iowait"} 0.83',
    'glasshouse_cpu_seconds_total{cpu="0",mode="irq"} 0',
    'glasshouse_cpu_seconds_total{cpu="0",mode="softirq"} 3.35',
    'glasshouse_cpu_seconds_total{cpu="0",mode="steal"} 0',
    'glasshouse_cpu_seconds_total{cpu="1",mode="user"} 75.26',
    'glasshouse_cpu_seconds_total{cpu="1",mode="nice"} 0.12',
    'glasshouse_cpu_seconds_total{cpu="1",mode="system"} 37.63',
    'glasshouse_cpu_seconds_total{cpu="1",mode="idle"} 812.75',
    'glasshouse_cpu_seconds_total{cpu="1",mode="iowait"} 1.36',
    'glasshouse_cpu_seconds_total{cpu="1",mode="irq"} 0',
    'glasshouse_cpu_seconds_total{cpu="1",mode="softirq"} 0.22',
    'glasshouse_cpu_seconds_total{cpu="1",mode="steal"} 0',
    'glasshouse_cpu_seconds_total{cpu="2",mode="user"} 77.25',
    'glasshouse_cpu_seconds_total{cpu="2",mode="nice"} 0.17',
    'glasshouse_cpu_seconds_total{cpu="2",mode="system"} 38.18',
    'glasshouse_cpu_seconds_total{cpu="2",mode="idle"} 805.87',
    'glasshouse_cpu_seconds_total{cpu="2",mode="iowait"} 1.01',
    'glasshouse_cpu_seconds_total{cpu="2",mode="irq"} 0',
    'glasshouse_cpu_seconds_total{cpu="2",mode="softirq"} 0.09',
    'glasshouse_cpu_seconds_total{cpu="2",mode="steal"} 0',
    'glasshouse_cpu_seconds_total{cpu="3",mode="user"} 34.93',
    'glasshouse_cpu_seconds_total{cpu="3",mode="nice"} 0',
    'glasshouse_cpu_seconds_total{cpu="3",mode="system"} 16.55',
    'glasshouse_cpu_seconds_total{cpu="3",mode="idle"} 210.42',
    'glasshouse_cpu_seconds_total{cpu="3",mode="iowait"} 0.99',
    'glasshouse_cpu_seconds_total{cpu="3",mode="irq"} 0',
    'glasshouse_cpu_seconds_total{cpu="3",mode="softirq"} 0.06',
    'glasshouse_cpu_seconds_total{cpu="3",mode="steal"} 0',
    'glasshouse_cpu_frequency_hertz 1008000000',
    'glasshouse_memory_total_bytes 2745262080',
    'glasshouse_memory_available_bytes 850268160',
    'glasshouse_swap_total_bytes 629141504',
    'glasshouse_swap_free_bytes 552226816',
    'glasshouse_network_receive_bytes_total{interface="wlan0"} 1365890',
    'glasshouse_network_transmit_bytes_total{interface="wlan0"} 1861641',
    'glasshouse_wifi_signal_dbm -66',
    'glasshouse_wifi_link_quality 0',
    'glasshouse_emmc_pre_eol_state{state="normal"} 1',
    'glasshouse_emmc_pre_eol_state{state="warning"} 0',
    'glasshouse_emmc_pre_eol_state{state="urgent"} 0',
    'glasshouse_emmc_life_used_ratio{type="a"} 0',
    'glasshouse_emmc_life_used_ratio{type="b"} 0',
    'glasshouse_app_storage_size_bytes 2935013376',
    'glasshouse_app_storage_available_bytes 758349824',
    'glasshouse_adblock_enabled 0',
    'glasshouse_oled_panel_usage_seconds_total 41880600',
    'glasshouse_oled_last_compensation_usage_seconds 41868000',
    'glasshouse_oled_compensation_interval_seconds 14400',
    'glasshouse_oled_compensation_running 0',
    'glasshouse_oled_compensation_runs_total 1822',
    'glasshouse_oled_last_refresher_usage_seconds 36032400',
    'glasshouse_oled_refresher_interval_seconds 7200000',
    'glasshouse_oled_refresher_runs_total 5',
    'glasshouse_signal_info{dynamic_range="",picture_mode="eco"} 1'
  ]);

  // The CX later, playing HDR from HDMI 4. Its panel service reports GSR
  // without a stress count, so that has no sample.
  var cxHdr = sampleLines(prometheus.render(require('./fixtures/stats-cx-webos5-hdr.json'), '0.80.1'));
  assert.deepEqual(cxHdr.filter(function (l) { return /^glasshouse_(oled_gsr|oled_protection|signal)_/.test(l); }), [
    'glasshouse_oled_protection_enabled{protection="asbl"} 1',
    'glasshouse_oled_protection_enabled{protection="gsr"} 1',
    'glasshouse_signal_info{dynamic_range="hdr",picture_mode="hdrStandard"} 1',
    'glasshouse_signal_width_pixels 3840',
    'glasshouse_signal_height_pixels 2160',
    'glasshouse_signal_refresh_hertz 60'
  ]);

  // Readings no fixture has.
  var more = sampleLines(prometheus.render({
    gpuMhz: 390,
    gpuHz: 389998000,
    tempMillidegrees: 54321,
    emmc: { eol: 'Urgent', life_est_a: 11, life_est_b: 4 },
    oled: { comp_status: 'Running', comp_interval_units: 25, comp_interval_hours: 4.2,
            gsr_stress_count: 12, gsr_enabled: true, tpc_enabled: false },
    picture: { dynamicRange_raw: 'dolbyHdrALLM' }
  }, ''));
  [
    'glasshouse_gpu_frequency_hertz 389998000',
    'glasshouse_soc_temperature_celsius 54.321',
    'glasshouse_emmc_pre_eol_state{state="normal"} 0',
    'glasshouse_emmc_pre_eol_state{state="urgent"} 1',
    'glasshouse_emmc_life_used_ratio{type="a"} 1',
    'glasshouse_emmc_life_used_ratio{type="b"} 0.3',
    'glasshouse_oled_compensation_running 1',
    'glasshouse_oled_compensation_interval_seconds 15000',
    'glasshouse_oled_gsr_stress_events_total 12',
    'glasshouse_oled_protection_enabled{protection="asbl"} 0',
    'glasshouse_oled_protection_enabled{protection="gsr"} 1',
    'glasshouse_signal_info{dynamic_range="dolbyHdrALLM",picture_mode=""} 1'
  ].forEach(function (line) { assert.ok(more.indexOf(line) !== -1, line + ' in\n' + more.join('\n')); });

  // An unread /proc/meminfo reads as zeros, which are not reported; a TV
  // without swap has a real 0, which is.
  var noMem = sampleLines(prometheus.render({ mem: { total: 0, avail: 0 }, swap: { total: 0, free: 0 } }, ''));
  assert.strictEqual(noMem.filter(function (l) { return /memory|swap/.test(l); }).length, 0);
  var noSwap = sampleLines(prometheus.render({ mem: { total: 1024, avail: 512 }, swap: { total: 0, free: 0 } }, ''));
  assert.ok(noSwap.indexOf('glasshouse_swap_total_bytes 0') !== -1);
  // An interval oled.js put back to 4 hours keeps the units it read; the
  // hours win where the two disagree.
  var reset = sampleLines(prometheus.render({ oled: { comp_interval_units: 200, comp_interval_hours: 4 } }, ''));
  assert.ok(reset.indexOf('glasshouse_oled_compensation_interval_seconds 14400') !== -1);
  // An eMMC estimate of 0 is "not defined".
  var undefinedEst = sampleLines(prometheus.render({ emmc: { life_est_a: null, life_est_b: 0 } }, ''));
  assert.strictEqual(undefinedEst.length, 1);
  // A protection neither the service nor a marker reports, as on a B8, and a
  // TV without the stress count, as the CX, have no sample.
  var unreported = sampleLines(prometheus.render({ oled: { gsr_enabled: null, tpc_enabled: true, gsr_stress_count: null } }, ''));
  assert.deepEqual(unreported.slice(1), ['glasshouse_oled_protection_enabled{protection="asbl"} 1']);
  // Neither picture setting known, or a port connected with no timing yet:
  // no signal series and no timing samples.
  assert.strictEqual(sampleLines(prometheus.render({
    picture: { dynamicRange: 'SDR', dynamicRange_raw: null },
    signal: 'Connected',
    signal_timing: null
  }, '')).length, 1);
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
