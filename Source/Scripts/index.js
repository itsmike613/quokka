const supabase = window.supabase.createClient('https://mfqrlzogwdgrjzigxlmg.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mcXJsem9nd2Rncmp6aWd4bG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1NDM3MzksImV4cCI6MjA2NjExOTczOX0.oXx3VT_IIZqbPLYF2AcIg_INQoAlle7OClTDOIHHskk');
let session, channel, currentMatchRequest;

const topics = {
    'Sports': ['Basketball', 'Soccer', 'Baseball'],
    'Games': ['Call of Duty', 'Valorant', 'Minecraft']
};

// Show specific page
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
    document.getElementById(pageId).style.display = 'block';
}

// Check session on load
async function init() {
    const { data: { session: s } } = await supabase.auth.getSession();
    session = s;
    showPage(session ? 'match-page' : 'auth-page');
}
init();

// Sign Up
document.getElementById('signup-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
        display_name: form['display-name'].value,
        username: form.username.value,
        email: form.email.value,
        password: form.password.value,
        age: parseInt(form.age.value),
        sex: form.sex.value,
        state: form.state.value
    };

    // Basic input validation
    if (data.display_name.length < 3 || data.display_name.length > 16 ||
        data.username.length < 3 || data.username.length > 16) {
        return alert('Display Name and Username must be 3-16 characters');
    }

    // Sign up the user (email and password go to auth.users)
    const { data: userData, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password
    });

    if (signUpError) {
        return alert(signUpError.message);
    }

    // Insert profile data (excluding email, matching table schema)
    const profileData = {
        id: userData.user.id,
        display_name: data.display_name,
        username: data.username,
        age: data.age,
        sex: data.sex,
        state: data.state
    };

    const { error: profileError } = await supabase
        .from('profiles')
        .insert(profileData);

    if (profileError) {
        // If profile creation fails, sign out and prompt retry
        alert(`Failed to create profile: ${profileError.message}. Please try again.`);
        await supabase.auth.signOut();
    } else {
        // Success: store session and proceed
        session = userData.session;
        showPage('match-page');
    }
};

// Login
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

// Generate Topics
const topicsContainer = document.getElementById('topics-container');
Object.entries(topics).forEach(([category, items]) => {
    topicsContainer.innerHTML += `<h5>${category}</h5>`;
    items.forEach(topic => {
        const badge = document.createElement('span');
        badge.className = 'badge bg-secondary m-1';
        badge.textContent = topic;
        badge.style.cursor = 'pointer';
        badge.onclick = () => {
            badge.classList.toggle('bg-secondary');
            badge.classList.toggle('bg-primary');
        };
        topicsContainer.appendChild(badge);
    });
});

// Match
document.getElementById('match-button').onclick = async () => {
    const desiredSex = document.getElementById('desired-sex').value;
    const selectedTopics = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);
    const { data, error } = await supabase.from('match_requests').insert({
        user_id: session.user.id,
        desired_sex: desiredSex,
        topics: selectedTopics.length ? selectedTopics : null
    }).select();
    if (error) return alert(error.message);
    currentMatchRequest = data[0];
    showPage('loading-page');
    const interval = setInterval(async () => {
        const { data: matchId } = await supabase.rpc('find_match', { current_mr_id: currentMatchRequest.id });
        if (matchId) {
            clearInterval(interval);
            await startChat(matchId);
        }
    }, 2000);
};

// Start Chat
async function startChat(matchId) {
    const { data: matchedMr } = await supabase.from('match_requests').select('user_id').eq('id', matchId).single();
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', matchedMr.user_id).single();
    document.getElementById('matched-display-name').textContent = profile.display_name;
    document.getElementById('matched-username').textContent = profile.username;
    document.getElementById('matched-sex').textContent = profile.sex;
    document.getElementById('matched-state').textContent = profile.state;
    document.getElementById('matched-age').textContent = profile.age;

    const channelName = `chat:${Math.min(currentMatchRequest.id, matchId)}:${Math.max(currentMatchRequest.id, matchId)}`;
    channel = supabase.channel(channelName);
    channel.on('broadcast', { event: 'message' }, ({ payload }) => addMessage(payload.text, payload.user_id === session.user.id));
    channel.on('broadcast', { event: 'user_left' }, () => {
        alert('The other user has left the chat');
        endChat();
        showPage('match-page');
    });
    channel.subscribe();
    showPage('chat-page');
}

// Add Message
function addMessage(text, isSelf) {
    const div = document.createElement('div');
    div.textContent = text;
    div.className = `message ${isSelf ? 'self' : 'other'}`;
    document.getElementById('chat-messages').appendChild(div);
}

// Send Message
document.getElementById('send-button').onclick = () => {
    const input = document.getElementById('message-input');
    if (input.value.trim()) {
        channel.send({ type: 'broadcast', event: 'message', payload: { text: input.value, user_id: session.user.id } });
        input.value = '';
    }
};

// Skip
document.getElementById('skip-button').onclick = async () => {
    channel.send({ type: 'broadcast', event: 'user_left' });
    await supabase.from('match_requests').delete().eq('id', currentMatchRequest.id);
    channel.unsubscribe();
    document.getElementById('match-button').click();
};

// Exit
document.getElementById('exit-button').onclick = async () => {
    channel.send({ type: 'broadcast', event: 'user_left' });
    endChat();
    showPage('match-page');
};

function endChat() {
    supabase.from('match_requests').delete().eq('id', currentMatchRequest.id);
    channel.unsubscribe();
    document.getElementById('chat-messages').innerHTML = '';
}

// Profile
document.getElementById('profile-button').onclick = async () => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (error || !data) {
        alert('Failed to load profile. Please try again.');
        return;
    }
    document.getElementById('profile-display-name').value = data.display_name;
    document.getElementById('profile-username').value = data.username;
    showPage('profile-page');
};

document.getElementById('profile-form').onsubmit = async e => {
    e.preventDefault();
    const form = e.target;
    const data = {
        display_name: form['profile-display-name'].value,
        username: form['profile-username'].value
    };
    if (data.display_name.length < 3 || data.display_name.length > 16 || data.username.length < 3 || data.username.length > 16) {
        return alert('Display Name and Username must be 3-16 characters');
    }
    const { error } = await supabase.from('profiles').update(data).eq('id', session.user.id);
    alert(error ? error.message : 'Profile updated');
    if (!error) showPage('match-page');
};

// Logout
document.getElementById('logout-button').onclick = async () => {
    await supabase.auth.signOut();
    session = null;
    showPage('auth-page');
};