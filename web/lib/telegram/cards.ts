import { InputFile, type Api, type InlineKeyboard } from "grammy";
import type { TelegramDraftDoc } from "../db/types";
import { siteUrl } from "./config";
import { HTML, liveCaption, liveKeyboard } from "./ui";

/**
 * Cards: a photo with the message as its caption. The coin's logo carries the review and the launch; the brand banner
 * carries the welcome. A photo Telegram cannot show (an SVG logo, an unreachable URL) or a caption over its 1024
 * characters falls back to a plain message, so a card never blocks the flow.
 */

const CAPTION_MAX = 1024;

export interface CardImage {
  /** a Telegram file id from an earlier send: no upload, instant */
  fileId?: string | null;
  /** an https image; the server fetches it and uploads it (redirects followed, no reliance on Telegram's fetcher) */
  url?: string | null;
}

export async function sendCard(api: Api, chatId: number, image: CardImage, caption: string, replyMarkup?: InlineKeyboard): Promise<{ messageId: number; fileId: string | null }> {
  const usable = image.fileId || (image.url && /^https?:\/\//.test(image.url) && !/\.svg(\?|$)/i.test(image.url));
  if (usable && caption.length <= CAPTION_MAX) {
    try {
      const photo = image.fileId ?? new InputFile(new URL(image.url!));
      const m = await api.sendPhoto(chatId, photo, { caption, parse_mode: "HTML", reply_markup: replyMarkup });
      return { messageId: m.message_id, fileId: m.photo?.at(-1)?.file_id ?? null };
    } catch (e) {
      console.warn("[telegram] card photo failed, sending text", String((e as Error)?.message ?? e).slice(0, 160));
    }
  }
  const m = await api.sendMessage(chatId, caption, { ...HTML, reply_markup: replyMarkup });
  return { messageId: m.message_id, fileId: null };
}

/** The coin's logo as a card image: its Telegram file id once it has one, else its hosted URL. */
export const logoImage = (d: Pick<TelegramDraftDoc, "logo" | "logoFileId">): CardImage => ({ fileId: d.logoFileId ?? null, url: d.logo });

let bannerFileId: string | null = null;

/** The brand banner (web/public/brand/telegram-banner.jpg), uploaded once per instance and reused by file id after that. */
export async function sendBannerCard(api: Api, chatId: number, caption: string, replyMarkup?: InlineKeyboard): Promise<void> {
  const r = await sendCard(api, chatId, { fileId: bannerFileId, url: `${siteUrl()}/brand/telegram-banner.jpg` }, caption, replyMarkup);
  if (r.fileId) bannerFileId = r.fileId;
}

/** The moment a coin goes live: its logo, what it pays, and where to trade and share it. */
export async function sendLiveCard(api: Api, d: TelegramDraftDoc): Promise<void> {
  await sendCard(api, d.chatId, logoImage(d), liveCaption(d), liveKeyboard(d));
}
