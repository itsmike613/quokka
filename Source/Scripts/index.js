const supabase = window.supabase.createClient(
	'https://kotcxrjnvutpllojtkoo.supabase.co',
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdGN4cmpudnV0cGxsb2p0a29vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1NTE0MTMsImV4cCI6MjA2NjEyNzQxM30.NcMrLfW6res9fUD-LlL2R1ohSf7lAsQy1h-eSOWcr6k'
);

let session, channel;

async function init() {
	const { data: { session: s }, error } = await supabase.auth.getSession();
	if (error) console.error('Session error:', error);
	session = s;
	showPage(session ? 'match-page' : 'auth-page');
	if (session) loadMatchSettings();

	supabase.auth.onAuthStateChange((event, newSession) => {
		session = newSession;
		showPage(session ? 'match-page' : 'auth-page');
	});
}
init();

function showPage(pageId) {
	document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
	document.getElementById(pageId).style.display = 'block';
}

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
		alert('Display Name and Username must be 3-16 characters');
		return;
	}

	const { data: userData, error } = await supabase.auth.signUp({
		email: data.email,
		password: data.password
	});

	if (error) {
		alert(error.message);
		return;
	}

	const profileData = {
		id: userData.user.id,
		display_name: data.display_name,
		username: data.username,
		age: data.age,
		sex: data.sex
	};

	const { error: profileError } = await supabase.from('profiles').insert(profileData);
	if (profileError) {
		alert(`Profile creation failed: ${profileError.message}`);
		await supabase.auth.signOut();
	} else {
		showPage('match-page');
	}
};

document.getElementById('login-form').onsubmit = async (e) => {
	e.preventDefault();
	const form = e.target;
	const { data, error } = await supabase.auth.signInWithPassword({
		email: form['login-email'].value,
		password: form['login-password'].value
	});
	if (error) alert(error.message);
	else showPage('match-page');
};

const topics = {
	'Sports': ['Basketball', 'Hockey', 'Soccer', 'Swimming'],
	'Games': ['Call of Duty', 'Valorant', 'Minecraft', 'Roblox']
};

function loadMatchSettings() {
	document.getElementById('desired-sex').value = localStorage.getItem('desired_sex') || 'Either';
	const savedTopics = JSON.parse(localStorage.getItem('selected_topics') || '[]');
	document.querySelectorAll('.badge').forEach(badge => {
		if (savedTopics.includes(badge.textContent)) {
			badge.classList.replace('bg-secondary', 'bg-primary');
		}
	});
}

function setupTopics() {
	const container = document.getElementById('topics-container');
	Object.entries(topics).forEach(([category, items]) => {
		const header = document.createElement('h5');
		header.textContent = category;
		container.appendChild(header);
		items.forEach(topic => {
			const badge = document.createElement('span');
			badge.className = 'badge bg-secondary m-1';
			badge.textContent = topic;
			badge.style.cursor = 'pointer';
			badge.onclick = () => {
				badge.classList.toggle('bg-secondary');
				badge.classList.toggle('bg-primary');
				const selected = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);
				localStorage.setItem('selected_topics', JSON.stringify(selected));
			};
			container.appendChild(badge);
		});
	});
}
setupTopics();

document.getElementById('desired-sex').onchange = () => {
	localStorage.setItem('desired_sex', document.getElementById('desired-sex').value);
};

let matchInterval;
document.getElementById('match-button').onclick = async () => {
	const desiredSex = document.getElementById('desired-sex').value;
	const selectedTopics = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);

	// Clean up existing queue entry
	await supabase.from('match_queue').delete().eq('user_id', session.user.id);

	const { error } = await supabase.from('match_queue').insert({
		user_id: session.user.id,
		desired_sex: desiredSex,
		topics: selectedTopics.length ? selectedTopics : null
	});
	if (error) {
		alert(`Failed to join queue: ${error.message}`);
		return;
	}

	showPage('loading-page');

	const queueChannel = supabase.channel('match_queue_changes');
	queueChannel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'match_queue' }, (payload) => {
		if (payload.old.user_id === session.user.id) {
			findActiveChat();
		}
	});
	queueChannel.subscribe();

	matchInterval = setInterval(async () => {
		const { data: chatId, error } = await supabase.rpc('find_match', { current_user_id: session.user.id });
		if (error) {
			console.error('Match error:', error);
		} else if (chatId) {
			clearInterval(matchInterval);
			queueChannel.unsubscribe();
			startChat(chatId);
		}
	}, 2000);

	window.onbeforeunload = async () => {
		await supabase.from('match_queue').delete().eq('user_id', session.user.id);
	};
};

