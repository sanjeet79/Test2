// --- FIREBASE CONFIG (Paste this at the top of random-matchmaking.js) ---
const firebaseConfig = {
    apiKey: "AIzaSyAXORFD8QNwVgPw38_wgqZd3U21oTJ4z1w",
    authDomain: "trap-the-king.firebaseapp.com",
    databaseURL: "https://trap-the-king-default-rtdb.firebaseio.com",
    projectId: "trap-the-king",
    storageBucket: "trap-the-king.firebasestorage.app",
    messagingSenderId: "279741214015",
    appId: "1:279741214015:web:d7418a7ceaf57deaf0378a",
    measurementId: "G-5ZF0F5RJ1C"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();
// --- GLOBAL VARIABLES ---
let myPlayerId = localStorage.getItem("tt_player_id");
let myCoins = parseInt(localStorage.getItem("tt_coins") || "500");
let isSearching = false;
let searchTimeout;
let createdRoomId = null; // Agar humne room banaya to yahan ID save hogi

// --- 1. INITIAL SETUP (ID & COINS) ---
if (!myPlayerId) {
    myPlayerId = 'user_' + Math.random().toString(36).substr(2, 5);
    localStorage.setItem("tt_player_id", myPlayerId);
}
// Update UI
document.getElementById("userCoins").innerText = myCoins;

// --- 2. MATCHMAKING START (Button Click) ---
function startMatchmaking(selectedRole) {
    if (myCoins < 50) {
        document.getElementById("lowBalancePopup").classList.remove("hidden");
        return;
    }

    // UI Show Loading
    document.getElementById("loadingOverlay").classList.remove("hidden");
    document.getElementById("loadingText").innerText = "Finding Opponent...";
    isSearching = true;

    // Coins Deduct (Abhi sirf dikhane ke liye, asli deduct game start hone pe karenge)
    // Lekin logic ke liye maan lete hain cut gaye
    
    findRoom(selectedRole);
}

// --- 3. FIND ROOM LOGIC (Main Brain) ---
function findRoom(myRole) {
    const roomsRef = db.ref('rooms');
    let targetLookingFor = 'any';

    // Logic: Agar main King hoon, to mujhe wo room chahiye jahan koi Pawn dhoond raha ho
    if (myRole === 'king') targetLookingFor = 'pawn';
    else if (myRole === 'pawn') targetLookingFor = 'king';
    
    // Firebase Query: "Waiting" rooms dhundo
    roomsRef.orderByChild('status').equalTo('waiting').limitToFirst(10).once('value')
        .then((snapshot) => {
            if (!isSearching) return; // Agar user ne cancel kar diya to ruk jao

            let foundRoom = null;

            if (snapshot.exists()) {
                const rooms = snapshot.val();
                
                // Filter: Check karo kya koi mere role ke hisaab se match hai?
                const roomKeys = Object.keys(rooms);
                
                for (let key of roomKeys) {
                    const r = rooms[key];
                    
                    // CASE 1: Main Random hoon -> Koi bhi room chalega
                    if (myRole === 'random') {
                        foundRoom = key; 
                        break;
                    }
                    // CASE 2: Specific Role Match
                    // Agar main King hoon, to us room mein lookingFor 'king' hona chahiye
                    else if (r.lookingFor === myRole || r.lookingFor === 'any') {
                        foundRoom = key;
                        break;
                    }
                }
            }

            if (foundRoom) {
                joinRoom(foundRoom, myRole);
            } else {
                createRoom(myRole);
            }
        });
}

// --- 4. JOIN ROOM (Agar Room Mil Gya) ---
function joinRoom(roomId, myRole) {
    const roomRef = db.ref('rooms/' + roomId);
    
    // Transaction use karenge taaki 2 log ek saath na ghus jayein
    roomRef.transaction((room) => {
        if (room && room.status === 'waiting') {
            room.status = 'playing'; // Darwaza band
            room.player2 = myPlayerId;
            
            // Role assignment logic
            if (myRole === 'random') {
                // Jo role khali hai wo le lo
                room.player2Role = (room.player1Role === 'king') ? 'pawn' : 'king';
            } else {
                room.player2Role = myRole;
            }
            return room;
        } else {
            return; // Abort (Room full ho gaya)
        }
    }, (error, committed, snapshot) => {
        if (committed) {
            // Success! Game Start
            const roomData = snapshot.val();
            const finalRole = roomData.player2Role;
            deductCoins();
            redirectToGame(roomId, finalRole);
        } else {
            // Failed (Koi aur ghus gaya), Dobara dhundo
            findRoom(myRole);
        }
    });
}

// --- 5. CREATE ROOM (Agar Room Nahi Mila) ---
function createRoom(myRole) {
    const newRoomRef = db.ref('rooms').push();
    createdRoomId = newRoomRef.key;

    // Agar main Random hoon, to Toss karo ki main King banunga ya Pawn
    let myFinalRole = myRole;
    if (myRole === 'random') {
        myFinalRole = Math.random() < 0.5 ? 'king' : 'pawn';
    }

    // Main kya dhund raha hoon?
    let lookingFor = (myFinalRole === 'king') ? 'pawn' : 'king';

    const roomData = {
        player1: myPlayerId,
        player1Role: myFinalRole,
        status: 'waiting',
        lookingFor: lookingFor, // Server ko batao mujhe kaun chahiye
        createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    newRoomRef.set(roomData)
        .then(() => {
            document.getElementById("loadingText").innerText = "Waiting for Player...";
            
            // Ab suno (Listen) ki koi aaya kya?
            newRoomRef.on('value', (snapshot) => {
                const data = snapshot.val();
                if (data && data.status === 'playing') {
                    // Koi aa gaya!
                    deductCoins();
                    redirectToGame(createdRoomId, myFinalRole);
                }
            });
        });
}

// --- UTILITIES ---

function deductCoins() {
    myCoins -= 50;
    localStorage.setItem("tt_coins", myCoins);
}

function redirectToGame(roomId, role) {
    // Game page par bhejo with Parameters
    window.location.href = `game-online.html?room=${roomId}&role=${role}&mode=random`;
}

function cancelSearch() {
    isSearching = false;
    document.getElementById("loadingOverlay").classList.add("hidden");
    
    // Agar room banaya tha to delete kar do
    if (createdRoomId) {
        db.ref('rooms/' + createdRoomId).remove();
        createdRoomId = null;
    }
}

function claimDailyBonus() {
    myCoins += 50;
    localStorage.setItem("tt_coins", myCoins);
    document.getElementById("userCoins").innerText = myCoins;
    document.getElementById("lowBalancePopup").classList.add("hidden");
}

function closePopup() {
    document.getElementById("lowBalancePopup").classList.add("hidden");
}
