import axios from 'axios'
import * as nodemailer from 'nodemailer'
import { logger } from '../utils/logger.js'
import type { Alert, NotificationChannel } from '../types/index.js'

// ─── Channel dispatcher interface ────────────────────────────────────────────

export interface ChannelDispatcher {
  send(channel: NotificationChannel, alert: Alert): Promise<void>
}

// ─── Microsoft Teams (Adaptive Card) ─────────────────────────────────────────

export class TeamsDispatcher implements ChannelDispatcher {
  async send(channel: NotificationChannel, alert: Alert): Promise<void> {
    const config = channel.config as { webhookUrl: string }
    const color = severityColor(alert.severity)

    const card = {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              size: 'Medium',
              weight: 'Bolder',
              text: `🔔 TenantWarden — ${capitalise(alert.severity)} Alert`,
              color: color === '#dc2626' ? 'Attention' : 'Warning',
            },
            { type: 'TextBlock', text: alert.title, wrap: true, weight: 'Bolder' },
            { type: 'TextBlock', text: alert.description, wrap: true, isSubtle: true },
            {
              type: 'FactSet',
              facts: [
                { title: 'Severity', value: capitalise(alert.severity) },
                { title: 'Source',   value: alert.source },
                { title: 'Tenant',   value: alert.tenantId },
                { title: 'Time',     value: new Date(alert.createdAt).toUTCString() },
              ],
            },
          ],
          actions: alert.recommendedAction ? [
            { type: 'Action.OpenUrl', title: 'View in TenantWarden', url: `${process.env.APP_URL}/alerts/${alert.id}` },
          ] : [],
        },
      }],
    }

    await axios.post(config.webhookUrl, card, { timeout: 10_000 })
    logger.info({ channelId: channel.id, alertId: alert.id }, 'teams notification sent')
  }
}

// ─── Slack ───────────────────────────────────────────────────────────────────

export class SlackDispatcher implements ChannelDispatcher {
  async send(channel: NotificationChannel, alert: Alert): Promise<void> {
    const config = channel.config as { botToken: string; channelId: string }

    const emoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', info: '⚪' }[alert.severity] ?? '⚪'

    const payload = {
      channel: config.channelId,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${emoji} ${capitalise(alert.severity)}: ${alert.title}` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: alert.description },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Source:*\n${alert.source}` },
            { type: 'mrkdwn', text: `*Time:*\n${new Date(alert.createdAt).toUTCString()}` },
          ],
        },
        ...(alert.recommendedAction ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Recommended action:*\n${alert.recommendedAction}` },
        }] : []),
        {
          type: 'actions',
          elements: [{
            type: 'button',
            text: { type: 'plain_text', text: 'View Alert' },
            url: `${process.env.APP_URL}/alerts/${alert.id}`,
            style: 'primary',
          }],
        },
      ],
    }

    await axios.post('https://slack.com/api/chat.postMessage', payload, {
      headers: { Authorization: `Bearer ${config.botToken}` },
      timeout: 10_000,
    })
  }
}

// ─── Generic webhook ──────────────────────────────────────────────────────────

export class WebhookDispatcher implements ChannelDispatcher {
  async send(channel: NotificationChannel, alert: Alert): Promise<void> {
    const config = channel.config as { url: string; secret?: string; method?: string }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.secret) headers['X-TenantWarden-Signature'] = config.secret

    await axios({
      method:  (config.method ?? 'POST') as 'POST' | 'PUT',
      url:     config.url,
      headers,
      data: {
        id:                alert.id,
        title:             alert.title,
        description:       alert.description,
        severity:          alert.severity,
        source:            alert.source,
        tenantId:          alert.tenantId,
        affectedUsers:     alert.affectedUsers,
        recommendedAction: alert.recommendedAction,
        createdAt:         alert.createdAt,
      },
      timeout: 15_000,
    })
  }
}

// ─── PagerDuty ───────────────────────────────────────────────────────────────

export class PagerDutyDispatcher implements ChannelDispatcher {
  async send(channel: NotificationChannel, alert: Alert): Promise<void> {
    const config = channel.config as { routingKey: string }

    const severity = { critical: 'critical', high: 'error', medium: 'warning', low: 'info', info: 'info' }[alert.severity] ?? 'warning'

    await axios.post('https://events.pagerduty.com/v2/enqueue', {
      routing_key:  config.routingKey,
      event_action: 'trigger',
      dedup_key:    alert.id,
      payload: {
        summary:   alert.title,
        severity,
        source:    `TenantWarden / ${alert.source}`,
        timestamp: new Date(alert.createdAt).toISOString(),
        custom_details: {
          description:      alert.description,
          tenantId:         alert.tenantId,
          affectedUsers:    alert.affectedUsers,
          recommendedAction: alert.recommendedAction,
        },
      },
      links: [{
        href: `${process.env.APP_URL}/alerts/${alert.id}`,
        text: 'View in TenantWarden',
      }],
    }, { timeout: 10_000 })
  }
}


// ─── Email (SMTP via .env) ────────────────────────────────────────────────────

export class EmailDispatcher implements ChannelDispatcher {
  async send(channel: NotificationChannel, alert: Alert): Promise<void> {
    const host = process.env.SMTP_HOST
    if (!host) throw new Error('SMTP_HOST not configured in .env')

    const config = channel.config as { recipients: string[] }
    if (!config.recipients?.length) throw new Error('email channel has no recipients')

    const transport = nodemailer.createTransport({
      host,
      port:   parseInt(process.env.SMTP_PORT ?? '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })

    const sevColor: Record<string, string> = {
      critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#2563eb', info: '#6b7280',
    }
    const color = sevColor[alert.severity] ?? '#6b7280'

    await transport.sendMail({
      from:    process.env.SMTP_FROM ?? 'alerts@tenantwarden.local',
      to:      config.recipients.join(', '),
      subject: `[TenantWarden ${alert.severity.toUpperCase()}] ${alert.title}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px">
          <div style="border-left:4px solid ${color};padding:12px 16px;background:#f9fafb">
            <h2 style="margin:0 0 4px;font-size:16px">${alert.title}</h2>
            <p style="margin:0;color:#6b7280;font-size:13px">
              Severity: <strong style="color:${color}">${alert.severity}</strong>
              &nbsp;·&nbsp; Category: ${alert.category ?? 'general'}
            </p>
          </div>
          <p style="font-size:13px;color:#374151;line-height:1.6">${alert.description ?? ''}</p>
          <a href="${process.env.APP_URL ?? 'http://localhost:8090'}/alerts"
             style="font-size:13px;color:#2563eb">View in TenantWarden →</a>
        </div>`,
    })
  }
}


// ─── ServiceNow (creates an incident) ─────────────────────────────────────────

export class ServiceNowDispatcher implements ChannelDispatcher {
  async send(channel: NotificationChannel, alert: Alert): Promise<void> {
    const cfg = channel.config as { instance?: string; user?: string; pass?: string; assignmentGroup?: string }
    const instance = cfg.instance ?? process.env.SERVICENOW_INSTANCE
    const user     = cfg.user     ?? process.env.SERVICENOW_USER
    const pass     = cfg.pass     ?? process.env.SERVICENOW_PASS
    if (!instance || !user || !pass) throw new Error('ServiceNow instance/user/pass not configured')

    // Map TenantWarden severity → ServiceNow impact/urgency (1=High, 2=Medium, 3=Low)
    const sevMap: Record<string, number> = { critical: 1, high: 1, medium: 2, low: 3, info: 3 }
    const impact = sevMap[alert.severity] ?? 3

    const base = instance.startsWith('http') ? instance : `https://${instance}.service-now.com`
    await axios.post(
      `${base}/api/now/table/incident`,
      {
        short_description: `[TenantWarden] ${alert.title}`,
        description: `${alert.description ?? ''}\n\nSeverity: ${alert.severity}\nCategory: ${alert.category ?? 'general'}\nView: ${process.env.APP_URL ?? ''}/alerts/${alert.id}`,
        impact,
        urgency: impact,
        category: 'Security',
        ...(cfg.assignmentGroup ? { assignment_group: cfg.assignmentGroup } : {}),
      },
      { auth: { username: user, password: pass }, timeout: 15_000 },
    )
  }
}

