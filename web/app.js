const $ = (id) => document.getElementById(id);
const state = { today: null, records: [], pendingAction: null, editingOriginalDate: null, elapsedTimer: null };

const els = {
  loginView: $('loginView'), appView: $('appView'), loginForm: $('loginForm'), passwordInput: $('passwordInput'), loginError: $('loginError'),
  logoutBtn: $('logoutBtn'), todayDate: $('todayDate'), statusPill: $('statusPill'), clockInValue: $('clockInValue'), clockOutValue: $('clockOutValue'),
  elapsedWrap: $('elapsedWrap'), elapsedValue: $('elapsedValue'), clockInBtn: $('clockInBtn'), clockOutBtn: $('clockOutBtn'),
  fromDate: $('fromDate'), toDate: $('toDate'), applyFilterBtn: $('applyFilterBtn'), copyBtn: $('copyBtn'), refreshBtn: $('refreshBtn'),
  historyList: $('historyList'), emptyState: $('emptyState'), confirmModal: $('confirmModal'), confirmText: $('confirmText'), confirmCancel: $('confirmCancel'), confirmReplace: $('confirmReplace'),
  editModal: $('editModal'), editForm: $('editForm'), editDate: $('editDate'), editIn: $('editIn'), editOut: $('editOut'), editCancel: $('editCancel'), editError: $('editError'), toast: $('toast')
};

async function api(path, options = {}) {
  const init = { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } };
  const res = await fetch(path, init);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (res.status === 401 && path !== '/api/login') showLogin();
  return { res, data };
}

function showLogin() {
  els.appView.classList.add('hidden');
  els.loginView.classList.remove('hidden');
  setTimeout(() => els.passwordInput.focus(), 80);
}

function showApp() {
  els.loginView.classList.add('hidden');
  els.appView.classList.remove('hidden');
}

function thaiDateLong(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat('th-TH', { day:'numeric', month:'long', year:'numeric' }).format(d);
}

const thaiDateShort = ReportFormatter.thaiDateShort;

function recordStatus(record) {
  if (!record) return { label:'READY', cls:'idle' };
  if (record.clock_in && record.clock_out) return { label:'COMPLETED', cls:'completed' };
  if (record.clock_in && !record.clock_out) return { label:'WORKING', cls:'working' };
  return { label:'INCOMPLETE', cls:'incomplete' };
}

function setTodayView(payload) {
  state.today = payload;
  const record = payload.record;
  els.todayDate.textContent = thaiDateLong(payload.date);
  els.clockInValue.textContent = record?.clock_in || '—';
  els.clockOutValue.textContent = record?.clock_out || '—';
  const status = recordStatus(record);
  els.statusPill.className = `status-pill ${status.cls}`;
  els.statusPill.querySelector('b').textContent = status.label;
  manageElapsed(record, payload.server_now);
}

