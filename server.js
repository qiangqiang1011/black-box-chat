const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket'] // 强制websocket，杜绝连接升级导致的人数虚高
});

app.use(express.static(path.join(__dirname, 'public')));

// ========== 密码配置 ==========
const ADMIN_PASSWORD = 'aaaa6666';
let roomPasswords = [];

function generateRoomPasswords() {
  roomPasswords = [];
  for (let i = 0; i < 8; i++) {
    const pwd = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    roomPasswords.push(pwd);
  }
  console.log('当日房间密码已生成:', roomPasswords);
}

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

// ========== 房间管理（Set天然去重） ==========
const rooms = new Map();
for(let i = 1; i <= 8; i++){
  rooms.set(i, new Set());
}

function broadcastRoomStatus() {
  const arr = [];
  for(let i = 1; i <= 8; i++) {
    arr.push({ num: i, full: rooms.get(i).size >= 2 });
  }
  io.emit('room_status', arr);
}

io.on('connection', (socket) => {
  console.log('新客户端连接:', socket.id);
  socket.currentRoom = null;
  broadcastRoomStatus();

  // 管理员获取密码
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
    if (!r) return;
    const room = rooms.get(r);
    const roomName = `room_${r}`;

    room.delete(socket.id);
    socket.leave(roomName);
    
    // 房间还有人，才发退出通知
    if (room.size > 0) {
      socket.to(roomName).emit('partner_leave');
    }
    
    socket.currentRoom = null;
    console.log('用户退出房间', r, '当前人数:', room.size);
    broadcastRoomStatus();
  });

  // 加入房间
  socket.on('join', ({ roomNum, password }) => {
    roomNum = Number(roomNum);
    const room = rooms.get(roomNum);
    const roomName = `room_${roomNum}`;

    if (!room) {
      socket.emit('tip', '房间不存在');
      return;
    }

    // 密码校验
    if (roomPasswords[roomNum - 1] !== password) {
      socket.emit('tip', '房间密码错误');
      return;
    }

    // 已在本房间，直接返回
    if (socket.currentRoom === roomNum) {
      socket.emit('wait');
      return;
    }

    // 房间已满
    if (room.size >= 2) {
      socket.emit('tip', '房间已满');
      return;
    }

    // 先退出旧房间
    if (socket.currentRoom !== null) {
      const oldRoom = rooms.get(socket.currentRoom);
      const oldRoomName = `room_${socket.currentRoom}`;
      if (oldRoom) {
        oldRoom.delete(socket.id);
        socket.leave(oldRoomName);
        if (oldRoom.size > 0) {
          socket.to(oldRoomName).emit('partner_leave');
        }
      }
    }

    // 加入新房间
    socket.currentRoom = roomNum;
    socket.join(roomName);
    room.add(socket.id);

    console.log('用户加入房间', roomNum, '当前人数:', room.size);
    broadcastRoomStatus();

    if (room.size === 1) {
      socket.emit('wait');
    } else if (room.size === 2) {
      io.to(roomName).emit('online');
    }
  });

  // 密钥交换转发
  socket.on('key_exchange', (payload) => {
    if (!socket.currentRoom) return;
    socket.to(`room_${socket.currentRoom}`).emit('key_exchange', payload);
  });

  // 聊天消息转发
  socket.on('send_cipher', (cipher) => {
    if (!socket.currentRoom) return;
    socket.to(`room_${socket.currentRoom}`).emit('recv_cipher', cipher);
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('客户端断开:', socket.id);
    const r = socket.currentRoom;
    if (!r) return;

    const room = rooms.get(r);
    const roomName = `room_${r}`;
    room.delete(socket.id);

    // 房间还有人，才发退出通知
    if (room.size > 0) {
      socket.to(roomName).emit('partner_leave');
    }

    console.log('用户断线退出房间', r, '当前人数:', room.size);
    broadcastRoomStatus();
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动成功，端口号 ${PORT}`);
});
