const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static('public'));

// 房间消息临时存储（仅内存）
const roomHistory = new Map();
// 单人房间销毁定时器
const roomTimers = new Map();
// 房间最大人数
const MAX_ROOM_SIZE = 2;

io.on('connection', (socket) => {
  // 加入房间
  socket.on('join_room', (roomCode) => {
    const roomObj = io.sockets.adapter.rooms.get(roomCode);
    const currentSize = roomObj ? roomObj.size : 0;

    // 房间满员，拒绝进入
    if (currentSize >= MAX_ROOM_SIZE) {
      socket.emit('room_full');
      return;
    }

    socket.join(roomCode);
    socket.currentRoom = roomCode;

    // 取消待销毁定时器（人回来了）
    if (roomTimers.has(roomCode)) {
      clearTimeout(roomTimers.get(roomCode));
      roomTimers.delete(roomCode);
    }

    // 发送历史消息给新进入的人
    if (roomHistory.has(roomCode)) {
      socket.emit('room_history', roomHistory.get(roomCode));
    }
  });

  // 接收并转发加密消息，存入临时历史
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

  // 转发已读回执
  socket.on('read_receipt', (data) => {
    io.to(data.room).emit('message_read', data.msgId);
  });

  // 转发正在输入状态
  socket.on('typing', (data) => {
    socket.to(data.room).emit('user_typing', data.sender);
  });

  // 转发停止输入状态
  socket.on('stop_typing', (data) => {
    socket.to(data.room).emit('user_stop_typing', data.sender);
  });

  // 断开连接：分模式处理
  socket.on('disconnect', () => {
    const room = socket.currentRoom;
    if (!room) return;

    const roomObj = io.sockets.adapter.rooms.get(room);
    const remaining = roomObj ? roomObj.size : 0;

    // 情况1：还剩1人 → 刚才是双人聊天，有人退出，立即全房销毁
    if (remaining === 1) {
      io.to(room).emit('room_destroy');
      roomHistory.delete(room);
      if (roomTimers.has(room)) {
        clearTimeout(roomTimers.get(room));
        roomTimers.delete(room);
      }
      return;
    }

    // 情况2：没人了 → 刚才是单人等待，30秒后彻底清空
    if (remaining === 0) {
      const timer = setTimeout(() => {
        roomHistory.delete(room);
        roomTimers.delete(room);
      }, 30000);
      roomTimers.set(room, timer);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务运行在端口 ${PORT}`);
});
