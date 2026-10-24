import { config } from '../config/env.js';

/*
 * Delivery boundary for one-time codes. Development prints codes to the server console.
 * For production add providers here (e.g. SES/SendGrid/Postmark for email; Twilio/MSG91/Vonage for SMS)
 * and add their names to OTP_DELIVERY in config/env.js. At scale, push sends onto a queue.
 */
export async function deliverCode(msg) {
  switch (config.OTP_DELIVERY) {
    case 'console':
      console.log(`[dev-otp] ${msg.channel} code for ${msg.to}: ${msg.code}`);
      return;
  }
}
