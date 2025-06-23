const supabase = window.supabase.createClient('https://iixlcjzlsexccqzveoug.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpeGxjanpsc2V4Y2NxenZlb3VnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MTM2OTAsImV4cCI6MjA2NjI4OTY5MH0.6c6Oomi-bG-b2tFY873wpIKq9V9r871FH9nrJqoTYSI');
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
  document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
  document.getElementById(pageId).style.display = 'block';
}

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

function init() {
  supabase.auth.onAuthStateChange((event, newSession) => {
    session = newSession;
    if (newSession) {
      showPage('match-page');
      if (event === 'SIGNED_IN') loadMatchFormSettings();
    } else {
      showPage('auth-page');
    }
  });
}
init();

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

  const { error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password
  });
  if (signUpError) return alert(signUpError.message);

  const { error: profileError } = await supabase.from('profiles').insert({
    id: (await supabase.auth.getUser()).user.id,
    display_name: data.display_name,
    username: data.username,
    age: data.age,
    sex: data.sex
  });

  if (profileError) {
    alert(`Failed to create profile: ${profileError.message}`);
    await supabase.auth.signOut();
  }
};

document.getElementById('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const { error } = await supabase.auth.signInWithPassword({
    email: form['login-email'].value,
    password: form['login-password'].value
  });
  if (error) alert(error.message);
};

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

document.getElementById('match-button').onclick = async () => {
  if (!session) {
    alert('Please log in to continue.');
    return;
  }
  const desiredSex = document.getElementById('desired-sex').value;
  const selectedTopics = [...document.querySelectorAll('.bg-primary')].map(b => b.textContent);

  try {
    // Remove user from match pool if already present
    const { error: deleteError } = await supabase.from('match_pool').delete().eq('user_id', session.user.id);
    if (deleteError) throw new Error(`Failed to clear match pool: ${deleteError.message}`);

    // Add user to match pool
    const { error: poolError } = await supabase.from('match_pool').insert({
      user_id: session.user.id,
      desired_sex: desiredSex,
      topics: selectedTopics.length ? selectedTopics : null
    });
    if (poolError) throw new Error(`Failed to join match pool: ${poolError.message}`);

    console.log('Joined match pool:', { user_id: session.user.id, desired_sex: desiredSex, topics: selectedTopics });
    showPage('loading-page');

    // Try to find a match immediately
    let { data: matchId, error: matchError } = await supabase.rpc('try_match', {
      p_user_id: session.user.id,
      p_desired_sex: desiredSex,
      p_topics: selectedTopics.length ? selectedTopics : null
    });
    if (matchError) throw new Error(`Match error: ${matchError.message}`);

    if (matchId) {
      currentMatchId = matchId;
      await startChat(matchId);
      return;
    }

    // Poll for a match with timeout
    const startTime = Date.now();
    const timeoutMs = 30000; // 30 seconds
    while (Date.now() - startTime < timeoutMs) {
      ({ data: matchId, error: matchError } = await supabase.rpc('try_match', {
        p_user_id: session.user.id,
        p_desired_sex: desiredSex,
        p_topics: selectedTopics.length ? selectedTopics : null
      }));
      if (matchError) throw new Error(`Match error: ${matchError.message}`);

      if (matchId) {
        currentMatchId = matchId;
        await startChat(matchId);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retrying
    }

    // Timeout reached
    const { error: timeoutDeleteError } = await supabase.from('match_pool').delete().eq('user_id', session.user.id);
    if (timeoutDeleteError) console.error('Failed to clear match pool on timeout:', timeoutDeleteError.message);
    alert('No match found. Please try again.');
    showPage('match-page');
  } catch (err) {
    console.error('Match process error:', err.message);
    alert(`Matching failed: ${err.message}`);
    const { error: cleanupError } = await supabase.from('match_pool').delete().eq('user_id', session.user.id);
    if (cleanupError) console.error('Failed to clear match pool on error:', cleanupError.message);
    showPage('match-page');
  }
};

async function startChat(matchId) {
  if (!session) {
    alert('Please log in to continue.');
    showPage('auth-page');
    return;
  }
  try {
    console.log('Starting chat with match ID:', matchId);
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select('user1_id, user2_id')
      .eq('id', matchId)
      .single();
    if (matchError || !match) throw new Error(`Failed to fetch match: ${matchError?.message || 'No data'}`);

    const matchedUserId = match.user1_id === session.user.id ? match.user2_id : match.user1_id;
    console.log('Matched user ID:', matchedUserId);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', matchedUserId)
      .single();
    if (profileError || !profile) throw new Error(`Failed to fetch profile: ${profileError?.message || 'No data'}`);

    console.log('Matched profile:', profile);
    document.getElementById('matched-display-name').textContent = profile.display_name;
    document.getElementById('matched-username').textContent = profile.username;
    document.getElementById('matched-sex').textContent = profile.sex;
    document.getElementById('matched-age').textContent = profile.age;

    const channelName = `chat:${Math.min(session.user.id, matchedUserId)}:${Math.max(session.user.id, matchedUserId)}`;
    channel = supabase.channel(channelName);
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
  } catch (err) {
    console.error('Start chat error:', err.message);
    alert(`Error starting chat: ${err.message}`);
    const { error: deleteError } = await supabase.from('matches').delete().eq('id', matchId);
    if (deleteError) console.error('Failed to delete match:', deleteError.message);
    showPage('match-page');
  }
}

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

document.getElementById('send-button').onclick = () => {
  const input = document.getElementById('message-input');
  if (input.value.trim() && channel) {
    addMessage(input.value, true);
    channel.send({
      type: 'broadcast',
      event: 'message',
      payload: { text: input.value, user_id: session.user.id }
    });
    input.value = '';
  }
};

document.getElementById('skip-button').onclick = async () => {
  if (channel) {
    channel.send({ type: 'broadcast', event: 'user_left' });
  }
  await endChat();
  document.getElementById('match-button').click();
};

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
    showPage('auth-page');
    return;
  }
  try {
    if (currentMatchId) {
      const { error } = await supabase.from('matches').delete().eq('id', currentMatchId);
      if (error) console.error('Failed to delete match:', error.message);
      currentMatchId = null;
    }
    if (channel) {
      await channel.unsubscribe();
      channel = null;
    }
    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-button').disabled = false;
  } catch (err) {
    console.error('Error during endChat:', err);
  }
}

