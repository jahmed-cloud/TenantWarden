import nodemailer from 'nodemailer'
import type { NotificationChannel, Alert } from '../types/index.js'
import type { ChannelDispatcher } from './dispatchers.js'

export class SmtpDispatcher implements ChannelDispatcher {
  async send(channel: NotificationChannel, alert: Alert): Promise<void> {
    const cfg = channel.config as {
      host: string; port: number; user: string; pass: string; from: string; to: string
    }

    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port,
      auth: { user: cfg.user, pass: cfg.pass },
      secure: cfg.port === 465,
    })

    const severityEmoji = { critical:'🔴', high:'🟠', medium:'🟡', low:'🟢', info:'⚪' }[alert.severity] ?? '⚪'
    const subject = `${severityEmoji} [${alert.severity.toUpperCase()}] ${alert.title}`

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color: #1f2937; margin: 0; padding: 0; background: #f9fafb; }
  .container { max-width: 600px; margin: 24px auto; background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; }
  .header { padding: 20px 24px; background: ${{ critical:'#dc2626', high:'#ea580c', medium:'#d97706', low:'#16a34a', info:'#6b7280' }[alert.severity]}; color: #fff; }
  .header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  .header .badge { display: inline-block; padding: 2px 8px; background: rgba(255,255,255,.2); border-radius: 4px; font-size: 12px; margin-top: 6px; }
  .body { padding: 24px; }
  .body p { margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: #374151; }
  .meta { background: #f9fafb; border-radius: 6px; padding: 12px 16px; margin-top: 16px; }
  .meta-row { display: flex; gap: 8px; font-size: 13px; margin-bottom: 6px; }
  .meta-row:last-child { margin-bottom: 0; }
  .meta-label { font-weight: 600; color: #6b7280; min-width: 100px; }
  .action { margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
  .btn { display: inline-block; padding: 10px 20px; background: #1d4ed8; color: #fff; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>${alert.title}</h1>
    <span class="badge">${alert.source} · ${alert.severity.toUpperCase()}</span>
  </div>
  <div class="body">
    <p>${alert.description}</p>
    ${alert.recommendedAction ? `<p><strong>Recommended action:</strong> ${alert.recommendedAction}</p>` : ''}
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Severity</span><span>${alert.severity}</span></div>
      <div class="meta-row"><span class="meta-label">Source</span><span>${alert.source}</span></div>
      <div class="meta-row"><span class="meta-label">Category</span><span>${alert.category}</span></div>
      <div class="meta-row"><span class="meta-label">Time</span><span>${new Date(alert.createdAt).toUTCString()}</span></div>
      ${alert.affectedUsers?.length ? `<div class="meta-row"><span class="meta-label">Affected users</span><span>${alert.affectedUsers.slice(0,3).join(', ')}${alert.affectedUsers.length > 3 ? ` +${alert.affectedUsers.length - 3} more` : ''}</span></div>` : ''}
    </div>
    <div class="action">
      <a href="${process.env.APP_URL ?? 'http://localhost'}/alerts/${alert.id}" class="btn">View in TenantWarden</a>
    </div>
  </div>
</div>
</body>
</html>`

    await transport.sendMail({ from: cfg.from, to: cfg.to, subject, html })
  }
}
