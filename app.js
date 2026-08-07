const socket = io({
    transports: ['polling', 'websocket'],
    reconnectionAttempts: 10,
    maxHttpBufferSize: 1e7
});

const headerStatus = document.getElementById('header-status');
const startChatBtn = document.getElementById('start-chat-btn');
const startBtnText = document.getElementById('start-btn-text');
const searchingState = document.getElementById('searching-state');
const screenLobby = document.getElementById('screen-lobby');
const screenChat = document.getElementById('screen-chat');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const nextPartnerBtn = document.getElementById('next-partner-btn');

const galleryBtn = document.getElementById('gallery-btn');
const galleryInput = document.getElementById('gallery-input');
const cameraBtn = document.getElementById('camera-btn');
const cameraInput = document.getElementById('camera-input');

let isSearching = false;

socket.on('connect', () => {
    headerStatus.innerHTML = '<span class="status-dot"></span> Online';
});

socket.on('connect_error', () => {
    headerStatus.innerHTML = '<span class="status-dot" style="background:#EF4444"></span> Riconnessione...';
});

startChatBtn.addEventListener('click', () => {
    if (!isSearching) {
        isSearching = true;
        searchingState.classList.add('active');
        startBtnText.textContent = "Annulla Ricerca";
        socket.emit('find_partner');
    } else {
        isSearching = false;
        searchingState.classList.remove('active');
        startBtnText.textContent = "Trova uno Sconosciuto";
        socket.emit('cancel_search');
    }
});

socket.on('peer_connected', () => {
    isSearching = false;
    searchingState.classList.remove('active');
    startBtnText.textContent = "Trova uno Sconosciuto";

    screenLobby.classList.remove('active');
    screenChat.classList.add('active');
    chatMessages.innerHTML = '<div class="system-msg">🔒 Chat crittografata. Sei connesso con uno sconosciuto. Dì ciao!</div>';
});

socket.on('peer_disconnected', () => {
    const sysMsg = document.createElement('div');
    sysMsg.className = 'system-msg';
    sysMsg.textContent = 'Lo sconosciuto si è disconnesso.';
    chatMessages.appendChild(sysMsg);
});

function sendMessage() {
    const txt = messageInput.value.trim();
    if (txt) {
        socket.emit('send_message', { text: txt });
        addMsg(txt, 'sent');
        messageInput.value = '';
    }
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

// COMPRESSIONE SUPER LEGGERA FOTO
function compressAndSendImage(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const max_size = 600; // Ridotto a 600px per massima stabilità

            if (width > height) {
                if (width > max_size) {
                    height *= max_size / width;
                    width = max_size;
                }
            } else {
                if (height > max_size) {
                    width *= max_size / height;
                    height = max_size;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Qualità al 50% per un file piccolissimo (circa 30KB)
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.5);

            socket.emit('send_message', { image: compressedBase64 });
            addImgMsg(compressedBase64, 'sent');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

galleryBtn.addEventListener('click', () => galleryInput.click());
galleryInput.addEventListener('change', (e) => {
    compressAndSendImage(e.target.files[0]);
    galleryInput.value = '';
});

cameraBtn.addEventListener('click', () => cameraInput.click());
cameraInput.addEventListener('change', (e) => {
    compressAndSendImage(e.target.files[0]);
    cameraInput.value = '';
});

socket.on('receive_message', (data) => {
    if (data.text) addMsg(data.text, 'received');
    if (data.image) addImgMsg(data.image, 'received');
});

function addMsg(txt, type) {
    const m = document.createElement('div');
    m.className = `message ${type}`;
    m.innerHTML = `<div class="msg-bubble">${txt}</div>`;
    chatMessages.appendChild(m);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addImgMsg(imgSrc, type) {
    const m = document.createElement('div');
    m.className = `message ${type}`;
    m.innerHTML = `<div class="msg-bubble"><img src="${imgSrc}" class="msg-image"></div>`;
    chatMessages.appendChild(m);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

nextPartnerBtn.addEventListener('click', () => {
    socket.emit('leave_chat');
    screenChat.classList.remove('active');
    screenLobby.classList.add('active');
});
