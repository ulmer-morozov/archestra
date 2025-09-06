import { OAuthProviderDefinition } from '../provider-interface';
import {
  clickOnElement,
  focusOnElement,
  getValueFromInput,
  requireDomainOrSubdomain,
  sleep,
  typeText,
} from '../utils/browser-auth-utils';
import {
  isAtlassianAuthenticatedPage,
  isAtlassianInLoginPage,
  isAtlassianTokensPage,
} from '../utils/jira-token-extractor';

export const jiraBrowserProvider: OAuthProviderDefinition = {
  name: 'jira-browser',
  authorizationUrl: '', // Not used for browser auth
  scopes: [], // Not used for browser auth
  usePKCE: false, // Not used for browser auth
  clientId: 'browser-auth', // Placeholder

  // Token pattern for Jira
  tokenEnvVarPattern: {
    accessToken: 'JIRA_ACCESS_TOKEN',
  },

  // Browser-based authentication configuration
  browserAuthConfig: {
    enabled: true,
    loginUrl: 'https://id.atlassian.com/login',

    // Map browser tokens to environment variables
    tokenMapping: {
      primary: 'JIRA_API_TOKEN', // Changed to match what the container expects
      secondary: 'CONFLUENCE_API_TOKEN', // Actually the same token
    },

    navigationRules: requireDomainOrSubdomain('atlassian.com'),

    extractTokens: async (windowWithContext) => {
      // Extract the actual window parts and context
      const { webContents, session, context } = windowWithContext;
      const url = webContents.getURL();

      console.log('[Jira Browser Auth] Attempting token extraction on:', url);

      // Check if we're on a login page
      if (isAtlassianInLoginPage(url)) {
        console.log('[Jira Browser Auth] Still on login page, waiting for authentication');
        return null;
      }

      // Only try to extract on authenticated pages
      if (!isAtlassianAuthenticatedPage(url)) {
        console.log(
          `[Jira Browser Auth] Not an authenticated page, waiting for user to log in ${new URL(url).pathname}`
        );
        return null;
      }

      // We need manage tokens page
      if (!isAtlassianTokensPage(url)) {
        console.log(`[Jira Browser Auth] Not on tokens page, waiting for user to navigate ${new URL(url).pathname}`);
        await webContents.loadURL('https://id.atlassian.com/manage-profile/security/api-tokens');

        return null;
      }

      console.log('[Jira Browser Auth] On token managment page, getting token...');

      // click on generate token button
      await clickOnElement(webContents, "button[data-testid='createApiToken-header']");

      // selector for main modal element
      const MODAL_SELECTOR = 'section[data-testid="api-token-creation-modal"]';

      // focus on token input name field
      await focusOnElement(webContents, `${MODAL_SELECTOR} input[name="tokenName"]`);
      // simulate keyboard events
      await typeText(webContents, `ArchestraAI_MCP_${Date.now()}`);

      // click on submit button to send form
      await clickOnElement(webContents, `${MODAL_SELECTOR} button[type="submit"]`);

      // wait a bit for the token
      await sleep(3000);

      // click on token visibility button to show it
      await clickOnElement(webContents, `${MODAL_SELECTOR} button[data-testid="toggleButton"]`);

      // get generated token from input
      const { value: token, error: browserError } = await getValueFromInput(
        webContents,
        `${MODAL_SELECTOR} input#apiTokenField`
      );

      let success = token.length > 0;

      if (success) {
        // Log success
        console.log('[LinkedIn Browser Auth] Page verification result:', {
          success,
        });

        // Return proper BrowserTokenResponse
        return {
          primary_token: token, // This is for Jira API
          secondary_token: token, // Duplicate token for Confluence API
        };
      }

      const error = browserError || 'Token is empty. Could not generate token';

      console.log('[LinkedIn Browser Auth] Page verification result:', {
        success,
        error,
      });

      // Log the error for debugging
      console.error('[LinkedIn Browser Auth] Page verification failed:', error);
      return null;
    },
  },

  metadata: {
    displayName: 'Jira (Browser Auth)',
    documentationUrl: '',
    supportsRefresh: false,
    notes: 'Browser authentication using token genertion from UI. No OAuth app required.',
  },
};
