export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface Model {
  id: string;
  name: string;
}
