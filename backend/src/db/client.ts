import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const db = postgres(connectionString, {
  max:             10,
  idle_timeout:    20,
  connect_timeout: 10,
});
