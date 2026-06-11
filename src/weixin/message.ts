import crypto from "node:crypto";
import {
  MessageItemType,
  MessageState,
  MessageType,
  type MessageItem,
  type SendMessageReq,
  type WeixinMessage,
} from "./types.js";

export interface InboundTextMessage {
  senderId: string;
  text: string;
  contextToken?: string;
  createdAtMs?: number;
}

export function extractTextFromItems(items: MessageItem[] | undefined): string {
  if (!items?.length) {
    return "";
  }
  for (const item of items) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      if (!item.ref_msg) {
        return text;
      }
      const quoted = [
        item.ref_msg.title,
        item.ref_msg.message_item ? extractTextFromItems([item.ref_msg.message_item]) : "",
      ].filter(Boolean).join(" | ");
      return quoted ? `[引用: ${quoted}]\n${text}` : text;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

export function normalizeInboundMessage(msg: WeixinMessage): InboundTextMessage | null {
  if (msg.message_type !== undefined && msg.message_type !== MessageType.USER) {
    return null;
  }
  if (msg.group_id) {
    return null;
  }
  const senderId = msg.from_user_id?.trim();
  if (!senderId) {
    return null;
  }
  const text = extractTextFromItems(msg.item_list).trim();
  if (!text) {
    return null;
  }
  return {
    senderId,
    text,
    contextToken: msg.context_token,
    createdAtMs: msg.create_time_ms,
  };
}

export function buildTextMessage(params: {
  toUserId: string;
  text: string;
  contextToken?: string | null;
  clientId?: string;
}): SendMessageReq {
  return {
    msg: {
      from_user_id: "",
      to_user_id: params.toUserId,
      client_id: params.clientId ?? `wechat-bridge-${crypto.randomUUID()}`,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: params.contextToken ?? undefined,
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: params.text },
        },
      ],
    },
  };
}
