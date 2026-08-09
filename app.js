document.addEventListener('DOMContentLoaded', () => {
  const btnPublic = document.getElementById('btn-public');
  const btnCreate = document.getElementById('btn-create');
  const btnJoin = document.getElementById('btn-join');
  const btnLeave = document.getElementById('btn-leave');
  const btnSend = document.getElementById('btn-send');

  const btnCamera = document.getElementById('btn-camera');
  const btnGallery = document.getElementById('btn-gallery');
  const cameraInput = document.getElementById('camera-input');
  const galleryInput = document.getElementById('gallery-input');

  const roomCodeInput = document.getElementById('room-code-input');
  const messageInput = document.getElementById('message-input');

  const introScreen = document.getElementById('intro-screen');
  const chatScreen = document.getElementById('chat-screen');
  const roomCodeDisplay = document.getElementById('room-code-display');
  const messagesContainer = document.getElementById('messages');

  const userId = 'user_' + Math.random().toString(36).substring(2, 9);
  let currentRoomId = null;
  let realtimeSubscription = null;

  // URL firmati per le foto: durata di validità (24 ore)
  const SIGNED_URL_TTL = 60 * 60 * 24;

  // Limiti upload lato client (il bucket ha comunque un limite reale lato server)
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'];

  // --- Modalità Moderatore (solo lato client, vedi nota sicurezza) ---
  const ADMIN_PASSWORD = 'lampo2026'; // Cambia questa password a piacere
  const btnAdmin = document.getElementById('btn-admin');
  let isAdmin = sessionStorage.getItem('chatlampo_admin') === '1';

  function updateAdminButton() {
    if (btnAdmin) btnAdmin.classList.toggle('active', isAdmin);
  }
  updateAdminButton();

  if (btnAdmin) {
    btnAdmin.addEventListener('click', () => {
      if (isAdmin) {
        isAdmin = false;
        sessionStorage.removeItem('chatlampo_admin');
      } else {
        const pwd = prompt('Password moderatore:');
        if (pwd === null) return;
        if (pwd === ADMIN_PASSWORD) {
          isAdmin = true;
          sessionStorage.setItem('chatlampo_admin', '1');
        } else {
          alert('Password errata.');
          return;
        }
      }
      updateAdminButton();
      loadMessages();
    });
  }

  if (btnCamera && cameraInput) btnCamera.addEventListener('click', () => cameraInput.click());
  if (btnGallery && galleryInput) btnGallery.addEventListener('click', () => galleryInput.click());

  async function handleImageUpload(inputElement, buttonElement, defaultIcon) {
    const file = inputElement.files[0];
    if (!file || !currentRoomId) return;

    // Validazione lato client (tipo e dimensione)
    if (!ALLOWED_TYPES.includes(file.type)) {
      alert('Formato non supportato. Usa una foto JPG, PNG, WEBP, GIF o HEIC.');
      inputElement.value = '';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert('Foto troppo grande (max 10 MB).');
      inputElement.value = '';
      return;
    }

    buttonElement.innerText = '⏳';

    const fileExt = file.name.split('.').pop();
    const fileName = `${currentRoomId}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

    const { error } = await supabase.storage
      .from('chat-photos')
      .upload(fileName, file);

    if (error) {
      alert('Errore caricamento foto: ' + error.message);
      buttonElement.innerText = defaultIcon;
      return;
    }

    // Salviamo solo il PERCORSO nel bucket, non un URL pubblico:
    // l'URL vero viene generato al volo (ed è temporaneo) quando si visualizza il messaggio.
    const { error: insertError } = await supabase.from('messages').insert([{
      room_id: currentRoomId,
      sender_id: userId,
      content: `[IMG]${fileName}`
    }]);

    if (insertError) {
      handleInsertError(insertError);
    }

    inputElement.value = '';
    buttonElement.innerText = defaultIcon;
  }

  if (cameraInput) cameraInput.addEventListener('change', () => handleImageUpload(cameraInput, btnCamera, '📷'));
  if (galleryInput) galleryInput.addEventListener('change', () => handleImageUpload(galleryInput, btnGallery, '🖼️'));

  // --- Ingresso stanze: passa sempre dalle funzioni RPC create_room/join_room ---

  if (btnPublic) {
    btnPublic.addEventListener('click', async () => {
      let { data } = await supabase.rpc('join_room', { p_code: 'PUBBLICA', p_pin: null });
      let room = Array.isArray(data) ? data[0] : data;

      if (!room) {
        const { data: created } = await supabase.rpc('create_room', { p_code: 'PUBBLICA', p_pin: null });
        room = Array.isArray(created) ? created[0] : created;
      }

      if (room) enterRoom(room.id, room.code);
      else alert('Impossibile accedere alla stanza pubblica.');
    });
  }

  if (btnCreate) {
    btnCreate.addEventListener('click', async () => {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const pin = prompt('Vuoi proteggere la stanza con un PIN? Lascia vuoto per nessun PIN.');
      if (pin === null) return; // annullato

      const { data, error } = await supabase.rpc('create_room', {
        p_code: code,
        p_pin: pin.trim().length > 0 ? pin.trim() : null
      });
      const room = Array.isArray(data) ? data[0] : data;

      if (error || !room) {
        alert('Errore nella creazione della stanza.');
        return;
      }
      enterRoom(room.id, room.code);
    });
  }

  if (btnJoin) {
    btnJoin.addEventListener('click', async () => {
      const code = roomCodeInput.value.trim().toUpperCase();
      if (!code) return alert('Inserisci un codice!');

      // Primo tentativo senza PIN
      let { data } = await supabase.rpc('join_room', { p_code: code, p_pin: null });
      let room = Array.isArray(data) ? data[0] : data;

      if (!room) {
        // Potrebbe servire un PIN, oppure la stanza non esiste
        const pin = prompt('Stanza non trovata o protetta da PIN. Inserisci il PIN (se la stanza non ne ha, annulla):');
        if (pin === null) return alert('Stanza non trovata!');

        const retry = await supabase.rpc('join_room', { p_code: code, p_pin: pin.trim() });
        room = Array.isArray(retry.data) ? retry.data[0] : retry.data;

        if (!room) return alert('Stanza non trovata o PIN errato!');
      }

      enterRoom(room.id, room.code);
    });
  }

  function enterRoom(roomId, code) {
    currentRoomId = roomId;
    roomCodeDisplay.innerText = code;
    introScreen.style.display = 'none';
    chatScreen.style.display = 'flex';

    loadMessages();
    listenToMessages();
  }

  if (btnLeave) {
    btnLeave.addEventListener('click', () => {
      if (realtimeSubscription) supabase.removeChannel(realtimeSubscription);
      currentRoomId = null;
      messagesContainer.innerHTML = '';
      chatScreen.style.display = 'none';
      introScreen.style.display = 'flex';
    });
  }

  // --- Invio messaggi (con piccolo cooldown anti-spam lato client) ---

  let sendLocked = false;

  if (btnSend) btnSend.addEventListener('click', sendMessage);
  if (messageInput) {
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }

  function handleInsertError(error) {
    if (error.message && error.message.includes('RATE_LIMIT')) {
      alert('Stai scrivendo troppo velocemente, aspetta qualche secondo.');
    } else {
      alert('Errore: ' + error.message);
    }
  }

  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentRoomId || sendLocked) return;

    sendLocked = true;
    if (btnSend) btnSend.disabled = true;

    messageInput.value = '';
    const { error } = await supabase.from('messages').insert([{
      room_id: currentRoomId,
      sender_id: userId,
      content: text
    }]);

    if (error) handleInsertError(error);

    setTimeout(() => {
      sendLocked = false;
      if (btnSend) btnSend.disabled = false;
    }, 400);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', currentRoomId)
      .order('created_at', { ascending: true });

    messagesContainer.innerHTML = '';
    if (data) {
      for (const msg of data) {
        await renderMessage(msg);
      }
    }
  }

  function listenToMessages() {
    realtimeSubscription = supabase
      .channel('room-' + currentRoomId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${currentRoomId}` }, (payload) => {
        renderMessage(payload.new);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${currentRoomId}` }, (payload) => {
        const el = document.querySelector(`[data-id="${payload.old.id}"]`);
        if (el) el.remove();
      })
      .subscribe();
  }

  // Genera un URL temporaneo firmato per un percorso nel bucket privato
  async function getSignedUrl(filePath) {
    const { data, error } = await supabase.storage
      .from('chat-photos')
      .createSignedUrl(filePath, SIGNED_URL_TTL);
    if (error || !data) return null;
    return data.signedUrl;
  }

  async function renderMessage(msg) {
    const div = document.createElement('div');
    div.classList.add('message');
    div.classList.add(msg.sender_id === userId ? 'mine' : 'theirs');
    div.dataset.id = msg.id;

    const isMine = msg.sender_id === userId;
    const canDelete = isMine || isAdmin;

    if (msg.content.startsWith('[IMG]')) {
      const filePath = msg.content.replace('[IMG]', '');

      const imgContainer = document.createElement('div');
      imgContainer.classList.add('img-container');

      const img = document.createElement('img');
      img.classList.add('message-img');
      img.alt = 'foto';
      imgContainer.appendChild(img);

      // URL firmato generato al volo: non è mai salvato in chiaro nel DB
      getSignedUrl(filePath).then((url) => {
        if (url) img.src = url;
      });

      if (canDelete) {
        const delBtn = document.createElement('button');
        delBtn.classList.add('delete-btn');
        delBtn.innerHTML = '🗑️';
        delBtn.onclick = () => deleteMessage(msg.id, filePath, div);
        imgContainer.appendChild(delBtn);
      }

      div.appendChild(imgContainer);
    } else {
      const textSpan = document.createElement('span');
      textSpan.innerText = msg.content;
      div.appendChild(textSpan);

      if (canDelete) {
        const delBtn = document.createElement('button');
        delBtn.classList.add('delete-btn-text');
        delBtn.innerHTML = '✕';
        delBtn.onclick = () => deleteMessage(msg.id, null, div);
        div.appendChild(delBtn);
      }
    }

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  async function deleteMessage(msgId, filePath, element) {
    if (!confirm('Vuoi cancellare questo elemento?')) return;

    if (filePath) {
      try {
        await supabase.storage.from('chat-photos').remove([filePath]);
      } catch (e) {
        console.error(e);
      }
    }

    const { error } = await supabase.from('messages').delete().eq('id', msgId);
    if (!error) {
      element.remove();
    }
  }
});
