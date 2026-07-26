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

let waitingUser = null;

io.on('connection', (socket) => {
    console.log(`Utente connesso: ${socket.id}`);

    // Cerca un partner
    socket.on('find_partner', () => {
        if (waitingUser && waitingUser.id !== socket.id) {
            const partnerSocket = waitingUser;
            waitingUser = null;

            const roomId = `room_${socket.id}_${partnerSocket.id}`;
            socket.join(roomId);
            partnerSocket.join(roomId);

            socket.roomId = roomId;
            partnerSocket.roomId = roomId;

            io.to(roomId).emit('peer_connected');
            console.log(`Match creato! Stanza: ${roomId}`);
        } else {
            waitingUser = socket;
            console.log(`Utente ${socket.id} in attesa.`);
        }
    });

    // Annulla ricerca prima di trovare un abbinamento
    socket.on('cancel_search', () => {
        if (waitingUser && waitingUser.id === socket.id) {
            waitingUser = null;
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

    // Abbandona la chat
    socket.on('leave_chat', () => disconnectUser(socket));
    socket.on('disconnect', () => disconnectUser(socket));

    function disconnectUser(s) {
        if (waitingUser && waitingUser.id === s.id) {
            waitingUser = null;
        }
        if (s.roomId) {
            s.to(s.roomId).emit('peer_disconnected');
            s.leave(s.roomId);
            s.roomId = null;
        }
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});
