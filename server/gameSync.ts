import { WebSocketServer, WebSocket } from 'ws';
import { storage } from './storage';

// أنواع الأحداث للألعاب
export type GameEventType = 
  | 'game_start'
  | 'game_end'
  | 'player_move'
  | 'player_score'
  | 'game_state_update'
  | 'player_powerup'
  | 'player_collision'
  | 'fruit_spawn'
  | 'bomb_explosion'
  | 'level_complete'
  | 'multiplayer_invite'
  | 'room_create'
  | 'room_join'
  | 'room_leave';

export interface GamePlayer {
  id: string;
  username: string;
  isAdmin: boolean;
  isHost: boolean;
  score: number;
  lives: number;
  level: number;
  position: { x: number; y: number };
  powerups: string[];
  isReady: boolean;
  ws: WebSocket;
}

export interface GameRoom {
  id: string;
  name: string;
  gameType: string;
  players: Map<string, GamePlayer>;
  gameState: any;
  settings: {
    maxPlayers: number;
    isPrivate: boolean;
    password?: string;
    gameMode: 'competitive' | 'cooperative';
    difficulty: 'easy' | 'medium' | 'hard';
  };
  status: 'waiting' | 'playing' | 'paused' | 'finished';
  createdAt: Date;
  hostId: string;
}

export interface GameMessage {
  type: GameEventType;
  roomId: string;
  playerId: string;
  data?: any;
  timestamp: number;
}

export class GameSyncManager {
  private rooms = new Map<string, GameRoom>();
  private playerRooms = new Map<string, string>(); // playerId -> roomId
  private gameTimers = new Map<string, NodeJS.Timeout>();

  constructor(private wss: WebSocketServer) {
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (message) => {
        try {
          const gameMessage: GameMessage = JSON.parse(message.toString());
          this.handleGameMessage(ws, gameMessage);
        } catch (error) {
          console.error('خطأ في معالجة رسالة اللعبة:', error);
        }
      });

