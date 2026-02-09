console.log("🚀 ONLINE MULTIPLAYER ENGINE INITIALIZED");

// --- 1. CONFIGURATION & FIREBASE SETUP ---
const urlParams = new URLSearchParams(window.location.search);
const ROOM_ID = urlParams.get('room');
const MY_ROLE = urlParams.get('role'); // 'pawn' or 'king'
const OPPONENT_ROLE = (MY_ROLE === 'pawn') ? 'king' : 'pawn';

if (!ROOM_ID || !MY_ROLE) {
    alert("Error: Invalid Room URL");
    window.location.href = 'random-menu.html';
}
// 🔥 YOUR FIREBASE CONFIG (Paste this exactly)
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

// Initialize Firebase only if not already initialized
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();
const roomRef = db.ref('rooms/' + ROOM_ID);
const connectedRef = db.ref(".info/connected");

// --- 2. GAME VARIABLES ---
const size = 118;
const cols = ["A","B","C","D","E"];
const pointsGroup = document.getElementById("points");
const piecesGroup = document.getElementById("pieces");
const oppTimerBar = document.getElementById("oppTimerBar");
const myTimerBar = document.getElementById("myTimerBar");

// Game State
let pawnStacks = {"B2":5,"D2":5,"C3":0,"B4":5,"D4":5};
let kingPositions = {king1:"C1", king2:"C5"};
let currentTurn = 'pawn'; // Always starts with Pawn
let gameState = "PLAYING";
let myCoins = parseInt(localStorage.getItem("tt_coins") || "500");

// Selection Variables
let selectedPawn = null;
let selectedKing = null;
let totalMovesLimit = 100;
let movesPlayed = 0;

// 🔥 FIX 1: Syntax Error Fixed (n -> null)
let timerInterval = null; 
let timeLeft = 15;
let isMyTurn = false;

// Sounds
const bgMusic = new Audio("music/bgGame.mp3"); bgMusic.loop = true; bgMusic.volume = 0.4;
const moveSound = new Audio("music/move.mp3"); 
const winSound = new Audio("music/win.mp3");
const loseSound = new Audio("music/lose.mp3"); 
let isMuted = false;

// --- 3. INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    // Setup UI
    document.getElementById("myRole").innerText = "Role: " + MY_ROLE.toUpperCase();
    document.getElementById("oppRole").innerText = "Role: " + OPPONENT_ROLE.toUpperCase();
    
    if(MY_ROLE === 'king') {
        document.querySelector(".self .avatar-box").innerHTML = '<i class="fas fa-chess-king"></i>';
        document.querySelector(".opponent .avatar-box").innerHTML = '<i class="fas fa-chess-pawn"></i>';
    } else {
        document.querySelector(".self .avatar-box").innerHTML = '<i class="fas fa-chess-pawn"></i>';
        document.querySelector(".opponent .avatar-box").innerHTML = '<i class="fas fa-chess-king"></i>';
    }

    // Initialize Board Graphics
    initBoardGrid();
    renderAll();
    
    // Start Music on Interaction
    document.body.addEventListener('click', () => { if(!isMuted) bgMusic.play().catch(()=>{}); }, {once:true});

    // --- FIREBASE LISTENERS ---
    
    // 1. Connection Monitor
    connectedRef.on("value", (snap) => {
        if (snap.val() === true) {
            roomRef.onDisconnect().update({ status: "playerLeft", winner: OPPONENT_ROLE });
        }
    });

    // 2. Game Updates Listener
    roomRef.on('value', (snapshot) => {
        const data = snapshot.val();
        
        if (!data) return; 

        // A. Check Game Over
        if (data.status === 'finished') {
            handleGameOver(data.winner, data.reason);
            return;
        }
        if (data.status === 'playerLeft') {
            handleGameOver(MY_ROLE, "Opponent Disconnected!");
            return;
        }

        // B. Update Board State
        if (data.board) {
            const newSig = JSON.stringify(data.board);
            const oldSig = JSON.stringify({pawnStacks, kingPositions}); // Note: movesPlayed not in check to avoid loop, but updated below
            
            // Hamesha update karo agar data naya hai
            if (data.board.pawnStacks) pawnStacks = data.board.pawnStacks;
            if (data.board.kingPositions) kingPositions = data.board.kingPositions;
            
            // Moves Sync
            movesPlayed = data.board.movesPlayed || 0;
            updateMoveCounter(movesPlayed);

            // Sirf tab render karo agar visual change hua ho
            if (newSig !== oldSig) {
                moveSound.play().catch(()=>{});
                renderAll();
            }
        }

        // C. Turn Handling
        if (data.turn) {
            currentTurn = data.turn;
            handleTurnChange();
        }
    });
});

// --- 4. TURN & TIMER LOGIC ---

