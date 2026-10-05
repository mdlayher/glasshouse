/*
 * Telemetry in the Prometheus text exposition format, version 0.0.4.
 * Strict ES5 for Node 0.12.2 on webOS 4.
 *
 * The names in STABLE are what dashboards and alerts are built on, so one is
 * never renamed or dropped; test-prometheus.js pins them. Labels hold only what
 * rarely changes, since every new label value starts a new series. Every
 * family is declared on every scrape, and one the TV gives no reading for has
 * no sample rather than a made-up 0.
 */

var MEBIBYTE = 1024 * 1024;

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function bool(v) {
  return typeof v === 'boolean' ? (v ? 1 : 0) : null;
}

// A value of 0 that stands for "not known" in the stats, as some OLED readings do.
function positive(v) {
  return num(v) !== null && v > 0 ? v : null;
}

function scaled(v, by) {
  return num(v) === null ? null : v * by;
}

// Divided rather than multiplied by 0.01, which prints 57 as 0.5700000000000001.
function percent(v) {
  return num(v) === null ? null : v / 100;
}

function one(v) {
  return v === null ? [] : [[{}, v]];
}

function path(o, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (o === null || typeof o !== 'object') return undefined;
    o = o[keys[i]];
  }
  return o;
}

// Telemetry reports 0 for every memory and swap figure when /proc/meminfo
// cannot be read, and a TV with no swap has a real 0, so MemTotal tells them
// apart.
function memoryRead(s) {
  return positive(path(s, ['mem', 'total'])) !== null;
}

// The JEDEC eMMC PRE_EOL_INFO states, as telemetry names them.
var EMMC_EOL_STATES = ['Normal', 'Warning', 'Urgent'];

