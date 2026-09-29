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

// 生成8个4位数字密码
function generatePasswords() {
  roomPasswords = Array.from({ length: 8 }, () => 
    Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  );
  console.log('当日房间密码已生成:', roomPasswords);
}
generatePasswords();

// 每天0点自动更新
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

// ========== 房间管理（Set强制去重，绝对准确） ==========
// 每个房间存socket.id集合，天然去重
const roomMembers = new Map();
for (let i = 1; i <= 8; i++) {
  roomMembers.set(i, new Set());
}

// 全局广播房间状态
function broadcastStatus() {
  const status = [];
  for (let i = 1; i <= 8; i++) {
    status.push({ num: i, full: roomMembers.get(i).size >= 2 });
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

  // 加入房间（严格顺序：校验→查人数→加入）
  socket.on('join', ({ roomNum, password }) => {
    roomNum = Number(roomNum);
    const memberSet = roomMembers.get(roomNum);

    // 1. 房间范围校验
    if (!memberSet) {
      socket.emit('tip', '房间不存在');
      return;
    }

    // 2. 密码校验
    if (roomPasswords[roomNum - 1] !== password) {
      socket.emit('tip', '房间密码错误');
      return;
    }

    // 3. 已在房间里直接返回
    if (socket.currentRoom === roomNum) {
      socket.emit('wait');
      return;
    }

    // 4. 房间已满判断（加入前判断）
    if (memberSet.size >= 2) {
      socket.emit('tip', '房间已满');
      return;
    }

    // 5. 先退出旧房间
    if (socket.currentRoom) {
      const oldSet = roomMembers.get(socket.currentRoom);
      if (oldSet) {
        oldSet.delete(socket.id);
        socket.leave(`room_${socket.currentRoom}`);
        socket.to(`room_${socket.currentRoom}`).emit('partner_leave');
      }
    }

    // 6. 加入新房间（强制去重）
    socket.currentRoom = roomNum;
    socket.join(`room_${roomNum}`);
    memberSet.add(socket.id);

    console.log('加入房间', roomNum, '当前人数:', memberSet.size, '用户:', socket.id);
    broadcastStatus();

    // 7. 返回状态
    if (memberSet.size === 1) {
      socket.emit('wait');
    } else if (memberSet.size === 2) {
      io.to(`room_${roomNum}`).emit('online');
    }
  });

  // 主动退出
  socket.on('leave_room', () => {
    if (!socket.currentRoom) return;
    const roomNum = socket.currentRoom;
    const memberSet = roomMembers.get(roomNum);
    
    memberSet.delete(socket.id);
    socket.leave(`room_${roomNum}`);
    socket.to(`room_${roomNum}`).emit('partner_leave');
    socket.currentRoom = null;

    console.log('退出房间', roomNum, '当前人数:', memberSet.size, '用户:', socket.id);
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

  // 断开连接（立刻清理）
  socket.on('disconnect', () => {
    console.log('客户端断开:', socket.id);
    if (!socket.currentRoom) return;
    
    const roomNum = socket.currentRoom;
    const memberSet = roomMembers.get(roomNum);
    memberSet.delete(socket.id);
    socket.to(`room_${roomNum}`).emit('partner_leave');

    console.log('断线退出房间', roomNum, '当前人数:', memberSet.size);
    broadcastStatus();
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动成功，端口号 ${PORT}`);
});
