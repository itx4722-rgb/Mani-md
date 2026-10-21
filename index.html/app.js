const $ = (id) => document.getElementById(id);
const loginForm = $('login-form');
const pairArea = $('pair-area');
const panelMessage = $('panel-message');
let statusTimer = null;

function showMessage(message, isError = false) {
  panelMessage.textContent = message || '';
  panelMessage.style.color = isError ? '#ff8da3' : '#76f5e5';
}
function setLoggedIn(value) {
  loginForm.classList.toggle('hidden', value);
  pairArea.classList.toggle('hidden', !value);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
async function refreshStatus() {
  try {
    const s = await api('/api/status');
    const connected = s.state === 'connected';
    $('stat-state').textContent = connected ? 'Connected' : s.state.replace('_', ' ');
    $('status-text').textContent = connected ? 'WhatsApp connected' : `Status: ${s.state.replace('_', ' ')}`;
    $('status-dot').className = `status-dot ${connected ? 'connected' : s.state === 'error' ? 'error' : ''}`;
    if (s.pairingCode) {
      $('code-box').classList.remove('hidden');
      $('pair-code').textContent = s.pairingCode;
    } else if (connected) {
      $('code-box').classList.add('hidden');
      showMessage('Connected successfully. You can now test !menu in WhatsApp.');
    }
    if (s.error) showMessage(s.error, true);
  } catch (err) {
    if (err.message.includes('log in') || err.message.includes('private panel')) setLoggedIn(false);
  }
}
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector('button');
  button.disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    $('password').value = '';
    setLoggedIn(true);
    showMessage('Panel unlocked.');
    await refreshStatus();
    statusTimer = setInterval(refreshStatus, 3500);
  } catch (err) {
    showMessage(err.message, true);
  } finally { button.disabled = false; }
});
$('pair-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const phone = $('phone').value.trim();
  const button = $('pair-form').querySelector('button');
  button.disabled = true;
  button.textContent = 'Requesting pairing code…';
  showMessage('Request sent. Waiting for the bot to prepare the code…');
  try {
    const result = await api('/api/pair', { method: 'POST', body: JSON.stringify({ phone }) });
    showMessage(result.message);
    setTimeout(refreshStatus, 1500);
    setTimeout(refreshStatus, 5000);
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Generate pairing code <span>↗</span>';
  }
});
$('refresh').addEventListener('click', refreshStatus);
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
  if (statusTimer) clearInterval(statusTimer);
  setLoggedIn(false);
  $('code-box').classList.add('hidden');
  $('stat-state').textContent = 'Not connected';
  showMessage('');
});
