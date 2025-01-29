import { BN } from "@coral-xyz/anchor";

// Helper function to format `bn` values into the string USD representation
export function BNToUSDRepresentation(
  value: BN,
  exponent: number = 8,
  displayDecimals: number = 2,
): string {
  const quotient = value.divn(Math.pow(10, exponent - displayDecimals));
  const usd = Number(quotient) / Math.pow(10, displayDecimals);

  return usd.toLocaleString("en-US", {
    maximumFractionDigits: displayDecimals,
    minimumFractionDigits: displayDecimals,
    useGrouping: false,
  });
}

// Helper function to send a message to a Telegram channel
export async function sendTelegramMessage(message: string) {
  const telegramBotToken = process.env.TG_API_KEY;
  const chatId = process.env.TG_EMERGENCY_CHANNEL_ID;
  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage?chat_id=${chatId}&text=${message}`;
  await fetch(url);
}
