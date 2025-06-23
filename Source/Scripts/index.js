// --- supabase init ---
const supabase = window.supabase.createClient(
	'https://otxksgnqdwnmhugyhnfu.supabase.co',
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90eGtzZ25xZHdubWh1Z3lobmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MTgwOTQsImV4cCI6MjA2NjI5NDA5NH0.4NQGI1dUf5hlW6Tm961OSwpq-Y7pMkxjPinDrVFd4rI'
);
let session = null;
supabase.auth.onAuthStateChange((_, s) => session = s);
async function initSession() {
	const { data } = await supabase.auth.getSession();
	session = data.session;
}

// --- grab DOM nodes ---
const createForm = document.getElementById('create-form');
const loginForm = document.getElementById('login-form');
const profileForm = document.getElementById('profile-form');
const toggleLinks = document.querySelectorAll('.text-cyan-700');
const profileButton = document.getElementById('profile-button');
const logoutButton = document.getElementById('logout-button');
const ds = document.getElementById('desired-sex');
const topicsContainer = document.getElementById('topics-container');
const matchButton = document.getElementById('match-button');
const skipButton = document.getElementById('skip-button');
const exitButton = document.getElementById('exit-button');
const sendButton = document.getElementById('send-button');
const messageInput = document.getElementById('message-input');
const chatMessages = document.getElementById('chat-messages');
const matchedDisplayName = document.getElementById('matched-display-name');
const matchedUsername = document.getElementById('matched-username');
const matchedSex = document.getElementById('matched-sex');
const matchedAge = document.getElementById('matched-age');

// --- helpers ---
function toggleAuth() {
	createForm.classList.toggle('d-none');
	loginForm.classList.toggle('d-none');
}
toggleLinks.forEach(el => el.addEventListener('click', toggleAuth));

function showPage(id) {
	document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
	document.getElementById(id).style.display = 'block';
}

function savePrefs() {
	localStorage.desired_sex = ds.value;
	localStorage.selected_topics = JSON.stringify(
		[...document.querySelectorAll('.bg-primary')].map(b => b.textContent)
	);
}

function loadPrefs() {
	ds.value = localStorage.desired_sex || 'Either';
	JSON.parse(localStorage.selected_topics || '[]').forEach(t => {
		[...document.querySelectorAll('.badge')]
			.filter(b => b.textContent === t)
			.forEach(b => b.classList.replace('bg-secondary', 'bg-primary'));
	});
}

// --- Auth & Profile ---
createForm.onsubmit = async e => {
	e.preventDefault();
	const email = createForm['email'].value;
	const password = createForm['password'].value;
	const { data: u, error: e1 } = await supabase.auth.signUp({ email, password });
	if (e1) return alert(e1.message);

	const pd = {
		id: u.user.id,
		display_name: createForm['display-name'].value,
		username: createForm.username.value,
		age: +createForm.age.value,
		sex: createForm.sex.value
	};
	const { error: e2 } = await supabase.from('profiles').insert(pd);
	if (e2) {
		alert(e2.message);
		await supabase.auth.signOut();
		return;
	}

	showPage('match-page');
	loadPrefs();
};

loginForm.onsubmit = async e => {
	e.preventDefault();
	const email = loginForm['login-email'].value;
	const password = loginForm['login-password'].value;
	const { error } = await supabase.auth.signInWithPassword({ email, password });
	if (error) return alert(error.message);

	showPage('match-page');
	loadPrefs();
};

profileButton.onclick = async () => {
	const { data, error } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', session.user.id)
		.single();
	if (error) return alert(error.message);

	profileForm['profile-display-name'].value = data.display_name;
	profileForm['profile-username'].value = data.username;
	showPage('profile-page');
};

profileForm.onsubmit = async e => {
	e.preventDefault();
	const updated = {
		display_name: profileForm['profile-display-name'].value,
		username: profileForm['profile-username'].value
	};
	const { error } = await supabase
		.from('profiles')
		.update(updated)
		.eq('id', session.user.id);
	alert(error ? error.message : 'Profile saved');
	if (!error) showPage('match-page');
};

