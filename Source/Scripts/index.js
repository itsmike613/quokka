// Initialize Firebase
const firebaseConfig = {
	apiKey: "AIzaSyAaMk9ker4NwaKHFagmRvx9QKp-05_wtm0",
	authDomain: "quokkatest-21978.firebaseapp.com",
	projectId: "quokkatest-21978",
	storageBucket: "quokkatest-21978.firebasestorage.app",
	messagingSenderId: "253169747366",
	appId: "1:253169747366:web:d0042784fd56e93ebc7b67"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// UI Control
function showPage(pageId) {
	['auth-page', 'home-page', 'chat-page', 'profile-page', 'loading'].forEach(id => {
		document.getElementById(id).style.display = id === pageId ? 'block' : 'none';
	});
}

// Auth State Listener
let currentChatId = null;
auth.onAuthStateChanged(user => {
	if (user) {
		showPage('home-page');
		db.collection('users').doc(user.uid).get().then(doc => user.sex = doc.data().sex);
		db.collection('chats').where('participants', 'array-contains', user.uid)
			.onSnapshot(snap => {
				snap.docChanges().forEach(change => {
					if (change.type === 'added') {
						currentChatId = change.doc.id;
						showChatPage(currentChatId);
					}
				});
			});
	} else {
		showPage('auth-page');
		currentChatId = null;
	}
});

// Signup
document.getElementById('signup-form').addEventListener('submit', e => {
	e.preventDefault();
	const displayName = document.getElementById('displayName').value;
	const username = document.getElementById('username').value;
	const email = document.getElementById('email').value;
	const password = document.getElementById('password').value;
	const age = document.getElementById('age').value;
	const sex = document.getElementById('sex').value;

	if (displayName.length < 3 || displayName.length > 16 || username.length < 3 || username.length > 16) {
		alert('Display Name and Username must be 3–16 characters');
		return;
	}

	auth.createUserWithEmailAndPassword(email, password)
		.then(cred => {
			const user = cred.user;
			return db.collection('usernames').doc(username).get().then(doc => {
				if (doc.exists) throw new Error('Username already taken');
				return Promise.all([
					db.collection('users').doc(user.uid).set({ displayName, username, age, sex }),
					db.collection('usernames').doc(username).set({ uid: user.uid })
				]);
			});
		})
		.catch(err => {
			alert(err.message);
			if (auth.currentUser) auth.currentUser.delete();
		});
});

// Login
document.getElementById('login-form').addEventListener('submit', e => {
	e.preventDefault();
	const email = document.getElementById('login-email').value;
	const password = document.getElementById('login-password').value;
	auth.signInWithEmailAndPassword(email, password).catch(err => alert(err.message));
});

// Match
document.getElementById('match-btn').addEventListener('click', () => {
	showPage('loading');
	const user = auth.currentUser;
	const preference = document.getElementById('preference').value;
	db.collection('waiting').doc(user.uid).set({ sex: user.sex, preference, timestamp: firebase.firestore.FieldValue.serverTimestamp() })
		.then(() => tryToMatch(user, preference));
});

function tryToMatch(user, preference) {
	db.collection('waiting').get().then(snap => {
		const matches = snap.docs.filter(doc => {
			if (doc.id === user.uid) return false;
			const { sex: M, preference: Q } = doc.data();
			const S = user.sex, P = preference;
			return (M === P || P === 'Either') && (S === Q || Q === 'Either');
		});
		if (matches.length) {
			const match = matches[0];
			db.runTransaction(t => {
				const aDoc = db.collection('waiting').doc(user.uid);
				const bDoc = db.collection('waiting').doc(match.id);
				return Promise.all([t.get(aDoc), t.get(bDoc)]).then(([a, b]) => {
					if (!a.exists || !b.exists) throw new Error('Not waiting');
					const chatId = db.collection('chats').doc().id;
					t.set(db.collection('chats').doc(chatId), { participants: [user.uid, match.id], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
					t.delete(aDoc);
					t.delete(bDoc);
				});
			}).catch(() => setTimeout(() => tryToMatch(user, preference), 1000));
		} else {
			setTimeout(() => tryToMatch(user, preference), 1000);
		}
	});
}

// Chat Page
function showChatPage(chatId) {
	showPage('chat-page');
	db.collection('chats').doc(chatId).get().then(doc => {
		const matchedUid = doc.data().participants.find(uid => uid !== auth.currentUser.uid);
		db.collection('users').doc(matchedUid).get().then(userDoc => {
			const { displayName, username, sex, age } = userDoc.data();
			document.getElementById('matched-displayName').textContent = displayName;
			document.getElementById('matched-username').textContent = username;
			document.getElementById('matched-sex').textContent = sex;
			document.getElementById('matched-age').textContent = age;
		});
	});

	db.collection('chats').doc(chatId).collection('messages').orderBy('timestamp')
		.onSnapshot(snap => {
			const chatBox = document.getElementById('chat-box');
			chatBox.innerHTML = '';
			snap.forEach(doc => {
				const { text, sender } = doc.data();
				const div = document.createElement('div');
				div.textContent = text;
				if (sender === auth.currentUser.uid) {
					div.style.textAlign = 'right';
					div.style.color = 'blue';
				} else if (!sender) {
					div.style.textAlign = 'center';
					div.style.color = 'red';
				} else {
					div.style.textAlign = 'left';
					div.style.color = 'grey';
				}
				chatBox.appendChild(div);
			});
		});

	document.getElementById('send-btn').onclick = () => {
		const input = document.getElementById('message-input');
		if (input.value) {
			db.collection('chats').doc(chatId).collection('messages').add({
				text: input.value,
				sender: auth.currentUser.uid,
				timestamp: firebase.firestore.FieldValue.serverTimestamp()
			});
			input.value = '';
		}
	};

	document.getElementById('skip-btn').onclick = () => {
		db.collection('chats').doc(chatId).delete().then(() => {
			showPage('loading');
			tryToMatch(auth.currentUser, document.getElementById('preference').value);
		});
	};

	document.getElementById('exit-btn').onclick = () => {
		db.collection('chats').doc(chatId).delete().then(() => showPage('home-page'));
	};
}

// Profile Page
document.getElementById('profile-btn').onclick = () => {
	showPage('profile-page');
	const user = auth.currentUser;
	db.collection('users').doc(user.uid).get().then(doc => {
		const { displayName, username } = doc.data();
		document.getElementById('profile-displayName').value = displayName;
		document.getElementById('profile-username').value = username;
	});
};

document.getElementById('profile-form').addEventListener('submit', e => {
	e.preventDefault();
	const displayName = document.getElementById('profile-displayName').value;
	const username = document.getElementById('profile-username').value;
	const user = auth.currentUser;

	if (displayName.length < 3 || displayName.length > 16 || username.length < 3 || username.length > 16) {
		alert('Display Name and Username must be 3–16 characters');
		return;
	}

	db.collection('users').doc(user.uid).get().then(doc => {
		const currentUsername = doc.data().username;
		if (username !== currentUsername) {
			db.collection('usernames').doc(username).get().then(doc => {
				if (doc.exists) return alert('Username already taken');
				Promise.all([
					db.collection('usernames').doc(username).set({ uid: user.uid }),
					db.collection('usernames').doc(currentUsername).delete(),
					db.collection('users').doc(user.uid).update({ displayName, username })
				]).then(() => alert('Profile updated'));
			});
		} else {
			db.collection('users').doc(user.uid).update({ displayName }).then(() => alert('Profile updated'));
		}
	});
});

document.getElementById('logout-btn').onclick = () => auth.signOut();