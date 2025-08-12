// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: roomId -> { hostId, guestId, viewerId, lobby: [socketIds] }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('create-room', (cb) => {
    const id = uuidv4().slice(0,8);
    rooms.set(id, { hostId: null, guestId: null, viewerId: null, lobby: [] });
    cb && cb({ room: id });
  });

  socket.on('join', ({ role, room, name }, cb) => {
    if (!rooms.has(room)) {
      return cb && cb({ error: 'room-not-found' });
    }
    const r = rooms.get(room);
    socket.join(room);
    socket.role = role;
    socket.room = room;
    socket.name = name || role;

    if (role === 'host') {
      r.hostId = socket.id;
      // notify host of any queued lobby members
      io.to(socket.id).emit('lobby-list', r.lobby);
    } else if (role === 'guest') {
      // add to lobby (await host accept)
      r.lobby.push({ id: socket.id, name: name || 'Guest', when: Date.now() });
      // notify host if present
      if (r.hostId) io.to(r.hostId).emit('lobby-list', r.lobby);
      // inform guest they are in lobby
      cb && cb({ status: 'waiting' });
    } else if (role === 'viewer') {
      r.viewerId = socket.id;
      // viewer connects, notify host (if present) to start forward
      if (r.hostId) io.to(r.hostId).emit('viewer-ready', { viewerId: socket.id });
    }
    cb && cb({ ok: true });
  });

  // Host accepts guest: sends back to that guest "accepted"
  socket.on('host-accept-guest', ({ room, guestId }) => {
    const r = rooms.get(room);
    if (!r || socket.id !== r.hostId) return;
    // mark guestId for room
    r.guestId = guestId;
    // tell guest they are accepted
    io.to(guestId).emit('accepted', { room, hostId: socket.id });
    // notify host to prepare receiving offer from guest
    io.to(r.hostId).emit('guest-accepted', { guestId });
    // update lobby list
    r.lobby = r.lobby.filter(x => x.id !== guestId);
    if (r.hostId) io.to(r.hostId).emit('lobby-list', r.lobby);
  });

  // Host rejects guest
  socket.on('host-reject-guest', ({ room, guestId }) => {
    const r = rooms.get(room);
    if (!r || socket.id !== r.hostId) return;
    io.to(guestId).emit('rejected', { reason: 'host rejected' });
    r.lobby = r.lobby.filter(x => x.id !== guestId);
    if (r.hostId) io.to(r.hostId).emit('lobby-list', r.lobby);
  });

  // Generic signaling forwarding
  // relay: { to, type, data }
  socket.on('signal', ({ to, type, data }) => {
    if (!to) return;
    io.to(to).emit('signal', { from: socket.id, type, data });
  });

  // Host commands to guest (mute/kick/overlay)
  socket.on('host-command', ({ room, cmd, target, payload }) => {
    const r = rooms.get(room);
    if (!r || socket.id !== r.hostId) return;
    if (cmd === 'kick') {
      io.to(target).emit('kicked', { reason: payload?.reason || 'kicked by host' });
      // clear guest if matches
      if (r.guestId === target) r.guestId = null;
    } else if (cmd === 'mute') {
      io.to(target).emit('mute', payload || {});
    } else if (cmd === 'overlay') {
      // send overlay instruction to viewer page
      if (r.viewerId) io.to(r.viewerId).emit('overlay', payload || {});
    } else if (cmd === 'start-forward') {
      // instruct host and viewer to start offer/answer flow
      io.to(r.hostId).emit('start-forward', { viewerId: r.viewerId, guestId: r.guestId });
      if (r.viewerId) io.to(r.viewerId).emit('prepare-viewer', { room, hostId: r.hostId });
    }
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    // cleanup roles from rooms
    if (!socket.room) return;
    const r = rooms.get(socket.room);
    if (!r) return;
    if (socket.role === 'host') {
      // notify guest/viewer
      if (r.guestId) io.to(r.guestId).emit('host-left');
      if (r.viewerId) io.to(r.viewerId).emit('host-left');
      rooms.delete(socket.room);
    } else if (socket.role === 'guest') {
      r.lobby = r.lobby.filter(x => x.id !== socket.id);
      if (r.hostId) io.to(r.hostId).emit('lobby-list', r.lobby);
      if (r.guestId === socket.id) r.guestId = null;
    } else if (socket.role === 'viewer') {
      if (r.hostId) io.to(r.hostId).emit('viewer-left');
      r.viewerId = null;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
