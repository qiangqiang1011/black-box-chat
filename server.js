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

const PORT = process.env.PORT || 80;

//房间池：key=房间密钥
const rooms = {};
const MAX_ROOM_SIZE = 2;

function getRoom(roomKey) {
  if (!rooms[roomKey]) {
    rooms[roomKey] = {
      clients: new Set(),
      history: []
    };
  }
  return rooms[roomKey];
}

io.on('connection', (socket) => {
  console.log('新连接：', socket.id);
  socket.currentRoomKey = null;

  socket.on('auto_join', (roomKey) => {
    //先离开旧房间
    if(socket.currentRoomKey){
      const oldRoom = getRoom(socket.currentRoomKey);
      oldRoom.clients.delete(socket.id);
      socket.leave(socket.currentRoomKey);
      if(oldRoom.clients.size === 1){
        io.to(socket.currentRoomKey).emit('room_destroy');
        oldRoom.history = [];
      }
      socket.currentRoomKey = null;
    }

    const room = getRoom(roomKey);

    socket.join(roomKey, () => {
      // join成功之后，再判断人数
      if(room.clients.size >= MAX_ROOM_SIZE){
        socket.leave(roomKey);
        socket.emit('room_full');
        return;
      }

      // 加入成功，再添加到集合
      room.clients.add(socket.id);
      socket.currentRoomKey = roomKey;
      console.log(`${socket.id} 加入房间【${roomKey}】，当前人数：${room.clients.size}`);

      if(room.clients.size === 2){
        // 第二个人来了，触发双方信道建立
        io.to(roomKey).emit('peer_online');
      }
      // size ===1：第一个人，什么事件都不发，前端直接显示等待提示
    });
  });

  socket.on('send_message', (data) => {
    const roomKey = data.room;
    const room = getRoom(roomKey);
    room.history.push({
      msgId: data.msgId,
      sender: data.sender,
      encrypted: data.encrypted
    });
    socket.to(roomKey).emit('receive_message', {
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
    const roomKey = socket.currentRoomKey;
    if (!roomKey) return;
    const room = getRoom(roomKey);
    room.clients.delete(socket.id);
    socket.leave(roomKey);
    console.log(`${socket.id}离开房间【${roomKey}】，剩余${room.clients.size}`);

    if (room.clients.size === 1) {
      io.to(roomKey).emit('room_destroy');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动，监听端口 ${PORT}`);
});