function handleTurnChange() {
    isMyTurn = (currentTurn === MY_ROLE);
    
    // Reset Timers UI
    clearInterval(timerInterval);
    timeLeft = 15;
    updateTimerUI(100, 100); 

    // Status Update
    const badge = document.getElementById("turnBadge");
    const statusText = document.getElementById("gameStatusText");

    // Safety check if elements exist
    if (!badge || !statusText) return;

    // Reset Classes
    badge.className = "turn-badge";

    if (isMyTurn) {
        badge.innerText = "YOUR TURN";
        badge.classList.add("badge-my-turn"); // Green Pulse CSS class required
        badge.style.background = "#4ade80"; // Fallback
        statusText.innerText = "Make your move!";
        startMyTimer();
        if(navigator.vibrate) navigator.vibrate(50);
    } else {
        badge.innerText = "OPPONENT";
        badge.classList.add("badge-opp-turn"); // Yellow CSS class required
        badge.style.background = "#fbbf24"; // Fallback
        statusText.innerText = "Waiting for opponent...";
        startOpponentTimer(); 
    }
}

function startMyTimer() {
    timerInterval = setInterval(() => {
        timeLeft--;
        const percentage = (timeLeft / 15) * 100;
        updateTimerUI(percentage, 100);

        if (timeLeft <= 5) playTickSound(); 

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            makeRandomMove(); 
        }
    }, 1000);
}

function startOpponentTimer() {
    let oppTime = 15;
    timerInterval = setInterval(() => {
        oppTime--;
        const percentage = (oppTime / 15) * 100;
        updateTimerUI(100, percentage);
        
        // Claim win if opponent disconnects/lags too much
        if (oppTime <= -5) {
            clearInterval(timerInterval);
            // Optional: Claim win here if desired
        }
    }, 1000);
}


function updateMoveCounter(played) {
    const left = totalMovesLimit - played;
    const el = document.getElementById("moveCountDisplay");
    const container = document.querySelector(".move-tracker");
    
    if (el) el.innerText = left;

    if (container) {
        if (left <= 20) container.classList.add("moves-danger");
        else container.classList.remove("moves-danger");
    }
}

function updateTimerUI(myPct, oppPct) {
    if (myTimerBar) {
        myTimerBar.style.width = myPct + "%";
        if(myPct < 30) myTimerBar.classList.add("timer-danger");
        else myTimerBar.classList.remove("timer-danger");
    }
    if (oppTimerBar) oppTimerBar.style.width = oppPct + "%";
}

function playTickSound() {
    // vibrate(20); 
}

// --- 5. MOVE LOGIC ---

function makeRandomMove() {
    const moves = getAllMoves({pawnStacks, kingPositions}, MY_ROLE);
    if (moves.length > 0) {
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        if (randomMove.type === 'pawn') {
            executeMove(randomMove.from, randomMove.to, 'pawn');
        } else {
            executeMove(randomMove.from, randomMove.to, 'king', randomMove.king, randomMove.mid);
        }
    } else {
        roomRef.update({ status: 'finished', winner: OPPONENT_ROLE, reason: 'No Moves Left (Timeout)' });
    }
}

function handleBoardClick(point) {
    if (!isMyTurn || gameState !== "PLAYING") return;

    if (MY_ROLE === 'pawn') {
        handlePawnClick(point);
    } else {
        handleKingClick(point);
    }
}

function handlePawnClick(point) {
    if ((pawnStacks[point]||0) > 0) {
        clearHighlights();
        selectedPawn = point;
        highlightValidMoves(point, 'pawn');
        renderAll();
    } else if (selectedPawn && isOneStepMove(selectedPawn, point) && !isOccupied(point)) {
        executeMove(selectedPawn, point, 'pawn');
    }
}

function handleKingClick(point) {
    if (kingPositions.king1 === point || kingPositions.king2 === point) {
        clearHighlights();
        selectedKing = (kingPositions.king1 === point) ? 'king1' : 'king2';
        highlightValidMoves(point, 'king');
        renderAll();
        return;
    }

    if (selectedKing) {
        const start = kingPositions[selectedKing];
        if (isOneStepMove(start, point) && !isOccupied(point)) {
            executeMove(start, point, 'king', selectedKing);
        } else {
            const mid = isValidKingJump(start, point);
            if (mid && (pawnStacks[mid]||0) > 0 && !isOccupied(point)) {
                executeMove(start, point, 'king', selectedKing, mid);
            }
        }
    }
}

