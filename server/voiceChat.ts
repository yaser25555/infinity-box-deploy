import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';

// أنواع أحداث المحادثة الصوتية
export type VoiceChatEventType = 
  | 'voice_room_join'
  | 'voice_room_leave'
  | 'voice_start_speaking'
  | 'voice_stop_speaking'
  | 'voice_audio_data'
  | 'voice_mute'
  | 'voice_unmute'
  | 'voice_quality_change'
  | 'voice_room_create'
  | 'voice_room_settings'
  | 'voice_user_status'
  | 'voice_echo_test'
  | 'voice_noise_reduction';

export interface VoiceUser {
  id: string;
  username: string;
  isAdmin: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  isDeafened: boolean;
  volume: number;
  quality: 'low' | 'medium' | 'high';
  ws: WebSocket;
  lastActivity: Date;
  micEnabled: boolean;
  speakerEnabled: boolean;
}

export interface VoiceRoom {
  id: string;
  name: string;
  description?: string;
  users: Map<string, VoiceUser>;
  settings: {
    maxUsers: number;
    isPrivate: boolean;
    password?: string;
    autoMute: boolean;
    noiseReduction: boolean;
    echoCancellation: boolean;
    bitrate: number;
    sampleRate: number;
  };
  createdAt: Date;
  ownerId: string;
  isTemporary: boolean;
}

export interface VoiceMessage {
  type: VoiceChatEventType;
  roomId: string;
  userId: string;
  data?: any;
  timestamp: number;
}

export class VoiceChatManager extends EventEmitter {
  private rooms = new Map<string, VoiceRoom>();
  private userRooms = new Map<string, string>(); // userId -> roomId
  private audioSessions = new Map<string, any>(); // للتحكم في جلسات الصوت

  constructor(private wss: WebSocketServer) {
    super();
    this.setupDefaultRooms();
    this.setupEventHandlers();
  }

  private setupDefaultRooms() {
    // إنشاء الغرف الافتراضية
    const generalRoom = this.createRoom({
      id: 'general',
      name: 'الغرفة العامة',
      description: 'غرفة المحادثة الصوتية العامة للجميع',
      ownerId: 'system',
      isPrivate: false,
      maxUsers: 50,
      isTemporary: false
    });

    const gameRoom = this.createRoom({
      id: 'gaming',
      name: 'غرفة الألعاب',
      description: 'للمحادثة الصوتية أثناء اللعب',
      ownerId: 'system',
      isPrivate: false,
      maxUsers: 20,
      isTemporary: false
    });

    console.log('تم إنشاء الغرف الصوتية الافتراضية');
  }

  private setupEventHandlers() {
    this.wss.on('connection', (ws: WebSocket) => {
      let currentUser: VoiceUser | null = null;

      ws.on('message', (message) => {
        try {
          const voiceMessage: VoiceMessage = JSON.parse(message.toString());
          this.handleVoiceMessage(ws, voiceMessage);
        } catch (error) {
          console.error('خطأ في معالجة رسالة المحادثة الصوتية:', error);
        }
      });

      ws.on('close', () => {
        if (currentUser) {
          this.handleUserDisconnect(currentUser);
        }
      });

      // تخزين مرجع المستخدم للاستخدام في الإغلاق
      ws.on('voice_user_authenticated', (user) => {
        currentUser = user;
      });
    });
  }

  private async handleVoiceMessage(ws: WebSocket, message: VoiceMessage) {
    switch (message.type) {
      case 'voice_room_join':
        await this.handleRoomJoin(ws, message);
        break;
      case 'voice_room_leave':
        await this.handleRoomLeave(ws, message);
        break;
      case 'voice_start_speaking':
        this.handleStartSpeaking(message);
        break;
      case 'voice_stop_speaking':
        this.handleStopSpeaking(message);
        break;
      case 'voice_audio_data':
        this.handleAudioData(message);
        break;
      case 'voice_mute':
        this.handleMute(message);
        break;
      case 'voice_unmute':
        this.handleUnmute(message);
        break;
      case 'voice_room_create':
        await this.handleRoomCreate(ws, message);
        break;
      case 'voice_quality_change':
        this.handleQualityChange(message);
        break;
      case 'voice_echo_test':
        this.handleEchoTest(ws, message);
        break;
      case 'voice_noise_reduction':
        this.handleNoiseReduction(message);
        break;
      default:
        console.log('نوع رسالة صوتية غير معروف:', message.type);
    }
  }