logoutButton.onclick = async () => {
	await supabase.auth.signOut();
	showPage('auth-page');
};

// --- Topics UI ---
Object.entries({
	Sports: ['Basketball', 'Hockey', 'Soccer', 'Swimming'],
	Games: ['CoD', 'Valorant', 'Minecraft', 'Roblox']
}).forEach(([cat, its]) => {
	const h = document.createElement('h5'); h.textContent = cat;
	topicsContainer.append(h);
	its.forEach(t => {
		const b = document.createElement('span');
		b.className = 'badge bg-secondary m-1';
		b.textContent = t;
		b.style.cursor = 'pointer';
		b.onclick = () => {
			b.classList.toggle('bg-secondary');
			b.classList.toggle('bg-primary');
			savePrefs();
		};
		topicsContainer.append(b);
	});
});
ds.onchange = savePrefs;

// --- Matching logic ---
async function joinPool() {
	// remove any old
	await supabase
		.from('match_pool')
		.delete()
		.eq('user_id', session.user.id);

	await supabase.from('match_pool').insert({
		user_id: session.user.id,
		desired_sex: ds.value,
		topics: [...document.querySelectorAll('.bg-primary')].map(b => b.textContent) || null
	});
}

async function checkMatch() {
	await supabase.rpc('do_match');
	const { data } = await supabase
		.from('matched_users')
		.select('*')
		.or(`a_id.eq.${session.user.id},b_id.eq.${session.user.id}`)
		.single();
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
	setupChat(m);
	showPage('chat-page');
}

matchButton.onclick = startMatching;

// --- Chat UI ---
function addMsg(text, self = false, sys = false) {
	const div = document.createElement('div');
	div.className = 'py-1 ' +
		(sys
			? 'd-flex flex-column align-items-end my-2'
			: `d-flex flex-column ${self ? 'align-items-end' : 'align-items-start'} my-2`
		);
	div.innerHTML = `<div class="d-inline-block ${sys ? 'bg-danger text-white' : self ? 'bg-primary text-white' : 'bg-light'
		} rounded p-2"><div class="text-sm">${text}</div></div>`;
	chatMessages.appendChild(div);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

let channel;
function setupChat(match) {
	// display partner info
	const partnerId = match.a_id === session.user.id ? match.b_id : match.a_id;
	supabase
		.from('profiles')
		.select('*')
		.eq('id', partnerId)
		.single()
		.then(({ data }) => {
			matchedDisplayName.textContent = data.display_name;
			matchedUsername.textContent = data.username;
			matchedSex.textContent = data.sex;
			matchedAge.textContent = data.age;
		});

	channel = supabase.channel(`chat:${match.id}`);
	channel.on('broadcast', { event: 'message' }, ({ payload }) =>
		addMsg(payload.text, payload.user === session.user.id)
	);
	channel.on('broadcast', { event: 'user_left' }, () =>
		addMsg('Partner left', false, true)
	);
	channel.subscribe();
}

sendButton.onclick = () => {
	const t = messageInput.value.trim();
	if (!t) return;
	channel.send({
		type: 'broadcast',
		event: 'message',
		payload: { text: t, user: session.user.id }
	});
	addMsg(t, true);
	messageInput.value = '';
};

async function unmatch(skip) {
	await supabase
		.from('matched_users')
		.delete()
		.or(`a_id.eq.${session.user.id},b_id.eq.${session.user.id}`);

	channel.send({ type: 'broadcast', event: 'user_left' });
	channel.unsubscribe();
	chatMessages.innerHTML = '';

	if (skip) await joinPool();
	showPage('match-page');
}

skipButton.onclick = () => unmatch(true);
exitButton.onclick = () => unmatch(false);

// --- kick things off ---
; (async () => {
	await initSession();
	showPage(session ? 'match-page' : 'auth-page');
})();
