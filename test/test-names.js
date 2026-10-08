/**
 * test/test-names.js - Each raw value the TV reports has its display name and
 * its Prometheus label from the one table
 *
 * Strict ES5: runs on node 0.12.
 */
var assert = require('assert');
var names = require('../server/lib/names');

console.log('Running test-names.js ...');

function phy(raw, clock) {
  var m = names.hdmiPhyMode(raw, clock);
  return [m.display, m.label, m.bitsPerSecond];
}

assert.deepEqual(phy('FRL 12G 4L(R6)', null), ['FRL 48 Gbps', 'frl_48', 48e9]);
assert.deepEqual(phy('FRL 10G 4L', null), ['FRL 40 Gbps', 'frl_40', 40e9]);
assert.deepEqual(phy('FRL 8G 4L', null), ['FRL 32 Gbps', 'frl_32', 32e9]);
assert.deepEqual(phy('FRL 6G 4L', null), ['FRL 24 Gbps', 'frl_24', 24e9]);
assert.deepEqual(phy('FRL 6G 3L', null), ['FRL 18 Gbps', 'frl_18', 18e9]);
assert.deepEqual(phy('FRL 3G 3L', null), ['FRL 9 Gbps', 'frl_9', 9e9]);
console.log('  ✓ FRL is the lane rate times the lanes');

assert.deepEqual(phy('6G', 594000), ['TMDS (6G)', 'tmds_6g', 594000 * 1000 * 10 * 3]);
assert.deepEqual(phy('3G', 148500), ['TMDS (3G)', 'tmds_3g', 148500 * 1000 * 10 * 3]);
assert.deepEqual(phy('6G', null), ['TMDS (6G)', 'tmds_6g', null]);
assert.deepEqual(phy('3G', 0), ['TMDS (3G)', 'tmds_3g', null]);
console.log('  ✓ TMDS is the character clock on three channels, with no rate without a clock');

assert.deepEqual(phy('FRL CTS', null), ['FRL CTS', 'other', null]);
console.log('  ✓ an unknown PHY mode is shown as given and labelled other');

function both(m) { return [m.display, m.label]; }

assert.deepEqual(both(names.hdmiChroma('R444')), ['RGB 4:4:4', 'rgb_444']);
assert.deepEqual(both(names.hdmiChroma('Y444')), ['YCbCr 4:4:4', 'ycbcr_444']);
assert.deepEqual(both(names.hdmiChroma('Y422')), ['YCbCr 4:2:2', 'ycbcr_422']);
assert.deepEqual(both(names.hdmiChroma('Y420')), ['YCbCr 4:2:0', 'ycbcr_420']);
assert.deepEqual(both(names.hdmiChroma('Y440')), ['Y440', 'y440']);
console.log('  ✓ chroma, and an unknown one shown as given');

assert.deepEqual(both(names.hdmiHdcp('HDCP23')), ['HDCP 2.3', '2_3']);
assert.deepEqual(both(names.hdmiHdcp('HDCP22')), ['HDCP 2.2', '2_2']);
assert.deepEqual(both(names.hdmiHdcp('HDCP14')), ['HDCP 1.4', '1_4']);
assert.deepEqual(both(names.hdmiHdcp('HDCP0')), ['None', 'none']);
assert.deepEqual(both(names.hdmiHdcp('HDCP2X')), ['HDCP2X', 'hdcp2_x']);
console.log('  ✓ HDCP, and an unknown version shown as given');
