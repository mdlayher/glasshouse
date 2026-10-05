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

// The names a sample line or a # TYPE line carries, in order of appearance.
function metricNames(text) {
  var seen = {}, names = [];
  text.split('\n').forEach(function (line) {
    var m = /^# TYPE (\S+) /.exec(line) || /^([a-zA-Z_:][a-zA-Z0-9_:]*)[{ ]/.exec(line);
    if (m && !seen[m[1]]) { seen[m[1]] = true; names.push(m[1]); }
  });
  return names;
}

// 1. Both fixtures render exactly the stable names
(function testStableNames() {
  // Renaming or dropping one of these breaks dashboards built on it.
  assert.deepEqual(prometheus.STABLE, ['glasshouse_info']);

  ['stats-b8-webos4.json', 'stats-g4-webos9.json'].forEach(function (f) {
    var stats = require(path.join(__dirname, 'fixtures', f));
    var text = prometheus.render(stats, '0.80.1');
    assert.deepEqual(metricNames(text), prometheus.STABLE, f);
    assert.ok(/\n$/.test(text), 'the exposition ends with a newline');
    text.split('\n').forEach(function (line) {
      if (!line || line.charAt(0) === '#') return;
      assert.ok(/^[a-z_]+(\{[^}]*\})? -?[0-9.e+]+$/.test(line), f + ': ' + line);
    });
  });

  var b8 = prometheus.render(require('./fixtures/stats-b8-webos4.json'), '0.80.1');
  assert.ok(b8.indexOf('# HELP glasshouse_info ') !== -1);
  assert.ok(b8.indexOf('# TYPE glasshouse_info gauge\n') !== -1);
  assert.ok(b8.indexOf('glasshouse_info{model="OLED65B8SLC",firmware="05.50.70",webos="4.4.3",version="0.80.1"} 1\n') !== -1, b8);
  console.log('  ✓ both fixtures render exactly the stable metric names');
})();

// 2. Label values are escaped, and a missing one is empty rather than omitted
(function testLabels() {
  assert.strictEqual(prometheus.escapeLabel('a\\b"c\nd'), 'a\\\\b\\"c\\nd');
  var text = prometheus.render({ device: { model: 'X"1\\\n' } }, '1.0');
  assert.ok(text.indexOf('glasshouse_info{model="X\\"1\\\\\\n",firmware="",webos="",version="1.0"} 1') !== -1, text);
  assert.ok(prometheus.render(null, '').indexOf('glasshouse_info{model="",firmware="",webos="",version=""} 1') !== -1);
  console.log('  ✓ label values are escaped, and missing ones are empty');
})();

// 3. The route: absent while off, gated by the token while on
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
