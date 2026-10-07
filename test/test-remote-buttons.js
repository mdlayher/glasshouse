/**
 * test/test-remote-buttons.js - Remote control colored button events
 *
 * Strict ES5 for Node 0.12.2 on webOS 4.
 */

var assert = require('assert');
var remotebuttons = require('../server/lib/remotebuttons');
var controls = require('../server/lib/controls');
var ha = require('../server/lib/ha');
var routes = require('../server/lib/routes');

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('BUTTON_CODES maps 398-401 to red, green, yellow, blue', function () {
  assert.strictEqual(remotebuttons.BUTTON_CODES[398], 'red');
  assert.strictEqual(remotebuttons.BUTTON_CODES[399], 'green');
  assert.strictEqual(remotebuttons.BUTTON_CODES[400], 'yellow');
  assert.strictEqual(remotebuttons.BUTTON_CODES[401], 'blue');
});

test('handleParsedEvent ignores non-EV_KEY, non-press, or unknown keycodes', function () {
  var called = 0;
  remotebuttons.init({
    config: { allowRemoteButtons: true },
    onButton: function () { called++; }
  });

  // type != 1 (EV_SYN, EV_REL, etc.)
  remotebuttons.handleParsedEvent(0, 398, 1);
  remotebuttons.handleParsedEvent(2, 398, 1);
  assert.strictEqual(called, 0);

  // val != 1 (val=0 is release, val=2 is repeat)
  remotebuttons.handleParsedEvent(1, 398, 0);
  remotebuttons.handleParsedEvent(1, 398, 2);
  assert.strictEqual(called, 0);

  // unknown keycode (e.g. 103 = KEY_UP)
  remotebuttons.handleParsedEvent(1, 103, 1);
  assert.strictEqual(called, 0);
});

test('handleParsedEvent calls onButton for each color and debounces rapid duplicates', function () {
  var events = [];
  remotebuttons.init({
    config: { allowRemoteButtons: true },
    onButton: function (btn, code) {
      events.push({ btn: btn, code: code });
    }
  });

  // Red button press
  remotebuttons.handleParsedEvent(1, 398, 1);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].btn, 'red');
  assert.strictEqual(events[0].code, 398);

  // Immediate red press within 200ms should be debounced
  remotebuttons.handleParsedEvent(1, 398, 1);
  assert.strictEqual(events.length, 1);

  // Different button (green) should fire immediately
  remotebuttons.handleParsedEvent(1, 399, 1);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[1].btn, 'green');
  assert.strictEqual(events[1].code, 399);

  // Yellow and blue
  remotebuttons.handleParsedEvent(1, 400, 1);
  remotebuttons.handleParsedEvent(1, 401, 1);
  assert.strictEqual(events.length, 4);
  assert.strictEqual(events[2].btn, 'yellow');
  assert.strictEqual(events[3].btn, 'blue');
});

test('remotebuttons init and setEnabled lifecycle', function () {
  var cfg = { allowRemoteButtons: false };
  remotebuttons.init({ config: cfg });
  assert.strictEqual(remotebuttons.isEnabled(), false);
  assert.strictEqual(remotebuttons.status().enabled, false);

  remotebuttons.setEnabled(true);
  assert.strictEqual(remotebuttons.isEnabled(), true);
  assert.strictEqual(remotebuttons.status().enabled, true);
  assert.strictEqual(cfg.allowRemoteButtons, true);

  remotebuttons.setEnabled(false);
  assert.strictEqual(remotebuttons.isEnabled(), false);
  assert.strictEqual(remotebuttons.status().enabled, false);
  assert.strictEqual(cfg.allowRemoteButtons, false);
});

test('controls doControl setRemoteButtonsAllowed toggles setting and republishes discovery', function () {
  var config = { allowControl: true, allowRemoteButtons: false };
  var written = null;
  var republishCount = 0;
  var mockRemoteButtons = {
    enabled: false,
    setEnabled: function (v) { this.enabled = v; }
  };

  controls.init({
    config: config,
    remoteButtons: mockRemoteButtons,
    republishDiscovery: function () { republishCount++; },
    writeSettings: function (patch, cb) {
      written = patch;
      cb(null);
    },
    updateSummary: function () {
      return { ok: true, allowRemoteButtons: config.allowRemoteButtons };
    }
  });

  // Enable
  controls.doControl('setRemoteButtonsAllowed', true, function (res) {
    assert.strictEqual(res.ok, true);
    assert.strictEqual(written.allowRemoteButtons, true);
    assert.strictEqual(config.allowRemoteButtons, true);
    assert.strictEqual(mockRemoteButtons.enabled, true);
    assert.strictEqual(republishCount, 1);
  });

  // Disable
  controls.doControl('setRemoteButtonsAllowed', false, function (res) {
    assert.strictEqual(res.ok, true);
    assert.strictEqual(written.allowRemoteButtons, false);
    assert.strictEqual(config.allowRemoteButtons, false);
    assert.strictEqual(mockRemoteButtons.enabled, false);
    assert.strictEqual(republishCount, 2);
  });
});

