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

// ========== 配置 ==========
const ADMIN_PASSWORD = 'aaaa6666';
let roomPasswords = [];

// 生成8个4位数字密码（0000-9999）
function generatePasswords() {
  roomPasswords = Array.from({ length: 8 }, () => 
    Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  );
  console.log('当日房间密码已生成:', roomPasswords);
}
generatePasswords();

// 每天凌晨0点自动更新密码
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

// ========== 核心工具 ==========
// 获取房间真实人数（socket.io原生统计，绝对准确，天然幂等）
function getRoomSize(roomName) {
  return io.sockets.adapter.rooms.get(roomName)?.size || 0;
}

// 全局广播房间状态
function broadcastStatus() {
  const status = [];
  for (let i = 1; i <= 8; i++) {
    status.push({ num: i, full: getRoomSize(`room_${i}`) >= 2 });
  }
  io.emit('room_status', status);
}

// ========== 连接处理 ==========
io.on('connection', socket => {
  console.log('客户端连接:', socket.id);
  socket.currentRoom = null;
  broadcastStatus();

  // 管理员：获取当日所有房间密码
  socket.on('admin_get', pwd => {
    if (pwd === ADMIN_PASSWORD) {
      socket.emit('admin_result', roomPasswords);
    } else {
      socket.emit('tip', '管理员密码错误');
    }
  });

  // 加入房间（密码校验 + 原生房间管理）
  socket.on('join', ({ roomNum, password }) => {
    roomNum = Number(roomNum);
    const roomName = `room_${roomNum}`;

    // 1. 校验房间范围
    if (roomNum < 1 || roomNum > 8) {
      socket.emit('tip', '房间不存在');
      return;
    }

    // 2. 校验房间密码
    if (roomPasswords[roomNum - 1] !== password) {
      socket.emit('tip', '房间密码错误');
      return;
    }

    // 3. 已在本房间，直接返回
    if (socket.currentRoom === roomNum) {
      socket.emit('wait');
      return;
    }

    // 4. 校验房间是否已满（加入前判断）
    if (getRoomSize(roomName) >= 2) {
      socket.emit('tip', '房间已满');
      return;
    }

    // 5. 先退出旧房间
    if (socket.currentRoom) {
      const oldRoomName = `room_${socket.currentRoom}`;
      socket.leave(oldRoomName);
      socket.to(oldRoomName).emit('partner_leave');
    }

    // 6. 加入新房间（socket.io原生join，天然幂等，永远不会重复计数）
    socket.join(roomName);
    socket.currentRoom = roomNum;

    console.log('用户加入房间', roomNum, '当前人数:', getRoomSize(roomName));
    broadcastStatus();

    // 7. 返回对应状态
    if (getRoomSize(roomName) === 1) {
      socket.emit('wait');
    } else if (getRoomSize(roomName) === 2) {
      io.to(roomName).emit('online');
    }
  });

  // 主动退出房间
  socket.on('leave_room', () => {
    if (!socket.currentRoom) return;
    const roomName = `room_${socket.currentRoom}`;
    socket.leave(roomName);
    socket.to(roomName).emit('partner_leave');
    socket.currentRoom = null;
    broadcastStatus();
  });

  // 密钥交换转发
  socket.on('key_exchange', data => {
    if (socket.currentRoom) {
      socket.to(`room_${socket.currentRoom}`).emit('key_exchange', data);
    }
  });

  // 聊天消息转发
  socket.on('send_cipher', data => {
    if (socket.currentRoom) {
      socket.to(`room_${socket.currentRoom}`).emit('recv_cipher', data);
    }
  });

  // 断开连接处理
  socket.on('disconnect', () => {
    if (socket.currentRoom) {
      socket.to(`room_${socket.currentRoom}`).emit('partner_leave');
      broadcastStatus();
    }
    console.log('客户端断开:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动成功，端口号 ${PORT}`);
});
