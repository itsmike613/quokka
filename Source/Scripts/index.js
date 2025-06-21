const supabase = Supabase.createClient('https://tegucnhyeejpjhfsejjx.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlZ3Vjbmh5ZWVqcGpoZnNlamp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA0NjM2ODYsImV4cCI6MjA2NjAzOTY4Nn0.S9eSb_AZ6DwTme4i5AghljcDq1YHfHNC8DE90NP89Kg'); // Replace with your Supabase URL and Anon Key

let currentUser = null;
let currentChatId = null;
let chatSubscription = null;
let matchSubscription = null;

// Show/hide pages
function showPage(pageId) {
    ['page_auth', 'page_match', 'page_chat', 'page_profile'].forEach(id => {
        document.getElementById(id).classList.add('d-none');
    });
    document.getElementById(pageId).classList.remove('d-none');
}

// Toggle between create and login forms
function toggleAuth() {
    document.getElementById('create').classList.toggle('d-none');
    document.getElementById('login').classList.toggle('d-none');
}

// Load topics dynamically
async function loadTopics() {
    const { data: topics, error } = await supabase.from('topics').select('name');
    if (error) return console.error('Error loading topics:', error);
    const container = document.getElementById('topics_container');
    container.innerHTML = '';
    topics.forEach(topic => {
        const badge = document.createElement('a');
        badge.href = '#';
        badge.classList.add('badge', 'bg-gray-400', 'me-1', 'mb-1');
        badge.innerHTML = `<i class="me-1 ph ph-game-controller"></i> ${topic.name}`;
        badge.addEventListener('click', (e) => {
            e.preventDefault();
            badge.classList.toggle('bg-gray-400');
            badge.classList.toggle('bg-cyan-700');
        });
        container.appendChild(badge);
    });
}

// Calculate age from date of birth
function calculateAge(birthday) {
    const birthDate = new Date(birthday);
    const ageDifMs = Date.now() - birthDate.getTime();
    return Math.floor(ageDifMs / (1000 * 60 * 60 * 24 * 365.25));
}

// Enter the matching queue
async function enterMatchingQueue() {
    const preferredSex = document.getElementById('preferred_sex').value;
    const selectedTopics = Array.from(document.querySelectorAll('#topics_container .bg-cyan-700'))
        .map(badge => badge.textContent.trim().split(' ').slice(1).join(' '));
    const { error } = await supabase.from('matching_queue').insert({
        user_id: currentUser.id,
        preferred_sex: preferredSex,
        topics: selectedTopics
    });
    if (error) return console.error('Error entering queue:', error);
    document.getElementById('match_status').classList.remove('d-none');
    matchSubscription = supabase
        .channel('chats')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chats', filter: `user1_id=eq.${currentUser.id}` }, handleNewChat)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chats', filter: `user2_id=eq.${currentUser.id}` }, handleNewChat)
        .subscribe();
    tryMatch();
}

// Attempt to match with another user
async function tryMatch() {
    const { data, error } = await supabase.rpc('try_match', { p_user_id: currentUser.id });
    if (error) console.error('Error trying to match:', error);
    else if (data) {
        currentChatId = data;
        loadChat();
    }
}

// Handle new chat creation
async function handleNewChat(payload) {
    currentChatId = payload.new.id;
    loadChat();
}

// Load chat details and start subscriptions
async function loadChat() {
    const { data: chat, error } = await supabase.from('chats').select('user1_id, user2_id').eq('id', currentChatId).single();
    if (error) return console.error('Error loading chat:', error);
    const otherUserId = chat.user1_id === currentUser.id ? chat.user2_id : chat.user1_id;
    const { data: otherUser, error: userError } = await supabase.from('profiles').select('*').eq('id', otherUserId).single();
    if (userError) return console.error('Error loading user:', userError);
    document.getElementById('match_displayname').textContent = otherUser.display_name;
    document.getElementById('match_username').textContent = otherUser.username;
    document.getElementById('match_sex').textContent = otherUser.sex;
    document.getElementById('match_state').textContent = otherUser.state;
    document.getElementById('match_age').textContent = calculateAge(otherUser.date_of_birth);
    document.getElementById('chat_messages').innerHTML = '';
    showPage('page_chat');
    if (matchSubscription) matchSubscription.unsubscribe();
    chatSubscription = supabase
        .channel('messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${currentChatId}` }, handleNewMessage)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chats', filter: `id=eq.${currentChatId}` }, () => showPage('page_match'))
        .subscribe();
}