// ─── Jira (creates an issue) ──────────────────────────────────────────────────

export class JiraDispatcher implements ChannelDispatcher {
  async send(channel: NotificationChannel, alert: Alert): Promise<void> {
    const cfg = channel.config as { url?: string; email?: string; token?: string; projectKey?: string; issueType?: string }
    const url   = cfg.url   ?? process.env.JIRA_URL
    const email = cfg.email ?? process.env.JIRA_EMAIL
    const token = cfg.token ?? process.env.JIRA_TOKEN
    const projectKey = cfg.projectKey
    if (!url || !email || !token || !projectKey) throw new Error('Jira url/email/token/projectKey not configured')

    const priMap: Record<string, string> = {
      critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low', info: 'Lowest',
    }

    await axios.post(
      `${url.replace(/\/$/, '')}/rest/api/3/issue`,
      {
        fields: {
          project:   { key: projectKey },
          issuetype: { name: cfg.issueType ?? 'Task' },
          priority:  { name: priMap[alert.severity] ?? 'Medium' },
          summary:   `[TenantWarden] ${alert.title}`,
          description: {
            type: 'doc', version: 1,
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: `${alert.description ?? ''}\n\nSeverity: ${alert.severity}\nView: ${process.env.APP_URL ?? ''}/alerts/${alert.id}` }],
            }],
          },
        },
      },
      {
        auth: { username: email, password: token },
        headers: { 'Content-Type': 'application/json' },
        timeout: 15_000,
      },
    )
  }
}

// ─── Dispatcher registry ──────────────────────────────────────────────────────

const dispatchers: Record<string, ChannelDispatcher> = {
  teams:      new TeamsDispatcher(),
  slack:      new SlackDispatcher(),
  webhook:    new WebhookDispatcher(),
  pagerduty:  new PagerDutyDispatcher(),
  email:      new EmailDispatcher(),
  servicenow: new ServiceNowDispatcher(),
  jira:       new JiraDispatcher(),
}

export function getDispatcher(type: string): ChannelDispatcher | null {
  return dispatchers[type.toLowerCase()] ?? null
}

// ─── Main dispatch function ───────────────────────────────────────────────────

export async function dispatchAlert(channel: NotificationChannel, alert: Alert): Promise<void> {
  const dispatcher = getDispatcher(channel.type)
  if (!dispatcher) {
    logger.warn({ type: channel.type }, 'no dispatcher for channel type')
    return
  }
  try {
    await dispatcher.send(channel, alert)
  } catch (err) {
    logger.error({ err, channelId: channel.id, alertId: alert.id }, 'notification dispatch failed')
    throw err
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function severityColor(severity: string): string {
  return { critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#16a34a', info: '#6b7280' }[severity] ?? '#6b7280'
}
