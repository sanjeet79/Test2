import { initializeApp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { get, getDatabase, onValue, ref, update } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-database.js";

// ==========================================
// 1. FIREBASE CONFIG
// ==========================================
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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==========================================
// 2. GAME VARIABLES
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const roomID = urlParams.get('room');
const myRole = urlParams.get('role'); 

if (!roomID) {
    alert("❌ Error: No Room Code Found!");
    window.location.href = "online-setup.html";
}

const size = 118;
const cols = ["A", "B", "C", "D", "E"];
let myPieceType = (myRole === 'host') ? 'king' : 'pawn';
const roomDisplayEl = document.getElementById("roomDisplay");
if(roomDisplayEl) roomDisplayEl.textContent = roomID;

let currentGameState = null;
let selectedPos = null;
let totalMovesLimit = 100;
let isMyTurn = false;

// Valid Moves
const VALID_NEIGHBORS = new Set([
    "A1-B2","B2-A1", "B2-C3","C3-B2", "C3-D4","D4-C3", "D4-E5","E5-D4",
    "E1-D2","D2-E1", "D2-C3","C3-D2", "C3-B4","B4-C3", "B4-A5","A5-B4",
    "C1-B2","B2-C1", "B2-A3","A3-B2", "C1-D2","D2-C1", "D2-E3","E3-D2",
    "A3-B4","B4-A3", "B4-C5","C5-B4", "E3-D4","D4-E3", "D4-C5","C5-D4"
]);

// ==========================================
// 🎧 AUDIO SETUP (FIXED)
// ==========================================
const moveSound = new Audio("music/move.mp3");
const winSound = new Audio("music/win.mp3");
const killSound = new Audio("music/pawnKill.mp3");

// Background Music
const bgMusic = new Audio("music/bgGame.mp3");
bgMusic.loop = true;  
bgMusic.volume = 0.5; 
let isMuted = false;

// Browser Auto-Play Policy Fix
// (User jab pehli baar screen touch karega tab music start hoga)
function startMusic() {
    if (!isMuted && bgMusic.paused) {
        bgMusic.play().catch(() => {});
    }
    // Listeners hata do taaki baar baar call na ho
    document.body.removeEventListener('click', startMusic);
    document.body.removeEventListener('touchstart', startMusic);
}
document.body.addEventListener('click', startMusic);
document.body.addEventListener('touchstart', startMusic);

// DOM Elements
const turnEl = document.getElementById("turnIndicator");
const moveCountEl = document.getElementById("moveCount");
const pawnCountEl = document.getElementById("pawnCount");
const k1StatusEl = document.getElementById("king1Status");
const k2StatusEl = document.getElementById("king2Status");
const pointsGroup = document.getElementById("points");
const piecesGroup = document.getElementById("pieces");
const aiMoveGroup = document.getElementById("aiMoveGroup");

// ==========================================
// 3. INITIALIZE GAME (HOST)
// ==========================================
if (myRole === 'host') {
    const boardRef = ref(db, `rooms/${roomID}/board`);
    get(boardRef).then((snapshot) => {
        if (!snapshot.exists()) {
            resetGameOnServer();
        }
    });
}

function resetGameOnServer() {
    update(ref(db, `rooms/${roomID}/board`), {
        pawnStacks: { "B2": 5, "B4": 5, "D2": 5, "D4": 5 },
        kingPositions: { king1: "C1", king2: "C5" }, 
        currentTurn: 'pawn', 
        movesPlayed: 0,
        winner: null,
        lastMove: null
    });
}

// ==========================================
// 4. MAIN LISTENER (Updates Board)
// ==========================================
const wholeRoomRef = ref(db, `rooms/${roomID}`);

onValue(wholeRoomRef, (snapshot) => {
    const roomData = snapshot.val();
    
    if (!roomData) return;

    // 1. TIME LIMIT CHECK
    if (roomData.createdAt) {
        const timePassed = Date.now() - roomData.createdAt;
        const ONE_HOUR = 60 * 60 * 1000; 
        if (timePassed > ONE_HOUR) {
            handleRoomExpiry();
            return; 
        }
    }

    // 2. BOARD DATA CHECK
    const data = roomData.board;
    if (!data) return; 

    // Sound Logic (SFX only)
    if (currentGameState && !isMuted) {
        const oldPawns = countPawns(currentGameState);
        const newPawns = countPawns(data);
        if (currentGameState.currentTurn !== data.currentTurn && !data.winner) {
            if (oldPawns > newPawns) killSound.play().catch(()=>{});
            else moveSound.play().catch(()=>{});
        }
    }

    currentGameState = data;

    // UI Reset if new game
    if (!data.winner) {
        document.getElementById("gameOverModal").style.display = "none";
        const container = document.getElementById("game-container");
        if(container) container.style.opacity = "1";
    }

    renderBoard(data);
    updateStatusUI(data);
    rotateBoard();

    if (myRole === 'host') checkWinCondition(data);
});

// ==========================================
// 5. RENDER FUNCTIONS
// ==========================================
function renderBoard(data) {
    piecesGroup.innerHTML = "";
    aiMoveGroup.innerHTML = ""; 

    // Draw Pawns
    if (data.pawnStacks) {
        for (let pos in data.pawnStacks) {
            if (data.pawnStacks[pos] > 0) drawPiece(pos, 'pawn', data.pawnStacks[pos]);
        }
    }
    // Draw Kings
    if (data.kingPositions) {
        if (data.kingPositions.king1) drawPiece(data.kingPositions.king1, 'king');
        if (data.kingPositions.king2) drawPiece(data.kingPositions.king2, 'king');
    }

    // Draw Last Move
    if (data.lastMove) drawTrail(data.lastMove.from, data.lastMove.to);
}

function drawPiece(pos, type, count=1) {
    const {x, y} = getCoords(pos);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("x", x); txt.setAttribute("y", y);
    txt.setAttribute("font-size", type==='king'?"65":"54");
    txt.setAttribute("text-anchor", "middle"); txt.setAttribute("dominant-baseline", "middle");
    txt.textContent = type === 'king' ? "♚" : "♟️";
    txt.setAttribute("fill", type==='king' ? "black" : "#003600");
    txt.setAttribute("class", "standing-piece");
    g.appendChild(txt);

    if(count > 1) {
        const cnt = document.createElementNS("http://www.w3.org/2000/svg","text");
        cnt.setAttribute("x", x+20); cnt.setAttribute("y", y-4);
        cnt.setAttribute("font-size", "20"); cnt.setAttribute("fill", "blue"); cnt.setAttribute("font-weight", "bold");
        cnt.textContent = count; g.appendChild(cnt);
    }
    piecesGroup.appendChild(g);
}

function drawTrail(from, to) {
    const f = getCoords(from);
    const t = getCoords(to);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", f.x); line.setAttribute("y1", f.y);
    line.setAttribute("x2", t.x); line.setAttribute("y2", t.y);
    line.setAttribute("class", "ai-trail-line");
    aiMoveGroup.appendChild(line);
}

// ==========================================
// 6. UI UPDATES
// ==========================================
function updateStatusUI(data) {
    if (data.winner) {
        showWinModal(data.winner);
        turnEl.textContent = "GAME OVER";
        return;
    }

    if (data.currentTurn === myPieceType) {
        isMyTurn = true;
        turnEl.textContent = "🟢 Your Turn";
        turnEl.style.color = "#4ade80";
        if("vibrate" in navigator) navigator.vibrate(50);
    } else {
        isMyTurn = false;
        turnEl.textContent = "🔴 Wait...";
        turnEl.style.color = "#f87171";
    }

    moveCountEl.textContent = data.movesPlayed || 0;
    pawnCountEl.textContent = countPawns(data);
    
    if (data.kingPositions) {
        updateKingStatus("king1Status", data.kingPositions.king1, data);
        updateKingStatus("king2Status", data.kingPositions.king2, data);
    }
}

function updateKingStatus(elId, kPos, data) {
    const el = document.getElementById(elId);
    if (!el) return;
    const safe = getValidKingMoves(kPos, data).length > 0;
    el.textContent = safe ? "Safe" : "Block";
    el.className = `status-value ${safe ? "safe" : "blocked"}`;
}

function rotateBoard() {
    const boardContainer = document.querySelector('.board');
    if (!boardContainer) return;
    boardContainer.style.transform = "rotate(0deg)";
    document.querySelectorAll('text').forEach(t => {
        t.style.transformBox = "fill-box";
        t.style.transformOrigin = "center";
        t.style.transform = "rotate(0deg)";
    });
}

function handleRoomExpiry() {
    turnEl.textContent = "⚠️ ROOM EXPIRED";
    turnEl.style.color = "red";
    const container = document.getElementById("game-container");
    if(container) container.style.opacity = "0.5";
    isMyTurn = false; 
    
    const modal = document.getElementById("gameOverModal");
    if(modal) {
        document.getElementById("winTitle").textContent = "TIME UP!";
        document.getElementById("winMessage").textContent = "Room limit (1 Hour) finished.";
        document.getElementById("winIcon").textContent = "⏳";
        const restartBtn = modal.querySelector(".restart-btn");
        if(restartBtn) restartBtn.style.display = "none"; 
        modal.style.display = "flex";
    }
}

// ==========================================
// 7. INPUT HANDLING
// ==========================================
function handleBoardClick(clickedPos) {
    if (!currentGameState || currentGameState.winner) return;
    if (!isMyTurn) { showToast("!Opnt..."); return; }

    if (selectedPos === null) {
        if (myPieceType === 'pawn' && currentGameState.pawnStacks[clickedPos]) {
            selectedPos = clickedPos; highlight(clickedPos);
        } 
        else if (myPieceType === 'king' && Object.values(currentGameState.kingPositions).includes(clickedPos)) {
            selectedPos = clickedPos; highlight(clickedPos);
        }
    } 
    else {
        if (selectedPos === clickedPos) { selectedPos = null; clearHighlights(); return; }

        if (validateMove(selectedPos, clickedPos, myPieceType)) {
            executeMove(selectedPos, clickedPos, myPieceType);
        } else {
            showToast("❌ Invalid Move!");
            if("vibrate" in navigator) navigator.vibrate([50, 50]);
        }
        selectedPos = null; clearHighlights();
    }
}

function executeMove(from, to, type) {
    const data = JSON.parse(JSON.stringify(currentGameState));

    if (type === 'pawn') {
        data.pawnStacks[from]--;
        if(data.pawnStacks[from]===0) delete data.pawnStacks[from];
        data.pawnStacks[to] = (data.pawnStacks[to] || 0) + 1;
        data.currentTurn = 'king';
    } else {
        if (data.kingPositions.king1 === from) data.kingPositions.king1 = to;
        else if (data.kingPositions.king2 === from) data.kingPositions.king2 = to;
        
        const mid = getMidPoint(from, to);
        if(mid && data.pawnStacks[mid]) {
            data.pawnStacks[mid]--;
            if(data.pawnStacks[mid]===0) delete data.pawnStacks[mid];
        }
        data.currentTurn = 'pawn';
    }

    data.movesPlayed++;
    data.lastMove = { from, to };
    update(ref(db, `rooms/${roomID}/board`), data);
}

// ==========================================
// 8. HELPERS & VALIDATION
// ==========================================
function getCoords(p) { 
    const c = cols.indexOf(p[0]), r = parseInt(p[1])-1;
    return {x: c*size, y: r*size};
}

function validateMove(from, to, type) {
    if (currentGameState.pawnStacks[to] > 0 || Object.values(currentGameState.kingPositions).includes(to)) return false; 
    
    if (isOneStep(from, to)) return true;
    
    if (type === 'king') {
        const mid = getMidPoint(from, to);
        if (mid && currentGameState.pawnStacks[mid] > 0) {
             return isOneStep(from, mid) && isOneStep(mid, to);
        }
    }
    return false;
}

function isOneStep(f, t) {
    const fc = cols.indexOf(f[0]), fr = parseInt(f[1]);
    const tc = cols.indexOf(t[0]), tr = parseInt(t[1]);
    const dc = Math.abs(fc - tc), dr = Math.abs(fr - tr);

    if (dc === 0 && dr === 0) return false;
    if ((dc === 0 && dr === 1) || (dc === 1 && dr === 0)) return true;
    if (dc === 1 && dr === 1) {
        return VALID_NEIGHBORS.has(`${f}-${t}`) || VALID_NEIGHBORS.has(`${t}-${f}`);
    }
    return false;
}

function getMidPoint(f, t) {
    const fc = cols.indexOf(f[0]), fr = parseInt(f[1]);
    const tc = cols.indexOf(t[0]), tr = parseInt(t[1]);
    if (Math.abs(fc-tc) > 2 || Math.abs(fr-tr) > 2) return null;
    const mc = (fc + tc) / 2, mr = (fr + tr) / 2;
    return (Number.isInteger(mc) && Number.isInteger(mr)) ? `${cols[mc]}${mr}` : null;
}

function getValidKingMoves(pos, data) {
    if(!pos) return [];
    let moves = [];
    const fc = cols.indexOf(pos[0]), fr = parseInt(pos[1]);
    for(let r=fr-2; r<=fr+2; r++) for(let c=fc-2; c<=fc+2; c++) {
        const t = `${cols[c]}${r}`;
        if(c>=0 && c<5 && r>=1 && r<=5 && pos!==t) {
            if (data.pawnStacks[t] || Object.values(data.kingPositions).includes(t)) continue;
            if (isOneStep(pos, t)) moves.push(t);
            else {
                const mid = getMidPoint(pos, t);
                if(mid && data.pawnStacks[mid]) {
                    if (isOneStep(pos, mid) && isOneStep(mid, t)) moves.push(t);
                }
             }
        }
    }
    return moves;
}

function countPawns(data) {
    let total = 0;
    if (data.pawnStacks) {
        for(let k in data.pawnStacks) total += data.pawnStacks[k];
    }
    return total;
}

// ==========================================
// 9. WIN & EVENTS
// ==========================================
function checkWinCondition(data) {
    if(data.winner) return;

    let winner = null;
    const pawns = countPawns(data);
    const k1Moves = getValidKingMoves(data.kingPositions.king1, data).length;
    const k2Moves = getValidKingMoves(data.kingPositions.king2, data).length;

    if (pawns <= 5) winner = "king";
    else if (data.movesPlayed >= totalMovesLimit) winner = "king";
    else if (k1Moves === 0 && k2Moves === 0) winner = "pawn";

    if (winner) update(ref(db, `rooms/${roomID}/board`), { winner: winner });
}

function showWinModal(winner) {
    if(!isMuted) winSound.play().catch(()=>{});
    const modal = document.getElementById("gameOverModal");
    if(modal) {
        document.getElementById("winTitle").textContent = "GAME OVER";
        document.getElementById("winMessage").textContent = `${winner.toUpperCase()} Wins!`;
        document.getElementById("winIcon").textContent = winner === 'king' ? '👑' : '♟️';
        
        const restartBtn = modal.querySelector(".restart-btn");
        if(restartBtn) {
            restartBtn.style.display = "inline-block";
            restartBtn.onclick = () => resetGameOnServer();
        }
        modal.style.display = "flex";
    }
}

// Setup Grid
pointsGroup.innerHTML = "";
for(let r=0; r<5; r++) {
    for(let c=0; c<5; c++) {
        const cx = c*size, cy = r*size; const pt = `${cols[c]}${r+1}`;
        const circ = document.createElementNS("http://www.w3.org/2000/svg","circle");
        circ.setAttribute("cx",cx); circ.setAttribute("cy",cy); circ.setAttribute("r","40");
        circ.setAttribute("fill","rgba(255,255,255,0.01)"); 
        circ.dataset.point = pt;
        circ.addEventListener("pointerdown", (e)=>{ e.preventDefault(); handleBoardClick(pt); });
        pointsGroup.appendChild(circ);
    }
}
// Labels
cols.forEach((c, i) => { const t = document.createElementNS("http://www.w3.org/2000/svg", "text"); t.setAttribute("x", i*size); t.setAttribute("y", -35); t.setAttribute("class", "point-label"); t.textContent = c; pointsGroup.appendChild(t); });
for(let r=0; r<5; r++){ const t = document.createElementNS("http://www.w3.org/2000/svg", "text"); t.setAttribute("x", -35); t.setAttribute("y", r*size+8); t.setAttribute("class", "point-label"); t.textContent = r+1; pointsGroup.appendChild(t); }

// ==========================================
// 🔊 SOUND BUTTON (FIXED)
// ==========================================
document.getElementById("soundBtn").addEventListener("click", function(e) {
    // Click board tak na jaye
    e.stopPropagation();

    isMuted = !isMuted;
    
    // UI Update
    this.style.opacity = isMuted ? "0.5" : "1";
    this.textContent = isMuted ? "🔇 Muted" : "🔊 Sound";

    // Logic
    if (isMuted) {
        bgMusic.pause();
    } else {
        bgMusic.play().catch(err => console.log("Interaction needed"));
    }
});

// Reset Button (Agar html me hai to hi chalega)
const resetBtn = document.getElementById("resetBtn");
if(resetBtn) {
    resetBtn.addEventListener("click", () => {
        if(confirm("Reset Board for BOTH players?")) resetGameOnServer();
    });
}

// Helpers
function highlight(p) { const c = pointsGroup.querySelector(`circle[data-point="${p}"]`); if(c) c.setAttribute("fill", "rgba(0, 255, 0, 0.4)"); }
function clearHighlights() { document.querySelectorAll("circle").forEach(c => c.setAttribute("fill", "rgba(255,255,255,0.01)")); }
function showToast(msg) { turnEl.textContent = msg; setTimeout(() => { if(currentGameState) updateStatusUI(currentGameState); }, 1500); }