test('controls doControl setRemoteButtonsAllowed refused when allowControl is false', function () {
  var config = { allowControl: false, allowRemoteButtons: false };
  controls.init({
    config: config
  });

  controls.doControl('setRemoteButtonsAllowed', true, function (res) {
    assert.strictEqual(res.ok, false);
  });
});

test('Home Assistant discovery builds remote_button entity with red/green/yellow/blue events', function () {
  var entities = ha.buildEntities({ pfx: 'lgtv' });
  var remoteBtn = null;
  for (var i = 0; i < entities.length; i++) {
    if (entities[i].id === 'remote_button') {
      remoteBtn = entities[i];
      break;
    }
  }
  assert.ok(remoteBtn, 'remote_button entity should exist in buildEntities');
  assert.strictEqual(remoteBtn.type, 'event');
  assert.strictEqual(remoteBtn.payload.name, 'Remote Button');
  assert.strictEqual(remoteBtn.payload.state_topic, 'lgtv/events/button');
  assert.deepEqual(remoteBtn.payload.event_types, ['red', 'green', 'yellow', 'blue']);
  assert.strictEqual(remoteBtn.payload.icon, 'mdi:remote');
});

test('ha filterWithholds drops remote_button when hasRemoteButtons is false, keeps when true', function () {
  var cleared = [];
  var publishFn = function (topic, payload) {
    cleared.push({ topic: topic, payload: payload });
  };

  var entitiesDisabled = ha.buildEntities({ pfx: 'lgtv' });
  var filteredDisabled = ha.filterWithholds(entitiesDisabled, {
    discPfx: 'homeassistant',
    devId: 'tv',
    publishFn: publishFn,
    capabilities: { hasRemoteButtons: false }
  });
  var hasBtnDisabled = filteredDisabled.some(function (e) { return e.id === 'remote_button'; });
  assert.strictEqual(hasBtnDisabled, false, 'should be withheld when hasRemoteButtons is false');
  var clearedBtn = cleared.some(function (c) {
    return c.topic.indexOf('homeassistant/event/tv/remote_button/config') !== -1 && c.payload === '';
  });
  assert.strictEqual(clearedBtn, true, 'discovery should be cleared with empty payload');

  // When enabled
  cleared = [];
  var entitiesEnabled = ha.buildEntities({ pfx: 'lgtv' });
  var filteredEnabled = ha.filterWithholds(entitiesEnabled, {
    discPfx: 'homeassistant',
    devId: 'tv',
    publishFn: publishFn,
    capabilities: { hasRemoteButtons: true }
  });
  var hasBtnEnabled = filteredEnabled.some(function (e) { return e.id === 'remote_button'; });
  assert.strictEqual(hasBtnEnabled, true, 'should be kept when hasRemoteButtons is true');
});

test('routes updateSummary exposes allowRemoteButtons', function () {
  routes.init({
    config: { allowRemoteButtons: true },
    updater: { updateSummary: function () { return { ok: true }; } },
    privacy: { tvUpdatesBlocked: function () { return false; } },
    devtools: { status: function () { return 'closed'; } }
  });
  var s1 = routes.updateSummary();
  assert.strictEqual(s1.allowRemoteButtons, true);

  routes.init({
    config: { allowRemoteButtons: false },
    updater: { updateSummary: function () { return { ok: true }; } },
    privacy: { tvUpdatesBlocked: function () { return false; } },
    devtools: { status: function () { return 'closed'; } }
  });
  var s2 = routes.updateSummary();
  assert.strictEqual(s2.allowRemoteButtons, false);
});

// Run all tests
var failures = 0;
tests.forEach(function (t) {
  try {
    t[1]();
    console.log('  ✓ ' + t[0]);
  } catch (e) {
    failures++;
    console.log('  ✗ ' + t[0] + '\n      ' + (e.stack || e.message));
  }
});

console.log((tests.length - failures) + ' passed, ' + failures + ' failed');
if (failures > 0) process.exit(1);
