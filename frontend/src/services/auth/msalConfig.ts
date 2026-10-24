import { PublicClientApplication, Configuration, LogLevel } from '@azure/msal-browser'

const msalConfig: Configuration = {
  auth: {
    clientId:              import.meta.env.VITE_AZURE_CLIENT_ID     ?? '00000000-0000-0000-0000-000000000000',
    authority:             `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID ?? 'common'}`,
    redirectUri:           window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation:         'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return
        if (import.meta.env.DEV) {
          switch (level) {
            case LogLevel.Error:   console.error(message); break
            case LogLevel.Warning: console.warn(message);  break
            case LogLevel.Info:    console.info(message);  break
          }
        }
      },
    },
  },
}

// MSAL requires a secure context (https or localhost). On plain-http IPs the
// constructor throws crypto_nonexistent — so guard it and run without SSO.
export const msalInstance: PublicClientApplication | null = (() => {
  try {
    return new PublicClientApplication(msalConfig)
  } catch (err) {
    console.warn('[TenantWarden] Microsoft SSO unavailable in this context (use https or localhost). Local login still works.', err)
    return null
  }
})()

// Initialize MSAL — called once from main.tsx before rendering
export async function initializeMsal(): Promise<void> {
  if (!msalInstance) return
  await msalInstance.initialize()
  const result = await msalInstance.handleRedirectPromise()
  if (result) {
    msalInstance.setActiveAccount(result.account)
  } else {
    const accounts = msalInstance.getAllAccounts()
    if (accounts.length > 0) {
      msalInstance.setActiveAccount(accounts[0])
    }
  }
}

export const graphScopes = ['User.Read', 'openid', 'profile', 'email']

export const tenantWardenApiScopes = [
  `api://${import.meta.env.VITE_AZURE_CLIENT_ID ?? '00000000-0000-0000-0000-000000000000'}/TenantWarden.Read`,
  `api://${import.meta.env.VITE_AZURE_CLIENT_ID ?? '00000000-0000-0000-0000-000000000000'}/TenantWarden.Write`,
]
