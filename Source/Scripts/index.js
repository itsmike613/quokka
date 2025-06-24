const supabase = window.supabase.createClient('https://cqmhugefopfideldbanr.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxbWh1Z2Vmb3BmaWRlbGRiYW5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MjM3NzUsImV4cCI6MjA2NjI5OTc3NX0.VjdEfzehdixgpJI8fv8OXjKvQnpa6P6rCYQvwb_6e48');
let session, channel, currentChannelId, matchSettings;

const topics = {
	'Sports': ['Basketball', 'Hockey', 'Soccer', 'Swimming'],
	'Games': ['Call of Duty', 'Valorant', 'Minecraft', 'Roblox']
};

// Initialize app
async function init() {
	const { data: { session: currentSession }, error } = await supabase.auth.getSession();
	session = currentSession;
	showPage(session ? 'match-page' : 'auth-page');
	if (session) loadMatchFormSettings();
}

// Toggle between auth forms
function toggleAuth() {
	document.getElementById('create-form').classList.toggle('d-none');
	document.getElementById('login-form').classList.toggle('d-none');
}

// Show specific page
function showPage(pageId) {
	document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
	document.getElementById(pageId).style.display = 'block';
}

// Load saved match settings
function loadMatchFormSettings() {
	const savedSex = localStorage.getItem('desired_sex') || 'Either';
	document.getElementById('desired-sex').value = savedSex;

	const savedTopics = JSON.parse(localStorage.getItem('selected_topics') || '[]');
	document.querySelectorAll('.badge').forEach(badge => {
		if (savedTopics.includes(badge.textContent)) {
			badge.classList.remove('bg-secondary');
			badge.classList.add('bg-primary');
		}
	});
}

// Create account handler
document.getElementById('create-form').onsubmit = async (e) => {
	e.preventDefault();
	const form = e.target;
	const data = {
		display_name: form['display-name'].value,
		username: form.username.value,
		email: form.email.value,
		password: form.password.value,
		age: parseInt(form.age.value),
		sex: form.sex.value
	};

	if (data.display_name.length < 3 || data.display_name.length > 16 ||
		data.username.length < 3 || data.username.length > 16) {
		return alert('Display Name and Username must be 3-16 characters');
	}

	const { data: userData, error: signUpError } = await supabase.auth.signUp({
		email: data.email,
		password: data.password
	});

	if (signUpError) return alert(signUpError.message);

	const { error: profileError } = await supabase.from('profiles').insert({
		id: userData.user.id,
		display_name: data.display_name,
		username: data.username,
		age: data.age,
		sex: data.sex
	});

	if (profileError) {
		alert(`Profile creation failed: ${profileError.message}`);
		await supabase.auth.signOut();
	} else {
		session = userData.session;
		showPage('match-page');
	}
};

// Login handler
document.getElementById('login-form').onsubmit = async e => {
	e.preventDefault();
	const form = e.target;
	const { data, error } = await supabase.auth.signInWithPassword({
		email: form['login-email'].value,
		password: form['login-password'].value
	});
	if (error) return alert(error.message);
	session = data.session;
	showPage('match-page');
};

// Initialize topics UI
const topicsContainer = document.getElementById('topics-container');
Object.entries(topics).forEach(([category, items]) => {
	const categoryHeader = document.createElement('h5');
	categoryHeader.textContent = category;
	topicsContainer.appendChild(categoryHeader);
	items.forEach(topic => {
		const badge = document.createElement('span');
		badge.className = 'badge bg-secondary m-1';
		badge.textContent = topic;
		badge.style.cursor = 'pointer';
		badge.onclick = () => {
			badge.classList.toggle('bg-secondary');
			badge.classList.toggle('bg-primary');
			const selectedTopics = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);
			localStorage.setItem('selected_topics', JSON.stringify(selectedTopics));
		};
		topicsContainer.appendChild(badge);
	});
});

// Match settings change handlers
document.getElementById('desired-sex').onchange = () => {
	localStorage.setItem('desired_sex', document.getElementById('desired-sex').value);
};

// Match button handler
document.getElementById('match-button').onclick = async () => {
	const desiredSex = document.getElementById('desired-sex').value;
	const selectedTopics = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);

	matchSettings = { desiredSex, selectedTopics };

	await supabase.from('match_pool').delete().eq('user_id', session.user.id);

	const { error: poolError } = await supabase.from('match_pool').insert({
		user_id: session.user.id,
		desired_sex: desiredSex,
		topics: selectedTopics.length ? selectedTopics : null
	});

	if (poolError) {
		console.error('Pool join error:', poolError);
		return alert('Failed to join match pool');
	}

	showPage('loading-page');
	startPolling();
};

// Poll for matches
async function startPolling() {
	const poll = setInterval(async () => {
		const { data: channelId, error } = await supabase.rpc('find_match', {
			user_id: session.user.id
		});

		if (error) {
			console.error('Match error:', error);
			clearInterval(poll);
			alert('Matching error. Please try again.');
			showPage('match-page');
			return;
		}

		if (channelId) {
			clearInterval(poll);
			startChat(channelId);
		}
	}, 2000);
}