// --- 6. EXECUTE & SEND ---
function executeMove(from, to, type, kingName=null, midPoint=null) {
    const nextState = {
        pawnStacks: {...pawnStacks},
        kingPositions: {...kingPositions},
        movesPlayed: movesPlayed + 1
    };

    if (type === 'pawn') {
        nextState.pawnStacks[from]--;
        if (nextState.pawnStacks[from] === 0) delete nextState.pawnStacks[from];
        nextState.pawnStacks[to] = (nextState.pawnStacks[to] || 0) + 1;
    } else {
        nextState.kingPositions[kingName] = to;
        if (midPoint) {
            nextState.pawnStacks[midPoint]--;
            if (nextState.pawnStacks[midPoint] === 0) delete nextState.pawnStacks[midPoint];
        }
    }

    // Check Win Locally
    const winner = checkWinLocally(nextState);
    
    const updateData = {
        board: nextState,
        turn: OPPONENT_ROLE, 
        lastMoveTime: firebase.database.ServerValue.TIMESTAMP
    };

    if (winner) {
        updateData.status = 'finished';
        updateData.winner = winner;
        updateData.reason = (winner === 'king') ? "King Survived (Moves/Time)" : "King Trapped!";
    }

    roomRef.update(updateData);
    
    clearHighlights();
    selectedPawn = null;
    selectedKing = null;
}

// --- 7. HELPERS ---
function isOccupied(p) { return (pawnStacks[p]||0)>0 || kingPositions.king1===p || kingPositions.king2===p; }
function pointName(col, row) { return `${cols[col]}${row+1}`; }
function parsePoint(p) { if(!p) return {col:-1,row:-1}; return {col: cols.indexOf(p[0]), row: parseInt(p[1])-1}; }
function pointToCoord(p) { const c=parsePoint(p); return {x:c.col*size, y:c.row*size}; }

const VALID_NEIGHBORS = new Set(["A1-B2","B2-A1","B2-C3","C3-B2","C3-D4","D4-C3","D4-E5","E5-D4","E1-D2","D2-E1","D2-C3","C3-D2","C3-B4","B4-C3","B4-A5","A5-B4","C1-B2","B2-C1","B2-A3","A3-B2","A3-B4","B4-A3","B4-C5","C5-B4","C1-D2","D2-C1","D2-E3","E3-D2","E3-D4","D4-E3","D4-C5","C5-D4","A1-C3","C3-A1","E1-C3","C3-E1","A5-C3","C3-A5","E5-C3","C3-E5"]);

function isOneStepMove(f, t) {
    const a=parsePoint(f), b=parsePoint(t);
    const dr=Math.abs(a.row-b.row), dc=Math.abs(a.col-b.col);
    if((dr===0&&dc===1)||(dc===0&&dr===1)) return true;
    if(dr===1&&dc===1) return VALID_NEIGHBORS.has(`${f}-${t}`) || VALID_NEIGHBORS.has(`${t}-${f}`);
    return false;
}

function isValidKingJump(from, to) {
    const a=parsePoint(from), b=parsePoint(to);
    const dr=b.row-a.row, dc=b.col-a.col;
    if(!((Math.abs(dr)===2&&dc===0)||(Math.abs(dc)===2&&dr===0)||(Math.abs(dr)===2&&Math.abs(dc)===2))) return null;
    const mid=pointName(a.col+Math.sign(dc), a.row+Math.sign(dr));
    return (isOneStepMove(from,mid) && isOneStepMove(mid,to)) ? mid : null;
}

// 🔥 FIX 2: Added 100 Move Limit Check
function checkWinLocally(state) {
    const pCount = Object.values(state.pawnStacks).reduce((a,b)=>a+b,0);
    
    if(pCount <= 5) return 'king'; // Pawns Exhausted
    if(state.movesPlayed >= totalMovesLimit) return 'king'; // Limit Reached
    
    // Note: King Trapped check (mobility) is hard to calc instantly without lag.
    // For now, reliance is on "No Moves Left" in makeRandomMove or user resignation.
    return null; 
}

// --- 8. RENDERING ---
function initBoardGrid() {
    pointsGroup.innerHTML = "";
    for(let r=0; r<5; r++) for(let c=0; c<5; c++) {
        const p = pointName(c,r);
        const {x,y} = pointToCoord(p);
        const circle = document.createElementNS("http://www.w3.org/2000/svg","circle");
        circle.setAttribute("cx",x); circle.setAttribute("cy",y); circle.setAttribute("r",40);
        circle.setAttribute("fill","rgba(255,255,255,0.01)");
        circle.style.cursor="pointer";
        circle.addEventListener("pointerdown", (e)=>{e.preventDefault(); handleBoardClick(p);});
        pointsGroup.appendChild(circle);
    }
}