var FAMILIES = [
  {
    name: 'glasshouse_info', type: 'gauge',
    help: 'Always 1, labelled with the TV model, its firmware and webOS versions, and the Glasshouse version.',
    samples: function (s, version) {
      return [[{
        model: path(s, ['device', 'model']),
        firmware: path(s, ['system', 'firmware']),
        webos: path(s, ['system', 'webos']),
        version: version
      }, 1]];
    }
  },
  {
    name: 'glasshouse_boot_time_seconds', type: 'gauge',
    help: 'Time the TV\'s system last booted, in seconds since the Unix epoch.',
    samples: function (s) {
      var t = typeof s.bootTime === 'string' ? Date.parse(s.bootTime) : NaN;
      return one(isNaN(t) ? null : t / 1000);
    }
  },
  {
    name: 'glasshouse_system_on', type: 'gauge',
    help: '1 when the TV is on, including with the screen off; 0 in standby or off.',
    samples: function (s) { return one(bool(path(s, ['powerState', 'systemOn']))); }
  },
  {
    name: 'glasshouse_screen_on', type: 'gauge',
    help: '1 when the screen is on, including a screen saver; 0 otherwise.',
    samples: function (s) { return one(bool(path(s, ['powerState', 'screenOn']))); }
  },
  {
    name: 'glasshouse_soc_temperature_celsius', type: 'gauge',
    help: 'Temperature of the SoC in degrees Celsius, to the nearest degree.',
    samples: function (s) { return one(num(s.temp)); }
  },
  {
    name: 'glasshouse_cpu_utilization_ratio', type: 'gauge',
    help: 'Share of the time the processor was busy, across all its cores, over at least the last 5 seconds, from 0 to 1.',
    samples: function (s) { return one(percent(s.load)); }
  },
  {
    name: 'glasshouse_cpu_core_utilization_max_ratio', type: 'gauge',
    help: 'Share of the time the busiest online core was busy, over the same window, from 0 to 1.',
    samples: function (s) { return one(percent(s.loadPeak)); }
  },
  {
    name: 'glasshouse_cpu_frequency_hertz', type: 'gauge',
    help: 'Processor clock frequency in hertz, as the TV\'s power manager reports it.',
    samples: function (s) { return one(scaled(s.mhz, 1e6)); }
  },
  {
    name: 'glasshouse_gpu_frequency_hertz', type: 'gauge',
    help: 'GPU clock frequency in hertz, to the nearest megahertz.',
    samples: function (s) { return one(scaled(s.gpuMhz, 1e6)); }
  },
  {
    name: 'glasshouse_memory_total_bytes', type: 'gauge',
    help: 'Memory usable by the system in bytes, MemTotal in /proc/meminfo.',
    samples: function (s) { return one(scaled(positive(path(s, ['mem', 'total'])), 1024)); }
  },
  {
    name: 'glasshouse_memory_available_bytes', type: 'gauge',
    help: 'Memory available for new work without swapping in bytes, MemAvailable in /proc/meminfo.',
    samples: function (s) {
      return one(memoryRead(s) ? scaled(path(s, ['mem', 'avail']), 1024) : null);
    }
  },
  {
    name: 'glasshouse_swap_total_bytes', type: 'gauge',
    help: 'Swap space in bytes, SwapTotal in /proc/meminfo.',
    samples: function (s) { return one(memoryRead(s) ? scaled(path(s, ['swap', 'total']), 1024) : null); }
  },
  {
    name: 'glasshouse_swap_free_bytes', type: 'gauge',
    help: 'Unused swap space in bytes, SwapFree in /proc/meminfo.',
    samples: function (s) { return one(memoryRead(s) ? scaled(path(s, ['swap', 'free']), 1024) : null); }
  },
  {
    name: 'glasshouse_network_receive_bytes_total', type: 'counter',
    help: 'Bytes received on the network interface in use, labelled with its name.',
    samples: function (s) {
      var n = s.netTotal;
      return n && num(n.rx) !== null ? [[{ interface: n.iface }, n.rx]] : [];
    }
  },
  {
    name: 'glasshouse_network_transmit_bytes_total', type: 'counter',
    help: 'Bytes sent on the network interface in use, labelled with its name.',
    samples: function (s) {
      var n = s.netTotal;
      return n && num(n.tx) !== null ? [[{ interface: n.iface }, n.tx]] : [];
    }
  },
  {
    name: 'glasshouse_wifi_signal_dbm', type: 'gauge',
    help: 'Wi-Fi signal level in dBm, from /proc/net/wireless.',
    samples: function (s) { return one(num(path(s, ['wifi', 'level']))); }
  },
  {
    name: 'glasshouse_wifi_link_quality', type: 'gauge',
    help: 'Wi-Fi link quality from /proc/net/wireless, on a scale the Wi-Fi driver sets.',
    samples: function (s) { return one(num(path(s, ['wifi', 'link']))); }
  },
  {
    name: 'glasshouse_emmc_pre_eol_state', type: 'gauge',
    help: 'eMMC pre-end-of-life state from its PRE_EOL_INFO register, 1 for the current one: normal, warning (80% of reserved blocks used) or urgent (90%).',
    samples: function (s) {
      var eol = path(s, ['emmc', 'eol']);
      if (EMMC_EOL_STATES.indexOf(eol) === -1) return [];
      return EMMC_EOL_STATES.map(function (st) {
        return [{ state: st.toLowerCase() }, st === eol ? 1 : 0];
      });
    }
  },
  {
    name: 'glasshouse_app_storage_size_bytes', type: 'gauge',
    help: 'Size of the app storage filesystem in bytes, to the nearest MiB.',
    samples: function (s) { return one(scaled(positive(path(s, ['appStorage', 'totalMb'])), MEBIBYTE)); }
  },
  {
    name: 'glasshouse_app_storage_available_bytes', type: 'gauge',
    help: 'Space on the app storage filesystem available for new apps in bytes, to the nearest MiB.',
    samples: function (s) {
      return one(positive(path(s, ['appStorage', 'totalMb'])) === null ? null
        : scaled(path(s, ['appStorage', 'freeMb']), MEBIBYTE));
    }
  },
  {
    name: 'glasshouse_remote_battery_ratio', type: 'gauge',
    help: 'Battery charge of the paired Magic Remote, from 0 to 1.',
    samples: function (s) { return one(percent(path(s, ['remote', 'battery']))); }
  },
  {
    name: 'glasshouse_adblock_enabled', type: 'gauge',
    help: '1 when the ad-blocking hosts table is in place over /etc/hosts, 0 otherwise.',
    samples: function (s) { return one(bool(path(s, ['privacy', 'adblock', 'enabled']))); }
  },
  {
    name: 'glasshouse_oled_panel_usage_seconds_total', type: 'counter',
    help: 'Time the OLED panel has been in use, in seconds, to the nearest 6 minutes.',
    samples: function (s) { return one(scaled(positive(path(s, ['oled', 'panel_hours_exact'])), 3600)); }
  },
  {
    name: 'glasshouse_oled_last_compensation_usage_seconds', type: 'gauge',
    help: 'Panel usage time at the last short compensation cycle, in seconds.',
    samples: function (s) { return one(scaled(positive(path(s, ['oled', 'last_compensation_hours'])), 3600)); }
  },
  {
    name: 'glasshouse_oled_compensation_interval_seconds', type: 'gauge',
    help: 'Panel usage time between short compensation cycles, in seconds.',
    samples: function (s) { return one(scaled(positive(path(s, ['oled', 'comp_interval_hours'])), 3600)); }
  },
  {
    name: 'glasshouse_oled_compensation_running', type: 'gauge',
    help: '1 while a short compensation cycle is running, 0 otherwise.',
    samples: function (s) {
      var st = path(s, ['oled', 'comp_status']);
      return one(typeof st === 'string' ? (st === 'Running' ? 1 : 0) : null);
    }
  },
  {
    name: 'glasshouse_oled_compensation_runs_total', type: 'counter',
    help: 'Short compensation cycles the panel has completed.',
    samples: function (s) { return one(num(path(s, ['oled', 'comp_cycles']))); }
  },
  {
    name: 'glasshouse_oled_last_refresher_usage_seconds', type: 'gauge',
    help: 'Panel usage time at the last Pixel Refresher run, in seconds, to the nearest hour.',
    samples: function (s) { return one(scaled(positive(path(s, ['oled', 'last_refresher_hours'])), 3600)); }
  },
  {
    name: 'glasshouse_oled_refresher_interval_seconds', type: 'gauge',
    help: 'Panel usage time between automatic Pixel Refresher runs, in seconds.',
    samples: function (s) { return one(scaled(positive(path(s, ['oled', 'refresher_interval_hours'])), 3600)); }
  },
  {
    name: 'glasshouse_oled_refresher_runs_total', type: 'counter',
    help: 'Pixel Refresher runs the panel has completed.',
    samples: function (s) { return one(num(path(s, ['oled', 'refresher_cycles']))); }
  },
  {
    name: 'glasshouse_oled_failure_alerts_total', type: 'counter',
    help: 'Panel maintenance failure alerts the TV has recorded.',
    samples: function (s) { return one(num(path(s, ['oled', 'failure_alerts']))); }
  }
];

var STABLE = FAMILIES.map(function (f) { return f.name; });

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

// stats is telemetry's collectStats result; version is Glasshouse's own.
function render(stats, version) {
  var s = stats && typeof stats === 'object' ? stats : {};
  var out = '';
  for (var i = 0; i < FAMILIES.length; i++) {
    var f = FAMILIES[i];
    out += '# HELP ' + f.name + ' ' + f.help + '\n# TYPE ' + f.name + ' ' + f.type + '\n';
    var samples = f.samples(s, version);
    for (var j = 0; j < samples.length; j++) {
      out += f.name + labelSet(samples[j][0]) + ' ' + samples[j][1] + '\n';
    }
  }
  return out;
}

module.exports = { render: render, escapeLabel: escapeLabel, STABLE: STABLE };