// Start chat with matched user
async function startChat(channelId) {
	currentChannelId = channelId;

	const { data: pair, error: pairError } = await supabase
		.from('matched_users')
		.select('user1_id, user2_id')
		.eq('channel_id', channelId)
		.single();

	if (pairError || !pair) {
		console.error('Pair fetch error:', pairError);
		alert('Error starting chat');
		return showPage('match-page');
	}

	const otherUserId = pair.user1_id === session.user.id ? pair.user2_id : pair.user1_id;
	const { data: profile, error: profileError } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', otherUserId)
		.single();

	if (profileError || !profile) {
		console.error('Profile fetch error:', profileError);
		alert('Error loading match profile');
		return showPage('match-page');
	}

	document.getElementById('matched-display-name').textContent = profile.display_name;
	document.getElementById('matched-username').textContent = profile.username;
	document.getElementById('matched-sex').textContent = profile.sex;
	document.getElementById('matched-age').textContent = profile.age;

	channel = supabase.channel(channelId);
	channel.on('broadcast', { event: 'message' }, ({ payload }) =>
		addMessage(payload.text, payload.user_id === session.user.id)
	);
	channel.on('broadcast', { event: 'user_left' }, () => {
		addMessage('Your partner left the chat', false, true);
		disableChat();
	});
	channel.subscribe();

	showPage('chat-page');
}

// Add message to chat UI
function addMessage(text, isSelf, isSystem = false) {
	const div = document.createElement('div');
	div.classList.add('border-0', 'py-1');

	if (isSystem) {
		div.classList.add('d-flex', 'flex-column', 'align-items-end', 'my-2');
		div.innerHTML = `<div class="d-inline-block bg-danger text-white rounded p-2"><div class="text-sm">${text}</div></div>`;
	} else if (isSelf) {
		div.classList.add('d-flex', 'flex-column', 'align-items-end', 'my-2');
		div.innerHTML = `<div class="d-inline-block bg-primary text-white rounded p-2"><div class="text-sm">${text}</div></div>`;
	} else {
		div.classList.add('d-flex', 'flex-column', 'align-items-start', 'my-2');
		div.innerHTML = `<div class="d-inline-block bg-light rounded p-2"><div class="text-sm">${text}</div></div>`;
	}

	document.getElementById('chat-messages').appendChild(div);
}

// Send message handler
document.getElementById('send-button').onclick = () => {
	const input = document.getElementById('message-input');
	if (input.value.trim()) {
		addMessage(input.value, true);
		channel.send({
			type: 'broadcast',
			event: 'message',
			payload: { text: input.value, user_id: session.user.id }
		});
		input.value = '';
	}
};

// Skip match handler
document.getElementById('skip-button').onclick = async () => {
	if (channel) {
		channel.send({ type: 'broadcast', event: 'user_left' });
		channel.unsubscribe();
	}

	await supabase.from('matched_users').delete().eq('channel_id', currentChannelId);
	await supabase.from('match_pool').insert({
		user_id: session.user.id,
		...matchSettings
	});

	document.getElementById('chat-messages').innerHTML = '';
	showPage('loading-page');
	startPolling();
};

// Exit chat handler
document.getElementById('exit-button').onclick = async () => {
	if (channel) {
		channel.send({ type: 'broadcast', event: 'user_left' });
		channel.unsubscribe();
	}

	await supabase.from('matched_users').delete().eq('channel_id', currentChannelId);
	document.getElementById('chat-messages').innerHTML = '';
	showPage('match-page');
};

// Disable chat UI
function disableChat() {
	document.getElementById('message-input').disabled = true;
	document.getElementById('send-button').disabled = true;
}

// Profile button handler
document.getElementById('profile-button').onclick = async () => {
	const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
	if (error) return alert('Failed to load profile');
	document.getElementById('profile-display-name').value = data.display_name;
	document.getElementById('profile-username').value = data.username;
	showPage('profile-page');
};

// Update profile handler
document.getElementById('profile-form').onsubmit = async e => {
	e.preventDefault();
	const form = e.target;
	const data = {
		display_name: form['profile-display-name'].value,
		username: form['profile-username'].value
	};

	if (data.display_name.length < 3 || data.display_name.length > 16 ||
		data.username.length < 3 || data.username.length > 16) {
		return alert('Display Name and Username must be 3-16 characters');
	}

	const { error } = await supabase.from('profiles').update(data).eq('id', session.user.id);
	alert(error ? error.message : 'Profile updated');
	if (!error) showPage('match-page');
};

// Logout handler
document.getElementById('logout-button').onclick = async () => {
	await supabase.auth.signOut();
	session = null;
	showPage('auth-page');
};

// Initialize app
init();