function renderAll() {
    piecesGroup.innerHTML = "";
    
    for(let p in pawnStacks) {
        if(pawnStacks[p]>0) {
            const {x,y} = pointToCoord(p);
            const g = document.createElementNS("http://www.w3.org/2000/svg","g");
            g.style.pointerEvents="none";
            
            const txt = document.createElementNS("http://www.w3.org/2000/svg","text");
            txt.setAttribute("x",x); txt.setAttribute("y",y);
            txt.setAttribute("font-size","54"); txt.setAttribute("text-anchor","middle"); txt.setAttribute("dominant-baseline","middle");
            txt.setAttribute("fill", (p===selectedPawn)?"#4ade80":"#003600");
            txt.textContent = "♟️";
            g.appendChild(txt);
            
            if(pawnStacks[p]>1) {
                const cnt = document.createElementNS("http://www.w3.org/2000/svg","text");
                cnt.setAttribute("x",x+20); cnt.setAttribute("y",y-4);
                cnt.setAttribute("font-size","20"); cnt.setAttribute("fill","blue"); cnt.setAttribute("font-weight","bold");
                cnt.textContent = pawnStacks[p];
                g.appendChild(cnt);
            }
            piecesGroup.appendChild(g);
        }
    }

    Object.entries(kingPositions).forEach(([k, pos]) => {
        const {x,y} = pointToCoord(pos);
        const txt = document.createElementNS("http://www.w3.org/2000/svg","text");
        txt.setAttribute("x",x); txt.setAttribute("y",y);
        txt.setAttribute("font-size","64"); txt.setAttribute("text-anchor","middle"); txt.setAttribute("dominant-baseline","middle");
        txt.style.pointerEvents="none";
        txt.textContent = "♚";
        
        if (selectedKing && kingPositions[selectedKing] === pos) txt.setAttribute("fill", "#4ade80");
        else txt.setAttribute("fill", "black");
        
        piecesGroup.appendChild(txt);
    });
}

function highlightValidMoves(point, type) {
    const moves = getAllMoves({pawnStacks, kingPositions}, type);
    moves.forEach(m => {
        let match = false;
        if(type==='king' && m.king===selectedKing) match=true;
        if(type==='pawn' && m.from===selectedPawn) match=true;
        
        if(match) {
            const {x,y} = pointToCoord(m.to);
            const circle = document.createElementNS("http://www.w3.org/2000/svg","circle");
            circle.setAttribute("cx",x); circle.setAttribute("cy",y); circle.setAttribute("r",15);
            circle.setAttribute("fill","rgba(0,255,0,0.5)");
            circle.style.pointerEvents="none";
            piecesGroup.appendChild(circle);
        }
    });
}

function getAllMoves(state, role) {
    const moves = [];
    const pStk = state.pawnStacks;
    const kPos = state.kingPositions;
    
    if (role === 'pawn') {
        for(let p in pStk) {
            if(pStk[p]>0) {
                for(let r=0; r<5; r++) for(let c=0; c<5; c++) {
                    const t = pointName(c,r);
                    if(isOneStepMove(p,t) && !isOccupied(t)) {
                        moves.push({type:'pawn', from:p, to:t});
                    }
                }
            }
        }
    } else {
        ['king1','king2'].forEach(k => {
            const pos = kPos[k];
            for(let r=0; r<5; r++) for(let c=0; c<5; c++) {
                const t = pointName(c,r);
                if(!isOccupied(t)) {
                    if(isOneStepMove(pos,t)) moves.push({type:'king', king:k, from:pos, to:t});
                    else {
                        const mid=isValidKingJump(pos,t);
                        if(mid && (pStk[mid]||0)>0) moves.push({type:'king', king:k, from:pos, to:t, mid:mid});
                    }
                }
            }
        });
    }
    return moves;
}

// --- 9. UTILITIES ---
function toggleSound() {
    isMuted = !isMuted;
    bgMusic.muted = isMuted;
    const icon = document.querySelector("#soundBtn i");
    if(isMuted) { icon.classList.remove("fa-volume-up"); icon.classList.add("fa-volume-mute"); }
    else { icon.classList.remove("fa-volume-mute"); icon.classList.add("fa-volume-up"); }
}

function showSurrenderConfirm() {
    if(confirm("Are you sure you want to surrender? You will lose 50 coins.")) {
        roomRef.update({ status: 'finished', winner: OPPONENT_ROLE, reason: 'Opponent Surrendered' });
    }
}

function handleGameOver(winner, reason) {
    gameState = "GAME_OVER";
    clearInterval(timerInterval);
    
    const modal = document.getElementById("gameOverModal");
    const title = document.getElementById("winTitle");
    const msg = document.getElementById("winMessage");
    const icon = document.getElementById("winIcon");
    
    modal.classList.remove("hidden");
    msg.innerText = reason;
    
    if (winner === MY_ROLE) {
        title.innerText = "YOU WON!";
        title.style.color = "#4ade80";
        icon.innerText = "🏆";
        winSound.play().catch(()=>{});
        
        // Coins logic
        myCoins += 100;
        localStorage.setItem("tt_coins", myCoins);
    } else {
        title.innerText = "YOU LOST";
        title.style.color = "#ef4444";
        icon.innerText = "💔";
        loseSound.play().catch(()=>{});
    }
}