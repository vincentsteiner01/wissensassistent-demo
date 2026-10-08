// ============================================================================
// config.js  ·  öffentliche Verbindungsdaten der Demo-Instanz
// ----------------------------------------------------------------------------
// Beides hier ist bewusst öffentlich und landet so auf GitHub Pages. Der
// Publishable Key schützt nichts – er sagt dem Supabase-Gateway nur, zu
// welchem Projekt eine Anfrage gehört. Geschützt wird über den Passcode:
// Sitzung, Rolle und Kostendeckel hängen am Zugang (SPEC 7, Plan Pos. 13).
//
// NIE hierher: Secret Key, Anthropic-Key, IP_HASH_SALT. Die liegen nur als
// Secrets bei den Edge Functions.
//
// Solange beides leer ist, meldet die Seite das beim Anmelden klar. Für einen
// Lauf ohne Projekt: ?mock=1 an die Adresse hängen.
// ============================================================================

/** z. B. "https://abcdefghijklmnopqrst.supabase.co" – ohne Schrägstrich am Ende */
export const SUPABASE_URL = "https://yqzxbrnclledubhtzhmu.supabase.co";

/** "sb_publishable_…" aus Project Settings → API Keys */
export const PUBLISHABLE_KEY = "sb_publishable_SF1b3kmftQQpuWdZQjoUgQ_3zfo8i9p";