  private async handleRoomJoin(ws: WebSocket, message: VoiceMessage) {
    const { roomId, userInfo } = message.data;
    const room = this.rooms.get(roomId);

    if (!room) {
      return this.sendError(ws, 'الغرفة الصوتية غير موجودة');
    }

    if (room.users.size >= room.settings.maxUsers) {
      return this.sendError(ws, 'الغرفة الصوتية ممتلئة');
    }

    // التحقق من كلمة المرور إذا كانت الغرفة خاصة
    if (room.settings.isPrivate && room.settings.password !== message.data.password) {
      return this.sendError(ws, 'كلمة مرور الغرفة الصوتية خاطئة');
    }

    // إزالة المستخدم من الغرفة السابقة إن وجدت
    const previousRoomId = this.userRooms.get(userInfo.id);
    if (previousRoomId) {
      await this.removeUserFromRoom(userInfo.id, previousRoomId);
    }

    // إنشاء مستخدم صوتي جديد
    const voiceUser: VoiceUser = {
      id: userInfo.id,
      username: userInfo.username,
      isAdmin: userInfo.isAdmin || false,
      isMuted: false,
      isSpeaking: false,
      isDeafened: false,
      volume: 100,
      quality: 'medium',
      ws,
      lastActivity: new Date(),
      micEnabled: true,
      speakerEnabled: true
    };

    // إضافة المستخدم للغرفة
    room.users.set(userInfo.id, voiceUser);
    this.userRooms.set(userInfo.id, roomId);

    // إرسال تأكيد الانضمام
    this.sendToUser(ws, {
      type: 'voice_room_join',
      roomId,
      userId: userInfo.id,
      data: {
        room: this.serializeVoiceRoom(room),
        settings: room.settings,
        message: `مرحباً بك في ${room.name}`
      },
      timestamp: Date.now()
    });

    // إخطار باقي المستخدمين
    this.broadcastToVoiceRoom(roomId, {
      type: 'voice_user_status',
      roomId,
      userId: userInfo.id,
      data: {
        user: this.serializeVoiceUser(voiceUser),
        action: 'joined',
        message: `انضم ${userInfo.username} للمحادثة الصوتية`
      },
      timestamp: Date.now()
    }, userInfo.id);

    // إرسال الحدث للمستمعين
    this.emit('userJoined', { room, user: voiceUser });

    console.log(`انضم ${userInfo.username} للغرفة الصوتية ${room.name}`);
  }

  private async handleRoomLeave(ws: WebSocket, message: VoiceMessage) {
    const { roomId, userId } = message;
    await this.removeUserFromRoom(userId, roomId);
  }

  private async removeUserFromRoom(userId: string, roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const user = room.users.get(userId);
    if (!user) return;

    // إزالة المستخدم من الغرفة
    room.users.delete(userId);
    this.userRooms.delete(userId);

    // إخطار باقي المستخدمين
    this.broadcastToVoiceRoom(roomId, {
      type: 'voice_user_status',
      roomId,
      userId,
      data: {
        action: 'left',
        message: `غادر ${user.username} المحادثة الصوتية`
      },
      timestamp: Date.now()
    });

    // حذف الغرفة المؤقتة إذا كانت فارغة
    if (room.isTemporary && room.users.size === 0) {
      this.rooms.delete(roomId);
    }

    // إرسال الحدث للمستمعين
    this.emit('userLeft', { room, user });

    console.log(`غادر ${user.username} الغرفة الصوتية ${room.name}`);
  }

  private handleStartSpeaking(message: VoiceMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    const user = room.users.get(message.userId);
    if (!user || user.isMuted) return;

    user.isSpeaking = true;
    user.lastActivity = new Date();

    // إخطار باقي المستخدمين
    this.broadcastToVoiceRoom(message.roomId, {
      type: 'voice_start_speaking',
      roomId: message.roomId,
      userId: message.userId,
      data: {
        username: user.username,
        quality: user.quality
      },
      timestamp: Date.now()
    }, message.userId);

    // إرسال الحدث للمستمعين
    this.emit('userSpeaking', { room, user, speaking: true });
  }

