const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['websocket']
});

app.use(express.static(path.join(__dirname, 'public')));

// ========== 密码配置 ==========
const ADMIN_PASSWORD = 'aaaa6666';
let roomPasswords = [];

function generatePasswords() {
  roomPasswords = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  );
  console.log('当日房间密码已生成:', roomPasswords);
}
generatePasswords();

function scheduleDailyReset() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const delay = nextMidnight - now;
  setTimeout(() => {
    generatePasswords();
    console.log('每日房间密码已自动更新');
    setInterval(generatePasswords, 24 * 60 * 60 * 1000);
  }, delay);
}
scheduleDailyReset();

// ========== 房间在线人数统计 ==========
const roomOnlineCount = new Map();
for (let i = 1; i <= 8; i++) {
  roomOnlineCount.set(i, 0);
}

function broadcastStatus() {
  const status = [];
  for (let i = 1; i <= 8; i++) {
    status.push({ num: i, online: roomOnlineCount.get(i) || 0 });
  }
  io.emit('room_status', status);
}

// ========== 连接处理 ==========
io.on('connection', socket => {
  console.log('客户端连接:', socket.id);
  socket.currentRoom = null;
  broadcastStatus();

  // 管理员查密码
  socket.on('admin_get', pwd => {
    if (pwd === ADMIN_PASSWORD) {
      socket.emit('admin_result', roomPasswords);
    } else {
      socket.emit('tip', '管理员密码错误');
    }
  });

  // 加入房间
  socket.on('join', ({ roomNum, password }) => {
    roomNum = Number(roomNum);
    const roomName = `room_${roomNum}`;

    if (roomNum < 1 || roomNum > 8) {
      socket.emit('tip', '房间不存在');
      return;
    }

    if (roomPasswords[roomNum - 1] !== password) {
      socket.emit('tip', '房间密码错误');
      return;
    }

    // 先退出旧房间
    if (socket.currentRoom) {
      const oldNum = socket.currentRoom;
      const oldName = `room_${oldNum}`;
      socket.leave(oldName);
      const oldCount = Math.max(0, (roomOnlineCount.get(oldNum) || 0) - 1);
      roomOnlineCount.set(oldNum, oldCount);
      // 退出旧房间时通知所有人，带最新人数
      socket.to(oldName).emit('user_leave', { id: socket.id, count: oldCount });
      socket.to(oldName).emit('clear_chat');
    }

    // 加入新房间
    socket.currentRoom = roomNum;
    socket.join(roomName);
    const newCount = (roomOnlineCount.get(roomNum) || 0) + 1;
    roomOnlineCount.set(roomNum, newCount);

    console.log('加入房间', roomNum, '当前在线:', newCount);
    broadcastStatus();

    // 通知房间内所有人有人加入，带最新人数
    io.to(roomName).emit('user_join', {
      id: socket.id,
      count: newCount
    });

    // 自己进入成功
    socket.emit('joined', { roomNum, count: newCount });
  });

  // 主动退出
  socket.on('leave_room', () => {
    if (!socket.currentRoom) return;
    const roomNum = socket.currentRoom;
    const roomName = `room_${roomNum}`;

    socket.leave(roomName);
    const count = Math.max(0, (roomOnlineCount.get(roomNum) || 0) - 1);
    roomOnlineCount.set(roomNum, count);
    
    // 通知房间内所有人，带最新人数
    socket.to(roomName).emit('user_leave', { id: socket.id, count: count });
    socket.to(roomName).emit('clear_chat');
    
    socket.currentRoom = null;

    console.log('退出房间', roomNum, '当前在线:', count);
    broadcastStatus();
  });

  // 聊天消息转发（纯明文，服务器不存储）
  socket.on('send_msg', text => {
    if (!socket.currentRoom) return;
    socket.to(`room_${socket.currentRoom}`).emit('recv_msg', { id: socket.id, text });
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('客户端断开:', socket.id);
    if (!socket.currentRoom) return;

    const roomNum = socket.currentRoom;
    const roomName = `room_${roomNum}`;
    const count = Math.max(0, (roomOnlineCount.get(roomNum) || 0) - 1);
    roomOnlineCount.set(roomNum, count);
    
    // 通知房间内所有人，带最新人数
    socket.to(roomName).emit('user_leave', { id: socket.id, count: count });
    socket.to(roomName).emit('clear_chat');

    console.log('断线退出房间', roomNum, '当前在线:', count);
    broadcastStatus();
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动成功，端口号 ${PORT}`);
});
