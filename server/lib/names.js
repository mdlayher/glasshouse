/*
 * names.js - The names of the raw values the TV reports, each in two forms
 * from the one raw value: display, as the API, the dashboards and Home
 * Assistant show it, and label, as Prometheus labels it.
 *
 * Strict ES5 for Node 0.12.2 on webOS 4.
 */

function snakeCase(v) {
  return v.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// A label outside the table keeps its own name rather than being dropped.
function mapped(table, v) {
  return table.hasOwnProperty(v) ? table[v] : snakeCase(v);
}

// A value outside the table is shown as the TV gave it.
function named(table, raw) {
  return table.hasOwnProperty(raw) ? table[raw] : { display: raw, label: snakeCase(raw) };
}

// The HDMI receiver's names for the chroma format and the HDCP version in use.
var HDMI_CHROMA = {
  R444: { display: 'RGB 4:4:4', label: 'rgb_444' },
  Y444: { display: 'YCbCr 4:4:4', label: 'ycbcr_444' },
  Y422: { display: 'YCbCr 4:2:2', label: 'ycbcr_422' },
  Y420: { display: 'YCbCr 4:2:0', label: 'ycbcr_420' }
};
var HDMI_HDCP = {
  HDCP23: { display: 'HDCP 2.3', label: '2_3' },
  HDCP22: { display: 'HDCP 2.2', label: '2_2' },
  HDCP14: { display: 'HDCP 1.4', label: '1_4' },
  HDCP0: { display: 'None', label: 'none' }
};

/*
 * The receiver's PHY mode, such as "FRL 12G 4L(R6)" or "6G", and the link's
 * rate. FRL runs at its lane rate on every lane, "FRL 12G 4L" being 48 Gbps.
 * TMDS's "3G" and "6G" are ceilings rather than rates: the rate is the
 * character clock, ten bits a character, on the three data channels. A mode
 * named neither way is other, with no rate.
 */
function hdmiPhyMode(raw, tmdsClockKhz) {
  var mode = String(raw || '');
  var frl = mode.match(/^FRL\s+(\d+)G\s+(\d+)L\b/i);
  if (frl) {
    var gbps = parseInt(frl[1], 10) * parseInt(frl[2], 10);
    return { display: 'FRL ' + gbps + ' Gbps', label: 'frl_' + gbps, bitsPerSecond: gbps * 1e9 };
  }
  var tmds = mode.match(/^(?:TMDS\s*)?([36])G$/i);
  if (tmds) {
    var clock = typeof tmdsClockKhz === 'number' && isFinite(tmdsClockKhz) && tmdsClockKhz > 0 ? tmdsClockKhz : null;
    return {
      display: 'TMDS (' + tmds[1] + 'G)',
      label: 'tmds_' + tmds[1] + 'g',
      bitsPerSecond: clock === null ? null : clock * 1000 * 10 * 3
    };
  }
  return { display: mode, label: 'other', bitsPerSecond: null };
}

function hdmiChroma(raw) {
  return named(HDMI_CHROMA, raw);
}

function hdmiHdcp(raw) {
  return named(HDMI_HDCP, raw);
}

module.exports = {
  snakeCase: snakeCase,
  mapped: mapped,
  hdmiPhyMode: hdmiPhyMode,
  hdmiChroma: hdmiChroma,
  hdmiHdcp: hdmiHdcp
};
