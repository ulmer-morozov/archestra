/**
 * Browser Authentication Utilities
 *
 * Common utilities for browser-based authentication flows
 */
import { BrowserWindow, WebContents } from 'electron';

import log from '@backend/utils/logger';

import { BrowserTokenResponse, OAuthProviderDefinition, TokenExtractionContext } from '../provider-interface';

/**
 * Token extraction handler configuration
 */
interface TokenExtractionConfig {
  window: BrowserWindow;
  provider: OAuthProviderDefinition;
  getWorkspaceId: () => string | null;
  onSuccess: (tokens: BrowserTokenResponse) => void;
}

/**
 * Set up token extraction handlers for browser authentication
 */
export function setupTokenExtractionHandlers(config: TokenExtractionConfig): void {
  const { window, provider, getWorkspaceId, onSuccess } = config;
  const browserConfig = provider.browserAuthConfig;

  if (!browserConfig) {
    log.error(`[Browser Auth] No browser config for provider ${provider.name}`);
    return;
  }

  // Common token extraction logic
  const attemptTokenExtraction = async (eventType: string) => {
    const url = window.webContents.getURL();
    log.info(`[Browser Auth - ${provider.name}] ${eventType}:`, url);

    try {
      const extractionContext: TokenExtractionContext = {
        url,
        workspaceId: getWorkspaceId(),
        provider: provider.name,
      };

      const tokens = await browserConfig.extractTokens({
        webContents: window.webContents,
        session: window.webContents.session,
        context: extractionContext,
      });

      if (tokens) {
        log.info(`[Browser Auth - ${provider.name}] Successfully extracted tokens on ${eventType}`);
        window.close();
        onSuccess(tokens);
      }
    } catch (error) {
      // Token extraction might fail on intermediate pages, which is normal
      log.debug(`[Browser Auth - ${provider.name}] Token extraction attempt on ${eventType} failed:`, error);
    }
  };

  // Extract tokens when page finishes loading
  window.webContents.on('did-finish-load', () => attemptTokenExtraction('page load'));

  // Also listen for navigation within the same page (SPA navigation)
  window.webContents.on('did-navigate-in-page', () => attemptTokenExtraction('in-page navigation'));
}

/**
 * Security settings for browser authentication windows
 */
export const BROWSER_AUTH_WINDOW_CONFIG = {
  width: 1024,
  height: 768,
  webPreferences: {
    // Security settings - keep all security features enabled
    nodeIntegration: false,
    contextIsolation: true,
    webSecurity: true,
    sandbox: true,
    // Security: Block insecure content
    allowRunningInsecureContent: false,
  },
  // Show standard window chrome for transparency
  autoHideMenuBar: false,
  titleBarStyle: 'default' as const,
  frame: true,
};

/**
 * Get session partition name for provider
 */
export function getProviderSessionPartition(providerName: string): string {
  return `persist:${providerName}-auth`;
}

/** Check if full host is on expected domain on is a subdomain of that domain */
function hostIsDomainOrSubdomain(expectedDomain: string, actualHost: string): boolean {
  return (
    actualHost === expectedDomain ||
    (actualHost.endsWith(`.${expectedDomain}`) && actualHost.length > `.${expectedDomain}`.length)
  );
}

/**
 * Function that checks if a URL is allowed based on its domain
 */
export function requireDomainOrSubdomain(domain: string): (url: string) => boolean {
  return (url: string): boolean => {
    // Only allow navigation to official Slack domains
    try {
      const parsedUrl = new URL(url);
      // Allow "example.com", and "*.example.com"
      return hostIsDomainOrSubdomain(domain, parsedUrl.hostname);
    } catch (e) {
      // If URL parsing fails, deny navigation
      return false;
    }
  };
}

/**
 * Check if URL is exact pagee on exact domain
 */
export function urlMatchesPage(url: string, domain: string, ...pageNames: string[]): boolean {
  if (pageNames.length === 0) {
    pageNames.push('/');
  }
  try {
    const parsedUrl = new URL(url);
    return (
      hostIsDomainOrSubdomain(domain, parsedUrl.hostname) &&
      pageNames.some((page) => (page === '/' ? parsedUrl.pathname === '/' : parsedUrl.pathname.startsWith(page)))
    );
  } catch {
    return false;
  }
}