async function findActiveChat() {
	const { data, error } = await supabase.from('active_chats')
		.select('id')
		.or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`)
		.single();
	if (error) {
		console.error('Find chat error:', error);
	} else if (data) {
		clearInterval(matchInterval);
		startChat(data.id);
	}
}

async function startChat(chatId) {
	const { data: chat, error } = await supabase.from('active_chats')
		.select('*')
		.eq('id', chatId)
		.single();
	if (error || !chat) {
		alert('Chat not found.');
		showPage('match-page');
		return;
	}

	const otherUserId = chat.user1_id === session.user.id ? chat.user2_id : chat.user1_id;
	const { data: profile, error: profileError } = await supabase.from('profiles')
		.select('*')
		.eq('id', otherUserId)
		.single();
	if (profileError || !profile) {
		alert('User profile not found.');
		showPage('match-page');
		return;
	}

	document.getElementById('matched-display-name').textContent = profile.display_name;
	document.getElementById('matched-username').textContent = profile.username;
	document.getElementById('matched-sex').textContent = profile.sex;
	document.getElementById('matched-age').textContent = profile.age;

	channel = supabase.channel(`chat:${chatId}`, {
		config: { broadcast: { ack: true } }
	});
	channel.on('broadcast', { event: 'message' }, ({ payload }) =>
		addMessage(payload.text, payload.user_id === session.user.id)
	);
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
	div.classList.add('border-0', 'py-1');
	if (isSystem) {
		div.classList.add('d-flex', 'flex-column', 'align-items-end', 'my-2');
		div.innerHTML = `<div class="d-inline-block bg-danger text-white rounded p-2">${text}</div>`;
	} else if (isSelf) {
		div.classList.add('d-flex', 'flex-column', 'align-items-end', 'my-2');
		div.innerHTML = `<div class="d-inline-block bg-primary text-white rounded p-2">${text}</div>`;
	} else {
		div.classList.add('d-flex', 'flex-column', 'align-items-start', 'my-2');
		div.innerHTML = `<div class="d-inline-block bg-light rounded p-2">${text}</div>`;
	}
	document.getElementById('chat-messages').appendChild(div);
}

document.getElementById('send-button').onclick = () => {
	const input = document.getElementById('message-input');
	if (input.value.trim()) {
		channel.send({
			type: 'broadcast',
			event: 'message',
			payload: { text: input.value, user_id: session.user.id }
		});
		addMessage(input.value, true);
		input.value = '';
	}
};

document.getElementById('skip-button').onclick = async () => {
	await endChat(true);
	document.getElementById('match-button').click();
};

document.getElementById('exit-button').onclick = async () => {
	await endChat(false);
	showPage('match-page');
};

async function endChat(requeue = false) {
	if (channel) {
		channel.send({ type: 'broadcast', event: 'user_left' });
		channel.unsubscribe();
	}
	await supabase.from('active_chats')
		.delete()
		.or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`);
	document.getElementById('chat-messages').innerHTML = '';
	document.getElementById('message-input').disabled = false;
	document.getElementById('send-button').disabled = false;
}

document.getElementById('profile-button').onclick = async () => {
	const { data, error } = await supabase.from('profiles')
		.select('*')
		.eq('id', session.user.id)
		.single();
	if (error) {
		alert('Failed to load profile.');
		return;
	}
	document.getElementById('profile-display-name').value = data.display_name;
	document.getElementById('profile-username').value = data.username;
	showPage('profile-page');
};

document.getElementById('profile-form').onsubmit = async (e) => {
	e.preventDefault();
	const form = e.target;
	const data = {
		display_name: form['profile-display-name'].value,
		username: form['profile-username'].value
	};
	if (data.display_name.length < 3 || data.display_name.length > 16 ||
		data.username.length < 3 || data.username.length > 16) {
		alert('Display Name and Username must be 3-16 characters');
		return;
	}
	const { error } = await supabase.from('profiles').update(data).eq('id', session.user.id);
	alert(error ? error.message : 'Profile updated');
	if (!error) showPage('match-page');
};

document.getElementById('logout-button').onclick = async () => {
	await supabase.from('match_queue').delete().eq('user_id', session.user.id);
	await supabase.auth.signOut();
};