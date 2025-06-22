const supabase = window.supabase.createClient('https://kotcxrjnvutpllojtkoo.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdGN4cmpudnV0cGxsb2p0a29vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1NTE0MTMsImV4cCI6MjA2NjEyNzQxM30.NcMrLfW6res9fUD-LlL2R1ohSf7lAsQy1h-eSOWcr6k');

let session, channel, currentMatchRequest;
const chatMessages = document.getElementById('chat-messages');
const topics = { Sports: ['Basketball', 'Hockey', 'Soccer', 'Swimming'], Games: ['Call of Duty', 'Valorant', 'Minecraft', 'Roblox'] };

supabase.auth.onAuthStateChange((event, newSession) => {
  session = event === 'SIGNED_IN' ? newSession : event === 'SIGNED_OUT' ? null : session;
  showPage(session ? 'match-page' : 'auth-page');
});

async function ensureSession() {
  if (!session || session.expires_at < Date.now() / 1000) {
    const { data: { session: s }, error } = await supabase.auth.getSession();
    if (error || !s) return false;
    session = s.expires_at < Date.now() / 1000 ? (await supabase.auth.refreshSession()).data.session : s;
  }
  return !!session;
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
  document.getElementById(pageId).style.display = 'block';
}

function loadMatchFormSettings() {
  document.getElementById('desired-sex').value = localStorage.getItem('desired_sex') || 'Either';
  const savedTopics = JSON.parse(localStorage.getItem('selected_topics') || '[]');
  document.querySelectorAll('.badge').forEach(badge => badge.classList.toggle('bg-primary', savedTopics.includes(badge.textContent)));
}

async function init() {
  await ensureSession();
  showPage(session ? 'match-page' : 'auth-page');
  if (session) loadMatchFormSettings();
}
init();

document.getElementById('create-form').onsubmit = async e => {
  e.preventDefault();
  const form = Object.fromEntries(new FormData(e.target));
  if (form['display-name'].length < 3 || form['display-name'].length > 16 || form.username.length < 3 || form.username.length > 16) 
    return alert('Display Name and Username must be 3-16 characters');
  const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password });
  if (error) return alert(error.message);
  const profile = { id: data.user.id, display_name: form['display-name'], username: form.username, age: parseInt(form.age), sex: form.sex, state: form.state };
  const { error: profileError } = await supabase.from('profiles').insert(profile);
  if (profileError) { alert(profileError.message); await supabase.auth.signOut(); } else showPage('match-page');
};

document.getElementById('login-form').onsubmit = async e => {
  e.preventDefault();
  const form = Object.fromEntries(new FormData(e.target));
  const { data, error } = await supabase.auth.signInWithPassword({ email: form['login-email'], password: form['login-password'] });
  if (error) alert(error.message); else showPage('match-page');
};

document.getElementById('toggle-auth').onclick = () => {
  document.getElementById('create-form').classList.toggle('d-none');
  document.getElementById('login-form').classList.toggle('d-none');
};

const topicsContainer = document.getElementById('topics-container');
Object.entries(topics).forEach(([cat, items]) => {
  topicsContainer.appendChild(Object.assign(document.createElement('h5'), { textContent: cat }));
  items.forEach(topic => {
    const badge = Object.assign(document.createElement('span'), { className: 'badge bg-secondary m-1', textContent: topic, style: 'cursor: pointer' });
    badge.onclick = () => {
      badge.classList.toggle('bg-secondary'); badge.classList.toggle('bg-primary');
      localStorage.setItem('selected_topics', JSON.stringify([...document.querySelectorAll('.bg-primary')].map(b => b.textContent)));
    };
    topicsContainer.appendChild(badge);
  });
});

document.getElementById('desired-sex').onchange = e => localStorage.setItem('desired_sex', e.target.value);

document.getElementById('match-button').onclick = async () => {
  if (!await ensureSession()) return showPage('auth-page');
  const desiredSex = document.getElementById('desired-sex').value;
  const selectedTopics = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);
  await supabase.from('match_requests').delete().eq('user_id', session.user.id).is('matched_with', null);
  const { data, error } = await supabase.from('match_requests').insert({ user_id: session.user.id, desired_sex: desiredSex, topics: selectedTopics || null, participants: [session.user.id] }).select();
  if (error) return alert(error.message);
  currentMatchRequest = data[0];
  showPage('loading-page');
  const interval = setInterval(async () => {
    const { data: matchId, error } = await supabase.rpc('find_match', { current_mr_id: currentMatchRequest.id });
    if (error || !matchId) { clearInterval(interval); await supabase.from('match_requests').delete().eq('id', currentMatchRequest.id); showPage('match-page'); }
    else { clearInterval(interval); await startChat(matchId); }
  }, 2000);
};

