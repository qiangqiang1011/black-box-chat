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

//房间池
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
  console.log('新连接 socket.id =', socket.id);
  socket.currentRoomKey = null;

  socket.on('auto_join', (rawRoomKey) => {
    //后端也trim，消除首尾空格漏洞
    const roomKey = rawRoomKey.trim();
    if (!roomKey) return;

    // 如果当前已经在别的房间，先退出旧房间
    if(socket.currentRoomKey){
      const oldKey = socket.currentRoomKey;
      const oldRoom = getRoom(oldKey);
      oldRoom.clients.delete(socket.id);
      socket.leave(oldKey);
      console.log(`【离开旧房间】${socket.id}, room:${oldKey},剩余:${oldRoom.clients.size}`);
      if(oldRoom.clients.size === 0){
        delete rooms[oldKey];
      }
      socket.currentRoomKey = null;
    }

    const room = getRoom(roomKey);
    socket.join(roomKey, () => {
      room.clients.add(socket.id);
      socket.currentRoomKey = roomKey;
      console.log(`尝试加入房间【${roomKey}】，socket:${socket.id} 当前人数:${room.clients.size}`);

      if(room.clients.size > MAX_ROOM_SIZE){
        room.clients.delete(socket.id);
        socket.leave(roomKey);
        socket.currentRoomKey = null;
        console.log(`房间【${roomKey}】已满，拒绝 ${socket.id}`);
        socket.emit('room_full');
        if(room.clients.size === 0){
          delete rooms[roomKey];
        }
        return;
      }

      if(room.clients.size === MAX_ROOM_SIZE){
        console.log(`✅房间【${roomKey}】凑齐两人，触发peer_online`);
        io.to(roomKey).emit('peer_online');
      }
    });
  });

  socket.on('send_message', (data) => {
    const roomKey = data.room.trim();
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
    console.log(`❌断开连接，离开【${roomKey}】socket:${socket.id}，剩余人数:${room.clients.size}`);

    if (room.clients.size === 1) {
      io.to(roomKey).emit('room_destroy');
    }
    if(room.clients.size === 0){
      delete rooms[roomKey];
      console.log(`🗑房间【${roomKey}】无人，删除房间`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动成功，监听端口 ${PORT}`);
});
