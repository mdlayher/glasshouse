/**
 * test/test-hdmi-map.js - Each HDMI input's signal comes from its own
 * receiver, by the input map in configd, and never from another input's
 *
 * Its own suite: telemetry remembers the map for good. The status files are
 * a C4's (webOS 9) with a PC at 4K 120 Hz on HDMI 4 and a streamer at 1080p
 * on HDMI 1; its input map puts HDMI 1 to 4 on receivers 3, 2, 1 and 0.
 *
 * Strict ES5: runs on node 0.12.
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var C4_STATUS = {};
for (var p = 0; p < 4; p++) {
  C4_STATUS['/proc/lg/hdmi20/port' + p + '/status'] =
    fs.readFileSync(path.join(__dirname, 'fixtures', 'hdmi20-c4', 'port' + p + '.status'), 'utf8');
}

var mockEnv = require('./mocks/mock-env').createMockEnv({ files: C4_STATUS });
mockEnv.install();

console.log('Running test-hdmi-map.js ...');

var C4_INPUT_MAP = {
  returnValue: true,
  configs: {
    'inputMap.videoInputMapIndexInfo0': [{
      maxHdmiCount: 4, maxCompCount: 1, maxAvCount: 1,
      assignment: { hdmi1: '3', hdmi2: '2', hdmi3: '1', hdmi4: '0', av1: '2', comp1: '1' }
    }]
  }
};

mockEnv.luna['com.webos.service.eim/getAllInputStatus'] = {
  returnValue: true,
  devices: [
    { id: 'HDMI_1', port: 1, label: 'Streamer', activate: true, hdmiPlugIn: true },
    { id: 'HDMI_2', port: 2, label: 'HDMI 2', activate: false },
    { id: 'HDMI_3', port: 3, label: 'HDMI 3', activate: false },
    { id: 'HDMI_4', port: 4, label: 'PC', activate: true, hdmiPlugIn: true }
  ]
};

var configdCalls = 0;
function load(configd) {
  configdCalls = 0;
  mockEnv.luna['com.webos.service.config/getConfigs'] = function (payload) {
    if (payload && payload.configNames && payload.configNames[0].indexOf('inputMap.') === 0) {
      configdCalls++;
      return configd;
    }
    return { returnValue: true, configs: { 'tv.model.logoLight': false } };
  };
  delete require.cache[require.resolve('../server/lib/telemetry')];
  var telemetry = require('../server/lib/telemetry');
  telemetry.init({
    // null stands for configd not answering at all, as a timed-out luna-send.
    luna: function (uri, payload, cb) {
      if (configd === null && uri === 'com.webos.service.config/getConfigs' &&
          payload.configNames[0].indexOf('inputMap.') === 0) {
        configdCalls++;
        return process.nextTick(function () { cb(null, ''); });
      }
      mockEnv.mockLuna(uri, payload, cb);
    },
    lunaCached: mockEnv.mockLunaCached,
    config: { port: 8080, allowControl: true },
    oled: { detectOled: function (cb) { cb(true); }, getIsOled: function () { return true; },
            refreshOledStats: function (s, ps, cb) { cb({}); } },
    privacy: { isAdBlockActive: function () { return false; }, collectPrivacy: function (cb) { cb({}); } },
    screensavers: { screensaverMode: function () { return 'stock'; }, screensaverLevel: function () { return 'dim'; } },
    tvwebVersion: '0.0.0',
    mapPowerState: function (raw) { return { raw: raw, label: 'On', systemOn: true, screenOn: true }; },
    isScreenSaver: function () { return false; }
  });
  return telemetry;
}

function onScreen(app) {
  mockEnv.luna['com.webos.applicationManager/getForegroundAppInfo'] = { returnValue: true, appId: app };
}

// collectStats swallows what its callbacks throw, so a failure exits here.
function checked(fn) {
  return function (arg) {
    try { fn(arg); } catch (e) {
      console.error('  ✗ ' + e.message);
      process.exit(1);
    }
  };
}

function statsOn(telemetry, app, cb) {
  onScreen(app);
  telemetry.clearCache();
  telemetry.collectStats(checked(cb));
}

var c4 = load(C4_INPUT_MAP);
c4.hdmiReceiverMap(checked(function (map) {
  assert.deepEqual(map, { 1: 3, 2: 2, 3: 1, 4: 0 });

  statsOn(c4, 'com.webos.app.hdmi1', function (s1) {
    assert.strictEqual(s1.signal, '1920x1081 @ 60Hz', 'HDMI 1 is the streamer on receiver 3');
    assert.strictEqual(s1.hdmi_diag.port, 3);
    assert.strictEqual(s1.hdmi_diag.phy_mode, 'TMDS (3G)');
    assert.strictEqual(s1.hdmi_diag.hdcp, 'HDCP 2.3');

    statsOn(c4, 'com.webos.app.hdmi4', function (s4) {
      assert.strictEqual(s4.signal, '3840x2160 @ 120Hz', 'HDMI 4 is the PC on receiver 0');
      assert.strictEqual(s4.hdmi_diag.port, 0);
      assert.strictEqual(s4.hdmi_diag.phy_mode, 'FRL 48 Gbps');

      statsOn(c4, 'com.webos.app.hdmi3', function (s3) {
        assert.strictEqual(s3.signal, null, 'HDMI 3 has nothing on receiver 1, and takes no other input\'s signal');
        assert.strictEqual(s3.signal_timing, null);
        assert.strictEqual(s3.hdmi_diag, null);
        assert.strictEqual(configdCalls, 1, 'the map is asked for once');
        console.log('  ✓ an input\'s signal comes from the receiver the input map gives it');

        c4.hdmiInputs(checked(function (r) {
          assert.strictEqual(r.pairedUnambiguously, true);
          assert.strictEqual(r.inputs[0].signal.port, 3);
          assert.strictEqual(r.inputs[0].signal.resolution, '1920x1081');
          assert.strictEqual(r.inputs[1].signal, null);
          assert.strictEqual(r.inputs[2].signal, null);
          assert.strictEqual(r.inputs[3].signal.port, 0);
          assert.strictEqual(r.inputs[3].signal.refreshHz, 120);
          console.log('  ✓ /api/hdmi pairs every input with its receiver, with two sources live');

          noMap();
        }));
      });
    });
  });
}));

// A TV whose configd has no map keeps the old guess, receiver n - 1 then n,
// but no longer borrows a receiver outside it.
function noMap() {
  var old = load({ returnValue: true, configs: {}, missingConfigs: ['inputMap.videoInputMapIndexInfo0'] });
  statsOn(old, 'com.webos.app.hdmi2', function (s2) {
    assert.strictEqual(s2.signal, null, 'receivers 1 and 2 are idle, and the PC on 0 is not HDMI 2');
    assert.strictEqual(s2.hdmi_diag, null);
    statsOn(old, 'com.webos.app.hdmi1', function (s1) {
      assert.strictEqual(s1.signal, '3840x2160 @ 120Hz', 'HDMI 1 guessed on receiver 0');
      assert.strictEqual(configdCalls, 1, 'an answer without a map is remembered too');
      console.log('  ✓ without a map, the guess stays within an input\'s own candidates');
      unanswered();
    });
  });
}

// No answer is asked again, rather than remembered as no map; a refusal is not.
function unanswered() {
  var t = load(null);
  t.hdmiReceiverMap(checked(function (map) {
    assert.strictEqual(map, null);
    t.hdmiReceiverMap(checked(function (map2) {
      assert.strictEqual(map2, null, 'still no answer');
      assert.strictEqual(configdCalls, 2, 'asked again after no answer');
      var refused = load({ returnValue: false, errorText: 'Unknown method' });
      refused.hdmiReceiverMap(checked(function () {
        refused.hdmiReceiverMap(checked(function (map3) {
          assert.strictEqual(map3, null);
          assert.strictEqual(configdCalls, 1, 'a refusal is remembered');
          console.log('  ✓ the map is asked for again until configd answers, and a refusal is final');
          absentInput();
        }));
      }));
    }));
  }));
}

function absentInput() {
  var t = load({
    returnValue: true,
    configs: { 'inputMap.videoInputMapIndexInfo0': [{ assignment: { hdmi1: '3', hdmi2: '2', hdmi3: '1', hdmi4: 'none' } }] }
  });
  t.hdmiReceiverMap(checked(function (map) {
    assert.strictEqual(map[4], null);
    statsOn(t, 'com.webos.app.hdmi4', function (s4) {
      assert.strictEqual(s4.signal, null, 'an input the board does not have has no receiver');
      console.log('  ✓ an input the map marks none has no signal');
      mockEnv.restore();
    });
  }));
}
