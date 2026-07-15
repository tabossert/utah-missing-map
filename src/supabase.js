// Lazy Supabase client. Returns null when unconfigured or the UMD lib is absent,
// so every caller must handle "no backend" gracefully.
import { CONFIG } from './config.js';

let client = null;

export function isConfigured() {
  return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
}

export function getSupabase() {
  if (!isConfigured()) return null;
  if (!globalThis.supabase || !globalThis.supabase.createClient) return null;
  if (!client) {
    client = globalThis.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  }
  return client;
}
