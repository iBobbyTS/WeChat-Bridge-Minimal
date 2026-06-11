import { WeixinApiClient, DEFAULT_WEIXIN_BASE_URL } from "./api.js";
import type { Logger } from "../util/logger.js";
import { silentLogger } from "../util/logger.js";
import type { WeixinAccountData, WeixinAccountStore } from "./account_store.js";

export interface LoginOptions {
  accountStore: WeixinAccountStore;
  apiClient?: WeixinApiClient;
  logger?: Logger;
  botType?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  displayQr?: (url: string) => Promise<void> | void;
  readVerifyCode?: (prompt: string) => Promise<string>;
}

export interface LoginResult {
  account: WeixinAccountData;
  alreadyConnected?: boolean;
}

export async function loginWithQr(options: LoginOptions): Promise<LoginResult> {
  const logger = options.logger ?? silentLogger;
  const api = options.apiClient ?? new WeixinApiClient();
  const qr = await api.fetchQrCode(options.botType ?? "3");
  if (!qr.qrcode || !qr.qrcode_img_content) {
    throw new Error("Weixin QR response did not include qrcode data.");
  }
  await options.displayQr?.(qr.qrcode_img_content);
  logger.info("Waiting for Weixin QR confirmation...");

  let pollBaseUrl = DEFAULT_WEIXIN_BASE_URL;
  const deadline = Date.now() + (options.timeoutMs ?? 480_000);
  while (Date.now() < deadline) {
    const status = await api.fetchQrStatus({
      qrcode: qr.qrcode,
      baseUrl: pollBaseUrl,
      timeoutMs: 35_000,
    });
    switch (status.status) {
      case "wait":
      case "scaned":
        break;
      case "scaned_but_redirect":
        if (status.redirect_host) {
          pollBaseUrl = `https://${status.redirect_host}`;
        }
        break;
      case "need_verifycode": {
        const verifyCode = await options.readVerifyCode?.("输入手机微信显示的数字，以继续连接：");
        if (verifyCode) {
          const verified = await api.fetchQrStatus({
            qrcode: qr.qrcode,
            verifyCode,
            baseUrl: pollBaseUrl,
            timeoutMs: 35_000,
          });
          if (verified.status === "confirmed") {
            return saveConfirmed(options.accountStore, verified);
          }
        }
        break;
      }
      case "binded_redirect": {
        const existing = await options.accountStore.load();
        if (!existing) {
          throw new Error("Weixin reports this bridge is already bound, but no local credentials exist.");
        }
        return { account: existing, alreadyConnected: true };
      }
      case "confirmed":
        return saveConfirmed(options.accountStore, status);
      case "expired":
      case "verify_code_blocked":
        throw new Error(`Weixin login stopped with status ${status.status}.`);
      default:
        logger.warn(`Ignoring unknown Weixin QR status: ${String(status.status ?? "")}`);
    }
    await sleep(options.pollIntervalMs ?? 1_000);
  }
  throw new Error("Weixin login timed out.");
}

async function saveConfirmed(
  accountStore: WeixinAccountStore,
  status: {
    ilink_bot_id?: string;
    bot_token?: string;
    baseurl?: string;
    ilink_user_id?: string;
  },
): Promise<LoginResult> {
  if (!status.ilink_bot_id || !status.bot_token || !status.ilink_user_id) {
    throw new Error("Weixin login confirmation missed account id, token, or user id.");
  }
  const account = await accountStore.save({
    accountId: status.ilink_bot_id,
    token: status.bot_token,
    baseUrl: status.baseurl || DEFAULT_WEIXIN_BASE_URL,
    userId: status.ilink_user_id,
  });
  return { account };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
