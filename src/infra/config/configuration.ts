export default () => ({
  port: parseInt(process.env.PORT, 10) || 4000,
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    apiBase: process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1',
    whisperModel: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
    chatModel: process.env.GROQ_CHAT_MODEL || 'llama-3.3-70b-versatile',
  },
  rabbitmq: {
    uri: process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672',
  },
  database: {
    url: process.env.DATABASE_URL || '',
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT, 10) || 5432,
    user: process.env.PG_USER || 'clipper',
    password: process.env.PG_PASSWORD || 'clipper',
    database: process.env.PG_DATABASE || 'clipper',
  },
});
