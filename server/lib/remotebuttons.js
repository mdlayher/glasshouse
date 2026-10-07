/**
 * remotebuttons.js - Remote control button event listener for webOS
 *
 * Reads Linux evdev streams on webOS remote input devices (/dev/input/event*)
 * to detect red, green, yellow, and blue button presses on LG Magic and IR remotes.
 *
 * Strict ES5 for Node 0.12.2 on webOS 4.
 */

var fs = require('fs');

// Linux EV_KEY event type and button keycodes
var EV_KEY = 1;
var KEY_PRESS = 1;

var BUTTON_CODES = {
  398: 'red',
  399: 'green',
  400: 'yellow',
  401: 'blue'
};

var configObj = null;
var onButtonFn = null;
var activeStreams = [];
var activeDevices = [];
var lastPressTime = {};
var DEBOUNCE_MS = 200;

function findRcuDevices() {
  var found = [];
  try {
    if (fs.existsSync('/proc/bus/input/devices')) {
      var content = fs.readFileSync('/proc/bus/input/devices', 'utf8');
      var blocks = content.split('\n\n');
      for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b];
        var nameMatch = /Name="([^"]+)"/.exec(block);
        var name = nameMatch ? nameMatch[1] : '';
        if (/LGE RCU|LGE M-RCU|Smart Remote RCU Input|LGE Simple Premium/i.test(name)) {
          var handlerMatch = /Handlers=[^\n]*?(event\d+)/.exec(block);
          if (handlerMatch && handlerMatch[1]) {
            var dev = '/dev/input/' + handlerMatch[1];
            if (found.indexOf(dev) === -1) {
              found.push(dev);
            }
          }
        }
      }
    }
  } catch (e) {}

  if (!found.length) {
    if (fs.existsSync('/dev/input/event1')) found.push('/dev/input/event1');
    if (fs.existsSync('/dev/input/event2')) found.push('/dev/input/event2');
  }

  return found;
}

function stop() {
  for (var i = 0; i < activeStreams.length; i++) {
    try {
      if (activeStreams[i].destroy) activeStreams[i].destroy();
      else if (activeStreams[i].close) activeStreams[i].close();
    } catch (e) {}
  }
  activeStreams = [];
  activeDevices = [];
}

function handleParsedEvent(type, code, val) {
  if (type !== EV_KEY || val !== KEY_PRESS) return;
  var color = BUTTON_CODES[code];
  if (!color) return;

  var now = Date.now();
  if (lastPressTime[color] && (now - lastPressTime[color] < DEBOUNCE_MS)) {
    return;
  }
  lastPressTime[color] = now;

  if (onButtonFn) {
    onButtonFn(color, code);
  }
}

function createDeviceStream(devPath) {
  var stream;
  try {
    stream = fs.createReadStream(devPath, { flags: 'r' });
  } catch (e) {
    return null;
  }

  var remainder = null;
  // 16 bytes for 32-bit (timeval=8, type=2, code=2, value=4)
  // 24 bytes for 64-bit (timeval=16, type=2, code=2, value=4)
  var evSize = (process.arch === 'arm64' || process.arch === 'x64') ? 24 : 16;
  var typeOff = (evSize === 24) ? 16 : 8;
  var codeOff = (evSize === 24) ? 18 : 10;
  var valOff = (evSize === 24) ? 20 : 12;

  stream.on('data', function (chunk) {
    if (!chunk || !Buffer.isBuffer(chunk)) return;
    var buf = chunk;
    if (remainder && remainder.length) {
      buf = Buffer.concat ? Buffer.concat([remainder, buf]) : buf;
      remainder = null;
    }

    var i = 0;
    while (i + evSize <= buf.length) {
      var type = buf.readUInt16LE(i + typeOff);
      var code = buf.readUInt16LE(i + codeOff);
      var val = buf.readInt32LE(i + valOff);
      handleParsedEvent(type, code, val);
      i += evSize;
    }

    if (i < buf.length) {
      remainder = buf.slice(i);
    }
  });

  stream.on('error', function (err) {
    // Input device disconnects or access errors are handled gracefully
  });

  stream.on('end', function () {
    var idx = activeStreams.indexOf(stream);
    if (idx !== -1) activeStreams.splice(idx, 1);
  });

  return stream;
}

function start() {
  stop();
  var devs = findRcuDevices();
  for (var i = 0; i < devs.length; i++) {
    var s = createDeviceStream(devs[i]);
    if (s) {
      activeStreams.push(s);
      activeDevices.push(devs[i]);
    }
  }
  if (activeDevices.length) {
    console.log('remotebuttons: listening for colored button events on ' + activeDevices.join(', '));
  }
}

function init(opts) {
  opts = opts || {};
  configObj = opts.config;
  onButtonFn = opts.onButton;

  if (configObj && configObj.allowRemoteButtons) {
    start();
  }
}

function setEnabled(enabled) {
  enabled = !!enabled;
  if (configObj) configObj.allowRemoteButtons = enabled;
  if (enabled) {
    start();
  } else {
    stop();
    console.log('remotebuttons: stopped listening for button events');
  }
}

function isEnabled() {
  return !!(configObj && configObj.allowRemoteButtons);
}

function status() {
  return {
    enabled: isEnabled(),
    devices: activeDevices.slice()
  };
}

module.exports = {
  BUTTON_CODES: BUTTON_CODES,
  findRcuDevices: findRcuDevices,
  handleParsedEvent: handleParsedEvent,
  init: init,
  start: start,
  stop: stop,
  setEnabled: setEnabled,
  isEnabled: isEnabled,
  status: status
};
