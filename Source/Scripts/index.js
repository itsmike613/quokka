// Supabase client (replace with your credentials)
const SUPABASE_URL = 'https://tbypaeavdibkbirujfws.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRieXBhZWF2ZGlia2JpcnVqZndzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA4MTE0MjIsImV4cCI6MjA2NjM4NzQyMn0.NY9aOkTzrd1vFrYBtqK3QDzUlCYXPodP4zJxyMKORfY';
const supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_KEY);

// DOM elements
const pages = {
  auth: document.getElementById('auth-page'),
  match: document.getElementById('match-page'),
  chat: document.getElementById('chat-page'),
  profile: document.getElementById('profile-page')
};
const forms = {
  create: document.getElementById('create-account-form').querySelector('form'),
  login: document.getElementById('login-form').querySelector('form'),
  profile: document.getElementById('profile-page').querySelector('form')
};
const buttons = {
  match: document.getElementById('match-button'),
  send: document.getElementById('send-button'),
  skip: document.getElementById('skip-button'),
  exit: document.getElementById('exit-button'),
  logout: document.getElementById('logout-button')
};
const profileLink = document.getElementById('profile-link');

let currentUser = null;
let matchedUser = null;
let subscription = null;

// Show page
function showPage(page) {
  Object.values(pages).forEach(p => p.style.display = 'none');
  pages[page].style.display = 'block';
}

// Auth: Create Account
forms.create.addEventListener('submit', async e => {
  e.preventDefault();
  const data = {
    displayName: document.getElementById('display-name').value,
    username: document.getElementById('username').value,
    email: document.getElementById('email').value,
    password: document.getElementById('password').value,
    age: document.getElementById('age').value,
    sex: document.getElementById('sex').value
  };
  if (data.displayName.length < 3 || data.displayName.length > 16 || data.username.length < 3 || data.username.length > 16) {
    alert('Display Name and Username must be 3-16 characters.');
    return;
  }
  try {
    const { user, error } = await supabase.auth.signUp({ email: data.email, password: data.password });
    if (error) throw error;
    const { data: userData, error: insertError } = await supabase
      .from('users')
      .insert([{ id: user.id, ...data }]);
    if (insertError) throw insertError;
    currentUser = userData[0];
    showPage('match');
    loadTopics();
  } catch (error) {
    alert(error.message);
  }
});

// Auth: Login
forms.login.addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    const { user, error } = await supabase.auth.signIn({ email, password });
    if (error) throw error;
    const { data, error: fetchError } = await supabase.from('users').select('*').eq('id', user.id).single();
    if (fetchError) throw fetchError;
    currentUser = data;
    showPage('match');
    loadTopics();
  } catch (error) {
    alert(error.message);
  }
});

// Load topics
async function loadTopics() {
  const { data, error } = await supabase.from('topics').select('*');
  if (error) return alert(error.message);
  const container = document.getElementById('topics-container');
  container.innerHTML = '';
  data.forEach(topic => {
    const badge = document.createElement('span');
    badge.className = 'badge badge-secondary mr-2 mb-2';
    badge.textContent = topic.name;
    badge.addEventListener('click', () => badge.classList.toggle('badge-primary').classList.toggle('badge-secondary'));
    container.appendChild(badge);
  });
}

// Match
buttons.match.addEventListener('click', async () => {
  const desiredSex = document.getElementById('desired-sex').value;
  const selectedTopics = Array.from(document.querySelectorAll('.badge-primary')).map(b => b.textContent);
  const { data: topicsData, error: topicsError } = await supabase.from('topics').select('id').in('name', selectedTopics);
  if (topicsError) return alert(topicsError.message);
  const topicIds = topicsData.map(t => t.id);
  buttons.match.disabled = true;
  buttons.match.textContent = 'Matching...';
  const { data, error } = await supabase.rpc('match_users', {
    p_user_id: currentUser.id,
    p_desired_sex: desiredSex,
    p_topics: topicIds
  });
  buttons.match.disabled = false;
  buttons.match.textContent = 'Match';
  if (error) return alert(error.message);
  if (!data) return alert('No match found.');
  matchedUser = data;
  showChatPage();
});

// Chat page
async function showChatPage() {
  showPage('chat');
  const { data, error } = await supabase.from('users').select('display_name, username, sex, age').eq('id', matchedUser).single();
  if (error) return alert(error.message);
  document.getElementById('matched-user-display-name').textContent = data.display_name;
  document.getElementById('matched-user-username').textContent = data.username;
  document.getElementById('matched-user-sex').textContent = data.sex;
  document.getElementById('matched-user-age').textContent = data.age;
  if (subscription) supabase.removeSubscription(subscription);
  subscription = supabase
    .from(`messages:sender_id=eq.${currentUser.id}&receiver_id=eq.${matchedUser}|sender_id=eq.${matchedUser}&receiver_id=eq.${currentUser.id}`)
    .on('INSERT', payload => {
      const msg = payload.new;
      const div = document.createElement('div');
      div.textContent = msg.content;
      div.className = msg.sender_id === currentUser.id ? 'text-right text-primary' : 'text-left text-muted';
      if (msg.content.startsWith('[System]')) div.className = 'text-center text-danger';
      document.getElementById('messages-area').appendChild(div);
    })
    .subscribe();
}

// Send message
buttons.send.addEventListener('click', async () => {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content) return;
  const { error } = await supabase.from('messages').insert({ sender_id: currentUser.id, receiver_id: matchedUser, content });
  if (error) alert(error.message);
  else input.value = '';
});

// Skip
buttons.skip.addEventListener('click', async () => {
  await supabase.from('messages').insert({
    sender_id: currentUser.id,
    receiver_id: matchedUser,
    content: `[System] ${currentUser.username} left the chat.`
  });
  document.getElementById('message-input').disabled = true;
  buttons.send.disabled = true;
  buttons.skip.disabled = true;
  buttons.exit.disabled = true;
  buttons.match.click();
});

// Exit
buttons.exit.addEventListener('click', () => {
  showPage('match');
  matchedUser = null;
  if (subscription) supabase.removeSubscription(subscription);
});

// Profile page
profileLink.addEventListener('click', e => {
  e.preventDefault();
  showPage('profile');
  document.getElementById('profile-display-name').value = currentUser.display_name;
  document.getElementById('profile-username').value = currentUser.username;
});

// Save profile
forms.profile.addEventListener('submit', async e => {
  e.preventDefault();
  const displayName = document.getElementById('profile-display-name').value;
  const username = document.getElementById('profile-username').value;
  if (displayName.length < 3 || displayName.length > 16 || username.length < 3 || username.length > 16) {
    alert('Display Name and Username must be 3-16 characters.');
    return;
  }
  const { data, error } = await supabase.from('users').select('id').eq('username', username).neq('id', currentUser.id);
  if (error) return alert(error.message);
  if (data.length > 0) return alert('Username is taken.');
  const { error: updateError } = await supabase.from('users').update({ display_name: displayName, username }).eq('id', currentUser.id);
  if (updateError) return alert(updateError.message);
  currentUser.display_name = displayName;
  currentUser.username = username;
  alert('Profile updated.');
});

// Logout
buttons.logout.addEventListener('click', async () => {
  await supabase.auth.signOut();
  currentUser = null;
  showPage('auth');
});