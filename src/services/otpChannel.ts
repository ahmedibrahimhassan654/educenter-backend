import { sendPasswordResetOtpEmail } from "./emailService";
import { OTP_TTL_MINUTES } from "./otpService";

export interface OtpRecipient {
  name: string;
  email: string;
  phone?: string;
}

/**
 * Delivery channel for one-time codes. Implementations are interchangeable so
 * the routes never need to know how a code is delivered.
 */
export interface OtpChannel {
  readonly name: string;
  sendOtp(recipient: OtpRecipient, code: string): Promise<boolean>;
}

const emailChannel: OtpChannel = {
  name: "email",
  async sendOtp(recipient, code) {
    return sendPasswordResetOtpEmail(
      recipient.name,
      recipient.email,
      code,
      OTP_TTL_MINUTES
    );
  },
};

/**
 * WhatsApp Cloud API delivery.
 *
 * Not implemented yet: OTP delivery uses "authentication" category templates,
 * which Meta always bills (Egypt is on the higher authentication-international
 * rate card). There is no free production tier.
 *
 * To enable later:
 *   1. Create a Meta app + WhatsApp Business account
 *   2. Get a permanent access token and phone number id
 *   3. Create and get approval for an authentication template
 *   4. Set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_OTP_TEMPLATE
 *   5. Set OTP_CHANNEL=whatsapp
 *
 * Implementation sketch:
 *   POST https://graph.facebook.com/v23.0/{PHONE_NUMBER_ID}/messages
 *   { messaging_product: "whatsapp", to, type: "template",
 *     template: { name, language: { code: "ar" },
 *       components: [
 *         { type: "body", parameters: [{ type: "text", text: code }] },
 *         { type: "button", sub_type: "url", index: "0",
 *           parameters: [{ type: "text", text: code }] }
 *       ] } }
 */
const whatsappChannel: OtpChannel = {
  name: "whatsapp",
  async sendOtp() {
    throw new Error(
      "WhatsApp OTP channel is not configured. Set OTP_CHANNEL=email or implement whatsappChannel."
    );
  },
};

const channels: Record<string, OtpChannel> = {
  email: emailChannel,
  whatsapp: whatsappChannel,
};

/**
 * Resolve the configured delivery channel, falling back to email.
 */
export function getOtpChannel(): OtpChannel {
  const configured = (process.env.OTP_CHANNEL || "email").toLowerCase();
  const channel = channels[configured];

  if (!channel) {
    console.warn(
      `Unknown OTP_CHANNEL "${configured}", falling back to email delivery`
    );
    return emailChannel;
  }

  return channel;
}