document.getElementById('profile-button').onclick = async () => {
  if (!session) {
    alert('Please log in to continue.');
    showPage('auth-page');
    return;
  }
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (error || !data) throw new Error('Failed to load profile.');
    document.getElementById('profile-display-name').value = data.display_name;
    document.getElementById('profile-username').value = data.username;
    showPage('profile-page');
  } catch (err) {
    console.error('Profile load error:', err);
    alert('Failed to load profile. Please try again.');
  }
};

document.getElementById('profile-form').onsubmit = async e => {
  e.preventDefault();
  if (!session) {
    alert('Please log in to continue.');
    showPage('auth-page');
    return;
  }
  const form = e.target;
  const data = {
    display_name: form['profile-display-name'].value,
    username: form['profile-username'].value
  };
  if (data.display_name.length < 3 || data.display_name.length > 16 ||
      data.username.length < 3 || data.username.length > 16) {
    return alert('Display Name and Username must be 3-16 characters');
  }
  try {
    const { error } = await supabase.from('profiles').update(data).eq('id', session.user.id);
    alert(error ? error.message : 'Profile updated');
    if (!error) showPage('match-page');
  } catch (err) {
    console.error('Profile update error:', err);
    alert('Failed to update profile. Please try again.');
  }
};

document.getElementById('logout-button').onclick = async () => {
  await supabase.auth.signOut();
};