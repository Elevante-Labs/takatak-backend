export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },

  otp: {
    expirationMinutes: parseInt(process.env.OTP_EXPIRATION_MINUTES || '5', 10),
    mockCode: process.env.OTP_MOCK_CODE || null,
  },

  wallet: {
    coinToDiamondRatio: parseFloat(process.env.COIN_TO_DIAMOND_RATIO || '1'),
    messageCoinCost: parseInt(process.env.MESSAGE_COIN_COST || '10', 10),
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },

  referral: {
    rewardCoins: parseInt(process.env.REFERRAL_REWARD_COINS || '50', 10),
    firstChatReward: parseInt(process.env.REFERRAL_FIRST_CHAT_REWARD || '25', 10),
  },

  vip: {
    discountPercent: parseInt(process.env.VIP_DISCOUNT_PERCENT || '20', 10),
  },

  fraud: {
    maxMessagesPerMinute: parseInt(process.env.MAX_MESSAGES_PER_MINUTE || '30', 10),
    maxAccountsPerDevice: parseInt(process.env.MAX_ACCOUNTS_PER_DEVICE || '2', 10),
  },
});
