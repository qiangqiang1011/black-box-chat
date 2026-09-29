const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['polling', 'websocket']
});

app.use(express.static(path.join(__dirname, 'public')));

// ========== 密码配置 ==========
const ADMIN_PASSWORD = 'aaaa6666';
let roomPasswords = [];

// 生成8个房间的4位随机数字密码
function generateRoomPasswords() {
  roomPasswords = [];
  for (let i = 0; i < 8; i++) {
    const pwd = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    roomPasswords.push(pwd);
  }
  console.log('当日房间密码已生成:', roomPasswords);
}

// 每天凌晨0点自动刷新密码
function scheduleDailyReset() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const delay = nextMidnight - now;
  setTimeout(() => {
    generateRoomPasswords();
    console.log('每日房间密码已自动更新');
    setInterval(generateRoomPasswords, 24 * 60 * 60 * 1000);
  }, delay);
}

generateRoomPasswords();
scheduleDailyReset();

// ========== 工具函数 ==========
// 获取指定房间当前人数（Socket.IO原生统计，绝对准确）
function getRoomSize(roomName) {
  return io.sockets.adapter.rooms.get(roomName)?.size || 0;
}

// 全局广播房间状态
function broadcastRoomStatus() {
  const arr = [];
  for (let i = 1; i <= 8; i++) {
    const size = getRoomSize(`room_${i}`);
    arr.push({ num: i, full: size >= 2 });
  }
  io.emit('room_status', arr);
}

io.on('connection', (socket) => {
  console.log('新客户端连接:', socket.id);
  socket.currentRoom = null;
  broadcastRoomStatus();

  // 管理员：获取当日所有房间密码
  socket.on('admin_get_passwords', (inputPwd) => {
    if (inputPwd === ADMIN_PASSWORD) {
      socket.emit('admin_passwords_result', { success: true, list: roomPasswords });
    } else {
      socket.emit('tip', '管理员密码错误');
    }
  });

  // 主动退出房间
  socket.on('leave_room', () => {
    const r = socket.currentRoom;
    if (r === null) return;
    const roomName = `room_${r}`;

    socket.leave(roomName);
    socket.to(roomName).emit('partner_leave');
    socket.currentRoom = null;

    console.log('用户退出房间', r, '当前人数:', getRoomSize(roomName));
    broadcastRoomStatus();
  });

  // 加入房间
  socket.on('join', ({ roomNum, password }) => {
    roomNum = Number(roomNum);
    const roomName = `room_${roomNum}`;

    // 1. 校验房间是否存在
    if (roomNum < 1 || roomNum > 8) {
      socket.emit('tip', '房间不存在');
      return;
    }

    // 2. 校验房间密码
    if (roomPasswords[roomNum - 1] !== password) {
      socket.emit('tip', '房间密码错误');
      return;
    }

    // 3. 已经在本房间，直接返回
    if (socket.currentRoom === roomNum) {
      socket.emit('wait');
      return;
    }

    // 4. 校验房间是否已满
    if (getRoomSize(roomName) >= 2) {
      socket.emit('tip', '房间已满');
      return;
    }

    // 5. 先退出旧房间
    if (socket.currentRoom !== null) {
      const oldRoomName = `room_${socket.currentRoom}`;
      socket.leave(oldRoomName);
      socket.to(oldRoomName).emit('partner_leave');
    }

    // 6. 正式加入新房间
    socket.currentRoom = roomNum;
    socket.join(roomName);

    const currentSize = getRoomSize(roomName);
    console.log('用户加入房间', roomNum, '当前人数:', currentSize);
    broadcastRoomStatus();

    // 7. 返回对应状态
    if (currentSize === 1) {
      socket.emit('wait');
    } else if (currentSize === 2) {
      io.to(roomName).emit('online');
    }
  });

  // 密钥交换转发
  socket.on('key_exchange', (payload) => {
    const r = socket.currentRoom;
    if (!r) return;
    socket.to(`room_${r}`).emit('key_exchange', payload);
  });

  // 聊天消息转发
  socket.on('send_cipher', (cipher) => {
    const r = socket.currentRoom;
    if (!r) return;
    socket.to(`room_${r}`).emit('recv_cipher', cipher);
  });

  // 断开连接处理
  socket.on('disconnect', () => {
    console.log('客户端断开:', socket.id);
    const r = socket.currentRoom;
    if (r === null) return;

    const roomName = `room_${r}`;
    socket.to(roomName).emit('partner_leave');
    socket.currentRoom = null;

    console.log('用户断线退出房间', r, '当前人数:', getRoomSize(roomName));
    broadcastRoomStatus();
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动成功，端口号 ${PORT}`);
});
