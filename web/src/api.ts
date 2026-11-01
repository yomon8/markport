export type FileReply = { path: string; type: 'image'; assetUrl: string }
  | { path: string; type: 'html' | 'pdf'; previewUrl: string }
  | { path: string; type: 'html' | 'markdown' | 'code'; html: string };
export type ApiError = { error?: string; message?: string };
export class RequestError extends Error { constructor(readonly code: string, message: string) { super(message); } }
