// Optional e-mail notification when a complaint is resolved.
// If EMAIL_USER / EMAIL_PASS are not configured the app works normally and simply skips the e-mail.
const nodemailer = require('nodemailer');

const configured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
const transporter = configured
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } })
  : null;

if (!configured) {
  console.log('[Notification] EMAIL_USER / EMAIL_PASS not configured. Resolution emails will be skipped.');
}

// User-supplied text is escaped before it is placed in the HTML body
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sendResolutionEmail = async (citizenEmail, rawName, rawCategory, rawAddress) => {
  if (!transporter) return;
  const name = escapeHtml(rawName);
  const category = escapeHtml(rawCategory);
  const address = rawAddress ? escapeHtml(rawAddress) : 'the reported location';
  try {
    await transporter.sendMail({
      from: `"CivicHelp" <${process.env.EMAIL_USER}>`,
      to: citizenEmail,
      subject: 'Your CivicHelp report has been resolved',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1c1a;">
          <p style="font-size:18px;font-weight:bold;margin:0 0 16px;">CivicHelp</p>
          <p>Hi ${name},</p>
          <p>Your report about <strong>${category}</strong> at <strong>${address}</strong> has been marked as resolved by the field team.</p>
          <p>Please open CivicHelp, look at the photo of the completed work and confirm the fix, or reopen the report if the problem is still there.</p>
          <p style="color:#666;">Thank you for helping improve your neighbourhood.</p>
        </div>`
    });
    console.log('[Notification] Resolution email sent');
  } catch (err) {
    console.error('[Notification] Email error:', err.message);
  }
};

module.exports = { sendResolutionEmail, escapeHtml };