function manageElapsed(record, serverNow) {
  if (state.elapsedTimer) clearInterval(state.elapsedTimer);
  if (!(record?.clock_in && !record.clock_out)) {
    els.elapsedWrap.classList.add('hidden');
    return;
  }
  els.elapsedWrap.classList.remove('hidden');
  const baseServer = new Date(serverNow);
  const offsetMatch = serverNow.match(/([+-]\d{2}:\d{2}|Z)$/);
  const offset = offsetMatch ? offsetMatch[1] : 'Z';
  const start = new Date(`${record.date}T${record.clock_in}:00${offset}`);
  const baseClient = Date.now();
  const tick = () => {
    const current = new Date(baseServer.getTime() + (Date.now() - baseClient));
    const mins = Math.max(0, Math.floor((current - start) / 60000));
    els.elapsedValue.textContent = `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
  };
  tick();
  state.elapsedTimer = setInterval(tick, 30000);
}

function pulseButton(btn, event) {
  if (event) {
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--x', `${event.clientX - r.left}px`);
    btn.style.setProperty('--y', `${event.clientY - r.top}px`);
  }
  btn.classList.remove('pulse');
  void btn.offsetWidth;
  btn.classList.add('pulse');
  setTimeout(() => btn.classList.remove('pulse'), 420);
}

async function loadToday() {
  const { res, data } = await api('/api/today');
  if (res.ok) setTodayView(data);
}

async function loadRecords() {
  const from = els.fromDate.value;
  const to = els.toDate.value;
  const { res, data } = await api(`/api/records?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  if (!res.ok) return;
  state.records = data.records || [];
  renderHistory();
}

function renderHistory() {
  els.historyList.textContent = '';
  els.emptyState.classList.toggle('hidden', state.records.length > 0);
  for (const record of state.records) {
    const card = document.createElement('article');
    card.className = 'record';

    const date = document.createElement('div'); date.className = 'record-date';
    const strong = document.createElement('strong'); strong.textContent = thaiDateShort(record.date);
    const small = document.createElement('small'); small.textContent = thaiDateLong(record.date);
    date.append(strong, small);
    if (!record.clock_in || !record.clock_out) {
      const badge = document.createElement('div'); badge.className = 'badge warn';
      badge.textContent = !record.clock_in ? 'ขาดเวลาเข้า' : 'ขาดเวลาออก';
      date.appendChild(badge);
    }

    const inBox = document.createElement('div'); inBox.className = 'record-time';
    const inLabel = document.createElement('span'); inLabel.textContent = 'IN';
    const inVal = document.createElement('b'); inVal.textContent = record.clock_in || '—';
    inBox.append(inLabel, inVal);

    const outBox = document.createElement('div'); outBox.className = 'record-time';
    const outLabel = document.createElement('span'); outLabel.textContent = 'OUT';
    const outVal = document.createElement('b'); outVal.textContent = record.clock_out || '—';
    outBox.append(outLabel, outVal);

    const actions = document.createElement('div'); actions.className = 'record-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'แก้'; edit.setAttribute('aria-label', `แก้ไข ${record.date}`); edit.onclick = () => openEdit(record);
    const del = document.createElement('button'); del.type = 'button'; del.textContent = 'ลบ'; del.setAttribute('aria-label', `ลบ ${record.date}`); del.onclick = () => deleteRecord(record);
    actions.append(edit, del);

    card.append(date, inBox, outBox, actions);
    els.historyList.appendChild(card);
  }
}

async function clock(action, replace = false, event = null) {
  const btn = action === 'in' ? els.clockInBtn : els.clockOutBtn;
  pulseButton(btn, event);
  const { res, data } = await api('/api/clock', { method:'POST', body:JSON.stringify({ action, replace }) });
  if (res.ok) {
    showToast(action === 'in' ? '✓ ลงเวลาเข้าแล้ว' : '✓ ลงเวลาออกแล้ว');
    await Promise.all([loadToday(), loadRecords()]);
    return;
  }
  if (res.status === 409 && data.error === 'already_exists') {
    state.pendingAction = action;
    const label = action === 'in' ? 'เวลาเข้า' : 'เวลาออก';
    const current = data.record?.[action === 'in' ? 'clock_in' : 'clock_out'] || '—';
    els.confirmText.textContent = `${label}วันนี้ถูกบันทึกไว้ที่ ${current} แล้ว ต้องการแทนที่ด้วยเวลาปัจจุบันหรือไม่?`;
    els.confirmModal.classList.remove('hidden');
  } else {
    showToast('เกิดข้อผิดพลาด');
  }
}

function openEdit(record) {
  state.editingOriginalDate = record.date;
  els.editDate.value = record.date;
  els.editIn.value = record.clock_in || '';
  els.editOut.value = record.clock_out || '';
  els.editError.textContent = '';
  els.editModal.classList.remove('hidden');
}

async function deleteRecord(record) {
  if (!window.confirm(`ลบข้อมูลวันที่ ${thaiDateShort(record.date)} ใช่หรือไม่?`)) return;
  const { res } = await api(`/api/records/${encodeURIComponent(record.date)}`, { method:'DELETE' });
  if (res.ok) {
    showToast('✓ ลบแล้ว');
    await Promise.all([loadToday(), loadRecords()]);
  }
}

async function copyReport() {
  if (!state.records.length) return showToast('ไม่มีข้อมูลให้คัดลอก');
  const text = ReportFormatter.formatReport(state.records);
  try {
    await navigator.clipboard.writeText(text);
    showToast('✓ คัดลอกแล้ว');
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = text; area.style.position='fixed'; area.style.opacity='0';
    document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy'); area.remove();
    showToast(ok ? '✓ คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ');
  }
}

let toastTimer;
function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1900);
}

function defaultRange() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = n => String(n).padStart(2,'0');
  els.fromDate.value = `${y}-${pad(m+1)}-01`;
  els.toDate.value = `${y}-${pad(m+1)}-${pad(now.getDate())}`;
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault(); els.loginError.textContent = '';
  const { res } = await api('/api/login', { method:'POST', body:JSON.stringify({ password: els.passwordInput.value }) });
  if (!res.ok) { els.loginError.textContent = 'รหัสผ่านไม่ถูกต้อง'; return; }
  els.passwordInput.value = ''; showApp(); defaultRange(); await Promise.all([loadToday(), loadRecords()]);
});
els.logoutBtn.addEventListener('click', async () => { await api('/api/logout', { method:'POST' }); showLogin(); });
els.clockInBtn.addEventListener('click', (e) => clock('in', false, e));
els.clockOutBtn.addEventListener('click', (e) => clock('out', false, e));
els.confirmCancel.addEventListener('click', () => { state.pendingAction = null; els.confirmModal.classList.add('hidden'); });
els.confirmReplace.addEventListener('click', async () => { const action = state.pendingAction; state.pendingAction = null; els.confirmModal.classList.add('hidden'); if (action) await clock(action, true); });
els.editCancel.addEventListener('click', () => els.editModal.classList.add('hidden'));
els.editForm.addEventListener('submit', async (e) => {
  e.preventDefault(); els.editError.textContent = '';
  if (!els.editIn.value && !els.editOut.value) { els.editError.textContent = 'กรุณาใส่เวลาเข้า หรือ เวลาออกอย่างน้อยหนึ่งช่อง'; return; }
  const payload = { date: els.editDate.value, clock_in: els.editIn.value || null, clock_out: els.editOut.value || null };
  const { res, data } = await api(`/api/records/${encodeURIComponent(state.editingOriginalDate)}`, { method:'PUT', body:JSON.stringify(payload) });
  if (!res.ok) {
    els.editError.textContent = data.error === 'date_conflict' ? 'วันที่ใหม่มีข้อมูลอยู่แล้ว' : 'บันทึกไม่สำเร็จ';
    return;
  }
  els.editModal.classList.add('hidden'); showToast('✓ บันทึกแล้ว'); await Promise.all([loadToday(), loadRecords()]);
});
els.applyFilterBtn.addEventListener('click', loadRecords);
els.refreshBtn.addEventListener('click', async () => { await Promise.all([loadToday(), loadRecords()]); showToast('รีเฟรชแล้ว'); });
els.copyBtn.addEventListener('click', copyReport);

(async function boot() {
  const { res, data } = await api('/api/session');
  if (res.ok && data.authenticated) { showApp(); defaultRange(); await Promise.all([loadToday(), loadRecords()]); }
  else showLogin();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
