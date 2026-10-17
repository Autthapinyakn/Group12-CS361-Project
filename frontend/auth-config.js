// Configure these values from your Amazon Cognito User Pool app client before deployment.
// Use an app client WITHOUT a client secret (public SPA client).
export const COGNITO_CONFIG = {
  domain: 'YOUR_COGNITO_DOMAIN.auth.us-east-1.amazoncognito.com',
  clientId: 'YOUR_COGNITO_APP_CLIENT_ID',
  redirectUri: `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}login.html`,
  logoutUri: `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}login.html`,
  scopes: ['openid', 'email', 'profile']
};
