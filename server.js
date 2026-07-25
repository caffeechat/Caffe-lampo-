const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

let waitingUser = null;

io.on('connection', (socket) => {
    console.log(`Utente connesso: ${socket.id}`);

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
        } else {
            waitingUser = socket;
        }
    });

    socket.on('send_message', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('receive_message', data);
        }
    });

    socket.on('typing', (isTyping) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner_typing', isTyping);
        }
    });

    socket.on('leave_room', () => disconnectUser(socket));
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
