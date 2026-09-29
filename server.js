const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

// ========== 密码配置 ==========
// 管理员总密码
const ADMIN_PASSWORD = 'aaaa666';
// 存储当天8个房间的4位密码
let roomPasswords = [];

// 生成8个房间的4位随机数字密码（补前导零，固定4位）
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
    // 之后每24小时执行一次
    setInterval(generateRoomPasswords, 24 * 60 * 60 * 1000);
  }, delay);
}

// 服务启动时先生成一次密码
generateRoomPasswords();
scheduleDailyReset();

// 8个房间，每间最多2人
const rooms = new Map();
for(let i=1;i<=8;i++){
  rooms.set(i, { count:0, clients:[] });
}

// 全局广播房间状态
function broadcastRoomStatus(){
  const arr = [];
  for(let i=1;i<=8;i++){
    const r = rooms.get(i);
    arr.push({num:i, full: r.count >=2});
  }
  io.emit('room_status', arr);
}

io.on('connection', (socket) => {
  console.log('客户端连接', socket.id);
  socket.currentRoom = null;
  // 新连接同步房间状态
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
  socket.on('leave_room', ()=>{
    const r = socket.currentRoom;
    if(r === null) return;
    const room = rooms.get(r);
    if(!room) return;

    // 移除当前用户
    room.clients = room.clients.filter(c=>c!==socket.id);
    room.count = room.clients.length;
    // 通知房间内对方：用户已退出
    socket.to(`room_${r}`).emit('partner_leave');
    socket.leave(`room_${r}`);
    socket.currentRoom = null;
    // 全局更新房间状态
    broadcastRoomStatus();
  });

  // 进入房间（带密码校验）
  socket.on('join', ({ roomNum, password })=>{
    const room = rooms.get(roomNum);
    if(!room) return;

    // 校验房间密码
    if (roomPasswords[roomNum - 1] !== password) {
      socket.emit('tip', '房间密码错误');
      return;
    }

    if(room.count >=2){
      socket.emit('tip','房间已满');
      return;
    }
    // 若之前在其他房间，先退出旧房间
    if(socket.currentRoom !== null){
      const old = rooms.get(socket.currentRoom);
      if(old){
        old.clients = old.clients.filter(c=>c!==socket.id);
        old.count = old.clients.length;
      }
    }
    socket.currentRoom = roomNum;
    socket.join(`room_${roomNum}`);
    room.clients.push(socket.id);
    room.count = room.clients.length;
    // 全局更新房间状态
    broadcastRoomStatus();

    if(room.count ===1){
      socket.emit('wait');
    }else if(room.count ===2){
      io.to(`room_${roomNum}`).emit('online');
    }
  });

  socket.on('key_exchange', (payload)=>{
    const r = socket.currentRoom;
    if(!r) return;
    socket.to(`room_${r}`).emit('key_exchange', payload);
  });

  socket.on('send_cipher', (cipher)=>{
    const r = socket.currentRoom;
    if(!r) return;
    socket.to(`room_${r}`).emit('recv_cipher', cipher);
  });

  // 断线处理
  socket.on('disconnect', ()=>{
    const r = socket.currentRoom;
    if(r === null) return;
    const room = rooms.get(r);
    if(!room) return;
    room.clients = room.clients.filter(c=>c!==socket.id);
    room.count = room.clients.length;
    socket.to(`room_${r}`).emit('partner_leave');
    // 全局更新房间状态
    broadcastRoomStatus();
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', ()=>{
  console.log(`服务启动成功，端口号 ${PORT}`);
});