  private handleStopSpeaking(message: VoiceMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    const user = room.users.get(message.userId);
    if (!user) return;

    user.isSpeaking = false;

    // إخطار باقي المستخدمين
    this.broadcastToVoiceRoom(message.roomId, {
      type: 'voice_stop_speaking',
      roomId: message.roomId,
      userId: message.userId,
      data: {
        username: user.username
      },
      timestamp: Date.now()
    }, message.userId);

    // إرسال الحدث للمستمعين
    this.emit('userSpeaking', { room, user, speaking: false });
  }

  private handleAudioData(message: VoiceMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    const sender = room.users.get(message.userId);
    if (!sender || sender.isMuted) return;

    // بث البيانات الصوتية لباقي المستخدمين
    room.users.forEach((user, userId) => {
      if (userId !== message.userId && !user.isDeafened && user.speakerEnabled) {
        if (user.ws.readyState === WebSocket.OPEN) {
          // تطبيق مستوى الصوت
          const audioData = this.applyVolumeControl(message.data.audioData, user.volume);
          
          this.sendToUser(user.ws, {
            type: 'voice_audio_data',
            roomId: message.roomId,
            userId: message.userId,
            data: {
              audioData,
              senderId: message.userId,
              senderName: sender.username,
              quality: sender.quality
            },
            timestamp: Date.now()
          });
        }
      }
    });
  }

  private handleMute(message: VoiceMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    const user = room.users.get(message.userId);
    if (!user) return;

    user.isMuted = true;
    user.isSpeaking = false;

    this.broadcastToVoiceRoom(message.roomId, {
      type: 'voice_mute',
      roomId: message.roomId,
      userId: message.userId,
      data: {
        username: user.username,
        isMuted: true
      },
      timestamp: Date.now()
    });
  }

  private handleUnmute(message: VoiceMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    const user = room.users.get(message.userId);
    if (!user) return;

    user.isMuted = false;

    this.broadcastToVoiceRoom(message.roomId, {
      type: 'voice_unmute',
      roomId: message.roomId,
      userId: message.userId,
      data: {
        username: user.username,
        isMuted: false
      },
      timestamp: Date.now()
    });
  }

  private async handleRoomCreate(ws: WebSocket, message: VoiceMessage) {
    const { roomData, userInfo } = message.data;
    
    const roomId = this.generateRoomId();
    const room = this.createRoom({
      id: roomId,
      name: roomData.name || `غرفة ${userInfo.username}`,
      description: roomData.description,
      ownerId: userInfo.id,
      isPrivate: roomData.isPrivate || false,
      password: roomData.password,
      maxUsers: roomData.maxUsers || 10,
      isTemporary: true
    });

    // إضافة المنشئ للغرفة تلقائياً
    await this.handleRoomJoin(ws, {
      type: 'voice_room_join',
      roomId,
      userId: userInfo.id,
      data: { userInfo },
      timestamp: Date.now()
    });

    this.sendToUser(ws, {
      type: 'voice_room_create',
      roomId,
      userId: userInfo.id,
      data: {
        room: this.serializeVoiceRoom(room),
        message: 'تم إنشاء الغرفة الصوتية بنجاح'
      },
      timestamp: Date.now()
    });

    console.log(`تم إنشاء غرفة صوتية جديدة: ${room.name} بواسطة ${userInfo.username}`);
  }

  private handleQualityChange(message: VoiceMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    const user = room.users.get(message.userId);
    if (!user) return;

    user.quality = message.data.quality;
    user.volume = message.data.volume || user.volume;

    // إخطار المستخدم بالتغيير
    this.sendToUser(user.ws, {
      type: 'voice_quality_change',
      roomId: message.roomId,
      userId: message.userId,
      data: {
        quality: user.quality,
        volume: user.volume,
        message: 'تم تحديث إعدادات الصوت'
      },
      timestamp: Date.now()
    });
  }

  private handleEchoTest(ws: WebSocket, message: VoiceMessage) {
    // إرجاع البيانات الصوتية للاختبار
    const testData = message.data.audioData;
    
    setTimeout(() => {
      this.sendToUser(ws, {
        type: 'voice_echo_test',
        roomId: message.roomId,
        userId: message.userId,
        data: {
          audioData: testData,
          delay: 500,
          message: 'اختبار الصدى مكتمل'
        },
        timestamp: Date.now()
      });
    }, 500); // تأخير 500ms لمحاكاة الصدى
  }

