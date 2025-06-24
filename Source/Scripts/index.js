const supabase = window.supabase.createClient('https://evnmqklbbmltrgdyiuzv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2bm1xa2xiYm1sdHJnZHlpdXp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzQ0ODgsImV4cCI6MjA2NjMxMDQ4OH0.tZYH_6GWh0yJANuf3tNVOgABj6HBNeYLTcyqL4lKaEY');
let session, channel, currentMatch;
let matchChannel;

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
  
  // Clear any existing pool entry
  await supabase.from('match_pool').delete().eq('user_id', session.user.id);
  
  // Join match pool
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
  findMatch();
};

async function findMatch() {
  // Create unique channel for match updates
  matchChannel = supabase.channel(`match_updates_${session.user.id}`);
  
  // Listen for match notifications
  matchChannel.on('broadcast', { event: 'matched' }, (payload) => {
    startChat(payload.channel_id, payload.other_user_id);
  }).subscribe();

  const poll = setInterval(async () => {
    try {
      const { data, error } = await supabase.rpc('find_match', {
        current_user_id: session.user.id
      });
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        clearInterval(poll);
        const { matched_user_id, channel_id } = data[0];
        
        // Notify the other user
        const notifyChannel = supabase.channel(`match_updates_${matched_user_id}`);
        notifyChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            notifyChannel.send({
              type: 'broadcast',
              event: 'matched',
              payload: { 
                channel_id, 
                other_user_id: session.user.id 
              }
            });
          }
        });
        
        startChat(channel_id, matched_user_id);
      }
    } catch (error) {
      console.error('Matching error:', error);
      clearInterval(poll);
      showPage('match-page');
    }
  }, 3000);
}

async function startChat(channelId, otherUserId) {
  // Clean up match listener
  if (matchChannel) {
    matchChannel.unsubscribe();
  }
  
  // Get profile with proper error handling
  let profile;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', otherUserId)
      .single();
    
    if (error) throw error;
    profile = data;
  } catch (error) {
    console.error('Profile fetch error:', error);
    // Get the user's actual ID as fallback
    profile = {
      display_name: `User ${otherUserId.slice(0, 8)}`,
      username: `user_${otherUserId.slice(0, 8)}`
    };
  }

  // Display profile
  document.getElementById('matched-display-name').textContent = profile.display_name;
  document.getElementById('matched-username').textContent = profile.username;

  // Setup chat channel
  channel = supabase.channel(channelId, {
    config: {
      presence: {
        key: session.user.id
      }
    }
  });
  
  // Message handler
  channel.on('broadcast', { event: 'message' }, ({ payload }) => {
    addMessage(payload.text, payload.user_id === session.user.id);
  });
  
  // User left handler
  channel.on('broadcast', { event: 'user_left' }, () => {
    addMessage('Partner left the chat', false, true);
    disableChat();
  });
  
  // Presence tracking
  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    const otherUserPresent = Object.keys(state).some(key => key !== session.user.id);
    
    if (!otherUserPresent) {
      addMessage('Partner disconnected', false, true);
      disableChat();
    }
  });
  
  // Track user presence
  channel.track({ online_at: new Date().toISOString() });
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
  const message = input.value.trim();
  
  if (message) {
    addMessage(message, true);
    channel.send({
      type: 'broadcast',
      event: 'message',
      payload: { text: message, user_id: session.user.id }
    });
    input.value = '';
  }
};

document.getElementById('skip-button').onclick = async () => {
  if (channel) {
    channel.send({ type: 'broadcast', event: 'user_left' });
    channel.unsubscribe();
    channel = null;
  }
  
  await supabase.from('matched_users')
    .delete()
    .or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`);
  
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('match-button').click();
};

// Exit chat handler
document.getElementById('exit-button').onclick = async () => {
  if (channel) {
    channel.send({ type: 'broadcast', event: 'user_left' });
    channel.unsubscribe();
    channel = null;
  }
  
  await supabase.from('matched_users')
    .delete()
    .or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`);
  
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
  // Clean up before logout
  await supabase.from('match_pool').delete().eq('user_id', session.user.id);
  await supabase.from('matched_users').delete().or(
    `user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`
  );
  
  await supabase.auth.signOut();
  session = null;
  showPage('auth-page');
};

// Initialize app
init();