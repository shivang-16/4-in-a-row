"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kafkaService = exports.GameEventType = void 0;
const kafkajs_1 = require("kafkajs");
var GameEventType;
(function (GameEventType) {
    GameEventType["GAME_STARTED"] = "game:started";
    GameEventType["GAME_ENDED"] = "game:ended";
    GameEventType["MOVE_MADE"] = "move:made";
    GameEventType["PLAYER_JOINED"] = "player:joined";
    GameEventType["PLAYER_DISCONNECTED"] = "player:disconnected";
    GameEventType["CHAT_MESSAGE"] = "chat:message";
})(GameEventType || (exports.GameEventType = GameEventType = {}));
class KafkaService {
    kafka = null;
    producer = null;
    consumer = null;
    isConnected = false;
    isEnabled = false;
    constructor() {
        const kafkaUrl = process.env.KAFKA_URL;
        // If no Kafka URL, service is disabled (graceful degradation)
        if (!kafkaUrl) {
            console.log('⚠️  KAFKA_URL not set - Kafka streaming disabled');
            this.isEnabled = false;
            return;
        }
        this.isEnabled = true;
        // SSL configuration from environment variables only
        const sslConfig = {
            rejectUnauthorized: true,
        };
        // CA Certificate (required for SSL)
        const caCert = process.env.KAFKA_CA_CERTIFICATE;
        if (caCert) {
            // Handle multiline certs stored in env (replace literal \n with actual newlines)
            sslConfig.ca = [caCert.replace(/\\n/g, '\n')];
        }
        // Client Certificate for mutual TLS
        const clientCert = process.env.KAFKA_ACCESS_CERTIFICATE;
        if (clientCert) {
            sslConfig.cert = clientCert.replace(/\\n/g, '\n');
        }
        // Client Key for mutual TLS
        const clientKey = process.env.KAFKA_ACCESS_KEY;
        if (clientKey) {
            sslConfig.key = clientKey.replace(/\\n/g, '\n');
        }
        // Check if we have all required SSL certs
        const hasSSL = sslConfig.ca && sslConfig.cert && sslConfig.key;
        this.kafka = new kafkajs_1.Kafka({
            clientId: process.env.KAFKA_CLIENT_ID || 'emitrr-game-api',
            brokers: [kafkaUrl],
            ssl: hasSSL ? sslConfig : undefined,
            logLevel: kafkajs_1.logLevel.WARN,
            retry: {
                initialRetryTime: 300,
                retries: 5,
            },
        });
        console.log(`📡 Kafka configured for broker: ${kafkaUrl}`);
        console.log(`🔐 SSL: ${hasSSL ? 'Enabled (mTLS)' : 'Disabled'}`);
    }
    async connect() {
        if (!this.isEnabled || !this.kafka) {
            console.log('⏭️  Kafka not enabled, skipping connection');
            return;
        }
        try {
            this.producer = this.kafka.producer();
            await this.producer.connect();
            this.isConnected = true;
            console.log('✅ Kafka producer connected');
        }
        catch (error) {
            console.error('❌ Failed to connect Kafka producer:', error);
            this.isConnected = false;
            // Don't throw - allow app to continue without Kafka
        }
    }
    async disconnect() {
        try {
            if (this.producer) {
                await this.producer.disconnect();
                console.log('🔌 Kafka producer disconnected');
            }
            if (this.consumer) {
                await this.consumer.disconnect();
                console.log('🔌 Kafka consumer disconnected');
            }
            this.isConnected = false;
        }
        catch (error) {
            console.error('❌ Error disconnecting Kafka:', error);
        }
    }
    /**
     * Send a game event to Kafka
     */
    async sendGameEvent(eventType, data) {
        if (!this.isEnabled || !this.producer || !this.isConnected) {
            // Silently skip if Kafka not available
            return;
        }
        const topic = process.env.KAFKA_TOPIC_GAME_EVENTS || 'game-events';
        try {
            await this.producer.send({
                topic,
                messages: [
                    {
                        key: eventType,
                        value: JSON.stringify({
                            eventType,
                            timestamp: new Date().toISOString(),
                            data,
                        }),
                    },
                ],
            });
            console.log(`📤 Kafka event: ${eventType}`);
        }
        catch (error) {
            console.error(`❌ Kafka send failed (${eventType}):`, error);
        }
    }
    /**
     * Send game move event with full board state
     */
    async sendMoveEvent(gameId, player, column, row, board, moveNumber) {
        await this.sendGameEvent(GameEventType.MOVE_MADE, {
            gameId,
            player,
            column,
            row,
            board,
            moveNumber,
            timestamp: Date.now(),
        });
    }
    /**
     * Send game started event
     */
    async sendGameStartEvent(gameId, player1, player2, isBot) {
        await this.sendGameEvent(GameEventType.GAME_STARTED, {
            gameId,
            player1,
            player2,
            isBot,
            timestamp: Date.now(),
        });
    }
    /**
     * Send game ended event
     */
    async sendGameEndEvent(gameId, winner, reason, duration, totalMoves) {
        await this.sendGameEvent(GameEventType.GAME_ENDED, {
            gameId,
            winner,
            reason,
            duration,
            totalMoves,
            timestamp: Date.now(),
        });
    }
    /**
     * Create a consumer for listening to events
     */
    async createConsumer(groupId) {
        if (!this.isEnabled || !this.kafka) {
            return null;
        }
        try {
            this.consumer = this.kafka.consumer({ groupId });
            await this.consumer.connect();
            console.log(`✅ Kafka consumer connected (group: ${groupId})`);
            return this.consumer;
        }
        catch (error) {
            console.error('❌ Failed to create Kafka consumer:', error);
            return null;
        }
    }
    /**
     * Subscribe to game events topic
     */
    async subscribeToGameEvents(callback) {
        if (!this.consumer) {
            console.warn('⚠️  No consumer available for subscription');
            return;
        }
        const topic = process.env.KAFKA_TOPIC_GAME_EVENTS || 'game-events';
        try {
            await this.consumer.subscribe({ topic, fromBeginning: false });
            await this.consumer.run({
                eachMessage: async ({ message }) => {
                    if (message.value) {
                        try {
                            const event = JSON.parse(message.value.toString());
                            callback(event);
                        }
                        catch (e) {
                            console.error('Failed to parse Kafka message:', e);
                        }
                    }
                },
            });
            console.log(`📥 Subscribed to Kafka topic: ${topic}`);
        }
        catch (error) {
            console.error('❌ Failed to subscribe to Kafka topic:', error);
        }
    }
    getProducer() {
        return this.producer;
    }
    getConsumer() {
        return this.consumer;
    }
    isProducerConnected() {
        return this.isConnected;
    }
    isKafkaEnabled() {
        return this.isEnabled;
    }
}
// Export singleton instance
exports.kafkaService = new KafkaService();