// Handle new messages
async function handleNewMessage(payload) {
    const message = payload.new;
    const div = document.createElement('div');
    div.classList.add('border-0', 'py-1');
    if (message.sender_id === currentUser.id) {
        div.classList.add('d-flex', 'flex-column', 'align-items-end', 'my-3');
        div.innerHTML = `<div class="d-inline-block bg-primary text-white rounded p-2"><div class="text-sm">${message.message}</div></div>`;
    } else {
        div.innerHTML = `<div class="d-inline-block bg-light rounded p-2"><div class="text-sm">${message.message}</div></div>`;
    }
    document.getElementById('chat_messages').appendChild(div);
}

// Send a message
async function sendMessage() {
    const message = document.getElementById('chat_input').value.trim();
    if (!message) return;
    await supabase.from('messages').insert({ chat_id: currentChatId, sender_id: currentUser.id, message });
    document.getElementById('chat_input').value = '';
}

// End the chat
async function endChat() {
    await supabase.from('chats').delete().eq('id', currentChatId);
    if (chatSubscription) chatSubscription.unsubscribe();
}

// Load profile data
async function loadProfile() {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
    if (error) return console.error('Error loading profile:', error);
    document.getElementById('profile_display_name').value = data.display_name;
    document.getElementById('profile_username').value = data.username;
}

// Save profile changes
async function saveProfile() {
    const display_name = document.getElementById('profile_display_name').value;
    const username = document.getElementById('profile_username').value;
    const { error } = await supabase.from('profiles').update({ display_name, username }).eq('id', currentUser.id);
    if (error) {
        document.getElementById('profile_error').textContent = error.code === '23505' ? 'Username already taken' : error.message;
        document.getElementById('profile_error').classList.remove('d-none');
    } else {
        document.getElementById('profile_error').classList.add('d-none');
    }
}

// Event Listeners
document.getElementById('create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const display_name = document.querySelector('#create input[type="text"]:nth-child(2)').value;
    const username = document.querySelector('#create input[type="text"]:nth-child(4)').value;
    const email = document.querySelector('#create input[type="email"]').value;
    const password = document.querySelector('#create input[type="password"]').value;
    const date_of_birth = document.querySelector('#create input[type="date"]').value;
    const sex = document.querySelector('#create select').value;
    const state = document.querySelector('#create select:nth-child(12)').value;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
        document.getElementById('create_error').textContent = error.message;
        document.getElementById('create_error').classList.remove('d-none');
        return;
    }
    const user = data.user;
    const { error: profileError } = await supabase.from('profiles').insert({
        id: user.id, username, display_name, date_of_birth, sex, state
    });
    if (profileError) {
        document.getElementById('create_error').textContent = profileError.code === '23505' ? 'Username already taken' : profileError.message;
        document.getElementById('create_error').classList.remove('d-none');
        return;
    }
    currentUser = user;
    showPage('page_match');
    loadTopics();
});

document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.querySelector('#login input[type="email"]').value;
    const password = document.querySelector('#login input[type="password"]').value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        document.getElementById('login_error').textContent = error.message;
        document.getElementById('login_error').classList.remove('d-none');
        return;
    }
    currentUser = data.user;
    showPage('page_match');
    loadTopics();
});

document.getElementById('match_button').addEventListener('click', (e) => {
    e.preventDefault();
    enterMatchingQueue();
});

document.getElementById('send').addEventListener('click', (e) => {
    e.preventDefault();
    sendMessage();
});

document.getElementById('skip').addEventListener('click', async (e) => {
    e.preventDefault();
    await endChat();
    enterMatchingQueue();
});

document.getElementById('exit').addEventListener('click', async (e) => {
    e.preventDefault();
    await endChat();
    showPage('page_match');
});

document.getElementById('profile_save').addEventListener('click', (e) => {
    e.preventDefault();
    saveProfile();
});

document.getElementById('logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await supabase.auth.signOut();
    showPage('page_auth');
});

// Check for existing session
supabase.auth.getSession().then(({ data }) => {
    if (data.session) {
        currentUser = data.session.user;
        showPage('page_match');
        loadTopics();
    } else {
        showPage('page_auth');
    }
});