      ws.on('close', () => {
        this.handlePlayerDisconnect(ws);
      });
    });
  }

  private async handleGameMessage(ws: WebSocket, message: GameMessage) {
    switch (message.type) {
      case 'room_create':
        await this.createGameRoom(ws, message);
        break;
      case 'room_join':
        await this.joinGameRoom(ws, message);
        break;
      case 'room_leave':
        await this.leaveGameRoom(ws, message);
        break;
      case 'game_start':
        await this.startGame(message.roomId, message.playerId);
        break;
      case 'player_move':
        this.handlePlayerMove(message);
        break;
      case 'player_score':
        await this.handlePlayerScore(message);
        break;
      case 'game_state_update':
        this.broadcastGameState(message);
        break;
      case 'fruit_spawn':
        this.handleFruitSpawn(message);
        break;
      case 'bomb_explosion':
        this.handleBombExplosion(message);
        break;
      default:
        console.log('نوع رسالة غير معروف:', message.type);
    }
  }

  private async createGameRoom(ws: WebSocket, message: GameMessage) {
    const roomId = this.generateRoomId();
    const { gameType, settings, playerInfo } = message.data;

    const room: GameRoom = {
      id: roomId,
      name: `غرفة ${playerInfo.username}`,
      gameType,
      players: new Map(),
      gameState: this.initializeGameState(gameType),
      settings: {
        maxPlayers: settings.maxPlayers || 4,
        isPrivate: settings.isPrivate || false,
        password: settings.password,
        gameMode: settings.gameMode || 'competitive',
        difficulty: settings.difficulty || 'medium'
      },
      status: 'waiting',
      createdAt: new Date(),
      hostId: playerInfo.id
    };

    this.rooms.set(roomId, room);
    
    // إضافة اللاعب كمضيف
    const player: GamePlayer = {
      id: playerInfo.id,
      username: playerInfo.username,
      isAdmin: playerInfo.isAdmin || false,
      isHost: true,
      score: 0,
      lives: 3,
      level: 1,
      position: { x: 50, y: 50 },
      powerups: [],
      isReady: true,
      ws
    };

    room.players.set(playerInfo.id, player);
    this.playerRooms.set(playerInfo.id, roomId);

    // إرسال تأكيد إنشاء الغرفة
    this.sendToPlayer(ws, {
      type: 'room_create',
      roomId,
      playerId: playerInfo.id,
      data: {
        room: this.serializeRoom(room),
        message: 'تم إنشاء غرفة اللعبة بنجاح'
      },
      timestamp: Date.now()
    });

    console.log(`تم إنشاء غرفة جديدة: ${roomId} بواسطة ${playerInfo.username}`);
  }

  private async joinGameRoom(ws: WebSocket, message: GameMessage) {
    const { roomId, playerInfo, password } = message.data;
    const room = this.rooms.get(roomId);

    if (!room) {
      return this.sendError(ws, 'الغرفة غير موجودة');
    }

    if (room.status === 'playing') {
      return this.sendError(ws, 'اللعبة قيد التشغيل حالياً');
    }

    if (room.players.size >= room.settings.maxPlayers) {
      return this.sendError(ws, 'الغرفة ممتلئة');
    }

    if (room.settings.isPrivate && room.settings.password !== password) {
      return this.sendError(ws, 'كلمة المرور خاطئة');
    }

    // إضافة اللاعب للغرفة
    const player: GamePlayer = {
      id: playerInfo.id,
      username: playerInfo.username,
      isAdmin: playerInfo.isAdmin || false,
      isHost: false,
      score: 0,
      lives: 3,
      level: 1,
      position: { x: Math.random() * 100, y: Math.random() * 100 },
      powerups: [],
      isReady: false,
      ws
    };

    room.players.set(playerInfo.id, player);
    this.playerRooms.set(playerInfo.id, roomId);

    // إخطار جميع اللاعبين بانضمام اللاعب الجديد
    this.broadcastToRoom(roomId, {
      type: 'player_joined',
      roomId,
      playerId: playerInfo.id,
      data: {
        player: this.serializePlayer(player),
        room: this.serializeRoom(room)
      },
      timestamp: Date.now()
    });

    console.log(`انضم ${playerInfo.username} إلى الغرفة ${roomId}`);
  }

  private async leaveGameRoom(ws: WebSocket, message: GameMessage) {
    const { roomId, playerId } = message;
    const room = this.rooms.get(roomId);

    if (!room || !room.players.has(playerId)) {
      return;
    }

    room.players.delete(playerId);
    this.playerRooms.delete(playerId);

    // إذا كان المضيف، نقل الاستضافة
    if (room.hostId === playerId && room.players.size > 0) {
      const newHost = room.players.values().next().value;
      room.hostId = newHost.id;
      newHost.isHost = true;
    }

    // إذا لم يبق أحد، احذف الغرفة
    if (room.players.size === 0) {
      this.rooms.delete(roomId);
      this.clearGameTimer(roomId);
    } else {
      // إخطار باقي اللاعبين
      this.broadcastToRoom(roomId, {
        type: 'player_left',
        roomId,
        playerId,
        data: { room: this.serializeRoom(room) },
        timestamp: Date.now()
      });
    }
  }

  private async startGame(roomId: string, hostId: string) {
    const room = this.rooms.get(roomId);
    
    if (!room || room.hostId !== hostId) {
      return;
    }

    // التأكد من جاهزية جميع اللاعبين
    const allReady = Array.from(room.players.values()).every(p => p.isReady);
    if (!allReady) {
      return this.broadcastToRoom(roomId, {
        type: 'game_start',
        roomId,
        playerId: hostId,
        data: { error: 'ليس جميع اللاعبين جاهزين' },
        timestamp: Date.now()
      });
    }

    room.status = 'playing';
    room.gameState = this.initializeGameState(room.gameType);

    // بدء مؤقت اللعبة
    this.startGameTimer(roomId);

    this.broadcastToRoom(roomId, {
      type: 'game_start',
      roomId,
      playerId: hostId,
      data: {
        gameState: room.gameState,
        message: 'بدأت اللعبة!'
      },
      timestamp: Date.now()
    });

    console.log(`بدأت اللعبة في الغرفة ${roomId}`);
  }

  private handlePlayerMove(message: GameMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room || room.status !== 'playing') return;

    const player = room.players.get(message.playerId);
    if (!player) return;

    // تحديث موقع اللاعب
    player.position = message.data.position;

    // بث التحديث لباقي اللاعبين
    this.broadcastToRoom(message.roomId, {
      type: 'player_move',
      roomId: message.roomId,
      playerId: message.playerId,
      data: {
        position: player.position,
        timestamp: message.timestamp
      },
      timestamp: Date.now()
    }, message.playerId);
  }

  private async handlePlayerScore(message: GameMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    const player = room.players.get(message.playerId);
    if (!player) return;

    const { points, itemType } = message.data;
    player.score += points;

    // حفظ النتيجة في قاعدة البيانات
    try {
      await storage.saveGameScore(
        parseInt(message.playerId), 
        room.gameType, 
        player.score, 
        player.level
      );
    } catch (error) {
      console.error('خطأ في حفظ النتيجة:', error);
    }

    // بث تحديث النتيجة
    this.broadcastToRoom(message.roomId, {
      type: 'player_score',
      roomId: message.roomId,
      playerId: message.playerId,
      data: {
        score: player.score,
        points,
        itemType,
        totalPlayers: room.players.size
      },
      timestamp: Date.now()
    });
  }

  private handleFruitSpawn(message: GameMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room || room.status !== 'playing') return;

    // إضافة الفاكهة لحالة اللعبة
    if (!room.gameState.fruits) room.gameState.fruits = [];
    room.gameState.fruits.push(message.data.fruit);

    // بث ظهور الفاكهة لجميع اللاعبين
    this.broadcastToRoom(message.roomId, {
      type: 'fruit_spawn',
      roomId: message.roomId,
      playerId: message.playerId,
      data: message.data,
      timestamp: Date.now()
    });
  }

  private handleBombExplosion(message: GameMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    // تطبيق تأثير الانفجار على اللاعبين القريبين
    const { explosionPosition, radius, damage } = message.data;
    
    room.players.forEach((player, playerId) => {
      const distance = this.calculateDistance(player.position, explosionPosition);
      if (distance <= radius) {
        player.lives -= damage;
        if (player.lives <= 0) {
          player.lives = 0;
          // إخطار بخروج اللاعب
        }
      }
    });

    this.broadcastToRoom(message.roomId, {
      type: 'bomb_explosion',
      roomId: message.roomId,
      playerId: message.playerId,
      data: {
        ...message.data,
        affectedPlayers: Array.from(room.players.values())
          .filter(p => this.calculateDistance(p.position, explosionPosition) <= radius)
          .map(p => ({ id: p.id, lives: p.lives }))
      },
      timestamp: Date.now()
    });
  }

  private broadcastGameState(message: GameMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    // تحديث حالة اللعبة
    room.gameState = { ...room.gameState, ...message.data.updates };

    this.broadcastToRoom(message.roomId, {
      type: 'game_state_update',
      roomId: message.roomId,
      playerId: message.playerId,
      data: { gameState: room.gameState },
      timestamp: Date.now()
    });
  }

  private handlePlayerDisconnect(ws: WebSocket) {
    // العثور على اللاعب المنقطع
    for (const [roomId, room] of this.rooms) {
      for (const [playerId, player] of room.players) {
        if (player.ws === ws) {
          this.leaveGameRoom(ws, {
            type: 'room_leave',
            roomId,
            playerId,
            data: {},
            timestamp: Date.now()
          });
          return;
        }
      }
    }
  }

  private startGameTimer(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // إذا كان هناك مؤقت قيد التشغيل، أوقفه
    this.clearGameTimer(roomId);

    // بدء مؤقت جديد للعبة (مثلاً، 5 دقائق)
    const timer = setTimeout(() => {
      this.endGame(roomId, 'timeout');
    }, 5 * 60 * 1000); // 5 دقائق

    this.gameTimers.set(roomId, timer);
  }

  private clearGameTimer(roomId: string) {
    const timer = this.gameTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.gameTimers.delete(roomId);
    }
  }

  private async endGame(roomId: string, reason: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.status = 'finished';
    this.clearGameTimer(roomId);

    // حساب النتائج النهائية
    const results = Array.from(room.players.values())
      .map(player => ({
        id: player.id,
        username: player.username,
        score: player.score,
        level: player.level
      }))
      .sort((a, b) => b.score - a.score);

    // حفظ النتائج النهائية
    for (const player of room.players.values()) {
      try {
        await storage.saveGameScore(
          parseInt(player.id),
          room.gameType,
          player.score,
          player.level
        );
      } catch (error) {
        console.error('خطأ في حفظ النتيجة النهائية:', error);
      }
    }

    this.broadcastToRoom(roomId, {
      type: 'game_end',
      roomId,
      playerId: '',
      data: {
        reason,
        results,
        winner: results[0]
      },
      timestamp: Date.now()
    });

    console.log(`انتهت اللعبة في الغرفة ${roomId} - السبب: ${reason}`);
  }

  private broadcastToRoom(roomId: string, message: GameMessage, excludePlayerId?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.players.forEach((player, playerId) => {
      if (playerId !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
        this.sendToPlayer(player.ws, message);
      }
    });
  }

  private sendToPlayer(ws: WebSocket, message: GameMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string) {
    this.sendToPlayer(ws, {
      type: 'room_join',
      roomId: '',
      playerId: '',
      data: { error },
      timestamp: Date.now()
    });
  }

  private initializeGameState(gameType: string) {
    switch (gameType) {
      case 'fruit_catching':
        return {
          fruits: [],
          bombs: [],
          powerups: [],
          gameSpeed: 1,
          spawnRate: 1000,
          difficulty: 'medium'
        };
      case 'racing':
        return {
          track: 'default',
          laps: 3,
          checkpoints: [],
          obstacles: []
        };
      default:
        return {};
    }
  }

  private calculateDistance(pos1: { x: number; y: number }, pos2: { x: number; y: number }): number {
    return Math.sqrt(Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.y - pos1.y, 2));
  }

  private generateRoomId(): string {
    return 'room_' + Math.random().toString(36).substr(2, 9);
  }

  private serializeRoom(room: GameRoom) {
    return {
      id: room.id,
      name: room.name,
      gameType: room.gameType,
      players: Array.from(room.players.values()).map(p => this.serializePlayer(p)),
      settings: room.settings,
      status: room.status,
      hostId: room.hostId
    };
  }

  private serializePlayer(player: GamePlayer) {
    return {
      id: player.id,
      username: player.username,
      isAdmin: player.isAdmin,
      isHost: player.isHost,
      score: player.score,
      lives: player.lives,
      level: player.level,
      position: player.position,
      powerups: player.powerups,
      isReady: player.isReady
    };
  }

  // طرق عامة للوصول للمعلومات
  public getRooms() {
    return Array.from(this.rooms.values()).map(room => this.serializeRoom(room));
  }

  public getRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    return room ? this.serializeRoom(room) : null;
  }

  public getPlayerRoom(playerId: string) {
    const roomId = this.playerRooms.get(playerId);
    return roomId ? this.getRoom(roomId) : null;
  }
}