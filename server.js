const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 静态文件托管，public目录
app.use(express.static(path.join(__dirname, 'public')));

// 8个房间，每个最多2人
const rooms = new Map();
for(let i=1;i<=8;i++){
  rooms.set(i, { count:0, clients:[] });
}

// 广播全部房间状态
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
  broadcastRoomStatus();

  // 加入房间
  socket.on('join', (roomNum)=>{
    const room = rooms.get(roomNum);
    if(!room) return;
    if(room.count >=2){
      socket.emit('tip','房间已满，请选择其他房间');
      return;
    }

    // 退出之前房间
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
    broadcastRoomStatus();

    if(room.count ===1){
      socket.emit('wait');
    }else if(room.count ===2){
      io.to(`room_${roomNum}`).emit('online');
    }
  });

  // 密钥交换透传
  socket.on('key_exchange', (payload)=>{
    const r = socket.currentRoom;
    if(!r) return;
    socket.to(`room_${r}`).emit('key_exchange', payload);
  });

  // 密文转发
  socket.on('send_cipher', (cipher)=>{
    const r = socket.currentRoom;
    if(!r) return;
    socket.to(`room_${r}`).emit('recv_cipher', cipher);
  });

  // 用户断线
  socket.on('disconnect', ()=>{
    const r = socket.currentRoom;
    if(r === null) return;
    const room = rooms.get(r);
    if(!room) return;
    room.clients = room.clients.filter(c=>c!==socket.id);
    room.count = room.clients.length;
    socket.to(`room_${r}`).emit('partner_leave');
    broadcastRoomStatus();
  });
});

const PORT = 3000;
// EKS容器必须监听0.0.0.0
server.listen(PORT, '0.0.0.0', ()=>{
  console.log(`服务启动，监听端口 ${PORT}`);
});
