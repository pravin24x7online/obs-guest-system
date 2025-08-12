const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));

let hostSocket = null;
let guestSocket = null;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('role', (role) => {
    if (role === 'host') {
      hostSocket = socket;
      console.log('Host connected');
    } else if (role === 'guest') {
      guestSocket = socket;
      console.log('Guest connected');
    }
  });

  // Signaling events
  socket.on('offer', (offer) => {
    if (guestSocket) guestSocket.emit('offer', offer);
  });

  socket.on('answer', (answer) => {
    if (hostSocket) hostSocket.emit('answer', answer);
  });

  socket.on('candidate', (candidate) => {
    if (socket === hostSocket && guestSocket) {
      guestSocket.emit('candidate', candidate);
    } else if (socket === guestSocket && hostSocket) {
      hostSocket.emit('candidate', candidate);
    }
  });

  // Host control commands
  socket.on('control', (cmd) => {
    if (guestSocket) guestSocket.emit('control', cmd);
  });

  socket.on('disconnect', () => {
    if (socket === hostSocket) hostSocket = null;
    if (socket === guestSocket) guestSocket = null;
    console.log('User disconnected:', socket.id);
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
