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

// /proc/stat counts in USER_HZ ticks, which is 100 on every Linux the TVs run.
var USER_HZ = 100;
// LG's panel counters step in 10-minute units.
var PANEL_UNIT_SECONDS = 600;
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

// The precise reading where telemetry gives one, otherwise the rounded one,
// from an older server or a capture made before it had the precise field.
function prefer(precise, rounded) {
  return precise !== null ? precise : rounded;
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

/*
 * The picture settings' dynamic range, with the ALLM suffix (low latency)
 * read off separately. The settings service accepts these four, each with or
 * without ALLM, and nothing else: /etc/palm/description.json on a CX (webOS 5)
 * and a C4 (webOS 9) declares the same eight.
 */
var DYNAMIC_RANGES = {
  sdr: 'sdr',
  hdr: 'hdr',
  dolbyHdr: 'dolby_vision',
  technicolorHdr: 'technicolor'
};

/*
 * A picture mode is the range's prefix (none, hdr, dolbyHdr) and a base mode;
 * the label is the base, since the range has its own. LG's display names are
 * no use as labels: they differ by webOS version (dolbyHdrCinema is "Cinema"
 * on webOS 5, "FILMMAKER MODE" on webOS 9) and by region. hdrExternal and
 * dolbyHdrDarkAmazon appear only in LG's name tables, named as Standard and
 * Cinema Home. hdrEffect is an SDR mode.
 */
var PICTURE_MODES = {
  personalized: 'personalized', hdrPersonalized: 'personalized', dolbyHdrPersonalized: 'personalized',
  vivid: 'vivid', hdrVivid: 'vivid', dolbyHdrVivid: 'vivid',
  normal: 'standard', hdrStandard: 'standard', dolbyHdrStandard: 'standard', hdrExternal: 'standard',
  eco: 'eco', hdrEco: 'eco',
  cinema: 'cinema', hdrCinema: 'cinema', dolbyHdrCinema: 'cinema',
  hdrCinemaBright: 'cinema_bright', dolbyHdrCinemaBright: 'cinema_bright', dolbyHdrDarkAmazon: 'cinema_bright',
  sports: 'sports',
  game: 'game', hdrGame: 'game', dolbyHdrGame: 'game',
  photo: 'photo',
  filmMaker: 'filmmaker', hdrFilmMaker: 'filmmaker',
  expert1: 'expert_bright', expert2: 'expert_dark',
  hdrEffect: 'hdr_effect'
};

function snakeCase(v) {
  return v.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// A value outside the table keeps its own name rather than being dropped.
function mapped(table, v) {
  return table.hasOwnProperty(v) ? table[v] : snakeCase(v);
}

function dynamicRange(s) {
  var raw = path(s, ['picture', 'dynamicRange_raw']);
  if (typeof raw !== 'string' || !raw) return null;
  var lowLatency = /ALLM$/.test(raw);
  return { range: mapped(DYNAMIC_RANGES, lowLatency ? raw.slice(0, -4) : raw), lowLatency: lowLatency };
}

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
      return one(prefer(positive(s.btime), isNaN(t) ? null : t / 1000));
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
    help: 'Temperature of the SoC in degrees Celsius.',
    samples: function (s) { return one(prefer(positive(s.tempMillidegrees) === null ? null : s.tempMillidegrees / 1000, num(s.temp))); }
  },
  {
    name: 'glasshouse_cpu_seconds_total', type: 'counter',
    help: 'Time each online core has spent in each mode since boot, in seconds, from /proc/stat.',
    samples: function (s) {
      var out = [], cpus = s.cpuTimes;
      if (!cpus || typeof cpus !== 'object') return out;
      Object.keys(cpus).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (cpu) {
        for (var mode in cpus[cpu]) {
          if (num(cpus[cpu][mode]) !== null) out.push([{ cpu: cpu, mode: mode }, cpus[cpu][mode] / USER_HZ]);
        }
      });
      return out;
    }
  },
  {
    name: 'glasshouse_cpu_frequency_hertz', type: 'gauge',
    help: 'Processor clock frequency in hertz, as the TV\'s power manager reports it.',
    samples: function (s) { return one(prefer(positive(s.cpuHz), scaled(s.mhz, 1e6))); }
  },
  {
    name: 'glasshouse_gpu_frequency_hertz', type: 'gauge',
    help: 'GPU clock frequency in hertz.',
    samples: function (s) { return one(prefer(positive(s.gpuHz), scaled(s.gpuMhz, 1e6))); }
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
    name: 'glasshouse_emmc_life_used_ratio', type: 'gauge',
    help: 'Share of the eMMC\'s estimated life used, from its DEVICE_LIFE_TIME_EST registers, in steps of 0.1: 0 for under a tenth, 1 for all of it or more. type is a or b, the two kinds of memory the card estimates for.',
    samples: function (s) {
      var out = [];
      ['a', 'b'].forEach(function (t) {
        var v = num(path(s, ['emmc', 'life_est_' + t]));
        if (v !== null && v >= 1 && v <= 11) out.push([{ type: t }, (v - 1) / 10]);
      });
      return out;
    }
  },
  {
    name: 'glasshouse_app_storage_size_bytes', type: 'gauge',
    help: 'Size of the app storage filesystem in bytes.',
    samples: function (s) {
      return one(prefer(scaled(positive(path(s, ['appStorage', 'totalKb'])), 1024),
        scaled(positive(path(s, ['appStorage', 'totalMb'])), MEBIBYTE)));
    }
  },
  {
    name: 'glasshouse_app_storage_available_bytes', type: 'gauge',
    help: 'Space on the app storage filesystem available for new apps in bytes.',
    samples: function (s) {
      if (positive(path(s, ['appStorage', 'totalKb'])) !== null) return one(scaled(path(s, ['appStorage', 'availKb']), 1024));
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
    help: 'Time the OLED panel has been in use, in seconds, counted in steps of 10 minutes.',
    samples: function (s) {
      return one(prefer(scaled(positive(path(s, ['oled', 'panel_usage_units'])), PANEL_UNIT_SECONDS),
        scaled(positive(path(s, ['oled', 'panel_hours_exact'])), 3600)));
    }
  },
  {
    name: 'glasshouse_oled_last_compensation_usage_seconds', type: 'gauge',
    help: 'Panel usage time at the last short compensation cycle, in seconds.',
    samples: function (s) {
      return one(prefer(scaled(positive(path(s, ['oled', 'last_compensation_units'])), PANEL_UNIT_SECONDS),
        scaled(positive(path(s, ['oled', 'last_compensation_hours'])), 3600)));
    }
  },
  {
    name: 'glasshouse_oled_compensation_interval_seconds', type: 'gauge',
    help: 'Panel usage time between short compensation cycles, in seconds.',
    samples: function (s) {
      // oled.js puts an interval outside 0.5 to 24 hours back to 4 hours and
      // leaves the units as read, so the units count only where they agree.
      var units = positive(path(s, ['oled', 'comp_interval_units']));
      var hours = positive(path(s, ['oled', 'comp_interval_hours']));
      if (units !== null && hours !== null && Math.abs(units / 6 - hours) < 0.1) return one(units * PANEL_UNIT_SECONDS);
      return one(scaled(hours, 3600));
    }
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
  },
  {
    name: 'glasshouse_oled_gsr_stress_events_total', type: 'counter',
    help: 'Stress events Global Stress Reduction has counted on the panel, as the TV\'s panel service reports them.',
    samples: function (s) { return one(num(path(s, ['oled', 'gsr_stress_count']))); }
  },
  {
    name: 'glasshouse_oled_protection_enabled', type: 'gauge',
    help: '1 when the panel protection is on, 0 when off: asbl is the Automatic Static Brightness Limiter, gsr Global Stress Reduction.',
    samples: function (s) {
      var out = [];
      [['asbl', 'tpc_enabled'], ['gsr', 'gsr_enabled']].forEach(function (p) {
        var v = bool(path(s, ['oled', p[1]]));
        if (v !== null) out.push([{ protection: p[0] }, v]);
      });
      return out;
    }
  },
  {
    name: 'glasshouse_signal_info', type: 'gauge',
    help: 'Always 1, labelled with the dynamic range (sdr, hdr, dolby_vision, technicolor) and the picture mode the picture settings are using.',
    samples: function (s) {
      var dr = dynamicRange(s);
      var mode = path(s, ['picture', 'mode_raw']);
      var labels = {
        dynamic_range: dr ? dr.range : '',
        picture_mode: typeof mode === 'string' && mode ? mapped(PICTURE_MODES, mode) : ''
      };
      return labels.dynamic_range || labels.picture_mode ? [[labels, 1]] : [];
    }
  },
  {
    name: 'glasshouse_signal_low_latency', type: 'gauge',
    help: '1 while the picture settings are in low-latency mode (ALLM), 0 otherwise.',
    samples: function (s) {
      var dr = dynamicRange(s);
      return one(dr ? (dr.lowLatency ? 1 : 0) : null);
    }
  },
  {
    name: 'glasshouse_signal_width_pixels', type: 'gauge',
    help: 'Width of the HDMI source\'s picture in pixels.',
    samples: function (s) { return one(positive(path(s, ['signal_timing', 'width']))); }
  },
  {
    name: 'glasshouse_signal_height_pixels', type: 'gauge',
    help: 'Height of the HDMI source\'s picture in pixels.',
    samples: function (s) { return one(positive(path(s, ['signal_timing', 'height']))); }
  },
  {
    name: 'glasshouse_signal_refresh_hertz', type: 'gauge',
    help: 'Refresh rate of the HDMI signal in hertz, as the source sends it rather than the content\'s frame rate.',
    samples: function (s) { return one(positive(path(s, ['signal_timing', 'refresh_hz']))); }
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
