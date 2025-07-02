import { 
  users, 
  gameScores, 
  friendships,
  gifts,
  privateMessages,
  userItems,
  transactions,
  userShields,
  type User, 
  type InsertUser,
  type Friendship,
  type Gift,
  type PrivateMessage,
  type UserItem,
  type Transaction,
  type UserShield
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, desc, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;
  deleteUser(id: number): Promise<boolean>;
  getAllUsers(): Promise<User[]>;
  authenticateUser(username: string, password: string): Promise<User | null>;
  saveGameScore(userId: number, gameName: string, score: number, level: number): Promise<void>;
  updatePlayerId(userId: number, newPlayerId: string): Promise<User | undefined>;
  updateCurrency(userId: number, goldDelta: number, pearlsDelta: number): Promise<User | undefined>;
  
  // Friends system
  sendFriendRequest(userId: number, friendId: number): Promise<Friendship>;
  acceptFriendRequest(friendshipId: number): Promise<boolean>;
  getFriends(userId: number): Promise<User[]>;
  getFriendRequests(userId: number): Promise<User[]>;
  
  // Gift system
  sendGift(fromUserId: number, toUserId: number, giftType: string, amount: number, message?: string): Promise<Gift>;
  claimGift(giftId: number): Promise<boolean>;
  getUserGifts(userId: number): Promise<Gift[]>;
  
  // Messages
  sendMessage(fromUserId: number, toUserId: number, message: string): Promise<PrivateMessage>;
  getMessages(userId1: number, userId2: number): Promise<PrivateMessage[]>;
  markMessageAsRead(messageId: number): Promise<boolean>;
  
  // Items and shields
  getUserItems(userId: number): Promise<UserItem[]>;
  addUserItem(userId: number, itemType: string, itemName: string, expiresAt?: Date): Promise<UserItem>;
  activateItem(userId: number, itemId: number): Promise<boolean>;
  
  // Transactions
  addTransaction(userId: number, type: string, goldAmount: number, pearlsAmount: number, description: string): Promise<Transaction>;
  getUserTransactions(userId: number): Promise<Transaction[]>;
  
  // Level system
  updateLevel(userId: number, levelIncrease: number): Promise<User | undefined>;
  
  // Shield system
  activateShield(userId: number, shieldType: 'gold' | 'usd'): Promise<UserShield>;
  getUserActiveShield(userId: number): Promise<UserShield | undefined>;
  deactivateShield(userId: number): Promise<boolean>;
  isUserProtected(userId: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  // Generate unique 6-digit player ID
  private generatePlayerId(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async isPlayerIdUnique(playerId: string): Promise<boolean> {
    const [existing] = await db.select().from(users).where(eq(users.playerId, playerId));
    return !existing;
  }

  private async generateUniquePlayerId(): Promise<string> {
    let playerId;
    let isUnique;
    do {
      playerId = this.generatePlayerId();
      isUnique = await this.isPlayerIdUnique(playerId);
    } while (!isUnique);
    return playerId;
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    // التحقق من عدم وجود المستخدم مسبقاً بنفس البريد الإلكتروني أو اسم المستخدم
    if (insertUser.email) {
      const existingEmailUser = await this.getUserByEmail(insertUser.email);
      if (existingEmailUser) {
        throw new Error('البريد الإلكتروني مستخدم مسبقاً');
      }
    }
    
    const existingUsernameUser = await this.getUserByUsername(insertUser.username);
    if (existingUsernameUser) {
      throw new Error('اسم المستخدم مستخدم مسبقاً');
    }

    const playerId = await this.generateUniquePlayerId();
    const [user] = await db
      .insert(users)
      .values({
        playerId,
        username: insertUser.username,
        password: insertUser.password,
        email: insertUser.email || null,
        avatar: null,
        isAdmin: false,
        coins: 0,
        goldCoins: 10000, // هدية ترحيبية: 10000 ذهب
        pearls: 1, // هدية ترحيبية: 1 لؤلؤة (= 1 دولار)
        level: 1,
        experience: 0,
        status: "offline"
      })
      .returning();

    // إضافة معاملة الهدية الترحيبية
    await this.addTransaction(
      user.id,
      'welcome_bonus',
      10000,
      1,
      'هدية ترحيبية - مرحباً بك في INFINITY BOX!'
    );

    return user;
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async updateProfileImage(userId: number, profileImage: string): Promise<User | undefined> {
    try {
      const [user] = await db
        .update(users)
        .set({ profileImage, lastActive: new Date() })
        .where(eq(users.id, userId))
        .returning();
      return user || undefined;
    } catch (error) {
      console.error("Error updating profile image:", error);
      return undefined;
    }
  }

  async updateGender(userId: number, gender: string): Promise<User | undefined> {
    try {
      const [user] = await db
        .update(users)
        .set({ gender, lastActive: new Date() })
        .where(eq(users.id, userId))
        .returning();
      return user || undefined;
    } catch (error) {
      console.error("Error updating gender:", error);
      return undefined;
    }
  }

  async deleteUser(id: number): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return (result.rowCount || 0) > 0;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async authenticateUser(username: string, password: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (user && user.password === password) {
      // Update last active time
      await this.updateUser(user.id, { lastActive: new Date(), status: "online" });
      return user;
    }
    return null;
  }

  async saveGameScore(userId: number, gameName: string, score: number, level: number): Promise<void> {
    await db.insert(gameScores).values({
      userId,
      gameName,
      score,
      level
    });
  }

  async updatePlayerId(userId: number, newPlayerId: string): Promise<User | undefined> {
    // Check if the new player ID is unique
    const isUnique = await this.isPlayerIdUnique(newPlayerId);
    if (!isUnique) {
      throw new Error("Player ID already exists");
    }

    const [updatedUser] = await db
      .update(users)
      .set({ playerId: newPlayerId })
      .where(eq(users.id, userId))
      .returning();
    
    return updatedUser;
  }

  async updateCurrency(userId: number, goldDelta: number, pearlsDelta: number): Promise<User | undefined> {
    try {
      const currentUser = await this.getUser(userId);
      if (!currentUser) return undefined;

      const newGold = Math.max(0, (currentUser.goldCoins || 0) + goldDelta);
      const newPearls = Math.max(0, (currentUser.pearls || 0) + pearlsDelta);

      // Calculate level increase based on gold charged
      let levelIncrease = 0;
      if (goldDelta > 0) {
        // +5 levels for every 5000 gold charged
        levelIncrease = Math.floor(goldDelta / 5000) * 5;
      }
      
      const newLevel = Math.max(1, (currentUser.level || 1) + levelIncrease);

      const [user] = await db
        .update(users)
        .set({ 
          goldCoins: newGold,
          pearls: newPearls,
          level: newLevel
        })
        .where(eq(users.id, userId))
        .returning();
      return user;
    } catch (error) {
      console.error("Error updating currency:", error);
      return undefined;
    }
  }

  async updateLevel(userId: number, levelIncrease: number): Promise<User | undefined> {
    try {
      const user = await this.getUser(userId);
      if (!user) return undefined;

      const newLevel = Math.max(1, (user.level || 1) + levelIncrease);

      const [updatedUser] = await db
        .update(users)
        .set({ level: newLevel })
        .where(eq(users.id, userId))
        .returning();

      return updatedUser;
    } catch (error) {
      console.error("Error updating level:", error);
      return undefined;
    }
  }

  // Friends system
  async sendFriendRequest(userId: number, friendId: number): Promise<Friendship> {
    const [friendship] = await db
      .insert(friendships)
      .values({ userId, friendId, status: "pending" })
      .returning();
    return friendship;
  }

  async acceptFriendRequest(friendshipId: number): Promise<boolean> {
    try {
      await db
        .update(friendships)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(friendships.id, friendshipId));
      return true;
    } catch (error) {
      console.error("Error accepting friend request:", error);
      return false;
    }
  }

  async getFriends(userId: number): Promise<User[]> {
    const friends = await db
      .select({
        id: users.id,
        playerId: users.playerId,
        username: users.username,
        avatar: users.avatar,
        level: users.level,
        status: users.status,
        lastActive: users.lastActive,
      })
      .from(friendships)
      .innerJoin(users, or(
        and(eq(friendships.userId, userId), eq(users.id, friendships.friendId)),
        and(eq(friendships.friendId, userId), eq(users.id, friendships.userId))
      ))
      .where(and(
        or(eq(friendships.userId, userId), eq(friendships.friendId, userId)),
        eq(friendships.status, "accepted")
      ));
    return friends;
  }

  async getFriendRequests(userId: number): Promise<User[]> {
    const requests = await db
      .select({
        id: users.id,
        playerId: users.playerId,
        username: users.username,
        avatar: users.avatar,
        level: users.level,
        status: users.status,
        lastActive: users.lastActive,
      })
      .from(friendships)
      .innerJoin(users, eq(users.id, friendships.userId))
      .where(and(
        eq(friendships.friendId, userId),
        eq(friendships.status, "pending")
      ));
    return requests;
  }

  // Gift system
  async sendGift(fromUserId: number, toUserId: number, giftType: string, amount: number, message?: string): Promise<Gift> {
    // فحص ما إذا كان المستقبل محمي بالدرع الواقي للهدايا السلبية
    const isProtected = await this.isUserProtected(toUserId);
    
    // إذا كانت الهدية سلبية (تخصم من الرصيد) والمستخدم محمي، نرفض الهدية
    if (amount < 0 && isProtected) {
      throw new Error('المستخدم محمي بالدرع الواقي ولا يمكن إرسال هدايا سلبية إليه');
    }

    const [gift] = await db
      .insert(gifts)
      .values({ fromUserId, toUserId, giftType, amount, message })
      .returning();
    return gift;
  }

  async claimGift(giftId: number): Promise<boolean> {
    try {
      const [gift] = await db
        .select()
        .from(gifts)
        .where(and(eq(gifts.id, giftId), eq(gifts.status, "pending")));
      
      if (!gift) return false;

      // Check if gift is harmful and user has shield protection
      const isHarmfulGift = gift.amount < 0 || gift.giftType.includes('bomb') || gift.giftType.includes('trap');
      if (isHarmfulGift) {
        const isProtected = await this.isUserProtected(gift.toUserId);
        if (isProtected) {
          // User is protected, mark gift as blocked
          await db
            .update(gifts)
            .set({ status: "blocked", claimedAt: new Date() })
            .where(eq(gifts.id, giftId));
          return true; // Gift was "processed" but blocked
        }
      }

      // Update user currency
      if (gift.giftType === "gold") {
        await this.updateCurrency(gift.toUserId, gift.amount, 0);
      } else if (gift.giftType === "pearls") {
        await this.updateCurrency(gift.toUserId, 0, gift.amount);
      }

      // Mark gift as claimed
      await db
        .update(gifts)
        .set({ status: "claimed", claimedAt: new Date() })
        .where(eq(gifts.id, giftId));

      return true;
    } catch (error) {
      console.error("Error claiming gift:", error);
      return false;
    }
  }

  async getUserGifts(userId: number): Promise<Gift[]> {
    return await db
      .select()
      .from(gifts)
      .where(and(eq(gifts.toUserId, userId), eq(gifts.status, "pending")))
      .orderBy(desc(gifts.sentAt));
  }

  // Messages
  async sendMessage(fromUserId: number, toUserId: number, message: string): Promise<PrivateMessage> {
    const [msg] = await db
      .insert(privateMessages)
      .values({ fromUserId, toUserId, message })
      .returning();
    return msg;
  }

  async getMessages(userId1: number, userId2: number): Promise<PrivateMessage[]> {
    return await db
      .select()
      .from(privateMessages)
      .where(or(
        and(eq(privateMessages.fromUserId, userId1), eq(privateMessages.toUserId, userId2)),
        and(eq(privateMessages.fromUserId, userId2), eq(privateMessages.toUserId, userId1))
      ))
      .orderBy(desc(privateMessages.sentAt));
  }

  async markMessageAsRead(messageId: number): Promise<boolean> {
    try {
      await db
        .update(privateMessages)
        .set({ isRead: true })
        .where(eq(privateMessages.id, messageId));
      return true;
    } catch (error) {
      console.error("Error marking message as read:", error);
      return false;
    }
  }

  // Items and shields
  async getUserItems(userId: number): Promise<UserItem[]> {
    return await db
      .select()
      .from(userItems)
      .where(eq(userItems.userId, userId))
      .orderBy(desc(userItems.obtainedAt));
  }

  async addUserItem(userId: number, itemType: string, itemName: string, expiresAt?: Date): Promise<UserItem> {
    const [item] = await db
      .insert(userItems)
      .values({ userId, itemType, itemName, expiresAt })
      .returning();
    return item;
  }

  async activateItem(userId: number, itemId: number): Promise<boolean> {
    try {
      // Deactivate all items of the same type first
      const [item] = await db
        .select()
        .from(userItems)
        .where(eq(userItems.id, itemId));
      
      if (!item) return false;

      await db
        .update(userItems)
        .set({ isActive: false })
        .where(and(eq(userItems.userId, userId), eq(userItems.itemType, item.itemType)));

      // Activate the selected item
      await db
        .update(userItems)
        .set({ isActive: true })
        .where(eq(userItems.id, itemId));

      return true;
    } catch (error) {
      console.error("Error activating item:", error);
      return false;
    }
  }

  // Transactions
  async addTransaction(userId: number, type: string, goldAmount: number, pearlsAmount: number, description: string): Promise<Transaction> {
    const [transaction] = await db
      .insert(transactions)
      .values({ userId, transactionType: type, goldAmount, pearlsAmount, description })
      .returning();
    return transaction;
  }

  async getUserTransactions(userId: number): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt))
      .limit(50);
  }

  // Shield system
  async activateShield(userId: number, shieldType: 'gold' | 'usd'): Promise<UserShield> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error('المستخدم غير موجود');
    }

    // تحديد التكلفة والعملة
    const cost = shieldType === 'gold' ? 2000 : 1;
    const currency = shieldType === 'gold' ? 'gold' : 'usd';

    // التحقق من الرصيد
    if (shieldType === 'gold' && (user.goldCoins || 0) < cost) {
      throw new Error('رصيد الذهب غير كافي');
    }
    if (shieldType === 'usd' && (user.pearls || 0) < 10) { // 1 دولار = 10 لؤلؤ
      throw new Error('رصيد اللؤلؤ غير كافي');
    }

    // إلغاء تفعيل أي درع حالي
    await this.deactivateShield(userId);

    // حساب تاريخ انتهاء الصلاحية (أسبوع من الآن)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // إنشاء الدرع الجديد
    const [shield] = await db
      .insert(userShields)
      .values({
        userId,
        shieldType,
        cost,
        currency,
        expiresAt
      })
      .returning();

    // خصم التكلفة من الرصيد
    if (shieldType === 'gold') {
      await this.updateCurrency(userId, -cost, 0);
      await this.addTransaction(userId, 'shield_activation', -cost, 0, `تفعيل الدرع الواقي (ذهب) لمدة أسبوع`);
    } else {
      await this.updateCurrency(userId, 0, -10);
      await this.addTransaction(userId, 'shield_activation', 0, -10, `تفعيل الدرع الواقي (دولار) لمدة أسبوع`);
    }

    return shield;
  }

  async getUserActiveShield(userId: number): Promise<UserShield | undefined> {
    const [shield] = await db
      .select()
      .from(userShields)
      .where(
        and(
          eq(userShields.userId, userId),
          eq(userShields.isActive, true),
          sql`${userShields.expiresAt} > NOW()`
        )
      )
      .orderBy(desc(userShields.activatedAt))
      .limit(1);

    return shield;
  }

  async deactivateShield(userId: number): Promise<boolean> {
    try {
      await db
        .update(userShields)
        .set({ isActive: false })
        .where(eq(userShields.userId, userId));
      return true;
    } catch (error) {
      console.error("Error deactivating shield:", error);
      return false;
    }
  }

  async isUserProtected(userId: number): Promise<boolean> {
    const shield = await this.getUserActiveShield(userId);
    return !!shield;
  }
}

export const storage = new DatabaseStorage();
