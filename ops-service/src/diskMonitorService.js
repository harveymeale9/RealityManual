'use strict';

const fs = require('fs');

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 100000); }
function bytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let number = Number(value || 0);
  let index = 0;
  while (number >= 1024 && index < units.length - 1) { number /= 1024; index++; }
  return number.toFixed(index < 2 ? 0 : 1).replace(/\.0$/, '') + ' ' + units[index];
}

function measureFilesystem(target) {
  const stats = fs.statfsSync(target || '/');
  const blockSize = Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * blockSize;
  const availableBytes = Number(stats.bavail) * blockSize;
  const usedBytes = (Number(stats.blocks) - Number(stats.bfree)) * blockSize;
  const usableBytes = usedBytes + availableBytes;
  return {
    path: target || '/', totalBytes: totalBytes, usedBytes: usedBytes,
    availableBytes: availableBytes,
    percentUsed: usableBytes ? Math.round((usedBytes / usableBytes) * 1000) / 10 : 0
  };
}

function levelFor(percent, warningPercent, criticalPercent) {
  if (percent >= criticalPercent) return 'critical';
  if (percent >= warningPercent) return 'warning';
  return 'normal';
}

function setup(db, options) {
  options = options || {};
  const recipient = clean(options.recipient || 'harveymeale9@gmail.com', 500);
  const warningPercent = Number(options.warningPercent) || 80;
  const criticalPercent = Number(options.criticalPercent) || 90;
  const intervalMs = Number(options.intervalMs) || 60 * 60 * 1000;
  const target = options.target || '/';
  const measure = options.measure || function () { return measureFilesystem(target); };
  const sendMail = options.sendMail;
  const enabled = options.enabled !== false && !!recipient && typeof sendMail === 'function';

  db.exec(`CREATE TABLE IF NOT EXISTS disk_monitor_state (
    id INTEGER PRIMARY KEY CHECK(id=1), level TEXT NOT NULL DEFAULT 'normal',
    percent_used REAL, used_bytes INTEGER, available_bytes INTEGER,
    total_bytes INTEGER, last_checked_at TEXT, last_alert_at TEXT,
    last_error TEXT
  )`);
  db.prepare("INSERT OR IGNORE INTO disk_monitor_state(id,level) VALUES(1,'normal')").run();

  function buildEmail(metrics, level) {
    const urgent = level === 'critical';
    const subject = (urgent ? 'URGENT: ' : '') + 'Reality Manual VPS disk usage is at ' + metrics.percentUsed.toFixed(1).replace(/\.0$/, '') + '%';
    const summary = 'The VPS is using ' + bytes(metrics.usedBytes) + ' with ' + bytes(metrics.availableBytes) + ' available (' + metrics.percentUsed.toFixed(1).replace(/\.0$/, '') + '% used).';
    const action = urgent
      ? 'Disk capacity is critically low. Review and clear unused Docker images/build cache as soon as possible.'
      : 'This has crossed the automatic warning threshold. Docker images and build cache were the main source in the latest storage audit; review them before the server reaches the critical threshold.';
    return {
      subject: subject,
      textBody: 'REALITY MANUAL VPS DISK ALERT\n\n' + summary + '\n\n' + action + '\n\nWarning threshold: ' + warningPercent + '%\nCritical threshold: ' + criticalPercent + '%',
      htmlBody: '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172019"><h1>VPS disk ' + (urgent ? 'critical' : 'warning') + '</h1><p><strong>' + summary + '</strong></p><p>' + action + '</p><p style="color:#67736a">Warning threshold: ' + warningPercent + '% · Critical threshold: ' + criticalPercent + '%</p></body></html>'
    };
  }

  async function check() {
    const stamp = new Date().toISOString();
    try {
      const metrics = measure();
      const nextLevel = levelFor(Number(metrics.percentUsed), warningPercent, criticalPercent);
      const previous = db.prepare('SELECT * FROM disk_monitor_state WHERE id=1').get();
      let alerted = false;
      let alertAt = previous.last_alert_at;
      // Notify once when crossing into warning and once more if it escalates
      // to critical. Staying at the same level never creates repeat mail.
      if (enabled && nextLevel !== 'normal' && nextLevel !== previous.level) {
        const email = buildEmail(metrics, nextLevel);
        await sendMail({ to: [recipient], cc: [], subject: email.subject, textBody: email.textBody, htmlBody: email.htmlBody });
        alerted = true;
        alertAt = stamp;
      }
      db.prepare(`UPDATE disk_monitor_state SET level=?,percent_used=?,used_bytes=?,available_bytes=?,
        total_bytes=?,last_checked_at=?,last_alert_at=?,last_error=NULL WHERE id=1`)
        .run(nextLevel, metrics.percentUsed, metrics.usedBytes, metrics.availableBytes, metrics.totalBytes, stamp, alertAt);
      return { enabled: enabled, level: nextLevel, alerted: alerted, recipient: recipient, metrics: metrics, checkedAt: stamp };
    } catch (error) {
      db.prepare('UPDATE disk_monitor_state SET last_checked_at=?,last_error=? WHERE id=1')
        .run(stamp, clean(error.message, 1000));
      throw error;
    }
  }

  function status() {
    return {
      enabled: enabled, recipient: recipient, warningPercent: warningPercent,
      criticalPercent: criticalPercent,
      state: db.prepare('SELECT * FROM disk_monitor_state WHERE id=1').get()
    };
  }

  let timer = null;
  if (enabled && options.autoStart !== false) {
    setImmediate(function () { check().catch(function (error) { console.error('[disk-monitor] check failed:', error.message); }); });
    timer = setInterval(function () { check().catch(function (error) { console.error('[disk-monitor] check failed:', error.message); }); }, intervalMs);
    if (timer.unref) timer.unref();
  }

  return { enabled: enabled, check: check, status: status, buildEmail: buildEmail, close: function () { if (timer) clearInterval(timer); } };
}

module.exports = { setup: setup, measureFilesystem: measureFilesystem, levelFor: levelFor };
