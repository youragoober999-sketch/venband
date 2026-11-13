// Builds the branded Supabase Auth email templates into supabase/templates/.
//   node scripts/assets/generate-email-templates.mjs
// Then paste each file into Supabase → Authentication → Emails → Templates
// (or run `npx supabase config push` — config.toml points at these files).
//
// Email-client rules followed here: table layout, inline styles only, no
// external CSS/fonts/SVG, a PNG logo with explicit size, bulletproof button.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('supabase/templates');
const LOGO = 'https://www.venband.com/icon-192.png';
const SITE = 'https://www.venband.com';

const C = { bg: '#0a0a0b', card: '#111113', line: '#242428', text: '#f5f5f7', text2: '#b4b4bb', muted: '#77777f', btn: '#f5f5f7', btnText: '#0a0a0b' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function button(href, label) {
  return `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto">
            <tr>
              <td align="center" bgcolor="${C.btn}" style="border-radius:10px">
                <a href="${href}" target="_blank" style="display:inline-block;padding:13px 30px;font-family:${FONT};font-size:15px;font-weight:600;color:${C.btnText};text-decoration:none;border-radius:10px">${label}</a>
              </td>
            </tr>
          </table>`;
}

function code(token) {
  return `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto">
            <tr>
              <td align="center" style="background:#1a1a1d;border:1px solid ${C.line};border-radius:12px;padding:14px 26px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:${C.text}">${token}</td>
            </tr>
          </table>`;
}

function layout({ preheader, title, body, action, fallbackUrl, footnote, fallbackLabel = '' }) {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}">
    <tr>
      <td align="center" style="padding:40px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
          <tr>
            <td align="center" style="padding:0 0 24px">
              <a href="${SITE}" target="_blank" style="text-decoration:none">
                <!-- if the email app blocks images, the alt text renders as a styled "V" tile instead of a broken icon -->
                <img src="${LOGO}" width="56" height="56" alt="V" style="display:block;width:56px;height:56px;border:1px solid ${C.line};border-radius:14px;background:#000;color:${C.text};font-family:${FONT};font-size:28px;font-weight:800;line-height:56px;text-align:center">
              </a>
              <div style="padding-top:10px;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:.5px;color:${C.text}">Venband</div>
            </td>
          </tr>
          <tr>
            <td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:18px;padding:36px 32px;text-align:center">
              <h1 style="margin:0 0 10px;font-family:${FONT};font-size:23px;line-height:1.3;font-weight:700;color:${C.text}">${title}</h1>
              <p style="margin:0 0 28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.text2}">${body}</p>
              ${action}
              ${fallbackUrl ? `
              <p style="margin:28px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted}">${fallbackLabel || 'Button not working? Paste this link into your browser:'}<br>
                <a href="${fallbackUrl}" target="_blank" style="color:${C.text2};word-break:break-all">${fallbackUrl}</a></p>` : ''}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 12px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted}">
              ${footnote}<br>
              <a href="${SITE}" target="_blank" style="color:${C.muted};text-decoration:underline">Venband</a> · end-to-end encrypted chat
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

