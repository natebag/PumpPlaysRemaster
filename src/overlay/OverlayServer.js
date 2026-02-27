const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

class OverlayServer {
  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new Server(this.httpServer, { cors: { origin: '*' } });
    this.clients = 0;

    this.app.use(express.static(path.join(__dirname, 'public')));

    this.io.on('connection', (socket) => {
      this.clients++;
      console.log(`[Overlay] Client connected (${this.clients} total)`);
      socket.on('disconnect', () => {
        this.clients--;
        console.log(`[Overlay] Client disconnected (${this.clients} total)`);
      });
    });
  }

  async start() {
    const port = parseInt(process.env.OVERLAY_PORT) || 4001;
    return new Promise((resolve) => {
      this.httpServer.listen(port, () => {
        console.log(`[Overlay] Server on http://localhost:${port}`);
        resolve();
      });
    });
  }

  broadcast(event, data) {
    this.io.emit(event, data);
  }

  stop() {
    this.httpServer.close();
  }
}

module.exports = OverlayServer;
