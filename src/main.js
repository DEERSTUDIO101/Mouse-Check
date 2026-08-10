const { invoke } = window.__TAURI__.core;

const KNOWN = {
  0x006e:'DeathAdder Essential',0x0071:'DeathAdder Essential White Ed.',0x0098:'DeathAdder Essential (2021)',
  0x0078:'Viper',0x007a:'Viper Ultimate (Wired)',0x007b:'Viper Ultimate',
  0x007c:'DeathAdder V2 Pro (Wired)',0x007d:'DeathAdder V2 Pro',
  0x0084:'DeathAdder V2',0x0085:'Basilisk V2',0x008a:'Viper Mini',
  0x0091:'Viper 8KHz',0x0096:'Naga X',0x0099:'Basilisk V3',
  0x00a5:'Viper V2 Pro (Wired)',0x00a6:'Viper V2 Pro',
  0x00b2:'DeathAdder V3',0x00b6:'DeathAdder V3 Pro (Wired)',0x00b7:'DeathAdder V3 Pro',
  0x00b8:'Viper V3 HyperSpeed',0x00b9:'Basilisk V3 X HyperSpeed',
  0x00be:'DeathAdder V4 Pro (Wired)',0x00bf:'DeathAdder V4 Pro',
  0x00c0:'Viper V3 Pro (Wired)',0x00c1:'Viper V3 Pro',
  0x00e5:'Viper V4 Pro (Wired)',0x00e6:'Viper V4 Pro',
};
const HP_KNOWN = { 0x1402:'HyperPolling Receiver' };
const TX_NAMES = { 0xff:'0xFF', 0x3f:'0x3F', 0x1f:'0x1F' };

const WEBID_META = {
  likely:      { label:'WebHID compatible',             cls:'webid-likely',   icon:'🟢' },
  workaround:  { label:'WebHID — workaround needed',    cls:'webid-workaround',icon:'🟡' },
  native_only: { label:'Native HID only — WebHID blocked', cls:'webid-native',icon:'🔴' },
  unknown:     { label:'WebHID status unknown',         cls:'webid-unknown',  icon:'⚪' },
  not_razer:   { label:'Non-Razer — protocol test N/A', cls:'webid-unknown',  icon:'ℹ️' },
};

let devices = [];
let selected = null;
let deviceGroups = new Map();

function hex(n, pad=4) { return '0x' + n.toString(16).padStart(pad,'0').toUpperCase(); }
function hexPlain(n, pad=4) { return n.toString(16).padStart(pad,'0').toUpperCase(); }

async function scan() {
  const list = document.getElementById('device-list');
  list.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div>Scanning…</div>';
  document.getElementById('detail-wrap').hidden = true;
  document.getElementById('iface-section').hidden = true;
  document.getElementById('copy-section').classList.remove('visible');
  selected = null; deviceGroups = new Map();

  try {
    devices = await invoke('list_devices');

    // Group by VID+PID, keep all interfaces per group
    for (const d of devices) {
      const key = `${d.vendor_id}:${d.product_id}`;
      if (!deviceGroups.has(key)) deviceGroups.set(key, []);
      deviceGroups.get(key).push(d);
    }

    if (!deviceGroups.size) {
      list.innerHTML = '<div class="empty"><div class="empty-icon">🔌</div>No supported devices found.<br>Make sure the mouse is connected.</div>';
      return;
    }

    list.innerHTML = '';
    for (const [key, ifaces] of deviceGroups) {
      const d = ifaces[0];
      const isHP = d.vendor_id === 0x31E3;
      const isRazer = d.vendor_id === 0x1532;
      const name = getDeviceName(d);
      const inDriver = isRazer && KNOWN[d.product_id] != null;

      const dotCls = isHP ? 'dot-hp' : isRazer ? 'dot-razer' : 'dot-other';
      const vendorBadge = isHP
        ? `<span class="badge badge-hp">⚡ HyperPolling</span>`
        : isRazer
          ? `<span class="badge badge-razer">✓ Razer</span>`
          : `<span class="badge badge-other">${d.brand}</span>`;
      const driverBadge = isRazer
        ? (inDriver ? `<span class="badge badge-known">in driver</span>` : `<span class="badge badge-missing">not in driver</span>`)
        : '';

      // Show first hardware ID
      const hwId = d.hardware_id || `VID_${hexPlain(d.vendor_id)}&PID_${hexPlain(d.product_id)}`;

      const card = document.createElement('div');
      card.className = 'device-card';
      card.innerHTML = `
        <div class="device-card-inner">
          <div class="device-dot ${dotCls}"></div>
          <div class="device-card-info">
            <div class="device-card-name">${name}</div>
            <div class="device-card-hwid">${hwId}</div>
          </div>
          <div class="device-card-badges">${vendorBadge}${driverBadge}</div>
        </div>`;
      card.onclick = () => selectDevice(key, card);
      list.appendChild(card);
    }
  } catch (e) {
    list.innerHTML = `<div class="empty" style="color:var(--fail-text)"><div class="empty-icon">⚠️</div>${e}</div>`;
  }
}