const TEMPLATES = {
  confirmation: {
    subject: 'Confirm your Venband account',
    html: layout({
      preheader: 'Your Venband sign-up code: {{ .Token }}',
      title: 'Welcome to Venband',
      body: 'Enter this code in Venband to finish setting up your account. It expires in 1 hour.',
      action: code('{{ .Token }}'),
      fallbackUrl: '{{ .ConfirmationURL }}',
      fallbackLabel: 'Or confirm with this link instead:',
      footnote: 'Didn’t sign up? You can safely ignore this email — no account will be created.',
    }),
  },
  recovery: {
    subject: 'Reset your Venband password',
    html: layout({
      preheader: 'Here’s the link to reset your Venband password.',
      title: 'Reset your password',
      body: 'Someone (hopefully you) asked to reset the password for <b style="color:' + C.text + '">{{ .Email }}</b>. Open this link <b style="color:' + C.text + '">in the same browser</b> you asked from.<br><br>Heads up: your messages are end-to-end encrypted with your old password, so a reset gives you new keys and your <b style="color:' + C.text + '">old encrypted message history can’t be recovered</b>. If you remember your password, just sign in instead.',
      action: button('{{ .ConfirmationURL }}', 'Choose a new password'),
      fallbackUrl: '{{ .ConfirmationURL }}',
      footnote: 'Didn’t ask for this? Ignore this email and your password stays the same.',
    }),
  },
  magic_link: {
    subject: 'Your Venband sign-in code',
    html: layout({
      preheader: 'Your Venband sign-in code: {{ .Token }}',
      title: 'Sign in to Venband',
      body: 'Enter this code in Venband to sign in. It expires in 1 hour and can only be used once.',
      action: code('{{ .Token }}'),
      fallbackUrl: '{{ .ConfirmationURL }}',
      fallbackLabel: 'Prefer a link? Open this one instead:',
      footnote: 'Didn’t try to sign in? Ignore this email — nobody can get in without the code.',
    }),
  },
  email_change: {
    subject: 'Confirm your new Venband email',
    html: layout({
      preheader: 'Confirm the new email address for your Venband account.',
      title: 'Confirm your new email',
      body: 'Confirm that you want to change your Venband email from <b style="color:' + C.text + '">{{ .Email }}</b> to <b style="color:' + C.text + '">{{ .NewEmail }}</b>.',
      action: button('{{ .ConfirmationURL }}', 'Confirm new email'),
      fallbackUrl: '{{ .ConfirmationURL }}',
      footnote: 'Didn’t ask for this? Ignore this email and change your password to be safe.',
    }),
  },
  invite: {
    subject: 'You’ve been invited to Venband',
    html: layout({
      preheader: 'You’ve been invited to join Venband.',
      title: 'You’re invited',
      body: 'You’ve been invited to create a Venband account — private, end-to-end encrypted chat with servers, voice and video.',
      action: button('{{ .ConfirmationURL }}', 'Accept invite'),
      fallbackUrl: '{{ .ConfirmationURL }}',
      footnote: 'Not expecting this? You can ignore it.',
    }),
  },
  reauthentication: {
    subject: 'Your Venband verification code',
    html: layout({
      preheader: 'Your Venband verification code: {{ .Token }}',
      title: 'Confirm it’s you',
      body: 'Enter this code in Venband to continue. It expires in a few minutes.',
      action: code('{{ .Token }}'),
      fallbackUrl: '',
      footnote: 'Didn’t request a code? Someone may know your password — change it in Settings → Security.',
    }),
  },
  password_changed_notification: {
    subject: 'Your Venband password was changed',
    html: `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>Your Venband password was changed</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Your Venband password was just changed.&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0b" style="background:#0a0a0b">
    <tr>
      <td align="center" style="padding:40px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
          <tr>
            <td align="center" style="padding:0 0 24px">
              <a href="https://www.venband.com" target="_blank" style="text-decoration:none">
                <img src="https://www.venband.com/icon-192.png" width="56" height="56" alt="V" style="display:block;width:56px;height:56px;border:1px solid #242428;border-radius:14px;background:#000;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:28px;font-weight:800;line-height:56px;text-align:center">
              </a>
              <div style="padding-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:.5px;color:#f5f5f7">Venband</div>
            </td>
          </tr>
          <tr>
            <td bgcolor="#111113" style="background:#111113;border:1px solid #242428;border-radius:18px;padding:36px 32px;text-align:center">
              <h1 style="margin:0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:23px;line-height:1.3;font-weight:700;color:#f5f5f7">Your password was changed</h1>
              <p style="margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#b4b4bb">The password for your Venband account was just changed.</p>
              <p style="margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#b4b4bb">If you made this change, you're all set — nothing else to do.</p>
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#ff6b6b;font-weight:600">If you didn't change your password, reset it immediately from the Venband login screen ("Forgot password") and contact support — your account may be compromised.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#77777f">
              Didn’t make this change? Act now — reset your password and contact support.<br>
              <a href="https://www.venband.com" target="_blank" style="color:#77777f;text-decoration:underline">Venband</a> · end-to-end encrypted chat
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },
  email_changed_notification: {
    subject: 'Your Venband email address was changed',
    html: `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>Your Venband email address was changed</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Your Venband email address was changed.&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0b" style="background:#0a0a0b">
    <tr>
      <td align="center" style="padding:40px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
          <tr>
            <td align="center" style="padding:0 0 24px">
              <a href="https://www.venband.com" target="_blank" style="text-decoration:none">
                <img src="https://www.venband.com/icon-192.png" width="56" height="56" alt="V" style="display:block;width:56px;height:56px;border:1px solid #242428;border-radius:14px;background:#000;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:28px;font-weight:800;line-height:56px;text-align:center">
              </a>
              <div style="padding-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:.5px;color:#f5f5f7">Venband</div>
            </td>
          </tr>
          <tr>
            <td bgcolor="#111113" style="background:#111113;border:1px solid #242428;border-radius:18px;padding:36px 32px;text-align:center">
              <h1 style="margin:0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:23px;line-height:1.3;font-weight:700;color:#f5f5f7">Your email address was changed</h1>
              <p style="margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#b4b4bb">The email address on your Venband account was changed.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px">
                <tr>
                  <td style="padding:12px 16px;background:#1a1a1d;border:1px solid #242428;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#b4b4bb;text-align:left">
                    <div style="color:#77777f;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px">From</div>
                    <div style="color:#f5f5f7;word-break:break-all">{{ .OldEmail }}</div>
                    <div style="color:#77777f;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin:10px 0 4px">To</div>
                    <div style="color:#f5f5f7;word-break:break-all">{{ .Email }}</div>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#ff6b6b;font-weight:600">If you didn't make this change, contact support immediately — your account may be compromised.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#77777f">
              Didn’t make this change? Contact support right away.<br>
              <a href="https://www.venband.com" target="_blank" style="color:#77777f;text-decoration:underline">Venband</a> · end-to-end encrypted chat
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, t] of Object.entries(TEMPLATES)) {
  fs.writeFileSync(path.join(OUT, `${name}.html`), t.html);
}
fs.writeFileSync(path.join(OUT, 'subjects.json'), JSON.stringify(Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, v.subject])), null, 2) + '\n');
console.log(`wrote ${Object.keys(TEMPLATES).length} templates to ${path.relative(process.cwd(), OUT)}`);
