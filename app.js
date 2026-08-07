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
let isSendingImage = false;
const MAX_IMAGE_BYTES = 300 * 1024; // ~300KB soglia sicura per evitare disconnessioni

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
    showSystemMsg('Lo sconosciuto si è disconnesso.');
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

// Stima i byte reali di una stringa base64 (data URL)
function base64Size(dataUrl) {
    const commaIdx = dataUrl.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    return Math.floor(base64.length * 0.75);
}

// Ottiene un canvas ridimensionato dal file, usando createImageBitmap quando
// disponibile: decodifica l'immagine direttamente alla dimensione richiesta
// invece di caricarla intera in memoria, evitando crash su foto da 50MP+.
async function getScaledCanvas(file, maxSize) {
    let bitmap;
    let srcWidth, srcHeight;

    if (window.createImageBitmap) {
        try {
            bitmap = await createImageBitmap(file, {
                resizeWidth: maxSize,
                resizeHeight: maxSize,
                resizeQuality: 'medium'
            });
        } catch (e) {
            bitmap = await createImageBitmap(file);
        }
        srcWidth = bitmap.width;
        srcHeight = bitmap.height;
    } else {
        // Fallback per browser senza createImageBitmap
        bitmap = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('read-failed'));
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = () => reject(new Error('decode-failed'));
                img.onload = () => resolve(img);
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
        srcWidth = bitmap.width;
        srcHeight = bitmap.height;
    }

    let width = srcWidth;
    let height = srcHeight;
    if (width > height) {
        if (width > maxSize) { height *= maxSize / width; width = maxSize; }
    } else {
        if (height > maxSize) { width *= maxSize / height; height = maxSize; }
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    if (bitmap.close) bitmap.close();
    return canvas;
}

// COMPRESSIONE ADATTIVA FOTO: riduce dimensione/qualità finché il file
// non è sotto la soglia di sicurezza, evitando disconnessioni sulle foto pesanti.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // 25MB, oltre non proviamo nemmeno (rischio crash)

async function compressAndSendImage(file) {
    if (!file || isSendingImage) return;

    if (file.size > MAX_SOURCE_BYTES) {
        showSystemMsg('⚠️ Foto troppo grande per essere elaborata su questo dispositivo.');
        return;
    }

    isSendingImage = true;
    setAttachButtonsEnabled(false);

    try {
        let maxSize = 700;
        let quality = 0.6;
        let result = null;

        // Riduce progressivamente dimensione e qualità finché il
        // risultato non è sotto MAX_IMAGE_BYTES (max 6 tentativi).
        for (let attempt = 0; attempt < 6; attempt++) {
            const canvas = await getScaledCanvas(file, maxSize);
            result = canvas.toDataURL('image/jpeg', quality);

            if (base64Size(result) <= MAX_IMAGE_BYTES) break;

            quality = Math.max(0.25, quality - 0.15);
            maxSize = Math.max(250, Math.round(maxSize * 0.75));
        }

        if (!result || base64Size(result) > MAX_IMAGE_BYTES) {
            showSystemMsg('⚠️ Foto troppo pesante, prova con un\'altra immagine.');
            return;
        }

        socket.emit('send_message', { image: result });
        addImgMsg(result, 'sent');
    } catch (err) {
        showSystemMsg('⚠️ Errore durante l\'elaborazione della foto. Prova a ridurre la risoluzione della fotocamera nelle impostazioni del telefono.');
    } finally {
        isSendingImage = false;
        setAttachButtonsEnabled(true);
    }
}

function setAttachButtonsEnabled(enabled) {
    galleryBtn.disabled = !enabled;
    cameraBtn.disabled = !enabled;
    galleryBtn.style.opacity = enabled ? '1' : '0.5';
    cameraBtn.style.opacity = enabled ? '1' : '0.5';
}

function showSystemMsg(text) {
    const sysMsg = document.createElement('div');
    sysMsg.className = 'system-msg';
    sysMsg.textContent = text;
    chatMessages.appendChild(sysMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
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
