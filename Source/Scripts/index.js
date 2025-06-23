const supabase = window.supabase.createClient('https://hjmkbavjskynegwkfarq.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqbWtiYXZqc2t5bmVnd2tmYXJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MTU3NjcsImV4cCI6MjA2NjI5MTc2N30.5CU4lIAmmsENQnMgNN2NupZPT4sKdRj62CFIbNAQ_0M');
let session, channel, currentMatchId;

const topics = {
	'Sports': ['Basketball', 'Hockey', 'Soccer', 'Swimming'],
	'Games': ['Call of Duty', 'Valorant', 'Minecraft', 'Roblox']
};

function toggleAuth() {
	document.getElementById('create-form').classList.toggle('d-none');
	document.getElementById('login-form').classList.toggle('d-none');
}

function showPage(pageId) {
	document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
	document.getElementById(pageId).style.display = 'block';
}

function loadMatchForm() {
	document.getElementById('desired-sex').value = localStorage.getItem('desired_sex') || 'Either';
	const savedTopics = JSON.parse(localStorage.getItem('selected_topics') || '[]');
	document.querySelectorAll('.badge').forEach(b => {
	if (savedTopics.includes(b.textContent)) b.classList.replace('bg-secondary', 'bg-primary');
	});
}

async function init() {
	const { data: { session: s } } = await supabase.auth.getSession();
	session = s;
	showPage(s ? 'match-page' : 'auth-page');
	if (s) loadMatchForm();
}
init();

document.getElementById('create-form').onsubmit = async e => {
	e.preventDefault();
	const form = Object.fromEntries(new FormData(e.target));
	if (form['display-name'].length < 3 || form['display-name'].length > 16 || form.username.length < 3 || form.username.length > 16)
	return alert('Display Name and Username must be 3-16 characters');

	const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password });
	if (error) return alert(error.message);

	const profile = { id: data.user.id, display_name: form['display-name'], username: form.username, age: parseInt(form.age), sex: form.sex };
	const { error: profileError } = await supabase.from('profiles').insert(profile);
	if (profileError) {
	alert(`Profile creation failed: ${profileError.message}`);
	await supabase.auth.signOut();
	} else {
	session = data.session;
	showPage('match-page');
	}
};

document.getElementById('login-form').onsubmit = async e => {
	e.preventDefault();
	const form = Object.fromEntries(new FormData(e.target));
	const { data, error } = await supabase.auth.signInWithPassword({ email: form['login-email'], password: form['login-password'] });
	if (error) return alert(error.message);
	session = data.session;
	showPage('match-page');
};

const topicsContainer = document.getElementById('topics-container');
Object.entries(topics).forEach(([cat, items]) => {
	topicsContainer.appendChild(Object.assign(document.createElement('h5'), { textContent: cat }));
	items.forEach(t => {
	const badge = document.createElement('span');
	badge.className = 'badge bg-secondary m-1';
	badge.textContent = t;
	badge.style.cursor = 'pointer';
	badge.onclick = () => {
		badge.classList.toggle('bg-secondary');
		badge.classList.toggle('bg-primary');
		const selected = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);
		localStorage.setItem('selected_topics', JSON.stringify(selected));
	};
	topicsContainer.appendChild(badge);
	});
});

document.getElementById('desired-sex').onchange = e => localStorage.setItem('desired_sex', e.target.value);

document.getElementById('match-button').onclick = async () => {
	const desiredSex = document.getElementById('desired-sex').value;
	const selectedTopics = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);

	await supabase.from('match_pool').delete().eq('user_id', session.user.id);
	const { data, error } = await supabase.from('match_pool').insert({ user_id: session.user.id, desired_sex: desiredSex, topics: selectedTopics || null }).select();
	if (error) return alert(`Match pool error: ${error.message}`);

	showPage('loading-page');
	const interval = setInterval(async () => {
	const { data: matchId, error } = await supabase.rpc('find_match', { current_user_id: session.user.id });
	if (error) {
		clearInterval(interval);
		alert(`Match error: ${error.message}`);
		await supabase.from('match_pool').delete().eq('user_id', session.user.id);
		showPage('match-page');
	} else if (matchId) {
		clearInterval(interval);
		currentMatchId = matchId;
		await startChat(matchId);
	}
	}, 2000);
};

async function startChat(matchId) {
	if (!session) {
	alert('Session expired. Please log in.');
	showPage('auth-page');
	return;
	}
	const { data: match, error } = await supabase.from('matched_users').select('user1_id, user2_id').eq('id', matchId).single();
	if (error || !match) {
	alert('Chat start error.');
	await supabase.from('match_pool').delete().eq('user_id', session.user.id);
	showPage('match-page');
	return;
	}

	const otherUserId = match.user1_id === session.user.id ? match.user2_id : match.user1_id;
	const { data: profile, error: pError } = await supabase.from('profiles').select('*').eq('id', otherUserId).single();
	if (pError || !profile) {
	alert('Profile fetch error.');
	showPage('match-page');
	return;
	}

	document.getElementById('matched-display-name').textContent = profile.display_name;
	document.getElementById('matched-username').textContent = profile.username;
	document.getElementById('matched-sex').textContent = profile.sex;
	document.getElementById('matched-age').textContent = profile.age;

	channel = supabase.channel(`chat:${matchId}`);
	channel.on('broadcast', { event: 'message' }, ({ payload }) => addMessage(payload.text, payload.user_id === session.user.id));
	channel.on('broadcast', { event: 'user_left' }, () => {
	addMessage(`${profile.username} left the chat.`, false, true);
	document.getElementById('message-input').disabled = true;
	document.getElementById('send-button').disabled = true;
	});
	channel.subscribe();
	showPage('chat-page');
}

function addMessage(text, isSelf, isSystem = false) {
	const div = document.createElement('div');
	div.className = `border-0 py-1 d-flex flex-column my-2 ${isSelf ? 'align-items-end' : 'align-items-start'}`;
	div.innerHTML = `<div class="d-inline-block rounded p-2 ${isSystem ? 'bg-danger text-white' : isSelf ? 'bg-primary text-white' : 'bg-light'}"><div class="text-sm">${text}</div></div>`;
	document.getElementById('chat-messages').appendChild(div);
}

document.getElementById('send-button').onclick = () => {
	const input = document.getElementById('message-input');
	if (input.value.trim()) {
	addMessage(input.value, true);
	channel.send({ type: 'broadcast', event: 'message', payload: { text: input.value, user_id: session.user.id } });
	input.value = '';
	}
};

document.getElementById('skip-button').onclick = async () => {
	if (channel) channel.send({ type: 'broadcast', event: 'user_left' });
	await endChat();
	document.getElementById('match-button').click();
};

document.getElementById('exit-button').onclick = async () => {
	if (channel) channel.send({ type: 'broadcast', event: 'user_left' });
	await endChat();
	showPage('match-page');
};

async function endChat() {
	if (currentMatchId) await supabase.from('matched_users').delete().eq('id', currentMatchId);
	if (channel) channel.unsubscribe();
	document.getElementById('chat-messages').innerHTML = '';
	currentMatchId = null;
	document.getElementById('message-input').disabled = false;
	document.getElementById('send-button').disabled = false;
}

document.getElementById('profile-button').onclick = async () => {
	const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
	if (error || !data) return alert('Profile load failed.');
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
	alert(error ? error.message : 'Profile updated');
	if (!error) showPage('match-page');
};

document.getElementById('logout-button').onclick = async () => {
	await supabase.auth.signOut();
	session = null;
	showPage('auth-page');
};