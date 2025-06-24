const supabase = window.supabase.createClient('https://evnmqklbbmltrgdyiuzv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2bm1xa2xiYm1sdHJnZHlpdXp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzQ0ODgsImV4cCI6MjA2NjMxMDQ4OH0.tZYH_6GWh0yJANuf3tNVOgABj6HBNeYLTcyqL4lKaEY');

let session, channel;
const topics = {
  'Sports': ['Basketball', 'Hockey', 'Soccer', 'Swimming'],
  'Games': ['Call of Duty', 'Valorant', 'Minecraft', 'Roblox']
};

// Initialize app
async function init() {
  const { data: { session: currentSession } } = await supabase.auth.getSession();
  session = currentSession;
  showPage(session ? 'match-page' : 'auth-page');
  if (session) loadMatchFormSettings();
}

// Basic UI functions
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
  document.getElementById(pageId).style.display = 'block';
}

function loadMatchFormSettings() {
  const savedSex = localStorage.getItem('desired_sex') || 'Either';
  document.getElementById('desired-sex').value = savedSex;
}

// Auth handlers
document.getElementById('create-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = {
    email: form.email.value,
    password: form.password.value,
    display_name: form['display-name'].value,
    username: form.username.value,
    age: parseInt(form.age.value),
    sex: form.sex.value
  };

  const { data: userData, error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password
  });

  if (signUpError) return alert(signUpError.message);

  await supabase.from('profiles').insert({
    id: userData.user.id,
    display_name: data.display_name,
    username: data.username,
    age: data.age,
    sex: data.sex
  });

  session = userData.session;
  showPage('match-page');
};

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

// Matchmaking
document.getElementById('match-button').onclick = async () => {
  const desiredSex = document.getElementById('desired-sex').value;
  
  await supabase.from('match_pool').delete().eq('user_id', session.user.id);
  
  await supabase.from('match_pool').insert({
    user_id: session.user.id,
    desired_sex: desiredSex
  });
  
  showPage('loading-page');
  findMatch();
};

async function findMatch() {
  const poll = setInterval(async () => {
    const { data: matchedUserId, error } = await supabase.rpc('find_match', {
      current_user_id: session.user.id
    });
    
    if (error) {
      console.error('Match error:', error);
      clearInterval(poll);
      showPage('match-page');
      return;
    }
    
    if (matchedUserId) {
      clearInterval(poll);
      startChat(matchedUserId);
    }
  }, 3000);
}

async function startChat(matchedUserId) {
  // Get matched user's profile
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name, username')
    .eq('id', matchedUserId)
    .single();
  
  if (error) {
    console.error('Profile fetch error:', error);
    showPage('match-page');
    return;
  }

  // Display profile
  document.getElementById('matched-display-name').textContent = profile.display_name;
  document.getElementById('matched-username').textContent = profile.username;

  // Create channel ID
  const user1 = session.user.id < matchedUserId ? session.user.id : matchedUserId;
  const user2 = session.user.id < matchedUserId ? matchedUserId : session.user.id;
  const channelId = `chat_${user1}_${user2}`;
  
  // Setup chat
  channel = supabase.channel(channelId);
  channel.on('broadcast', { event: 'message' }, ({ payload }) => {
    addMessage(payload.text, payload.sender === session.user.id);
  }).subscribe();
  
  showPage('chat-page');
}

// Chat functions
function addMessage(text, isSelf) {
  const div = document.createElement('div');
  div.classList.add('border-0', 'py-1');
  
  if (isSelf) {
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
  const text = input.value.trim();
  if (!text) return;
  
  addMessage(text, true);
  channel.send({
    type: 'broadcast',
    event: 'message',
    payload: { text, sender: session.user.id }
  });
  input.value = '';
};

document.getElementById('skip-button').onclick = async () => {
  if (channel) channel.unsubscribe();
  await supabase.from('matched_users').delete().or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`);
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('match-button').click();
};

document.getElementById('exit-button').onclick = async () => {
  if (channel) channel.unsubscribe();
  await supabase.from('matched_users').delete().or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`);
  document.getElementById('chat-messages').innerHTML = '';
  showPage('match-page');
};

// Initialize
init();