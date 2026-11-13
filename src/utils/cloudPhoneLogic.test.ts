import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapViewportToDeviceCoords,
  validatePackageName,
  validateDevicePath,
  requiresUnicodeBroadcast,
  escapeAdbInputText,
  parseDumpsysBattery,
  evaluateThermalPolicy,
  calculateWatchdogBackoffMs,
} from './cloudPhoneLogic';

test('mapViewportToDeviceCoords maps portrait and landscape coordinates accurately', () => {
  // Portrait 1080x2340, click right in the center of a 360x780 browser canvas
  const centerPortrait = mapViewportToDeviceCoords(180, 390, 360, 780, {
    physicalWidth: 1080,
    physicalHeight: 2340,
    rotation: 0,
  });
  assert.deepEqual(centerPortrait, { x: 540, y: 1170 });

  // Landscape (rotation = 1) -> active resolution is 2340x1080
  const centerLandscape = mapViewportToDeviceCoords(390, 180, 780, 360, {
    physicalWidth: 1080,
    physicalHeight: 2340,
    rotation: 1,
  });
  assert.deepEqual(centerLandscape, { x: 1170, y: 540 });
});

test('validatePackageName allows valid Android packages and blocks command injection', () => {
  assert.equal(validatePackageName('com.termux'), true);
  assert.equal(validatePackageName('com.termux.boot'), true);
  assert.equal(validatePackageName('com.lge.camera'), true);
  assert.equal(validatePackageName('com.termux; rm -rf /'), false);
  assert.equal(validatePackageName('$(reboot)'), false);
  assert.equal(validatePackageName('singleword'), false);
});

test('validateDevicePath restricts access to /sdcard and blocks traversal/injection', () => {
  assert.equal(validateDevicePath('/sdcard/Download/test.apk'), true);
  assert.equal(validateDevicePath('/storage/emulated/0/DCIM/Camera'), true);
  assert.equal(validateDevicePath('/sdcard/../system/build.prop'), false);
  assert.equal(validateDevicePath('/sdcard/file;id'), false);
  assert.equal(validateDevicePath('/etc/passwd'), false);
});

test('requiresUnicodeBroadcast and escapeAdbInputText handle Vietnamese and special characters', () => {
  assert.equal(requiresUnicodeBroadcast('Hello World 123'), false);
  assert.equal(requiresUnicodeBroadcast('Xin chào LG G8X ThinQ'), true);
  assert.equal(escapeAdbInputText('hello world'), 'hello%sworld');
  assert.equal(escapeAdbInputText('a&b;c'), 'a\\&b\\;c');
});

test('parseDumpsysBattery extracts level, temperature in Celsius, and AC power status', () => {
  const sampleDumpsys = `
Current Battery Service state:
  AC powered: true
  USB powered: false
  Wireless powered: false
  status: 2
  health: 2
  present: true
  level: 82
  scale: 100
  voltage: 4192
  temperature: 378
  technology: Li-ion
  `;
  const parsed = parseDumpsysBattery(sampleDumpsys);
  assert.equal(parsed.level, 82);
  assert.equal(parsed.temperatureC, 37.8);
  assert.equal(parsed.voltageMv, 4192);
  assert.equal(parsed.plugged, 'AC');
  assert.equal(parsed.status, 'Charging');
});

test('evaluateThermalPolicy throttles at 42C and pauses stream at 45C', () => {
  const normal = evaluateThermalPolicy(36.5, 6);
  assert.equal(normal.state, 'normal');
  assert.equal(normal.effectiveFps, 6);
  assert.equal(normal.streamPaused, false);

  const throttled = evaluateThermalPolicy(42.5, 6);
  assert.equal(throttled.state, 'throttled');
  assert.equal(throttled.effectiveFps, 2);
  assert.equal(throttled.streamPaused, false);

  const critical = evaluateThermalPolicy(45.2, 6);
  assert.equal(critical.state, 'critical_paused');
  assert.equal(critical.effectiveFps, 0);
  assert.equal(critical.streamPaused, true);
});

test('calculateWatchdogBackoffMs increases exponentially and caps at maxMs', () => {
  assert.equal(calculateWatchdogBackoffMs(1, 5000, 60000), 5000);
  assert.equal(calculateWatchdogBackoffMs(2, 5000, 60000), 10000);
  assert.equal(calculateWatchdogBackoffMs(3, 5000, 60000), 20000);
  assert.equal(calculateWatchdogBackoffMs(10, 5000, 60000), 60000);
});
