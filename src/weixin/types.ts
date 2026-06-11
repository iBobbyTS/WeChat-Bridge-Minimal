export interface BaseInfo {
  channel_version?: string;
  bot_agent?: string;
}

export const MessageType = {
  USER: 1,
  BOT: 2,
} as const;

export const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export interface TextItem {
  text?: string;
}

export interface VoiceItem {
  text?: string;
}

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  voice_item?: VoiceItem;
  ref_msg?: {
    title?: string;
    message_item?: MessageItem;
  };
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number | string;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  sync_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface QrCodeResponse {
  qrcode?: string;
  qrcode_img_content?: string;
}

export type QrStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "scaned_but_redirect"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect"
  | string;

export interface QrStatusResponse {
  status?: QrStatus;
  redirect_host?: string;
  ilink_bot_id?: string;
  bot_token?: string;
  baseurl?: string;
  ilink_user_id?: string;
}
