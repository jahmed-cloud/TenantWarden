import type { ReactNode } from 'react'
import { Card, KeyValues, PageHeader } from '@/components/ui'
import { Logo, MAINTAINER, NEW_TAB, REPOSITORY, SponsorLink, WEBSITE, linkText } from '@/components/Brand'

function Out({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} {...NEW_TAB} className="text-primary hover:underline">{children}</a>
}

export function AboutPage() {
  const handle = '@' + MAINTAINER.github.split('/').pop()
  return (
    <>
      <PageHeader title="About" subtitle="The project, who maintains it, and how to support it" />
      <div className="grid gap-4 lg:grid-cols-2 max-w-5xl">
        <Card title="TenantWarden">
          <div className="flex items-start gap-4 mb-4">
            <Logo size={44} animated={false} />
            <p className="text-sm text-on-surface-variant">
              Self-hosted security monitoring for Microsoft 365 and the servers behind it. Version 1.0, MIT licensed.
            </p>
          </div>
          <KeyValues items={[
            ['Website', <Out href={WEBSITE}>{linkText(WEBSITE)}</Out>],
            ['GitHub', <Out href={REPOSITORY}>{REPOSITORY.split('/').slice(-2).join('/')}</Out>],
          ]} />
        </Card>

        <Card title="Maintainer">
          <div className="mb-4">
            <div className="font-display text-lg font-medium text-on-surface">{MAINTAINER.name}</div>
            {MAINTAINER.bio && <p className="text-sm text-on-surface-variant mt-1">{MAINTAINER.bio}</p>}
          </div>
          <KeyValues items={[
            ['Website', <Out href={MAINTAINER.website}>{linkText(MAINTAINER.website)}</Out>],
            ['GitHub', <Out href={MAINTAINER.github}>{handle}</Out>],
            ['Email', <a href={`mailto:${MAINTAINER.email}`} className="text-primary hover:underline">{MAINTAINER.email}</a>],
          ]} />
        </Card>

        <Card title="Support this project" className="lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-sm text-on-surface-variant max-w-2xl">
              TenantWarden is free and open source. If it is useful to you, sponsoring {MAINTAINER.name} on GitHub
              helps fund its development.
            </p>
            <SponsorLink size="md" className="self-start sm:self-auto" />
          </div>
        </Card>
      </div>
    </>
  )
}
