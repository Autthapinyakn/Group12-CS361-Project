// Deployment settings. Fill in the AWS values after deploying (document/deploy/deploy-learner-lab.md).
// When the site runs on localhost (backend `npm run dev`), it uses the local API and a dev sign-in
// that lets you pick a role; that mode is never active on the deployed site.
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const basePath = window.location.pathname.replace(/[^/]*$/, '');

export const CONFIG = isLocal
  ? {
      apiBaseUrl: `${window.location.origin}/api`,
      authMode: 'dev',
    }
  : {
      // API Gateway HTTP API invoke URL (no trailing slash), e.g. https://abc123.execute-api.us-east-1.amazonaws.com
      apiBaseUrl: 'https://aekfus24ab.execute-api.us-east-1.amazonaws.com',
      authMode: 'cognito',
      cognito: {
        // Cognito domain without https://, e.g. cs361-group12.auth.us-east-1.amazoncognito.com
        domain: 'us-east-1is2j9avr9.auth.us-east-1.amazoncognito.com',
        // Public app client (no client secret)
        clientId: 'clq8i6fv6dvdpuqf18c7gllbl',
        scopes: ['openid', 'email', 'profile'],
        redirectUri: `${window.location.origin}${basePath}login.html`,
        logoutUri: `${window.location.origin}${basePath}login.html`,
      },
    };
