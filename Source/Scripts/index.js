// Initialize Supabase client
        const SUPABASE_URL = 'https://kotcxrjnvutpllojtkoo.supabase.co';
        const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdGN4cmpudnV0cGxsb2p0a29vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1NTE0MTMsImV4cCI6MjA2NjEyNzQxM30.NcMrLfW6res9fUD-LlL2R1ohSf7lAsQy1h-eSOWcr6k';
        
        const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        
        // State management
        let session = null;
        let channel = null;
        let matchRequest = null;
        let matchInterval = null;
        
        // DOM Elements
        const pages = {
            auth: document.getElementById('auth-page'),
            match: document.getElementById('match-page'),
            loading: document.getElementById('loading-page'),
            chat: document.getElementById('chat-page'),
            profile: document.getElementById('profile-page')
        };
        
        // Initialize app
        async function initApp() {
            // Check for existing session
            const { data: { session: existingSession }, error } = await supabase.auth.getSession();
            
            if (error) {
                console.error('Session error:', error);
                showPage('auth');
                return;
            }
            
            if (existingSession) {
                session = existingSession;
                showPage('match');
                loadPreferences();
            } else {
                showPage('auth');
            }
            
            // Setup event listeners
            setupEventListeners();
        }
        
        // Show specific page
        function showPage(pageName) {
            // Hide all pages
            Object.values(pages).forEach(page => {
                page.style.display = 'none';
            });
            
            // Show requested page
            pages[pageName].style.display = 'block';
            
            // Additional setup per page
            if (pageName === 'match') {
                document.getElementById('desired-gender').focus();
            } else if (pageName === 'chat') {
                document.getElementById('message-input').focus();
            }
        }
        
        // Setup all event listeners
        function setupEventListeners() {
            // Auth forms
            document.getElementById('login-form').addEventListener('submit', handleLogin);
            document.getElementById('signup-form').addEventListener('submit', handleSignup);
            
            // Match page
            document.getElementById('match-btn').addEventListener('click', startMatch);
            document.getElementById('cancel-match-btn').addEventListener('click', cancelMatch);
            document.getElementById('profile-btn').addEventListener('click', () => showPage('profile'));
            document.getElementById('logout-btn').addEventListener('click', handleLogout);
            
            // Chat page
            document.getElementById('send-btn').addEventListener('click', sendMessage);
            document.getElementById('message-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') sendMessage();
            });
            document.getElementById('skip-chat-btn').addEventListener('click', skipChat);
            document.getElementById('leave-chat-btn').addEventListener('click', leaveChat);
            
            // Profile page
            document.getElementById('profile-form').addEventListener('submit', saveProfile);
            document.getElementById('back-to-match-btn').addEventListener('click', () => showPage('match'));
            
            // Topic selection
            document.querySelectorAll('.badge-topic').forEach(badge => {
                badge.addEventListener('click', () => {
                    badge.classList.toggle('selected');
                    badge.classList.toggle('bg-light');
                    badge.classList.toggle('bg-primary');
                    badge.classList.toggle('text-dark');
                    badge.classList.toggle('text-white');
                });
            });
        }
        
        // Load user preferences
        function loadPreferences() {
            const savedGender = localStorage.getItem('desiredGender') || 'Any';
            document.getElementById('desired-gender').value = savedGender;
            
            const savedTopics = JSON.parse(localStorage.getItem('selectedTopics') || '[]');
            document.querySelectorAll('.badge-topic').forEach(badge => {
                if (savedTopics.includes(badge.dataset.topic)) {
                    badge.classList.add('selected', 'bg-primary', 'text-white');
                    badge.classList.remove('bg-light', 'text-dark');
                }
            });
        }
        
        // Save preferences
        function savePreferences() {
            const desiredGender = document.getElementById('desired-gender').value;
            localStorage.setItem('desiredGender', desiredGender);
            
            const selectedTopics = Array.from(document.querySelectorAll('.badge-topic.selected'))
                .map(el => el.dataset.topic);
            localStorage.setItem('selectedTopics', JSON.stringify(selectedTopics));
        }
        
        // Handle login
        async function handleLogin(e) {
            e.preventDefault();
            
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });
            
            if (error) {
                alert(`Login failed: ${error.message}`);
                return;
            }
            
            session = data.session;
            showPage('match');
        }
        
        // Handle signup
        async function handleSignup(e) {
            e.preventDefault();
            
            const displayName = document.getElementById('display-name').value;
            const username = document.getElementById('username').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const age = document.getElementById('age').value;
            const gender = document.getElementById('gender').value;
            
            // Validate inputs
            if (displayName.length < 3 || displayName.length > 16) {
                alert('Display name must be between 3-16 characters');
                return;
            }
            
            if (username.length < 3 || username.length > 16) {
                alert('Username must be between 3-16 characters');
                return;
            }
            
            if (age < 13) {
                alert('You must be at least 13 years old to use this service');
                return;
            }
            
            // Create auth user
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password
            });
            
            if (authError) {
                alert(`Signup failed: ${authError.message}`);
                return;
            }
            
            // Create profile
            const { error: profileError } = await supabase
                .from('profiles')
                .insert({
                    id: authData.user.id,
                    display_name: displayName,
                    username,
                    age,
                    sex: gender
                });
            
            if (profileError) {
                alert(`Profile creation failed: ${profileError.message}`);
                await supabase.auth.signOut();
                return;
            }
            
            session = authData.session;
            showPage('match');
        }
        
        // Start match process
        async function startMatch() {
            savePreferences();
            showPage('loading');
            
            // Create match request
            const desiredGender = document.getElementById('desired-gender').value;
            const minAge = document.getElementById('min-age').value;
            const maxAge = document.getElementById('max-age').value;
            const topics = Array.from(document.querySelectorAll('.badge-topic.selected'))
                .map(el => el.dataset.topic);
            
            try {
                // Clear any existing match requests
                await supabase
                    .from('match_requests')
                    .delete()
                    .eq('user_id', session.user.id)
                    .is('matched_with', null);
                
                // Create new match request
                const { data, error } = await supabase
                    .from('match_requests')
                    .insert({
                        user_id: session.user.id,
                        desired_sex: desiredGender,
                        min_age: minAge,
                        max_age: maxAge,
                        topics: topics.length ? topics : null
                    })
                    .select()
                    .single();
                
                if (error) throw error;
                
                matchRequest = data;
                
                // Start polling for a match
                matchInterval = setInterval(checkForMatch, 3000);
            } catch (error) {
                console.error('Match request error:', error);
                alert(`Failed to start matching: ${error.message}`);
                showPage('match');
            }
        }
        
        // Check for match
        async function checkForMatch() {
            try {
                // Check if match has been found
                const { data: updatedRequest, error } = await supabase
                    .from('match_requests')
                    .select('matched_with')
                    .eq('id', matchRequest.id)
                    .single();
                
                if (error) throw error;
                
                if (updatedRequest.matched_with) {
                    clearInterval(matchInterval);
                    startChat(updatedRequest.matched_with);
                }
            } catch (error) {
                console.error('Match check error:', error);
                clearInterval(matchInterval);
                alert('Error checking for match. Please try again.');
                showPage('match');
            }
        }
        
        // Cancel match process
        function cancelMatch() {
            clearInterval(matchInterval);
            
            // Delete match request
            supabase
                .from('match_requests')
                .delete()
                .eq('id', matchRequest.id);
            
            showPage('match');
        }
        
        // Start chat session
        async function startChat(matchId) {
            try {
                // Get matched user's details
                const { data: matchRequestData, error: matchError } = await supabase
                    .from('match_requests')
                    .select('user_id')
                    .eq('id', matchId)
                    .single();
                
                if (matchError) throw matchError;
                
                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('display_name, username, sex, age')
                    .eq('id', matchRequestData.user_id)
                    .single();
                
                if (profileError) throw profileError;
                
                // Update UI with matched user info
                document.getElementById('matched-name').textContent = profile.display_name;
                document.getElementById('matched-initial').textContent = profile.display_name.charAt(0);
                document.getElementById('matched-status').textContent = 'Online';
                
                // Create realtime channel
                const channelName = `chat_${Math.min(matchRequest.id, matchId)}_${Math.max(matchRequest.id, matchId)}`;
                channel = supabase.channel(channelName);
                
                // Listen for messages
                channel.on('broadcast', { event: 'message' }, (payload) => {
                    addMessage(payload.text, payload.sender_id === session.user.id);
                });
                
                // Listen for user leaving
                channel.on('broadcast', { event: 'user_left' }, () => {
                    addSystemMessage(`${profile.username} left the chat`);
                    document.getElementById('message-input').disabled = true;
                });
                
                // Subscribe to channel
                channel.subscribe();
                
                showPage('chat');
            } catch (error) {
                console.error('Chat start error:', error);
                alert(`Failed to start chat: ${error.message}`);
                showPage('match');
            }
        }
        
        // Add message to chat UI
        function addMessage(text, isSelf, isSystem = false) {
            const messagesContainer = document.getElementById('chat-messages');
            const messageDiv = document.createElement('div');
            
            if (isSystem) {
                messageDiv.className = 'd-flex justify-content-center mb-3';
                messageDiv.innerHTML = `
                    <div class="message message-system">
                        ${text}
                    </div>
                `;
            } else {
                messageDiv.className = isSelf ? 
                    'd-flex justify-content-end mb-3' : 
                    'd-flex justify-content-start mb-3';
                
                messageDiv.innerHTML = `
                    <div class="message ${isSelf ? 'message-self' : 'message-other'}">
                        ${text}
                    </div>
                `;
            }
            
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        // Add system message
        function addSystemMessage(text) {
            addMessage(text, false, true);
        }
        
        // Send message
        function sendMessage() {
            const input = document.getElementById('message-input');
            const message = input.value.trim();
            
            if (!message) return;
            
            // Add to UI immediately
            addMessage(message, true);
            
            // Broadcast to channel
            channel.send({
                type: 'broadcast',
                event: 'message',
                payload: {
                    text: message,
                    sender_id: session.user.id
                }
            });
            
            input.value = '';
        }
        
        // Skip current chat
        async function skipChat() {
            // Notify other user
            channel.send({
                type: 'broadcast',
                event: 'user_left'
            });
            
            // Clean up
            await endChat();
            
            // Start a new match
            startMatch();
        }
        
        // Leave chat
        async function leaveChat() {
            // Notify other user
            channel.send({
                type: 'broadcast',
                event: 'user_left'
            });
            
            // Clean up
            await endChat();
            showPage('match');
        }
        
        // End chat session
        async function endChat() {
            // Unsubscribe from channel
            if (channel) {
                channel.unsubscribe();
                channel = null;
            }
            
            // Delete match request
            if (matchRequest) {
                await supabase
                    .from('match_requests')
                    .delete()
                    .eq('id', matchRequest.id);
                
                matchRequest = null;
            }
            
            // Clear chat messages
            document.getElementById('chat-messages').innerHTML = '';
            document.getElementById('message-input').disabled = false;
        }
        
        // Save profile
        async function saveProfile(e) {
            e.preventDefault();
            
            // In a real app, this would update the profile in the database
            alert('Profile updated successfully!');
            showPage('match');
        }
        
        // Handle logout
        async function handleLogout() {
            await supabase.auth.signOut();
            session = null;
            showPage('auth');
        }
        
        // Initialize the app
        document.addEventListener('DOMContentLoaded', initApp);
        
        // Simulate match counter
        setInterval(() => {
            const counter = document.querySelector('.match-counter');
            if (counter) {
                const count = parseInt(counter.textContent.replace(/,/g, ''));
                counter.textContent = (count + Math.floor(Math.random() * 3)).toLocaleString();
            }
        }, 3000);