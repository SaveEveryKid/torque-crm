/** One chat message for Claude (through your dialer's /draft). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