async function startChat(matchId) {
  if (!await ensureSession()) return showPage('auth-page');
  const { data: matchedMr, error: mrErr } = await supabase.from('match_requests').select('user_id').eq('id', matchId).single();
  if (mrErr) return handleChatError();
  const { data: profile, error: profErr } = await supabase.from('profiles').select('*').eq('id', matchedMr.user_id).single();
  if (profErr) return handleChatError();
  ['display-name', 'username', 'sex', 'state', 'age'].forEach(k => document.getElementById(`matched-${k}`).textContent = profile[k]);
  const channelName = `chat:${Math.min(currentMatchRequest.id, matchId)}:${Math.max(currentMatchRequest.id, matchId)}`;
  if (channel) channel.unsubscribe();
  channel = supabase.channel(channelName, { config: { presence: { key: session.user.id } } });
  channel.on('broadcast', { event: 'message' }, ({ payload }) => addMessage(payload.text, payload.user_id === session.user.id));
  channel.on('broadcast', { event: 'user_left' }, () => endChatUI('Your partner has left the chat.'));
  channel.on('presence', { event: 'sync' }, () => { if (!Object.keys(channel.presenceState()).filter(k => k !== session.user.id).length) endChatUI('Your partner has left the chat.'); });
  channel.subscribe(status => { if (status === 'SUBSCRIBED') document.getElementById('send-button').disabled = false; });
  chatMessages.innerHTML = '';
  showPage('chat-page');
}

function addMessage(text, isSelf, isSystem = false) {
  const div = document.createElement('div');
  div.classList.add('border-0', 'py-1', 'd-flex', 'flex-column', 'my-2');
  div.classList.add(isSelf ? 'align-items-end' : 'align-items-start');
  div.innerHTML = `<div class="d-inline-block rounded p-2 text-sm ${isSystem ? 'bg-danger text-white' : isSelf ? 'bg-primary text-white' : 'bg-light'}">${text}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById('send-button').onclick = () => {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (text && channel) {
    addMessage(text, true);
    channel.send({ type: 'broadcast', event: 'message', payload: { text, user_id: session.user.id } });
    input.value = '';
  }
};

document.getElementById('skip-button').onclick = async () => {
  if (channel) channel.send({ type: 'broadcast', event: 'user_left', payload: { user_id: session.user.id } });
  await endChat();
  document.getElementById('match-button').click();
};

document.getElementById('exit-button').onclick = async () => {
  if (channel) { channel.send({ type: 'broadcast', event: 'user_left', payload: { user_id: session.user.id } }); channel.unsubscribe(); channel = null; }
  await endChat();
  showPage('match-page');
};

async function endChat() {
  if (currentMatchRequest) {
    await supabase.from('match_requests').delete().eq('id', currentMatchRequest.id);
    currentMatchRequest = null;
  }
  chatMessages.innerHTML = '';
  document.getElementById('message-input').disabled = false;
  document.getElementById('send-button').disabled = false;
}

function endChatUI(message) {
  addMessage(message, false, true);
  document.getElementById('message-input').disabled = true;
  document.getElementById('send-button').disabled = true;
}

function handleChatError() {
  supabase.from('match_requests').delete().eq('id', currentMatchRequest.id);
  showPage('match-page');
}

document.getElementById('profile-button').onclick = async () => {
  if (!await ensureSession()) return showPage('auth-page');
  const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) return alert(error.message);
  document.getElementById('profile-display-name').value = data.display_name;
  document.getElementById('profile-username').value = data.username;
  showPage('profile-page');
};

document.getElementById('profile-form').onsubmit = async e => {
  e.preventDefault();
  const form = Object.fromEntries(new FormData(e.target));
  if (form['profile-display-name'].length < 3 || form['profile-display-name'].length > 16 || form['profile-username'].length < 3 || form['profile-username'].length > 16) 
    return alert('Display Name and Username must be 3-16 characters');
  const { error } = await supabase.from('profiles').update(form).eq('id', session.user.id);
  if (!error) showPage('match-page'); else alert(error.message);
};

document.getElementById('logout-button').onclick = async () => {
  await supabase.auth.signOut();
  showPage('auth-page');
};