  private handleNoiseReduction(message: VoiceMessage) {
    const room = this.rooms.get(message.roomId);
    if (!room) return;

    const user = room.users.get(message.userId);
    if (!user || !user.isAdmin) return;

    // تحديث إعدادات تقليل الضوضاء للغرفة
    room.settings.noiseReduction = message.data.enabled;

    this.broadcastToVoiceRoom(message.roomId, {
      type: 'voice_room_settings',
      roomId: message.roomId,
      userId: message.userId,
      data: {
        settings: room.settings,
        message: `تم ${message.data.enabled ? 'تفعيل' : 'إلغاء'} تقليل الضوضاء`
      },
      timestamp: Date.now()
    });
  }

  private handleUserDisconnect(user: VoiceUser) {
    const roomId = this.userRooms.get(user.id);
    if (roomId) {
      this.removeUserFromRoom(user.id, roomId);
    }
  }

  private createRoom(config: {
    id: string;
    name: string;
    description?: string;
    ownerId: string;
    isPrivate: boolean;
    password?: string;
    maxUsers: number;
    isTemporary: boolean;
  }): VoiceRoom {
    const room: VoiceRoom = {
      id: config.id,
      name: config.name,
      description: config.description,
      users: new Map(),
      settings: {
        maxUsers: config.maxUsers,
        isPrivate: config.isPrivate,
        password: config.password,
        autoMute: false,
        noiseReduction: true,
        echoCancellation: true,
        bitrate: 64000, // 64 kbps
        sampleRate: 44100 // 44.1 kHz
      },
      createdAt: new Date(),
      ownerId: config.ownerId,
      isTemporary: config.isTemporary
    };

    this.rooms.set(config.id, room);
    return room;
  }

  private applyVolumeControl(audioData: any, volume: number): any {
    // تطبيق مستوى الصوت (من 0 إلى 100)
    const volumeMultiplier = volume / 100;
    // هنا يمكن تطبيق معالجة الصوت الفعلية
    return {
      ...audioData,
      volume: volumeMultiplier
    };
  }

  private broadcastToVoiceRoom(roomId: string, message: VoiceMessage, excludeUserId?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.users.forEach((user, userId) => {
      if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
        this.sendToUser(user.ws, message);
      }
    });
  }

  private sendToUser(ws: WebSocket, message: VoiceMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string) {
    this.sendToUser(ws, {
      type: 'voice_room_join',
      roomId: '',
      userId: '',
      data: { error },
      timestamp: Date.now()
    });
  }

  private generateRoomId(): string {
    return 'voice_' + Math.random().toString(36).substr(2, 9);
  }

  private serializeVoiceRoom(room: VoiceRoom) {
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      users: Array.from(room.users.values()).map(u => this.serializeVoiceUser(u)),
      settings: room.settings,
      ownerId: room.ownerId,
      isTemporary: room.isTemporary,
      userCount: room.users.size
    };
  }

  private serializeVoiceUser(user: VoiceUser) {
    return {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      isMuted: user.isMuted,
      isSpeaking: user.isSpeaking,
      isDeafened: user.isDeafened,
      volume: user.volume,
      quality: user.quality,
      micEnabled: user.micEnabled,
      speakerEnabled: user.speakerEnabled,
      lastActivity: user.lastActivity
    };
  }

  // طرق عامة للوصول للمعلومات
  public getVoiceRooms() {
    return Array.from(this.rooms.values()).map(room => this.serializeVoiceRoom(room));
  }

  public getVoiceRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    return room ? this.serializeVoiceRoom(room) : null;
  }

  public getUserVoiceRoom(userId: string) {
    const roomId = this.userRooms.get(userId);
    return roomId ? this.getVoiceRoom(roomId) : null;
  }

  public getRoomStats() {
    return {
      totalRooms: this.rooms.size,
      totalUsers: Array.from(this.rooms.values()).reduce((sum, room) => sum + room.users.size, 0),
      activeRooms: Array.from(this.rooms.values()).filter(room => room.users.size > 0).length
    };
  }
}