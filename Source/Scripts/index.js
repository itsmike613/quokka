// --- init supabase & session ---
const supabase = window.supabase.createClient(
	'https://otxksgnqdwnmhugyhnfu.supabase.co',
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90eGtzZ25xZHdubWh1Z3lobmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MTgwOTQsImV4cCI6MjA2NjI5NDA5NH0.4NQGI1dUf5hlW6Tm961OSwpq-Y7pMkxjPinDrVFd4rI'
);
let session = null;
supabase.auth.onAuthStateChange((_, s) => session = s);
(async () => session = (await supabase.auth.getSession()).data.session)();

// --- helpers ---
function showPage(id) {
	document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
	document.getElementById(id).style.display = 'block';
}
function savePrefs() { localStorage.desired_sex = ds.value; localStorage.selected_topics = JSON.stringify([...document.querySelectorAll('.bg-primary')].map(b => b.textContent)); }
function loadPrefs() {
	ds.value = localStorage.desired_sex || 'Either';
	JSON.parse(localStorage.selected_topics || '[]').forEach(t => {
		[...document.querySelectorAll('.badge')].filter(b => b.textContent === t).forEach(b => b.classList.replace('bg-secondary', 'bg-primary'));
	});
}

// --- Auth & Profile ---
createForm.onsubmit = async e => {
	e.preventDefault();
	const d = { email: cf.email.value, password: cf.password.value };
	const { data: u, error: e1 } = await supabase.auth.signUp(d);
	if (e1) return alert(e1.message);
	const pd = { id: u.user.id, display_name: cf['display-name'].value, username: cf.username.value, age: +cf.age.value, sex: cf.sex.value };
	const { error: e2 } = await supabase.from('profiles').insert(pd);
	if (e2) { alert(e2.message); await supabase.auth.signOut(); return; }
	showPage('match-page'); loadPrefs();
};
loginForm.onsubmit = async e => {
	e.preventDefault();
	const { error } = await supabase.auth.signInWithPassword({ email: lf['login-email'].value, password: lf['login-password'].value });
	if (error) return alert(error.message);
	showPage('match-page'); loadPrefs();
};
profileButton.onclick = async () => {
	const { data, p } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
	if (p) return alert(p.message);
	profile['profile-display-name'].value = data.display_name;
	profile['profile-username'].value = data.username;
	showPage('profile-page');
};
profileForm.onsubmit = async e => {
	e.preventDefault();
	const d = { display_name: profile['profile-display-name'].value, username: profile['profile-username'].value };
	const { error } = await supabase.from('profiles').update(d).eq('id', session.user.id);
	alert(error ? error.message : 'Profile saved');
	if (!error) showPage('match-page');
};
logoutButton.onclick = async () => { await supabase.auth.signOut(); showPage('auth-page'); };

// --- Topics UI ---
Object.entries({ Sports: ['Basketball', 'Hockey', 'Soccer', 'Swimming'], Games: ['CoD', 'Valorant', 'Minecraft', 'Roblox'] })
	.forEach(([cat, its]) => {
		topicsContainer.append(Object.assign(document.createElement('h5'), { textContent: cat }));
		its.forEach(t => {
			const b = document.createElement('span');
			b.className = 'badge bg-secondary m-1'; b.textContent = t; b.style.cursor = 'pointer';
			b.onclick = () => { b.classList.toggle('bg-secondary'); b.classList.toggle('bg-primary'); savePrefs(); };
			topicsContainer.append(b);
		});
	});
ds.onchange = savePrefs;

// --- Matching logic ---
async function joinPool() {
	await supabase.from('match_pool').delete().eq('user_id', session.user.id).is('id', null);
	await supabase.from('match_pool').insert({
		user_id: session.user.id,
		desired_sex: ds.value,
		topics: [...document.querySelectorAll('.bg-primary')].map(b => b.textContent) || null
	});
}
async function checkMatch() {
	await supabase.rpc('do_match');
	const { data } = await supabase.from('matched_users')
		.select('*').or(`a_id.eq.${session.user.id},b_id.eq.${session.user.id}`).single();
	return data;
}
async function startMatching() {
	await joinPool();
	showPage('loading-page');
	let m = null;
	while (!m) {
		await new Promise(r => setTimeout(r, 2000));
		m = await checkMatch();
	}
	setupChat(m); showPage('chat-page');
}

// --- Chat UI ---
function addMsg(t, self, sys) {
	const d = document.createElement('div');
	d.className = 'py-1 ' + (sys ? 'd-flex flex-column align-items-end my-2' : 'd-flex flex-column ' + (self ? 'align-items-end' : 'align-items-start') + ' my-2');
	d.innerHTML = `<div class="d-inline-block ${sys ? 'bg-danger text-white' : ' ' + (self ? 'bg-primary text-white' : 'bg-light')} rounded p-2"><div class="text-sm">${t}</div></div>`;
	chatMessages.appendChild(d); chatMessages.scrollTop = chatMessages.scrollHeight;
}
let channel;
function setupChat(match) {
	const partner = match.a_id === session.user.id ? match.b_id : match.a_id;
	matchedDisplayName.textContent = '…'; // fetch profile if needed
	channel = supabase.channel(`chat:${match.id}`);
	channel.on('broadcast', { event: 'message' }, ({ payload }) => addMsg(payload.text, payload.user === session.user.id));
	channel.on('broadcast', { event: 'user_left' }, () => addMsg('Partner left', false, true));
	channel.subscribe();
}
sendButton.onclick = () => {
	const t = messageInput.value.trim();
	if (!t) return;
	channel.send({ type: 'broadcast', event: 'message', payload: { text: t, user: session.user.id } });
	addMsg(t, true);
	messageInput.value = '';
};
skipButton.onclick = () => unmatch(true);
exitButton.onclick = () => unmatch(false);

async function unmatch(skip) {
	await supabase.from('matched_users').delete().or(`a_id.eq.${session.user.id},b_id.eq.${session.user.id}`);
	channel.send({ type: 'broadcast', event: 'user_left' });
	channel.unsubscribe(); chatMessages.innerHTML = '';
	if (skip) await joinPool();
	showPage('match-page');
}

// --- start ---
init().then(() => showPage(session ? 'match-page' : 'auth-page'));
