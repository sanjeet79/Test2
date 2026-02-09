// --- FIREBASE CONFIGURATION ---
// Isse sabse upar rakhna zaroori hai
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
let createdRoomRef = null; // Reference to delete room on cancel

// --- 1. INITIAL SETUP ---
if (!myPlayerId) {
    myPlayerId = 'user_' + Math.random().toString(36).substr(2, 5);
    localStorage.setItem("tt_player_id", myPlayerId);
}

// Update UI on Load
document.addEventListener("DOMContentLoaded", () => {
    const coinEl = document.getElementById("userCoins");
    if(coinEl) coinEl.innerText = myCoins;
});

// --- 2. START MATCHMAKING ---
function startMatchmaking(selectedRole) {
    if (myCoins < 50) {
        document.getElementById("lowBalancePopup").classList.remove("hidden");
        return;
    }

    // UI Show Loading
    const overlay = document.getElementById("loadingOverlay");
    const statusText = document.getElementById("loadingText");
    
    if(overlay) overlay.classList.remove("hidden");
    if(statusText) statusText.innerText = "Finding Opponent...";
    
    // Status Element Logic (Error Fix)
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.innerText = "Searching...";

    isSearching = true;
    findRoom(selectedRole);
}

// --- 3. FIND ROOM LOGIC ---
function findRoom(myRole) {
    if (!isSearching) return;

    const roomsRef = db.ref('rooms');
    
    // Query: Sirf wahi rooms lao jo 'waiting' mein hain
    roomsRef.orderByChild('status').equalTo('waiting').limitToFirst(10).once('value')
        .then((snapshot) => {
            let foundRoomId = null;
            let foundRoomData = null;

            if (snapshot.exists()) {
                const rooms = snapshot.val();
                const roomKeys = Object.keys(rooms);

                for (let key of roomKeys) {
                    const r = rooms[key];
                    
                    // Logic: Match Role
                    // 1. Agar main Random hoon -> Koi bhi room chalega
                    // 2. Agar Room 'any' dhoond raha hai -> Main fit hoon
                    // 3. Agar Room mere role ko dhoond raha hai (e.g. King dhoond raha hai Pawn)
                    
                    const isMatch = (myRole === 'random') || (r.lookingFor === 'any') || (r.lookingFor === myRole);
                    
                    if (isMatch) {
                        foundRoomId = key;
                        foundRoomData = r;
                        break; 
                    }
                }
            }

            if (foundRoomId) {
                console.log("Match Found! Joining Room:", foundRoomId);
                joinRoom(foundRoomId, myRole, foundRoomData);
            } else {
                console.log("No matching room found. Creating new...");
                createRoom(myRole);
            }
        })
        .catch((error) => {
            console.error("Firebase Query Error:", error);
            // Agar error aaye (e.g. Indexing), tab bhi room bana do taaki user atke na
            createRoom(myRole);
        });
}

// --- 4. JOIN ROOM ---
function joinRoom(roomId, myRole, roomData) {
    const roomRef = db.ref('rooms/' + roomId);
    
    // Transaction to safely join
    roomRef.transaction((currentData) => {
        if (currentData && currentData.status === 'waiting') {
            // Lock the room
            return {
                ...currentData,
                status: 'playing',
                player2: myPlayerId,
                player2Role: (myRole === 'random') ? ((currentData.player1Role === 'king') ? 'pawn' : 'king') : myRole
            };
        } else {
            return; // Abort (Room is full or gone)
        }
    }, (error, committed, snapshot) => {
        if (committed) {
            // Success
            const finalRoom = snapshot.val();
            const finalRole = finalRoom.player2Role;
            deductCoinsAndRedirect(roomId, finalRole);
        } else {
            // Failed, try again
            findRoom(myRole);
        }
    });
}

// --- 5. CREATE ROOM ---
function createRoom(myRole) {
    if (!isSearching) return;

    const newRoomRef = db.ref('rooms').push();
    createdRoomRef = newRoomRef; // Save reference for cancel

    // Determine Roles
    let myFinalRole = myRole;
    let lookingFor = 'any';

    if (myRole === 'random') {
        myFinalRole = Math.random() < 0.5 ? 'king' : 'pawn';
        lookingFor = (myFinalRole === 'king') ? 'pawn' : 'king';
    } else {
        lookingFor = (myRole === 'king') ? 'pawn' : 'king';
    }

    const roomData = {
        player1: myPlayerId,
        player1Role: myFinalRole,
        status: 'waiting',
        lookingFor: lookingFor,
        createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    // Update UI
    document.getElementById("loadingText").innerText = "Waiting for Player...";

    newRoomRef.set(roomData).then(() => {
        // Listen for joiner
        newRoomRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.status === 'playing' && data.player2) {
                // Someone joined!
                newRoomRef.off(); // Stop listening
                deductCoinsAndRedirect(newRoomRef.key, myFinalRole);
            }
        });
    });
}

// --- UTILITIES ---

function deductCoinsAndRedirect(roomId, role) {
    // 1. Deduct Coins
    myCoins -= 50;
    localStorage.setItem("tt_coins", myCoins);

    // 2. Redirect (Note: random-game.html is the destination)
    window.location.href = `random-game.html?room=${roomId}&role=${role}`;
}

function cancelSearch() {
    isSearching = false;
    document.getElementById("loadingOverlay").classList.add("hidden");
    
    // Agar room banaya tha to delete kar do
    if (createdRoomRef) {
        createdRoomRef.remove();
        createdRoomRef = null;
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
