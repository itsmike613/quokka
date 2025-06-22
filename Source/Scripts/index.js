const supabase = window.supabase.createClient('https://kotcxrjnvutpllojtkoo.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdGN4cmpudnV0cGxsb2p0a29vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1NTE0MTMsImV4cCI6MjA2NjEyNzQxM30.NcMrLfW6res9fUD-LlL2R1ohSf7lAsQy1h-eSOWcr6k');
let session, channel, currentMatchRequest;

const topics = {
  'Sports': ['Basketball', 'Soccer', 'Baseball'],
  'Games': ['Call of Duty', 'Valorant', 'Minecraft']
};

function toggleAuth() {
    document.getElementById('create-form').classList.toggle('d-none');
    document.getElementById('login-form').classList.toggle('d-none');
}

// Show specific page
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
  document.getElementById(pageId).style.display = 'block';
}

// Load match form settings from localStorage
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

// Check session on load
async function init() {
  const { data: { session: s }, error } = await supabase.auth.getSession();
  if (error) console.error('Session fetch error:', error);
  console.log('Initial session:', s ? 'Active' : 'None');
  session = s;
  showPage(session ? 'match-page' : 'auth-page');
  if (session) loadMatchFormSettings();
}
init();

// Sign Up
document.getElementById('create-form').onsubmit = async (e) => {
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

  if (data.display_name.length < 3 || data.display_name.length > 16 ||
      data.username.length < 3 || data.username.length > 16) {
    return alert('Display Name and Username must be 3-16 characters');
  }

  const { data: userData, error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password
  });

  if (signUpError) {
    return alert(signUpError.message);
  }

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
    alert(`Failed to create profile: ${profileError.message}. Please try again.`);
    await supabase.auth.signOut();
  } else {
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

document.getElementById('desired-sex').onchange = () => {
  localStorage.setItem('desired_sex', document.getElementById('desired-sex').value);
};

// Match
document.getElementById('match-button').onclick = async () => {
  const desiredSex = document.getElementById('desired-sex').value;
  const selectedTopics = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);

  try {
    await supabase.from('match_requests')
      .delete()
      .eq('user_id', session.user.id)
      .is('matched_with', null);
  } catch (err) {
    console.error('Error deleting old match requests:', err);
  }

  const { data, error } = await supabase.from('match_requests')
    .insert({
      user_id: session.user.id,
      desired_sex: desiredSex,
      topics: selectedTopics.length ? selectedTopics : null,
      participants: [session.user.id]
    })
    .select();

  if (error) {
    console.error('Match request insert error:', error);
    alert(`Failed to create match request: ${error.message}`);
    return;
  }

  console.log('Inserted match request:', JSON.stringify(data, null, 2));
  currentMatchRequest = data[0];
  showPage('loading-page');

  const interval = setInterval(async () => {
    try {
      const { data: matchId, error: matchError } = await supabase.rpc('find_match', {
        current_mr_id: currentMatchRequest.id
      });
      console.log('Find match result:', { matchId, matchError });

      if (matchError) {
        console.error('Find match error:', matchError);
        clearInterval(interval);
        alert('Error finding match. Please try again.');
        await supabase.from('match_requests').delete().eq('id', currentMatchRequest.id);
        showPage('match-page');
        return;
      }

      if (matchId) {
        clearInterval(interval);
        await startChat(matchId);
      }
    } catch (err) {
      console.error('Polling error:', err);
      clearInterval(interval);
      alert('Unexpected error during matching. Please try again.');
      await supabase.from('match_requests').delete().eq('id', currentMatchRequest.id);
      showPage('match-page');
    }
  }, 2000);
};

// Start Chat
async function startChat(matchId) {
  if (!session) {
    console.error('No active session. Redirecting to auth page.');
    alert('Session expired. Please log in again.');
    showPage('auth-page');
    return;
  }
  console.log('Starting chat with match ID:', matchId);
  const { data: matchedMr, error: mrError } = await supabase
    .from('match_requests')
    .select('user_id')
    .eq('id', matchId)
    .single();
  if (mrError || !matchedMr) {
    console.error('Failed to fetch matched request:', mrError?.message || 'No data');
    alert('Error starting chat. Returning to match page.');
    await supabase.from('match_requests').delete().eq('id', currentMatchRequest.id);
    showPage('match-page');
    return;
  }
  console.log('Matched request:', matchedMr);
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', matchedMr.user_id)
    .single();
  if (profileError || !profile) {
    console.error('Failed to fetch profile:', profileError?.message || 'No data');
    alert('Error starting chat. Returning to match page.');
    await supabase.from('match_requests').delete().eq('id', currentMatchRequest.id);
    showPage('match-page');
    return;
  }
  console.log('Matched profile:', profile);
  document.getElementById('matched-display-name').textContent = profile.display_name;
  document.getElementById('matched-username').textContent = profile.username;
  document.getElementById('matched-sex').textContent = profile.sex;
  document.getElementById('matched-state').textContent = profile.state;
  document.getElementById('matched-age').textContent = profile.age;

  const channelName = `chat:${Math.min(currentMatchRequest.id, matchId)}:${Math.max(currentMatchRequest.id, matchId)}`;
  channel = supabase.channel(channelName);
  channel.on('broadcast', { event: 'message' }, ({ payload }) => 
    addMessage(payload.text, payload.user_id === session.user.id)
  );
  channel.on('broadcast', { event: 'user_left' }, () => {
    addMessage('The other user has left the chat.', false, true);
    document.getElementById('message-input').disabled = true;
    document.getElementById('send-button').disabled = true;
  });
  channel.subscribe();
  showPage('chat-page');
}

// Add Message
function addMessage(text, isSelf, isSystem = false) {
  const div = document.createElement('div');
  div.textContent = text;
  div.className = `message ${isSystem ? 'system' : isSelf ? 'self' : 'other'}`;
  document.getElementById('chat-messages').appendChild(div);
}

// Send Message
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

// Skip
document.getElementById('skip-button').onclick = async () => {
  if (channel) {
    channel.send({ type: 'broadcast', event: 'user_left' });
  }
  await endChat();
  document.getElementById('match-button').click();
};

// Exit
document.getElementById('exit-button').onclick = async () => {
  if (channel) {
    channel.send({ type: 'broadcast', event: 'user_left' });
  }
  await endChat();
  showPage('match-page');
};

async function endChat() {
  if (!session) {
    console.log('No active session during endChat.');
    return;
  }
  if (currentMatchRequest) {
    try {
      await supabase.from('match_requests').delete().eq('id', currentMatchRequest.id);
      const { data: matchedMr, error: fetchError } = await supabase
        .from('match_requests')
        .select('matched_with')
        .eq('id', currentMatchRequest.id)
        .single();
      if (fetchError) {
        console.error('Error fetching matched request:', fetchError);
      } else if (matchedMr?.matched_with) {
        await supabase.from('match_requests').delete().eq('id', matchedMr.matched_with);
      }
    } catch (err) {
      console.error('Error during endChat cleanup:', err);
    }
  }
  if (channel) {
    channel.unsubscribe();
  }
  document.getElementById('chat-messages').innerHTML = '';
  currentMatchRequest = null;
  document.getElementById('message-input').disabled = false;
  document.getElementById('send-button').disabled = false;
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
  if (data.display_name.length < 3 || data.display_name.length > 16 || 
      data.username.length < 3 || data.username.length > 16) {
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