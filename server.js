const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket'] // 强制纯websocket，杜绝连接升级
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

// ========== 房间管理（按客户端ID去重，彻底解决人数虚高） ==========
// 每个房间是一个Map：key=客户端ID，value=该客户端的连接数
const rooms = new Map();
for(let i = 1; i <= 8; i++){
  rooms.set(i, new Map());
}

function broadcastRoomStatus() {
  const arr = [];
  for(let i = 1; i <= 8; i++) {
    // 人数 = Map的size（不同客户端的数量）
    arr.push({ num: i, full: rooms.get(i).size >= 2 });
  }
  io.emit('room_status', arr);
}

io.on('connection', (socket) => {
  // 从连接参数获取固定客户端ID（同一个浏览器永远同一个ID）
  const clientId = socket.handshake.query.clientId;
  console.log('新客户端连接:', clientId, socket.id);
  
  if (!clientId) {
    socket.disconnect();
    return;
  }

  socket.clientId = clientId;
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

    // 该客户端连接数减1
    const count = (room.get(clientId) || 1) - 1;
    if (count <= 0) {
      // 连接数归零，真正移除用户
      room.delete(clientId);
      socket.leave(roomName);
      // 房间还有人，才发退出通知
      if (room.size > 0) {
        socket.to(roomName).emit('partner_leave');
      }
    } else {
      room.set(clientId, count);
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

    // 房间已满（按不同客户端数判断）
    if (room.size >= 2 && !room.has(clientId)) {
      socket.emit('tip', '房间已满');
      return;
    }

    // 先退出旧房间
    if (socket.currentRoom !== null) {
      const oldNum = socket.currentRoom;
      const oldRoom = rooms.get(oldNum);
      const oldRoomName = `room_${oldNum}`;
      if (oldRoom) {
        const oldCount = (oldRoom.get(clientId) || 1) - 1;
        if (oldCount <= 0) {
          oldRoom.delete(clientId);
          socket.leave(oldRoomName);
          if (oldRoom.size > 0) {
            socket.to(oldRoomName).emit('partner_leave');
          }
        } else {
          oldRoom.set(clientId, oldCount);
        }
      }
    }

    // 加入新房间
    socket.currentRoom = roomNum;
    socket.join(roomName);
    // 连接数+1（同一个客户端重连只增加计数，人数不变）
    room.set(clientId, (room.get(clientId) || 0) + 1);

    console.log('用户加入房间', roomNum, '当前人数:', room.size, '连接数:', room.get(clientId));
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
    console.log('客户端断开:', clientId, socket.id);
    const r = socket.currentRoom;
    if (!r) return;

    const room = rooms.get(r);
    const roomName = `room_${r}`;
    
    // 连接数减1
    const count = (room.get(clientId) || 1) - 1;
    if (count <= 0) {
      // 连接数归零，真正移除用户
      room.delete(clientId);
      if (room.size > 0) {
        socket.to(roomName).emit('partner_leave');
      }
    } else {
      room.set(clientId, count);
    }

    console.log('用户断线退出房间', r, '当前人数:', room.size);
    broadcastRoomStatus();
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动成功，端口号 ${PORT}`);
});