/**
 * Check if URL is exact pagee on exact domain
 */
export function isOnPage(url: string, domain: string, pageName: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return hostIsDomainOrSubdomain(domain, parsedUrl.hostname) && pageName === parsedUrl.pathname;
  } catch {
    return false;
  }
}

/**
 * Wait for exact duration in asynchronous tasks
 */
export function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/**
 * JS Function that waits for a HTML element for a given duration
 */
const WAIT_FOR_ELEMENT_FUNCTION = (durationMs: number) => `
function waitForElement(TConstructor, selector, root = document.body) {
        return new Promise((resolve, reject) => {
            const element = root.querySelector(selector);
            if (element !== null && !(element instanceof TConstructor)) {
                return reject(new Error("Element is not an instance of " + TConstructor.name));
            }
            if (element) {
                return resolve(element);
            }
            let timeoutId;
            const observer = new MutationObserver(() => {
                const observedElement = root.querySelector(selector);
                if (observedElement) {
                    observer.disconnect();
                    clearTimeout(timeoutId);
                    if (observedElement instanceof TConstructor) {
                        return resolve(observedElement);
                    }
                    return reject(new Error("Element is not an instance of " + TConstructor.name));
                }
            });
            timeoutId = setTimeout(() => {
                observer.disconnect();
                reject(new Error("Element not found:" + selector));
            }, ${durationMs});
            observer.observe(root, {
                childList: true,
                subtree: true,
            });
        });
    }`;

/**
 * Wait for an element in Electron Window
 */
export async function waitForElement(wc: WebContents, selector: string) {
  console.log('[Browser Auth] Waiting for element:', selector);

  return wc.executeJavaScript(`
(async function () {
    ${WAIT_FOR_ELEMENT_FUNCTION(30_000)}
    try {
      await waitForElement(HTMLElement, ${JSON.stringify(selector)});
      return true;
    }
    catch (e) {
        console.error("Error waiting for element", e);
        return false;
    }
})();
  `);
}

/**
 * Wait for an element in Electron Window and focus on it
 */
export function focusOnElement(wc: WebContents, selector: string) {
  console.log('[Browser Auth] Focusing on element:', selector);
  return wc.executeJavaScript(`
(async function () {
    ${WAIT_FOR_ELEMENT_FUNCTION(30_000)}
    try {
      const element = await waitForElement(HTMLElement, ${JSON.stringify(selector)});
      element.focus();
      return true;
    }
    catch (e) {
        console.error("Error focusing on element", e);
        return false;
    }
})();
  `);
}

/**
 * Wait for an element in Electron Window and click on it
 */
export function clickOnElement(wc: WebContents, selector: string) {
  console.log('[Browser Auth] Clicking on element:', selector);
  return wc.executeJavaScript(`
   (async function () {
    ${WAIT_FOR_ELEMENT_FUNCTION(30_000)}
    try {
      const element = await waitForElement(HTMLElement, ${JSON.stringify(selector)});
      element.click();
      return true;
    }
    catch (e) {
        console.error("Error clicking on element", e);
        return false;
    }
})();
  `);
}

/**
 * Wait for an HTMLInputElement in Electron Window and get value from it
 */
export function getValueFromInput(wc: WebContents, selector: string): Promise<{ error?: string; value: string }> {
  console.log('[Browser Auth] Getting value from input:', selector);
  return wc.executeJavaScript(`
   (async function () {
    ${WAIT_FOR_ELEMENT_FUNCTION(30_000)}
    try {
      const element = await waitForElement(HTMLInputElement, ${JSON.stringify(selector)});
      return {value: element.value};
    }
    catch (e) {
        console.error("Error getting value for element", e);
        return {error: e.message, value: ''};
    }
})();
  `);
}

/**
 * Simulate keyboard typing in focused input in Electron Window
 */
export async function typeText(wc: WebContents, text: string) {
  console.log('[Browser Auth] Typing text:', text);

  for (const ch of text) {
    wc.sendInputEvent({ type: 'char', keyCode: ch }); // real text input
    await sleep(50);
  }
}
