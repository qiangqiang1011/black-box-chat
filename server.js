const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static('public'));
app.get('/healthz', (req, res) => {
  res.sendStatus(200);
});

// 适配云托管默认 80 探针
const PORT = process.env.PORT || 80;
const FIXED_ROOM = "default_room_001";
let roomHistory = [];
const onlineClients = new Set();
const MAX_ROOM_SIZE = 2;

function broadcastPeerState() {
  if(onlineClients.size === 2) {
    io.to(FIXED_ROOM).emit('peer_online');
  }
}

io.on('connection', (socket) => {
  console.log('新连接：', socket.id);

  socket.on('auto_join', () => {
    if (onlineClients.size >= MAX_ROOM_SIZE) {
      socket.emit('room_full');
      console.log(`拒绝${socket.id}，当前在线${onlineClients.size}`);
      return;
    }
    socket.join(FIXED_ROOM);
    socket.currentRoom = FIXED_ROOM;
    onlineClients.add(socket.id);
    console.log(`${socket.id}加入房间，在线：`, onlineClients.size);
    broadcastPeerState();
  });

  socket.on('send_message', (data) => {
    roomHistory.push({
      msgId: data.msgId,
      sender: data.sender,
      encrypted: data.encrypted
    });
    socket.to(data.room).emit('receive_message', {
      msgId: data.msgId,
      sender: data.sender,
      encrypted: data.encrypted
    });
  });

  socket.on('read_receipt', (data) => {
    socket.to(data.room).emit('message_read', data.msgId);
  });

  socket.on('typing', (data) => {
    socket.to(data.room).emit('user_typing', data.sender);
  });

  socket.on('stop_typing', (data) => {
    socket.to(data.room).emit('user_stop_typing', data.sender);
  });

  socket.on('disconnecting', () => {
    const room = socket.currentRoom;
    if (!room) return;
    onlineClients.delete(socket.id);
    console.log(`${socket.id}离开房间，在线：`, onlineClients.size);

    if (onlineClients.size === 1) {
      io.to(room).emit('room_destroy');
      roomHistory = [];
    }
    if(onlineClients.size === 0){
      roomHistory = [];
    }
    broadcastPeerState();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动，监听端口 ${PORT}`);
});