function getDeviceName(d) {
  const isHP = d.vendor_id === 0x31E3;
  const isRazer = d.vendor_id === 0x1532;
  return d.product ||
    (isHP ? (HP_KNOWN[d.product_id] ?? 'HyperPolling Device') :
     isRazer ? (KNOWN[d.product_id] ?? 'Unknown Razer Device') :
     `${d.brand} Device`);
}

function selectDevice(key, cardEl) {
  document.querySelectorAll('.device-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');

  const ifaces = deviceGroups.get(key);
  const d = ifaces[0];
  const isHP = d.vendor_id === 0x31E3;
  const isRazer = d.vendor_id === 0x1532;
  const name = getDeviceName(d);
  const inDriver = isRazer && KNOWN[d.product_id] != null;

  selected = { vid: d.vendor_id, pid: d.product_id, name, razerTestable: d.razer_testable };

  // Header
  document.getElementById('detail-name').textContent = name;
  document.getElementById('detail-meta').textContent =
    `${d.manufacturer ? d.manufacturer + ' · ' : ''}VID_${hexPlain(d.vendor_id)} · PID_${hexPlain(d.product_id)}`;

  // Badges
  const badgesEl = document.getElementById('detail-badges');
  const vendorBadge = isHP
    ? `<span class="badge badge-hp">⚡ HyperPolling</span>`
    : isRazer ? `<span class="badge badge-razer">✓ Razer</span>`
    : `<span class="badge badge-other">${d.brand}</span>`;
  const driverBadge = isRazer
    ? (inDriver ? `<span class="badge badge-known">✓ in driver</span>` : `<span class="badge badge-missing">⚠ not in driver yet</span>`)
    : '';
  badgesEl.innerHTML = vendorBadge + driverBadge;

  // Hardware info table
  const hwTable = document.getElementById('hw-table');
  const rows = [
    ['Vendor ID',    `VID_${hexPlain(d.vendor_id)} (${hex(d.vendor_id)})`],
    ['Product ID',   `PID_${hexPlain(d.product_id)} (${hex(d.product_id)})`],
    ['Manufacturer', d.manufacturer || '—'],
    ['Brand',        d.brand],
    ['Interfaces',   `${ifaces.length} detected`],
  ];
  // Show all hardware IDs
  const uniqueHwIds = [...new Set(ifaces.map(i => i.hardware_id))];
  uniqueHwIds.forEach((hwid, idx) => {
    rows.push([idx === 0 ? 'Hardware ID' : '', hwid]);
  });
  hwTable.innerHTML = rows.map(([k, v]) =>
    `<div class="hw-key">${k}</div><div class="hw-val${k === 'Hardware ID' ? ' accent' : ''}">${v}</div>`
  ).join('');

  // Button label
  document.getElementById('btn-label').textContent = d.razer_testable ? 'Run Razer Diagnostics' : 'Run HID Interface Scan';
  document.getElementById('result').className = 'result';
  document.getElementById('detail-wrap').hidden = false;
  document.getElementById('iface-section').hidden = true;
  document.getElementById('copy-section').classList.remove('visible');
}

