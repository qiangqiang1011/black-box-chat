const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static('public'));

const PORT = process.env.PORT || 80;
const FIXED_ROOM = "default_room_001";
const roomHistory = new Map();
const MAX_ROOM_SIZE = 2;

io.on('connection', (socket) => {
  socket.on('auto_join', () => {
    const roomObj = io.sockets.adapter.rooms.get(FIXED_ROOM);
    const currentSize = roomObj ? roomObj.size : 0;

    if (currentSize >= MAX_ROOM_SIZE) {
      socket.emit('room_full');
      return;
    }
    socket.join(FIXED_ROOM);
    socket.currentRoom = FIXED_ROOM;

    if (roomHistory.has(FIXED_ROOM)) {
      socket.emit('room_history', roomHistory.get(FIXED_ROOM));
    }
  });

  socket.on('send_message', (data) => {
    if (!roomHistory.has(data.room)) {
      roomHistory.set(data.room, []);
    }
    roomHistory.get(data.room).push({
      msgId: data.msgId,
      sender: data.sender,
      encrypted: data.encrypted
    });
    io.to(data.room).emit('receive_message', {
      msgId: data.msgId,
      sender: data.sender,
      encrypted: data.encrypted
    });
  });

  socket.on('read_receipt', (data) => {
    socket.to(data.room).emit('message_read', data.msgId);
  });

  socket.on('typing', (data) => {
    socket.to(data.room).emit('user_typing', data.sender);
  });

  socket.on('stop_typing', (data) => {
    socket.to(data.room).emit('user_stop_typing', data.sender);
  });

  socket.on('disconnect', () => {
    const room = socket.currentRoom;
    if (!room) return;
    const roomObj = io.sockets.adapter.rooms.get(room);
    // 断开后，房间剩余人数
    const remaining = roomObj ? roomObj.size : 0;

    // 只要还有1个人留在房间 → 代表另一个人走了，立即销毁
    if (remaining === 1) {
      io.to(room).emit('room_destroy');
      roomHistory.delete(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`服务启动，监听端口 ${PORT}`);
});
