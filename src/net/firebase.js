import { initializeApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInAnonymously, updateProfile, onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  getDatabase, ref, set, update, remove, onValue, onChildAdded,
  onChildChanged, onChildRemoved, onDisconnect,
} from 'firebase/database';

// Web app config — public identifiers, safe to ship (security = DB rules)
const firebaseConfig = {
  apiKey: 'AIzaSyBKvnHDER_nbOyj1GaRF-y-YlGLIS7mvYM',
  authDomain: 'blocktopia-game.firebaseapp.com',
  databaseURL: 'https://blocktopia-game-default-rtdb.firebaseio.com',
  projectId: 'blocktopia-game',
  storageBucket: 'blocktopia-game.firebasestorage.app',
  messagingSenderId: '1006123350241',
  appId: '1:1006123350241:web:f34decda9f3cbdfb395fa0',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ---- auth (login persists across visits by Firebase default) ----

export function watchAuth(cb) {
  onAuthStateChanged(auth, cb);
}

export async function signUp(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  return cred.user;
}

export function logIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password).then(c => c.user);
}

export async function playAsGuest(name) {
  const cred = await signInAnonymously(auth);
  await updateProfile(cred.user, { displayName: name || 'Guest' });
  return cred.user;
}

export function logOut() {
  return signOut(auth);
}

export function playerName(user) {
  return user.displayName || user.email?.split('@')[0] || 'Player';
}

// ---- multiplayer sync over Realtime Database ----

const POS_INTERVAL_MS = 120;

export function joinWorld(user, callbacks, name) {
  const uid = user.uid;
  const meRef = ref(db, `players/${uid}`);
  onDisconnect(meRef).remove();
  set(meRef, { name: name || playerName(user), x: 0, y: 0, z: 0, yaw: 0 });

  const playersRef = ref(db, 'players');
  onChildAdded(playersRef, (snap) => {
    if (snap.key !== uid) callbacks.onPlayerJoin(snap.key, snap.val());
  });
  onChildChanged(playersRef, (snap) => {
    if (snap.key !== uid) callbacks.onPlayerMove(snap.key, snap.val());
  });
  onChildRemoved(playersRef, (snap) => {
    if (snap.key !== uid) callbacks.onPlayerLeave(snap.key);
  });

  // shared block edits: key "x_y_z" -> block id; applied by everyone
  const blocksRef = ref(db, 'blocks');
  const applyBlock = (snap) => {
    const [x, y, z] = snap.key.split('_').map(Number);
    callbacks.onBlockChange(x, y, z, snap.val());
  };
  onChildAdded(blocksRef, applyBlock);
  onChildChanged(blocksRef, applyBlock);

  let last = 0;
  return {
    sendPosition(pos, yaw) {
      const now = performance.now();
      if (now - last < POS_INTERVAL_MS) return;
      last = now;
      update(meRef, {
        x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2),
        yaw: +yaw.toFixed(2),
      });
    },
    sendBlock(x, y, z, id) {
      set(ref(db, `blocks/${x}_${y}_${z}`), id);
    },
    leave() {
      remove(meRef);
    },
  };
}

// online player count for the start screen
export function watchPlayerCount(cb) {
  onValue(ref(db, 'players'), (snap) => cb(snap.size || 0));
}