async function runTest() {
  if (!selected) return;
  const btn = document.getElementById('run-btn');
  btn.classList.add('loading'); btn.disabled = true;
  document.getElementById('result').className = 'result';
  document.getElementById('iface-section').hidden = true;
  document.getElementById('copy-section').classList.remove('visible');

  try {
    const report = await invoke('run_full_test', { pid: selected.pid, vid: selected.vid });
    renderReport(report);
  } catch (e) {
    showResult('fail', 'Error', String(e));
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

function renderReport(report) {
  const sec = document.getElementById('iface-section');
  sec.innerHTML = '';
  sec.hidden = false;

  const isRazer = report.vendor_id === 0x1532;
  const inDriver = isRazer && KNOWN[report.product_id] != null;
  const wm = WEBID_META[report.webid_status] ?? WEBID_META.unknown;

  const reportLines = [
    `**OpenMouse — Native HID Diagnostics**`,
    `Device:  ${report.name}`,
    `VID:     VID_${hexPlain(report.vendor_id)} (${hex(report.vendor_id)})`,
    `PID:     PID_${hexPlain(report.product_id)} (${hex(report.product_id)})`,
    `Driver:  ${inDriver ? 'known ✓' : 'NOT in driver yet ⚠️'}`,
    `WebHID:  ${wm.icon} ${wm.label}`,
    '',
  ];

  // WebHID banner
  const banner = document.createElement('div');
  banner.className = `webid-banner ${wm.cls}`;
  banner.innerHTML = `<span class="wi-icon">${wm.icon}</span><strong>${wm.label}</strong>`;
  sec.appendChild(banner);

  for (const iface of report.interfaces) {
    const isWinner = report.winner_iface === iface.interface;
    const block = document.createElement('div');
    block.className = `iface-block${isWinner ? ' winner' : ''}`;
    const upStr = hex(iface.usage_page);
    const uStr  = hex(iface.usage);
    const hwId  = `HID\\VID_${hexPlain(report.vendor_id)}&PID_${hexPlain(report.product_id)}&MI_${iface.interface.toString(16).padStart(2,'0').toUpperCase()}`;

    block.innerHTML = `
      <div class="iface-head">
        ${isWinner ? '<span class="iface-win-star">★</span>' : ''}
        <span>${iface.iface_type} · IF ${iface.interface}</span>
        <span class="iface-hwid">UP:${upStr} U:${uStr}</span>
        <span class="iface-hwid" style="margin-left:auto">${hwId}</span>
      </div>
      <div class="tx-rows"></div>`;

    const txRows = block.querySelector('.tx-rows');
    reportLines.push(`[${iface.iface_type} — UP:${upStr} U:${uStr} IF:${iface.interface}]${isWinner ? ' ← ACTIVE' : ''}`);
    reportLines.push(`  HW: ${hwId}`);

    if (report.scan_type === 'generic') {
      // Generic HID scan — show interface accessibility
      const a = iface.access;
      const row = document.createElement('div');
      row.className = 'tx-row';
      if (!a || a.error === 'open_failed') {
        row.innerHTML = `<span class="tx-tag">HID</span><span class="tx-err">❌ Cannot open — OS/driver blocking exclusive access</span>`;
        reportLines.push(`  ❌ Cannot open (exclusive access blocked)`);
      } else if (a.has_feature_report) {
        row.innerHTML = `<span class="tx-tag">HID</span><span class="tx-ok">✅ Accessible — feature reports supported</span>`;
        reportLines.push(`  ✅ Accessible — feature reports supported`);
      } else {
        row.innerHTML = `<span class="tx-tag">HID</span><span class="tx-dim">🔓 Accessible — no feature report channel</span>`;
        reportLines.push(`  🔓 Accessible — no feature report channel`);
      }
      txRows.appendChild(row);
    } else {
      // Razer protocol scan — show TX results
      for (const r of iface.results) {
        const txName = TX_NAMES[r.tx_id] ?? hex(r.tx_id, 2);
        const row = document.createElement('div');
        row.className = 'tx-row';
        if (r.error === 'open_failed') {
          row.innerHTML = `<span class="tx-tag">–</span><span class="tx-err">Could not open interface</span>`;
          reportLines.push(`  ⚠️ Could not open`);
        } else if (r.error === 'no_feature_report_channel') {
          row.innerHTML = `<span class="tx-tag">${txName}</span><span class="tx-dim">no feature report channel</span>`;
          reportLines.push(`  — ${txName}: no feature report channel`);
        } else if (r.ok) {
          row.innerHTML = `<span class="tx-tag">${txName}</span><span class="tx-ok">✅ OK — firmware ${r.firmware}</span>`;
          reportLines.push(`  ✅ ${txName}: OK — firmware ${r.firmware}`);
        } else {
          row.innerHTML = `<span class="tx-tag">${txName}</span><span class="tx-err">❌ ${r.error ?? 'no reply'}</span>`;
          reportLines.push(`  ❌ ${txName}: ${r.error ?? 'no reply'}`);
        }
        txRows.appendChild(row);
      }
    }
    sec.appendChild(block);
  }

  reportLines.push('');
  if (report.scan_type === 'generic') {
    const accessible = report.interfaces.filter(i => i.access?.accessible).length;
    const total = report.interfaces.length;
    if (accessible > 0) {
      showResult('success', `✅ ${accessible}/${total} interfaces accessible`, `WebHID assessment: ${wm.icon} ${wm.label}`);
      reportLines.push(`Result: ✅ ${accessible}/${total} interfaces accessible`);
    } else {
      showResult('fail', `❌ No interfaces accessible`, 'All HID interfaces are blocked by exclusive OS/driver access.');
      reportLines.push(`Result: ❌ No interfaces accessible`);
    }
  } else if (report.winner_tx != null) {
    showResult('success',
      `✅ Connected — TX ${TX_NAMES[report.winner_tx]} · IF ${report.winner_iface} (${report.winner_iface_type})`,
      `Firmware: <strong>${report.winner_firmware}</strong>`
    );
    reportLines.push(`Result: ✅ TX ${TX_NAMES[report.winner_tx]} on IF ${report.winner_iface} — firmware ${report.winner_firmware}`);
  } else {
    showResult('fail', '❌ No interface responded',
      'Check that Synapse or other HID software isn\'t blocking exclusive access.');
    reportLines.push('Result: ❌ No interface responded');
  }

  document.getElementById('copy-text').value = reportLines.join('\n');
  document.getElementById('copy-section').classList.add('visible');
}

function showResult(type, head, body) {
  const el = document.getElementById('result');
  el.className = `result ${type}`;
  el.innerHTML = `<div class="result-head">${head}</div>${body ? `<div style="margin-top:3px;font-size:12px">${body}</div>` : ''}`;
}

function copyReport() {
  const btn = document.getElementById('copy-btn');
  navigator.clipboard.writeText(document.getElementById('copy-text').value).then(() => {
    btn.textContent = '✓ Copied!'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy to Clipboard'; btn.classList.remove('copied'); }, 2000);
  });
}

async function checkForUpdate() {
  try {
    const info = await invoke('check_update');
    if (info.available) {
      document.getElementById('update-version').textContent = `v${info.version}`;
      document.getElementById('update-banner').classList.add('visible');
    }
  } catch (_) { /* silently ignore — dev builds have no endpoint */ }
}

async function installUpdate() {
  const btn = document.getElementById('update-btn');
  btn.textContent = 'Downloading…'; btn.disabled = true;
  try {
    await invoke('install_update');
    btn.textContent = 'Restarting…';
  } catch (e) {
    btn.textContent = 'Failed — retry';
    btn.disabled = false;
    console.error(e);
  }
}

window.scan = scan;
window.runTest = runTest;
window.copyReport = copyReport;
window.installUpdate = installUpdate;

scan();
checkForUpdate();
