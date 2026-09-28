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

  // 主动退出房间
  socket.on('leave_room', ()=>{
    const r = socket.currentRoom;
    if(r === null) return;
    const room = rooms.get(r);
    if(!room) return;

    // 移除当前用户
    room.clients = room.clients.filter(c=>c!==socket.id);
    room.count = room.clients.length;
    // 只通知房间内对方：用户已退出，不强制对方离开房间
    socket.to(`room_${r}`).emit('partner_leave');
    socket.leave(`room_${r}`);
    socket.currentRoom = null;
    // 全局更新房间状态
    broadcastRoomStatus();
  });

  // 进入房间
  socket.on('join', (roomNum)=>{
    const room = rooms.get(roomNum);
    if(!room) return;
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
  console.log(`服务启动，端口 ${PORT}`);
});
