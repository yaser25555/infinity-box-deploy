import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { storage } from "./storage";
import { insertUserSchema, loginSchema, type User } from "@shared/schema";
import { GameSyncManager } from "./gameSync";
import { VoiceChatManager } from "./voiceChat";

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      
      const user = await storage.authenticateUser(username, password);
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Generate new session token
      const sessionToken = `${Date.now()}-${Math.random().toString(36)}`;
      const token = Buffer.from(`${user.id}:${user.username}:${sessionToken}`).toString('base64');
      
      // Update user with new session token (this will invalidate other sessions)
      await storage.updateUser(user.id, { 
        activeSessionToken: sessionToken,
        status: 'online',
        lastActive: new Date()
      });
      
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          isAdmin: user.isAdmin,
          coins: user.coins,
          level: user.level,
          experience: user.experience,
          status: user.status
        },
        isAdmin: user.isAdmin,
        username: user.username
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(400).json({ 
        message: "Invalid request data",
        error: error.message 
      });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      
      const user = await storage.createUser(userData);
      
      // Simple token (in production, use JWT)
      const token = Buffer.from(`${user.id}:${user.username}`).toString('base64');
      
      res.status(201).json({
        token,
        user: {
          id: user.id,
          playerId: user.playerId,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          isAdmin: user.isAdmin,
          coins: user.coins,
          goldCoins: user.goldCoins,
          pearls: user.pearls,
          level: user.level,
          experience: user.experience,
          status: user.status
        },
        isAdmin: user.isAdmin,
        username: user.username,
        welcomeBonus: true // إشارة للواجهة الأمامية لعرض رسالة الترحيب
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      // معالجة أخطاء التسجيل المتكرر
      if (error.message === 'البريد الإلكتروني مستخدم مسبقاً') {
        return res.status(400).json({ message: "Email already exists" });
      }
      if (error.message === 'اسم المستخدم مستخدم مسبقاً') {
        return res.status(400).json({ message: "Username already exists" });
      }
      res.status(400).json({ 
        message: "Registration failed",
        error: error.message 
      });
    }
  });

  // Logout route
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        const decoded = Buffer.from(token, 'base64').toString();
        const [userId] = decoded.split(':');
        
        // Clear session token and set status to offline
        await storage.updateUser(parseInt(userId), { 
          activeSessionToken: null,
          status: 'offline'
        });
      }
      
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      res.json({ message: "Logged out successfully" });
    }
  });

  // User routes
  app.get("/api/user", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId, username, sessionToken] = decoded.split(':');
      
      const user = await storage.getUser(parseInt(userId));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if session is still valid (not logged in from another device)
      if (user.activeSessionToken !== sessionToken) {
        return res.status(401).json({ 
          message: "Session expired - logged in from another device",
          code: "MULTIPLE_LOGIN"
        });
      }

      res.json({
        id: user.id,
        playerId: user.playerId,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
        coins: user.coins,
        level: user.level,
        experience: user.experience,
        status: user.status
      });
    } catch (error) {
      res.status(401).json({ message: "Invalid token" });
    }
  });

  // Game routes
  app.post("/api/game/score", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      const { gameName, score, level, goldEarned, pearlsEarned } = req.body;
      
      if (!gameName || score === undefined) {
        return res.status(400).json({ message: "Game name and score are required" });
      }

      await storage.saveGameScore(parseInt(userId), gameName, score, level || 1);
      
      // Update currencies if provided
      if (goldEarned || pearlsEarned) {
        await storage.updateCurrency(parseInt(userId), goldEarned || 0, pearlsEarned || 0);
      }
      
      // Get updated user data
      const user = await storage.getUser(parseInt(userId));
      
      res.json({ 
        success: true, 
        message: "Score saved successfully",
        goldCoins: user?.goldCoins || 0,
        pearls: user?.pearls || 0
      });
    } catch (error) {
      console.error("Error saving score:", error);
      res.status(500).json({ message: "Error saving score" });
    }
  });

  // Profile routes
  app.get("/api/profile/friends/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const friends = await storage.getFriends(userId);
      res.json(friends);
    } catch (error) {
      console.error("Error getting friends:", error);
      res.status(500).json({ message: "Error getting friends" });
    }
  });

  app.get("/api/profile/friend-requests/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const requests = await storage.getFriendRequests(userId);
      res.json(requests);
    } catch (error) {
      console.error("Error getting friend requests:", error);
      res.status(500).json({ message: "Error getting friend requests" });
    }
  });

  app.post("/api/profile/friend-request", async (req, res) => {
    try {
      const { friendId } = req.body;
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      const friendship = await storage.sendFriendRequest(parseInt(userId), friendId);
      res.json(friendship);
    } catch (error) {
      console.error("Error sending friend request:", error);
      res.status(500).json({ message: "Error sending friend request" });
    }
  });

  app.post("/api/profile/accept-friend", async (req, res) => {
    try {
      const { friendshipId } = req.body;
      const success = await storage.acceptFriendRequest(friendshipId);
      res.json({ success });
    } catch (error) {
      console.error("Error accepting friend request:", error);
      res.status(500).json({ message: "Error accepting friend request" });
    }
  });

  // Check friendship status
  app.get("/api/friends/check/:friendId", async (req, res) => {
    try {
      const friendId = parseInt(req.params.friendId);
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      // Get user's friends list
      const friends = await storage.getFriends(parseInt(userId));
      const isFriend = friends.some(friend => friend.id === friendId);
      
      res.json({ isFriend });
    } catch (error) {
      console.error("Error checking friendship:", error);
      res.status(500).json({ message: "Error checking friendship" });
    }
  });

  // Send message to friends only
  app.post("/api/messages/send", async (req, res) => {
    try {
      const { toUserId, message } = req.body;
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [fromUserId] = decoded.split(':');
      
      // Check if users are friends
      const friends = await storage.getFriends(parseInt(fromUserId));
      const isFriend = friends.some(friend => friend.id === toUserId);
      
      if (!isFriend) {
        return res.status(403).json({ message: "يمكن إرسال الرسائل للأصدقاء فقط" });
      }
      
      // Send message
      const sentMessage = await storage.sendMessage(parseInt(fromUserId), toUserId, message);
      res.json(sentMessage);
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: "Error sending message" });
    }
  });

  // Get messages between two users (friends only)
  app.get("/api/messages/:friendId", async (req, res) => {
    try {
      const friendId = parseInt(req.params.friendId);
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      // Check if users are friends
      const friends = await storage.getFriends(parseInt(userId));
      const isFriend = friends.some(friend => friend.id === friendId);
      
      if (!isFriend) {
        return res.status(403).json({ message: "يمكن مشاهدة الرسائل مع الأصدقاء فقط" });
      }
      
      // Get messages
      const messages = await storage.getMessages(parseInt(userId), friendId);
      res.json(messages);
    } catch (error) {
      console.error("Error getting messages:", error);
      res.status(500).json({ message: "Error getting messages" });
    }
  });

  app.get("/api/profile/gifts/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const gifts = await storage.getUserGifts(userId);
      res.json(gifts);
    } catch (error) {
      console.error("Error getting gifts:", error);
      res.status(500).json({ message: "Error getting gifts" });
    }
  });

  app.post("/api/profile/send-gift", async (req, res) => {
    try {
      const { toUserId, giftType, amount, message } = req.body;
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [fromUserId] = decoded.split(':');
      
      // Check if user has enough currency
      const user = await storage.getUser(parseInt(fromUserId));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (giftType === 'gold' && (user.goldCoins || 0) < amount) {
        return res.status(400).json({ message: "Insufficient gold" });
      }
      if (giftType === 'pearls' && (user.pearls || 0) < amount) {
        return res.status(400).json({ message: "Insufficient pearls" });
      }

      // Deduct from sender
      const goldDelta = giftType === 'gold' ? -amount : 0;
      const pearlsDelta = giftType === 'pearls' ? -amount : 0;
      await storage.updateCurrency(parseInt(fromUserId), goldDelta, pearlsDelta);

      // Create gift
      const gift = await storage.sendGift(parseInt(fromUserId), toUserId, giftType, amount, message);
      
      // Add transaction record
      await storage.addTransaction(
        parseInt(fromUserId), 
        'gift_sent', 
        goldDelta, 
        pearlsDelta, 
        `إرسال هدية ${amount} ${giftType === 'gold' ? 'ذهب' : 'لؤلؤ'} إلى المستخدم ${toUserId}`
      );

      res.json(gift);
    } catch (error) {
      console.error("Error sending gift:", error);
      res.status(500).json({ message: "Error sending gift" });
    }
  });

  app.post("/api/profile/claim-gift", async (req, res) => {
    try {
      const { giftId } = req.body;
      const success = await storage.claimGift(giftId);
      res.json({ success });
    } catch (error) {
      console.error("Error claiming gift:", error);
      res.status(500).json({ message: "Error claiming gift" });
    }
  });

  app.get("/api/profile/items/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const items = await storage.getUserItems(userId);
      res.json(items);
    } catch (error) {
      console.error("Error getting items:", error);
      res.status(500).json({ message: "Error getting items" });
    }
  });

  app.post("/api/profile/activate-item", async (req, res) => {
    try {
      const { itemId } = req.body;
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      const success = await storage.activateItem(parseInt(userId), itemId);
      res.json({ success });
    } catch (error) {
      console.error("Error activating item:", error);
      res.status(500).json({ message: "Error activating item" });
    }
  });

  app.post("/api/profile/charge-balance", async (req, res) => {
    try {
      const { amount } = req.body;
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      // Simulate payment processing (in real app, integrate with payment gateway)
      await storage.updateCurrency(parseInt(userId), amount, 0);
      
      // Add transaction record
      await storage.addTransaction(
        parseInt(userId), 
        'purchase', 
        amount, 
        0, 
        `شحن رصيد ${amount} ذهب`
      );

      res.json({ success: true });
    } catch (error) {
      console.error("Error charging balance:", error);
      res.status(500).json({ message: "Error charging balance" });
    }
  });

  app.get("/api/profile/transactions/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const transactions = await storage.getUserTransactions(userId);
      res.json(transactions);
    } catch (error) {
      console.error("Error getting transactions:", error);
      res.status(500).json({ message: "Error getting transactions" });
    }
  });

  // Convert pearls to USD with level increase
  app.post("/api/profile/convert-pearls", async (req, res) => {
    try {
      const { pearlsAmount } = req.body;
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      // Check if user has enough pearls
      const user = await storage.getUser(parseInt(userId));
      if (!user || (user.pearls || 0) < pearlsAmount) {
        return res.status(400).json({ message: "Insufficient pearls" });
      }

      // Calculate level increase: +10 levels per pearl converted
      const levelIncrease = pearlsAmount * 10;
      
      // Update currency (subtract pearls)
      await storage.updateCurrency(parseInt(userId), 0, -pearlsAmount);
      
      // Update level
      await storage.updateLevel(parseInt(userId), levelIncrease);
      
      // Add transaction record
      await storage.addTransaction(
        parseInt(userId), 
        'pearl_conversion', 
        0, 
        -pearlsAmount, 
        `تحويل ${pearlsAmount} لؤلؤ - رفع المستوى ${levelIncrease} درجة`
      );

      res.json({ success: true, levelIncrease });
    } catch (error) {
      console.error("Error converting pearls:", error);
      res.status(500).json({ message: "Error converting pearls" });
    }
  });

  // Get user currency
  app.get("/api/user/currency", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      const user = await storage.getUser(parseInt(userId));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ 
        goldCoins: user.goldCoins || 0,
        pearls: user.pearls || 0
      });
    } catch (error) {
      console.error("Error getting currency:", error);
      res.status(500).json({ message: "Error getting currency" });
    }
  });

  // Admin routes
  app.get("/api/admin/users", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      const user = await storage.getUser(parseInt(userId));
      if (!user || !user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const users = await storage.getAllUsers();
      res.json(users.map(u => ({
        id: u.id,
        playerId: u.playerId,
        username: u.username,
        email: u.email,
        avatar: u.avatar,
        isAdmin: u.isAdmin,
        coins: u.coins,
        level: u.level,
        experience: u.experience,
        joinedAt: u.joinedAt,
        lastActive: u.lastActive,
        status: u.status
      })));
    } catch (error) {
      res.status(401).json({ message: "Invalid token" });
    }
  });

  // Update player ID
  app.put("/api/admin/users/:id/player-id", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [, adminUsername] = decoded.split(':');
      const adminUser = await storage.getUserByUsername(adminUsername);
      
      if (!adminUser || !adminUser.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const userId = parseInt(req.params.id);
      const { playerId } = req.body;

      if (!playerId || playerId.length !== 6 || !/^\d{6}$/.test(playerId)) {
        return res.status(400).json({ message: "Player ID must be exactly 6 digits" });
      }

      const updatedUser = await storage.updatePlayerId(userId, playerId);
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "Player ID updated successfully", user: updatedUser });
    } catch (error) {
      if (error.message === "Player ID already exists") {
        return res.status(400).json({ message: "Player ID already exists" });
      }
      console.error("Error updating player ID:", error);
      res.status(500).json({ message: "Error updating player ID" });
    }
  });

  // Shield routes
  app.post("/api/profile/activate-shield", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      const { shieldType } = req.body;
      
      if (!shieldType || !['gold', 'usd'].includes(shieldType)) {
        return res.status(400).json({ message: "Invalid shield type" });
      }

      const shield = await storage.activateShield(parseInt(userId), shieldType);
      res.json({ 
        success: true, 
        shield,
        message: shieldType === 'gold' ? 
          'تم تفعيل الدرع الواقي بـ 2000 ذهب لمدة أسبوع' :
          'تم تفعيل الدرع الواقي بـ 1 دولار لمدة أسبوع'
      });
    } catch (error: any) {
      console.error("Error activating shield:", error);
      res.status(400).json({ message: error.message || "Error activating shield" });
    }
  });

  app.get("/api/profile/shield/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const shield = await storage.getUserActiveShield(userId);
      res.json({ shield, isProtected: !!shield });
    } catch (error) {
      console.error("Error getting shield:", error);
      res.status(500).json({ message: "Error getting shield" });
    }
  });

  app.delete("/api/profile/deactivate-shield", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      const success = await storage.deactivateShield(parseInt(userId));
      res.json({ success });
    } catch (error) {
      console.error("Error deactivating shield:", error);
      res.status(500).json({ message: "Error deactivating shield" });
    }
  });

  // Shield protection system endpoints
  app.post("/api/profile/activate-shield", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [, username] = decoded.split(':');
      
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid token" });
      }

      const { shieldType } = req.body;
      
      if (shieldType !== 'gold' && shieldType !== 'usd') {
        return res.status(400).json({ message: "Invalid shield type" });
      }

      // Check if user already has active shield
      const existingShield = await storage.getUserActiveShield(user.id);
      if (existingShield) {
        return res.status(400).json({ message: "لديك درع نشط بالفعل!" });
      }

      // Check balance and activate shield
      if (shieldType === 'gold') {
        if ((user.goldCoins || 0) < 2000) {
          return res.status(400).json({ message: "رصيد الذهب غير كافي!" });
        }
        // Deduct gold and activate shield
        await storage.updateCurrency(user.id, -2000, 0);
        await storage.addTransaction(user.id, 'shield_purchase', -2000, 0, 'تفعيل درع الذهب (24 ساعة)');
      } else {
        if ((user.pearls || 0) < 10) {
          return res.status(400).json({ message: "رصيد اللؤلؤ غير كافي!" });
        }
        // Deduct pearls and activate shield
        await storage.updateCurrency(user.id, 0, -10);
        await storage.addTransaction(user.id, 'shield_purchase', 0, -10, 'تفعيل درع الدولار (7 أيام)');
      }

      const shield = await storage.activateShield(user.id, shieldType);
      
      res.json({ 
        shield, 
        message: `تم تفعيل ${shieldType === 'gold' ? 'درع الذهب' : 'درع الدولار'} بنجاح!` 
      });
    } catch (error: any) {
      console.error('Error activating shield:', error);
      res.status(500).json({ message: "خطأ في تفعيل الدرع الواقي" });
    }
  });

  app.get("/api/profile/shield/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const shield = await storage.getUserActiveShield(userId);
      res.json({ shield });
    } catch (error: any) {
      console.error('Error fetching shield:', error);
      res.status(500).json({ message: "خطأ في جلب معلومات الدرع" });
    }
  });

  // Profile update endpoints
  app.put("/api/profile/update", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [, username] = decoded.split(':');
      
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid token" });
      }

      const { profileImage, gender } = req.body;
      
      const updates: any = {};
      if (profileImage !== undefined) updates.profileImage = profileImage;
      if (gender !== undefined) updates.gender = gender;

      const updatedUser = await storage.updateUser(user.id, updates);
      
      if (updatedUser) {
        res.json(updatedUser);
      } else {
        res.status(500).json({ message: "Failed to update profile" });
      }
    } catch (error: any) {
      console.error('Error updating profile:', error);
      res.status(500).json({ message: "خطأ في تحديث الملف الشخصي" });
    }
  });

  // Admin endpoint to manage user profile images
  app.delete("/api/admin/users/:id/profile-image", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [, adminUsername] = decoded.split(':');
      
      const admin = await storage.getUserByUsername(adminUsername);
      if (!admin || !admin.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const userId = parseInt(req.params.id);
      const updatedUser = await storage.updateProfileImage(userId, '');
      
      if (updatedUser) {
        res.json({ message: "تم حذف الصورة الشخصية بنجاح", user: updatedUser });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    } catch (error: any) {
      console.error('Error removing profile image:', error);
      res.status(500).json({ message: "خطأ في حذف الصورة الشخصية" });
    }
  });

  app.put("/api/admin/users/:id/profile-image", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [, adminUsername] = decoded.split(':');
      
      const admin = await storage.getUserByUsername(adminUsername);
      if (!admin || !admin.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const userId = parseInt(req.params.id);
      const { profileImage } = req.body;
      
      const updatedUser = await storage.updateProfileImage(userId, profileImage);
      
      if (updatedUser) {
        res.json({ message: "تم تحديث الصورة الشخصية بنجاح", user: updatedUser });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    } catch (error: any) {
      console.error('Error updating profile image:', error);
      res.status(500).json({ message: "خطأ في تحديث الصورة الشخصية" });
    }
  });

  const httpServer = createServer(app);

  // Setup WebSocket server
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/ws'
  });
  
  // إنشاء مديري الألعاب والمحادثة الصوتية
  const gameSyncManager = new GameSyncManager(wss);
  const voiceChatManager = new VoiceChatManager(wss);

  // Game rooms API endpoints
  app.get("/api/game/rooms", async (req, res) => {
    try {
      const rooms = gameSyncManager.getRooms();
      res.json({ rooms });
    } catch (error: any) {
      console.error('Error getting game rooms:', error);
      res.status(500).json({ message: "خطأ في جلب غرف الألعاب" });
    }
  });

  app.get("/api/game/rooms/:roomId", async (req, res) => {
    try {
      const room = gameSyncManager.getRoom(req.params.roomId);
      if (!room) {
        return res.status(404).json({ message: "الغرفة غير موجودة" });
      }
      res.json({ room });
    } catch (error: any) {
      console.error('Error getting game room:', error);
      res.status(500).json({ message: "خطأ في جلب معلومات الغرفة" });
    }
  });

  app.get("/api/game/player/:playerId/room", async (req, res) => {
    try {
      const room = gameSyncManager.getPlayerRoom(req.params.playerId);
      res.json({ room });
    } catch (error: any) {
      console.error('Error getting player room:', error);
      res.status(500).json({ message: "خطأ في جلب غرفة اللاعب" });
    }
  });

  // Voice chat API endpoints
  app.get("/api/voice/rooms", async (req, res) => {
    try {
      const rooms = voiceChatManager.getVoiceRooms();
      res.json({ rooms });
    } catch (error: any) {
      console.error('Error getting voice rooms:', error);
      res.status(500).json({ message: "خطأ في جلب الغرف الصوتية" });
    }
  });

  app.get("/api/voice/rooms/:roomId", async (req, res) => {
    try {
      const room = voiceChatManager.getVoiceRoom(req.params.roomId);
      if (!room) {
        return res.status(404).json({ message: "الغرفة الصوتية غير موجودة" });
      }
      res.json({ room });
    } catch (error: any) {
      console.error('Error getting voice room:', error);
      res.status(500).json({ message: "خطأ في جلب معلومات الغرفة الصوتية" });
    }
  });

  app.get("/api/voice/player/:playerId/room", async (req, res) => {
    try {
      const room = voiceChatManager.getUserVoiceRoom(req.params.playerId);
      res.json({ room });
    } catch (error: any) {
      console.error('Error getting player voice room:', error);
      res.status(500).json({ message: "خطأ في جلب الغرفة الصوتية للاعب" });
    }
  });

  app.get("/api/voice/stats", async (req, res) => {
    try {
      const stats = voiceChatManager.getRoomStats();
      res.json({ stats });
    } catch (error: any) {
      console.error('Error getting voice stats:', error);
      res.status(500).json({ message: "خطأ في جلب إحصائيات المحادثة الصوتية" });
    }
  });
  
  const voiceRooms = new Map<string, Set<any>>();
  const userConnections = new Map<string, { ws: any, username: string, room: string, isAdmin: boolean }>();
  
  wss.on('connection', (ws, req) => {
    console.log('WebSocket client connected');
    
    let currentRoom = 'general';
    let username = 'Anonymous';
    let userId = '';
    let isAdmin = false;
    
    // Enhanced ping/pong for connection stability
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    
    // Add user to default room
    if (!voiceRooms.has(currentRoom)) {
      voiceRooms.set(currentRoom, new Set());
    }
    voiceRooms.get(currentRoom)?.add(ws);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connection_established',
      roomId: currentRoom,
      message: 'أهلاً بك في INFINITY BOX'
    }));
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'user_auth') {
          // Store user info
          username = data.username || 'Anonymous';
          userId = data.userId || '';
          isAdmin = data.isAdmin || false;
          
          userConnections.set(userId, { ws, username, room: currentRoom, isAdmin });
          
          // Broadcast updated user list
          broadcastRoomUsers(currentRoom);
          
          // Send welcome message
          ws.send(JSON.stringify({
            type: 'auth_success',
            message: `مرحباً ${username}! أنت الآن متصل بالمحادثة الصوتية`
          }));
          
        } else if (data.type === 'join_room') {
          // Remove from old room
          voiceRooms.get(currentRoom)?.delete(ws);
          userConnections.delete(userId);
          
          // Add to new room
          currentRoom = data.roomId || 'general';
          if (!voiceRooms.has(currentRoom)) {
            voiceRooms.set(currentRoom, new Set());
          }
          voiceRooms.get(currentRoom)?.add(ws);
          userConnections.set(userId, { ws, username, room: currentRoom, isAdmin });
          
          broadcastRoomUsers(currentRoom);
          
          // Broadcast join message
          broadcastToRoom(currentRoom, {
            type: 'player_joined',
            username: username,
            roomId: currentRoom,
            timestamp: new Date().toISOString()
          });
          
        } else if (data.type === 'chat_message') {
          // Broadcast message to room
          broadcastToRoom(currentRoom, {
            type: 'chat_message',
            sender: username,
            text: data.text,
            roomId: currentRoom,
            timestamp: new Date().toISOString(),
            isAdmin: isAdmin
          });
          
        } else if (data.type === 'voice_status') {
          // Handle voice status updates (muted, speaking, etc.)
          broadcastToRoom(currentRoom, {
            type: 'voice_status_update',
            username: username,
            isMuted: data.isMuted,
            isSpeaking: data.isSpeaking,
            roomId: currentRoom
          });
          
        } else if (data.type === 'get_room_users') {
          broadcastRoomUsers(currentRoom);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    // Helper functions
    function broadcastToRoom(roomId: string, message: any) {
      const roomClients = voiceRooms.get(roomId);
      if (roomClients) {
        const response = JSON.stringify(message);
        roomClients.forEach(client => {
          if (client.readyState === 1) {
            client.send(response);
          }
        });
      }
    }
    
    function broadcastRoomUsers(roomId: string) {
      const roomUsers = Array.from(userConnections.values())
        .filter(conn => conn.room === roomId)
        .map(conn => ({
          username: conn.username,
          isAdmin: conn.isAdmin,
          isSpeaking: false, // Will be updated by client
          isMuted: false
        }));
        
      broadcastToRoom(roomId, {
        type: 'voice_room_users',
        users: roomUsers,
        roomId: roomId,
        totalUsers: roomUsers.length
      });
    }
    
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      voiceRooms.get(currentRoom)?.delete(ws);
      userConnections.delete(userId);
      
      // Broadcast user left
      broadcastToRoom(currentRoom, {
        type: 'player_left',
        username: username,
        roomId: currentRoom,
        timestamp: new Date().toISOString()
      });
      
      // Update room user list
      broadcastRoomUsers(currentRoom);
    });
  });
  
  // Add game item to user inventory
  app.post("/api/add-game-item", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = Buffer.from(token, 'base64').toString();
      const [userId] = decoded.split(':');
      
      const { itemType, itemName, quantity = 1 } = req.body;
      
      // Validate item types
      const validItems = ['gems', 'stars', 'coins', 'bombs', 'bats', 'snakes'];
      if (!validItems.includes(itemType)) {
        return res.status(400).json({ message: "Invalid item type" });
      }

      // Add items to user inventory
      for (let i = 0; i < quantity; i++) {
        await storage.addUserItem(parseInt(userId), itemType, itemName);
      }
      
      res.json({ 
        success: true, 
        message: `Added ${quantity} ${itemName} to inventory`,
        itemType,
        quantity
      });
    } catch (error) {
      console.error("Error adding game item:", error);
      res.status(500).json({ message: "Error adding game item" });
    }
  });

  // Get user items count
  app.get("/api/user-items/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const items = await storage.getUserItems(userId);
      
      // Count items by type
      const itemCounts = {
        gems: items.filter(item => item.itemType === 'gems').length,
        stars: items.filter(item => item.itemType === 'stars').length,
        coins: items.filter(item => item.itemType === 'coins').length,
        bombs: items.filter(item => item.itemType === 'bombs').length,
        bats: items.filter(item => item.itemType === 'bats').length,
        snakes: items.filter(item => item.itemType === 'snakes').length
      };
      
      res.json({ items: itemCounts });
    } catch (error) {
      console.error("Error getting user items:", error);
      res.status(500).json({ message: "Error getting user items" });
    }
  });

  // Stats endpoint
  app.get("/api/stats", async (req, res) => {
    try {
      const onlinePlayers = wss.clients.size;
      const activeRooms = gameSyncManager.getRooms().length + voiceChatManager.getVoiceRooms().length;
      
      res.json({
        onlinePlayers,
        activeRooms
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ message: "خطأ في جلب الإحصائيات" });
    }
  });

  // Ping interval for connection health
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  return httpServer;
}
