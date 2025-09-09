import { OAuthProviderDefinition } from '../provider-interface';
import {
  clickOnElement,
  focusOnElement,
  getDataAttributeValueFromElement,
  getPropertyFromElement,
  getValueFromInput,
  isOnPage,
  requireDomainOrSubdomain,
  sleep,
  typeText,
} from '../utils/browser-auth-utils';
import { isAtlassianAuthenticatedPage, isAtlassianInLoginPage } from '../utils/jira-token-extractor';

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
      if (!isOnPage(url, 'id.atlassian.com', '/manage-profile/security/api-tokens')) {
        console.log(`[Jira Browser Auth] Not on tokens page ${new URL(url).pathname}. Redirecting...`);
        await webContents.loadURL('https://id.atlassian.com/manage-profile/security/api-tokens');

        return null;
      }

      await sleep(5000);

      // Get user email from profile button
      const userEmail = (
        await getPropertyFromElement(
          webContents,
          "[data-testid='HorizontalNavTopNavigation-secondary-actions'] div:nth-child(2) button",
          'ariaLabel'
        )
      ).orThrow('[Jira Browser Auth] Could not get user email from profile button');

      console.log(`[Jira Browser Auth] Logged in as user: ${userEmail}`);

      const SHOW_APP_BUTTON_SELECTOR = '[data-testid="HorizontalNavTopNavigation-header"] button';

      // open dropdown menu to show available products
      (await clickOnElement(webContents, SHOW_APP_BUTTON_SELECTOR)).orThrow(
        '[Jira Browser Auth] Could not click on show Apps button'
      );

      // duration of waitig for products to appear in menu
      const PRODUCT_WAIT_DELAY = 2000;

      const jiraAttributeValue = await getDataAttributeValueFromElement(
        webContents,
        'a[data-testid^="switcher-item__JIRA_SOFTWARE"]',
        'testid',
        PRODUCT_WAIT_DELAY
      );

      const jiraServerPrefix = jiraAttributeValue.isSuccessfull
        ? jiraAttributeValue.data.substring('switcher-item__JIRA_SOFTWARE'.length)
        : '';

      const confluenceAttributeValue = await getDataAttributeValueFromElement(
        webContents,
        'a[data-testid^="switcher-item__CONFLUENCE"]',
        'testid',
        PRODUCT_WAIT_DELAY
      );

      const confluenceServerPrefix = confluenceAttributeValue.isSuccessfull
        ? confluenceAttributeValue.data.substring('switcher-item__CONFLUENCE'.length)
        : '';

      console.log(`[Jira Browser Auth] Jira server prefix found: ${jiraServerPrefix}`);
      console.log(`[Jira Browser Auth] Confluence server prefix found: ${confluenceServerPrefix}`);

      if (jiraServerPrefix && confluenceServerPrefix) {
        webContents.executeJavaScript(
          `alert("Both Jira and Confluence products are not activated for Atlassian account with email: ${userEmail}. At least one product is required.")`
        );
      }

      (await clickOnElement(webContents, SHOW_APP_BUTTON_SELECTOR)).orThrow(
        '[Jira Browser Auth] Could not click on show Apps button'
      );

      console.log('[Jira Browser Auth] On token managment page, getting token...');

      // click on generate token button
      (await clickOnElement(webContents, "button[data-testid='createApiToken-header']")).orThrow(
        '[Jira Browser Auth] Create new token button not found'
      );

      // selector for main modal element
      const MODAL_SELECTOR = 'section[data-testid="api-token-creation-modal"]';

      // focus on token input name field
      (await focusOnElement(webContents, `${MODAL_SELECTOR} input[name="tokenName"]`)).orThrow(
        '[Jira Browser Auth] Focus on input token name filed has failed'
      );

      // simulate keyboard events
      await typeText(webContents, `ArchestraAI_MCP_${Date.now()}`);

      // click on submit button to send form
      (await clickOnElement(webContents, `${MODAL_SELECTOR} button[type="submit"]`)).orThrow(
        '[Jira Browser Auth] Submiting new token failed'
      );

      // wait a bit for the token
      await sleep(3000);

      // click on token visibility button to show it
      (await clickOnElement(webContents, `${MODAL_SELECTOR} button[data-testid="toggleButton"]`)).orThrow(
        '[Jira Browser Auth] Toggling visibility of a generated token failed'
      );

      // get generated token from input
      const tokenResult = await getValueFromInput(webContents, `${MODAL_SELECTOR} input#apiTokenField`);

      if (tokenResult.isSuccessfull && tokenResult.data.length > 0) {
        // Log success
        console.log('[LinkedIn Browser Auth] Page verification result:', {
          success: true,
        });

        // Return proper BrowserTokenResponse
        return {
          primary_token: tokenResult.data, // This is for Jira API
          secondary_token: tokenResult.data, // Duplicate token for Confluence API
          jira_server_url: `https://${jiraServerPrefix}.atlassian.com`, // User's Jira Server URL
          confluence_server_url: `https://${confluenceServerPrefix}.atlassian.com`, // User's Confluence Server URL
        };
      }

      const error = tokenResult.isSuccessfull ? 'Token is empty. Could not generate token' : tokenResult.error;

      console.log('[LinkedIn Browser Auth] Page verification result:', {
        success: false,
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
