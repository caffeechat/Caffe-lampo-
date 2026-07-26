const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Serve i file statici (index.html, immagini, sw.js, manifest.json, ecc.)
app.use(express.static(path.join(__dirname)));

// Configurazione Socket.io
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// Rotta principale: invia l'index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Salviamo SOLO l'ID del socket in attesa, non l'intero oggetto
let waitingSocketId = null;

io.on('connection', (socket) => {
    console.log(`+ Utente connesso: ${socket.id}`);

    // Cerca un partner
    socket.on('find_partner', () => {
        // Verifica se c'è un altro utente in attesa ed è diverso da se stesso
        if (waitingSocketId && waitingSocketId !== socket.id) {
            const partnerSocket = io.sockets.sockets.get(waitingSocketId);

            // Se il partner esiste ed è ancora connesso
            if (partnerSocket && partnerSocket.connected) {
                const roomId = `room_${socket.id}_${partnerSocket.id}`;

                // Unisci entrambi gli utenti nella stanza
                socket.join(roomId);
                partnerSocket.join(roomId);

                socket.roomId = roomId;
                partnerSocket.roomId = roomId;

                // Reset dell'utente in attesa
                waitingSocketId = null;

                // Avvisa entrambi i client
                io.to(roomId).emit('peer_connected');
                console.log(`MATCH CREATO! Stanza: ${roomId}`);
                return;
            }
        }

        // Se la coda è vuota o il partner in attesa non era più connesso
        waitingSocketId = socket.id;
        console.log(`Utente ${socket.id} in attesa di un partner...`);
    });

    // Annulla ricerca prima di trovare un abbinamento
    socket.on('cancel_search', () => {
        if (waitingSocketId === socket.id) {
            waitingSocketId = null;
            console.log(`Utente ${socket.id} ha annullato la ricerca.`);
        }
    });

    // Invio messaggi (testo o immagini)
    socket.on('send_message', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('receive_message', data);
        }
    });

    // Gestione Scrittura (Typing)
    socket.on('typing', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner_typing');
        }
    });

    socket.on('stop_typing', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner_stop_typing');
        }
    });

    // Abbandona la chat o Disconnessione
    socket.on('leave_chat', () => cleanUpUser(socket));
    socket.on('disconnect', () => cleanUpUser(socket));

    function cleanUpUser(s) {
        if (waitingSocketId === s.id) {
            waitingSocketId = null;
        }

        if (s.roomId) {
            s.to(s.roomId).emit('peer_disconnected');
            s.leave(s.roomId);
            s.roomId = null;
        }
        console.log(`- Utente uscito/disconnesso: ${s.id}`);
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});
